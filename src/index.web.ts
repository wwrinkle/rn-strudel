/// <reference path="./strudel.d.ts" />
// Web build of rn-strudel: the browser already has everything Strudel needs, so this is only the same initStrudel()
// API on top of stock @strudel/webaudio + superdough (call it from a user gesture, e.g. a click handler). It lets app
// code shared between web and native stay free of platform checks.

import { repl } from '@strudel/core';
import { miniAllStrings } from '@strudel/mini';
import { webaudioOutput } from '@strudel/webaudio';
import { getAudioContext, initAudio, registerSynthSounds, resetGlobalEffects, samples } from 'superdough';

export interface StrudelScheduler {
  setPattern: (pattern: unknown) => void;
  start: () => void;
  stop: () => void;
}

export interface InitStrudelOptions {
  resetEffectsOnStart?: boolean;
}

export interface StrudelEngine {
  scheduler: StrudelScheduler;
  context: AudioContext;
  sleep: (ms: number) => Promise<void>;
}

let engine: Promise<StrudelEngine> | null = null;

export function initStrudel(options: InitStrudelOptions = {}): Promise<StrudelEngine> {
  if (!engine) {
    engine = (async () => {
      await initAudio();
      miniAllStrings();
      registerSynthSounds();
      const context = getAudioContext() as AudioContext;
      const { scheduler } = repl({ defaultOutput: webaudioOutput, getTime: () => context.currentTime }) as {
        scheduler: StrudelScheduler;
      };
      const start = scheduler.start.bind(scheduler);
      scheduler.start = () => {
        if (options.resetEffectsOnStart ?? true) resetGlobalEffects();
        start();
      };
      const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      return { scheduler, context, sleep };
    })();
  }
  return engine;
}

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
    })();
  }
  return defaultSamples;
}

// No-op option API on web (nothing to switch there), so shared code can call it unconditionally.
export function setStrudelOptions(_: Record<string, boolean>): void {}
