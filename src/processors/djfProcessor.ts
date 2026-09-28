// Real-time port of superdough's DJFProcessor (worklets.mjs): a single-knob "DJ filter". The centre is bypass; one
// direction sweeps toward a lowpass, the other toward a highpass. Superdough source: https://codeberg.org/uzu/strudel
// (AGPL-3.0-or-later). Registered (register.ts) under superdough's name, 'djf-processor'.
//
// State (one two-pole filter per channel) is created per node by createState() and grows as channels appear. The
// original's TwoPoleFilter class and module-level constants are inlined into `process`, which must be self-contained
// (rn-web-audio-compat's docs/FINDINGS.md, "Worklet rules"). Uses framesToProcess instead of the original's fixed 128.

import type { WorkletProcessorModule } from 'rn-web-audio-compat';

interface TwoPoleFilterState {
  s0: number;
  s1: number;
}

export const djfProcessor: WorkletProcessorModule<TwoPoleFilterState[]> = {
  kind: 'effect',
  parameterDescriptors: [{ name: 'value', defaultValue: 0.5 }],

  createState: () => [],

  process: (channels, input, output, params, framesToProcess, sampleRate, _currentTime) => {
    'worklet';

    while (channels.length < output.length) {
      channels.push({ s0: 0, s1: 0 });
    }

    const value = Math.min(Math.max(params.value, 0), 1);
    let filterType = 0; // 0 none, 1 lopass, 2 hipass
    let v = 1;
    if (value > 0.51) {
      filterType = 2;
      v = (value - 0.5) * 2;
    } else if (value < 0.49) {
      filterType = 1;
      v = value * 2;
    }

    if (filterType === 0) {
      for (let channel = 0; channel < output.length; channel++) {
        const inChannel = input[channel];
        const outChannel = output[channel];
        for (let n = 0; n < framesToProcess; n++) {
          outChannel[n] = inChannel[n];
        }
      }
      return;
    }

    // Same two-pole state-variable filter as the original's TwoPoleFilter,
    // with its cutoff/resonance-dependent coefficients hoisted out of the
    // per-sample loop (cutoff and resonance are constant across a block).
    const cutoff = Math.pow(v * 11, 4);
    const resonance = 0.1;
    const clampedCutoff = Math.min(Math.max(cutoff, 0), sampleRate / 2 - 1);
    const c = Math.min(Math.max(2 * Math.sin(clampedCutoff * Math.PI * (1 / sampleRate)), 0), 1.14);
    const r = Math.pow(0.5, 8 * resonance + 1);
    const mrc = 1 - r * c;
    const isLopass = filterType === 1;

    for (let channel = 0; channel < output.length; channel++) {
      const state = channels[channel];
      const inChannel = input[channel];
      const outChannel = output[channel];
      let s0 = state.s0;
      let s1 = state.s1;

      for (let n = 0; n < framesToProcess; n++) {
        const x = inChannel[n];
        s0 = mrc * s0 - c * s1 + c * x;
        s1 = mrc * s1 + c * s0;
        outChannel[n] = isLopass ? s1 : x - s1;
      }

      state.s0 = s0;
      state.s1 = s1;
    }
  },
};
