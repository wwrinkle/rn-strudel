/// <reference path="./strudel.d.ts" />
// Web build of rn-strudel: the browser already has everything Strudel needs, so this is only the same initStrudel()
// API on top of stock @strudel/webaudio + superdough (call it from a user gesture, e.g. a click handler). It lets app
// code shared between web and native stay free of platform checks.

import * as strudelCore from '@strudel/core';
import { evalScope, evaluate as strudelEvaluate, repl } from '@strudel/core';
import * as strudelMini from '@strudel/mini';
import { miniAllStrings } from '@strudel/mini';
import * as strudelWebaudio from '@strudel/webaudio';
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
  evaluate: (code: string) => Promise<unknown>;
}

// Pattern code runs through @strudel/core's evaluate() (Function(), which Hermes supports). Its names (note, s, ...)
// must be globals, like in the Strudel REPL: evalScope installs them once.
let scopeReady: Promise<unknown> | null = null;
async function evaluatePattern(code: string): Promise<unknown> {
  scopeReady = scopeReady ?? evalScope(strudelCore, strudelMini, strudelWebaudio);
  await scopeReady;
  const { pattern } = (await strudelEvaluate(code)) as { pattern: unknown };
  return pattern;
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
      return { scheduler, context, sleep, evaluate: evaluatePattern };
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

export { bundledSamples } from './bundledSamples.web';
export type { BundledSample } from './bundledSamples.web';

// No-op option API on web (nothing to switch there), so shared code can call it unconditionally.
export function setStrudelOptions(_: Record<string, boolean>): void {}
