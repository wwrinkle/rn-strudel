// Real-time port of superdough's PulseOscillatorProcessor (worklets.mjs) —
// a "half-Tomisawa" feedback-FM pulse oscillator, source-style. Registered
// in register.ts as 'pulse-oscillator'.
//
// Ported as faithfully as possible, including one upstream quirk kept
// intentionally rather than "fixed": `env` is a local reset to 1 at the
// start of every process() call (block), not carried in persistent state —
// only its exponentially-smoothed derivative `envf` (in state) persists
// across blocks. That's the original's actual behavior, not a bug this
// port introduces.

import type { WorkletProcessorModule } from 'rn-web-audio-compat';

interface PulseOscillatorState {
  phi: number;
  y0: number;
  y1: number;
  b: number;
  dphif: number;
  envf: number;
}

export const pulseOscillatorProcessor: WorkletProcessorModule<PulseOscillatorState> = {
  kind: 'source',
  parameterDescriptors: [
    { name: 'begin', defaultValue: 0 },
    { name: 'end', defaultValue: 0 },
    { name: 'frequency', defaultValue: 440 },
    { name: 'detune', defaultValue: 0 },
    { name: 'pulsewidth', defaultValue: 1 },
  ],

  createState: () => ({
    phi: -Math.PI,
    y0: 0,
    y1: 0,
    b: 2.3,
    dphif: 0,
    envf: 0,
  }),

  process: (state, _input, output, params, framesToProcess, sampleRate, currentTime) => {
    'worklet';

    if (currentTime <= params.begin) {
      for (let channel = 0; channel < output.length; channel++) {
        output[channel].fill(0);
      }
      return;
    }
    if (currentTime >= params.end) {
      for (let channel = 0; channel < output.length; channel++) {
        output[channel].fill(0);
      }
      return;
    }

    const PI = Math.PI;
    const TWO_PI = 2 * PI;
    const invSampleRate = 1 / sampleRate;
    const applySemitoneDetuneToFrequency = (frequency: number, detune: number): number => {
      return frequency * Math.pow(2, detune / 12);
    };

    const pulsewidth = Math.min(Math.max(params.pulsewidth, -0.99), 0.99);
    const pw = (1 - pulsewidth) * PI;
    const detune = params.detune;
    const freq = applySemitoneDetuneToFrequency(params.frequency, detune / 100);
    const dphi = freq * TWO_PI * invSampleRate;

    let env = 1;

    for (let i = 0; i < framesToProcess; i++) {
      state.dphif += 0.1 * (dphi - state.dphif);

      env *= 0.9998;
      state.envf += 0.1 * (env - state.envf);

      state.b = 2.3 * (1 - 0.0001 * freq);
      if (state.b < 0) state.b = 0;

      state.phi += state.dphif;
      if (state.phi >= PI) state.phi -= TWO_PI;

      const out0 = Math.cos(state.phi + state.b * state.y0);
      state.y0 = 0.5 * (out0 + state.y0);

      const out1 = Math.cos(state.phi + state.b * state.y1 + pw);
      state.y1 = 0.5 * (out1 + state.y1);

      const sample = 0.15 * (out0 - out1) * state.envf;
      for (let channel = 0; channel < output.length; channel++) {
        output[channel][i] = sample;
      }
    }
  },
};
