// initStrudel(): one call that brings up Strudel on React Native (import 'rn-strudel/environment' first).
//
// Does, in order: creates (or takes) an AudioContext and makes it browser-like (rn-web-audio-compat), registers
// superdough's processors, replaces superdough's orbit delay and reverb with working versions, initialises superdough
// with that context, and creates a Strudel scheduler driven by an audio-thread clock (so it keeps running with the
// screen locked; plain setInterval stops on Android). Checks that the native kernels are present and throws otherwise.

import { AudioContext } from 'react-native-audio-api';
import {
  assertNativeKernels,
  createAudioClock,
  installWebAudioCompat,
  startBackgroundPlayback,
  stopBackgroundPlayback,
  type AudioClock,
} from 'rn-web-audio-compat';
import { repl } from '@strudel/core';
import { miniAllStrings } from '@strudel/mini';
import { webaudioOutput } from '@strudel/webaudio';
import { initAudio, registerSynthSounds, resetGlobalEffects, samples, setAudioContext } from 'superdough';
import { registerStrudelProcessors, STRUDEL_KERNEL_NAMES } from './register';
import { installFeedbackDelay, isFeedbackDelayInstalled } from './superdough/feedbackDelay';
import { installReverbGuard } from './superdough/reverb';
import { installCrackleCache } from './superdough/crackle';

export interface StrudelScheduler {
  setPattern: (pattern: unknown) => void;
  start: () => void;
  stop: () => void;
  started?: boolean;
}

export interface InitStrudelOptions {
  context?: AudioContext;
  // Clock tick source: native buffer-source events (default, no JS on the audio thread) or the JS worklet clock.
  nativeClock?: boolean;
  // Show the playback notification (Android foreground service) while playing, so audio survives screen lock.
  backgroundPlayback?: boolean;
  // Reset superdough's orbit effects (djf, delay, reverb...) on every start. Without it an orbit effect keeps the last
  // pattern's value until the app restarts. Default true.
  resetEffectsOnStart?: boolean;
}

export interface StrudelEngine {
  scheduler: StrudelScheduler;
  context: AudioContext;
  clock: AudioClock;
  // setTimeout replacement that keeps working with the screen off.
  sleep: (ms: number) => Promise<void>;
}

let engine: Promise<StrudelEngine> | null = null;

// Idempotent: later calls return the same engine (one engine, switch patterns with scheduler.setPattern).
export function initStrudel(options: InitStrudelOptions = {}): Promise<StrudelEngine> {
  if (!engine) {
    engine = create(options).catch((err) => {
      engine = null;
      throw err;
    });
  }
  return engine;
}

async function create(options: InitStrudelOptions): Promise<StrudelEngine> {
  const context = options.context ?? new AudioContext();
  assertNativeKernels(context, ['feedback-delay', 'compressor', 'fdn-reverb', ...STRUDEL_KERNEL_NAMES], 'rn-strudel');

  installWebAudioCompat(context);
  registerStrudelProcessors();
  installFeedbackDelay();
  installReverbGuard();
  if (!isFeedbackDelayInstalled()) {
    throw new Error('rn-strudel: superdough overwrote createFeedbackDelay (import order); delays would have no repeats.');
  }

  setAudioContext(context);
  miniAllStrings();
  registerSynthSounds();
  installCrackleCache();
  await initAudio({ disableWorklets: false });

  const clock = createAudioClock(context, { native: options.nativeClock ?? true });
  const { scheduler } = repl({
    defaultOutput: webaudioOutput,
    getTime: () => context.currentTime,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  }) as { scheduler: StrudelScheduler };

  const start = scheduler.start.bind(scheduler);
  const stop = scheduler.stop.bind(scheduler);
  scheduler.start = () => {
    if (options.resetEffectsOnStart ?? true) resetGlobalEffects();
    if (options.backgroundPlayback ?? true) void startBackgroundPlayback();
    start();
  };
  scheduler.stop = () => {
    if (options.backgroundPlayback ?? true) void stopBackgroundPlayback();
    stop();
  };

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const begin = Date.now();
      const id = clock.setInterval(() => {
        if (Date.now() - begin >= ms) {
          clock.clearInterval(id);
          resolve();
        }
      }, Math.min(50, ms));
    });

  return { scheduler, context, clock, sleep };
}

// strudel.cc's default sample set (the manifests its own init loads, in the same order; order matters where two define
// the same name). Each call only fetches a small JSON manifest; audio files are fetched and decoded on first use.
export const DEFAULT_SAMPLE_MANIFESTS = [
  'tidal-drum-machines.json',
  'piano.json',
  'Dirt-Samples.json',
  'EmuSP12.json',
  'vcsl.json',
  'mridangam.json',
].map((m) => `https://raw.githubusercontent.com/felixroos/dough-samples/main/${m}`);

let defaultSamples: Promise<void> | null = null;

export function loadDefaultSamples(): Promise<void> {
  if (!defaultSamples) {
    defaultSamples = (async () => {
      for (const url of DEFAULT_SAMPLE_MANIFESTS) await samples(url);
    })().catch((err) => {
      defaultSamples = null;
      throw err;
    });
  }
  return defaultSamples;
}
