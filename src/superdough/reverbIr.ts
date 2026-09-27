// Cached reverb impulse responses for .room() (optimizations.ts 'reverbIrCache').
//
// superdough regenerates the noise IR every time an orbit's reverb is created (every pattern start, since
// resetGlobalEffects() drops the orbits) and every time a pattern changes .roomsize/.roomfade/.roomlp/.roomdim: about
// 5 ms of JS-thread work each (plus an OfflineAudioContext render for the lowpass sweep). The IR is random noise
// shaped by those parameters, so an IR generated earlier with the same parameters is as good as a new one; this keeps
// the last few and reuses them.
//
// generateReverbIr is a port of superdough's reverbGen.mjs generateReverb/applyGradualLowpass (which superdough doesn't
// export), itself from https://github.com/adelespinasse/reverbGen:
//   Copyright 2014 Alan deLespinasse. Licensed under the Apache License, Version 2.0
//   (http://www.apache.org/licenses/LICENSE-2.0).
// Same math, except the exponential decay is computed incrementally instead of Math.pow per sample.

import type { AudioBuffer, BaseAudioContext } from 'react-native-audio-api';

const MAX_CACHED_IRS = 8;

export interface ReverbIrParams {
  decayTime: number;
  fadeInTime: number;
  lpFreqStart: number;
  lpFreqEnd: number;
}

type IrCallback = (buffer: AudioBuffer) => void;

const cache = new Map<string, AudioBuffer>();
const pending = new Map<string, IrCallback[]>();

function cacheKey(context: BaseAudioContext, p: ReverbIrParams): string {
  return `${context.sampleRate}|${p.decayTime}|${p.fadeInTime}|${p.lpFreqStart}|${p.lpFreqEnd}`;
}

// Calls back synchronously on a cache hit, otherwise once the IR is generated (later, if the lowpass sweep needs an
// offline render). Concurrent requests for the same parameters share one generation.
export function getCachedReverbIr(context: BaseAudioContext, params: ReverbIrParams, callback: IrCallback): void {
  const key = cacheKey(context, params);
  const hit = cache.get(key);
  if (hit) {
    // Refresh recency (Map iteration order is insertion order; the oldest entry is evicted first).
    cache.delete(key);
    cache.set(key, hit);
    console.log(`[REVERB-IR] cache hit ${key}`);
    callback(hit);
    return;
  }
  const waiting = pending.get(key);
  if (waiting) {
    waiting.push(callback);
    return;
  }
  pending.set(key, [callback]);
  const started = Date.now();
  generateReverbIr(context, params, (buffer) => {
    console.log(`[REVERB-IR] generated ${key} in ${Date.now() - started} ms`);
    cache.set(key, buffer);
    while (cache.size > MAX_CACHED_IRS) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    const callbacks = pending.get(key) ?? [];
    pending.delete(key);
    callbacks.forEach((cb) => cb(buffer));
  });
}

export function generateReverbIr(context: BaseAudioContext, params: ReverbIrParams, callback: IrCallback): void {
  const sampleRate = context.sampleRate;
  const numChannels = 2;
  // decayTime is the -60 dB fade time; the IR runs 50% longer to reach -90 dB.
  const totalTime = params.decayTime * 1.5;
  const decaySampleFrames = Math.round(params.decayTime * sampleRate);
  const numSampleFrames = Math.round(totalTime * sampleRate);
  const fadeInSampleFrames = Math.round((params.fadeInTime || 0) * sampleRate);
  const decayBase = Math.pow(1 / 1000, 1 / decaySampleFrames);
  const ir = context.createBuffer(numChannels, numSampleFrames, sampleRate);
  for (let i = 0; i < numChannels; i++) {
    const chan = ir.getChannelData(i);
    let decay = 1;
    for (let j = 0; j < numSampleFrames; j++) {
      chan[j] = (Math.random() * 2 - 1) * decay;
      decay *= decayBase;
    }
    for (let j = 0; j < fadeInSampleFrames; j++) {
      chan[j] *= j / fadeInSampleFrames;
    }
  }
  applyGradualLowpass(ir, params.lpFreqStart || 0, params.lpFreqEnd || 0, params.decayTime, callback);
}

function applyGradualLowpass(
  input: AudioBuffer,
  lpFreqStart: number,
  lpFreqEnd: number,
  lpFreqEndAt: number,
  callback: IrCallback,
): void {
  if (lpFreqStart === 0) {
    callback(input);
    return;
  }
  // The global OfflineAudioContext (rnGlobalPolyfills.ts), same as superdough uses.
  const Offline = (
    globalThis as unknown as {
      OfflineAudioContext: new (channels: number, length: number, sampleRate: number) => BaseAudioContext & {
        startRendering: () => Promise<AudioBuffer>;
      };
    }
  ).OfflineAudioContext;
  const offline = new Offline(input.numberOfChannels, input.length, input.sampleRate);
  const player = offline.createBufferSource();
  player.buffer = input;
  const filter = offline.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.0001;
  filter.frequency.setValueAtTime(Math.min(lpFreqStart, input.sampleRate / 2), 0);
  filter.frequency.linearRampToValueAtTime(Math.min(lpFreqEnd, input.sampleRate / 2), lpFreqEndAt);
  player.connect(filter);
  filter.connect(offline.destination);
  player.start();
  offline
    .startRendering()
    .then(callback)
    .catch((err: unknown) => console.log('[REVERB-IR] offline render failed', err));
}
