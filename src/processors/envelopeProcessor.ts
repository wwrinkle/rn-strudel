// Real-time port of superdough's EnvelopeProcessor (worklets.mjs) — an ADSR
// control-signal generator (mono, no audio input), source-style. Registered
// in register.ts as 'envelope-processor'.
//
// `_warp`/`_advance` were instance methods referencing `this.val`/
// `this.beginTime` in the original; ported here as nested functions closing
// over `state` (passed in, not `this`) — same self-containment rule as
// every other processor in this directory. `currentTime` (a global in the
// original's AudioWorkletGlobalScope) is passed explicitly — see types.ts.
//
// Ported as faithfully as possible, including a subtlety worth flagging
// rather than "fixing": state transitions are checked once per sample
// AFTER computing that sample's value from the state active at the START
// of the iteration, so multiple transitions within one sample only
// re-fetch `time` for the next segment, not `start`/`target`/`curve` — an
// artifact of the original's loop structure, preserved intentionally for
// fidelity.

import type { WorkletProcessorModule } from 'rn-web-audio-compat';

interface EnvelopeState {
  val: number;
  segmentIndex: number;
  beginTime: number;
  endTime: number;
  attackStart: number;
}

export const envelopeProcessor: WorkletProcessorModule<EnvelopeState> = {
  kind: 'source',
  parameterDescriptors: [
    { name: 'begin', defaultValue: 0 },
    { name: 'end', defaultValue: 0 },
    { name: 'attack', defaultValue: 0.005 },
    { name: 'decay', defaultValue: 0.14 },
    { name: 'sustain', defaultValue: 0 },
    { name: 'release', defaultValue: 0.1 },
    { name: 'attackCurve', defaultValue: 0 },
    { name: 'decayCurve', defaultValue: 0 },
    { name: 'releaseCurve', defaultValue: 0 },
    { name: 'depth', defaultValue: 1 },
    { name: 'min', defaultValue: -1e9 },
    { name: 'max', defaultValue: 1e9 },
    { name: 'retrigger', defaultValue: 1 },
  ],

  createState: () => ({
    val: 0,
    segmentIndex: 0,
    beginTime: 0,
    endTime: 0,
    attackStart: 0,
  }),

  process: (state, _input, output, params, framesToProcess, _sampleRate, currentTime) => {
    'worklet';

    const begin = params.begin;
    const end = params.end;
    if (currentTime >= end) {
      output[0].fill(0);
      return;
    }
    if (currentTime <= begin) {
      output[0].fill(0);
      return;
    }

    const warp = (phase: number, curvature: number, strength = 8): number => {
      if (phase === 0 || phase === 1) return phase;
      if (curvature > 0) {
        const exp = 1 + strength * curvature;
        return 1 - Math.pow(1 - phase, exp);
      }
      const exp = 1 - strength * curvature;
      return Math.pow(phase, exp);
    };

    const advance = (start: number, target: number, time: number, curvature: number): void => {
      if (time === 0 || start === target) {
        state.val = target;
      } else {
        const phase = Math.min(1, (currentTime - state.beginTime) / time);
        state.val = start + (target - start) * warp(phase, curvature);
      }
    };

    const retrigger = params.retrigger >= 0.5;
    if (begin !== state.beginTime && (state.segmentIndex === 0 || retrigger)) {
      state.beginTime = begin;
      state.segmentIndex = 1;
      state.endTime = end;
      state.attackStart = state.val;
    }

    const attack = params.attack;
    const decay = params.decay;
    const sustain = params.sustain;
    const release = params.release;
    const aCurve = params.attackCurve;
    const dCurve = params.decayCurve;
    const rCurve = params.releaseCurve;
    const depth = params.depth;
    const min = params.min;
    const max = params.max;
    const susTime = state.endTime - state.beginTime;

    const out = output[0];
    for (let n = 0; n < framesToProcess; n++) {
      const segments = [
        { time: Number.POSITIVE_INFINITY, start: 0, target: 0, curve: 0 },
        { time: attack, start: state.attackStart, target: 1, curve: aCurve },
        { time: attack + decay, start: 1, target: sustain, curve: dCurve },
        { time: susTime, start: sustain, target: sustain, curve: 0 },
        { time: susTime + release, start: sustain, target: 0, curve: rCurve },
      ];
      let segment = segments[state.segmentIndex];
      advance(segment.start, segment.target, segment.time, segment.curve);
      while (currentTime - state.beginTime >= segment.time) {
        state.segmentIndex = (state.segmentIndex + 1) % segments.length;
        segment = segments[state.segmentIndex];
      }
      out[n] = Math.min(Math.max(state.val * depth, min), max);
    }
  },
};
