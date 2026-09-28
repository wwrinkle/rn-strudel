// Real-time port of superdough's LFOProcessor (worklets.mjs) — a
// modulation-signal generator (no audio input), source-style. Registered (register.ts) as 'lfo-processor'.
//
// begin/end gate on the AudioWorkletGlobalScope's `currentTime` global in
// the original; that's now passed explicitly into `process` (see
// types.ts) rather than referenced as a global, since react-native-audio-api
// provides it as a callback argument, not a global.
//
// Waveshape functions (tri/sine/ramp/saw/square/custom/sawblep) are
// superdough's own `waveshapes` dict (worklets.mjs) — inlined here as
// nested functions in process()'s own body (self-contained, see
// distortProcessor.ts's header for why), same math, same shape-index order
// (must match — LFO selects a shape by numeric index into this list).

import type { WorkletProcessorModule } from 'rn-web-audio-compat';

interface LfoState {
  phase: number | null;
}

export const lfoProcessor: WorkletProcessorModule<LfoState> = {
  kind: 'source',
  parameterDescriptors: [
    { name: 'begin', defaultValue: 0 },
    { name: 'time', defaultValue: 0 },
    { name: 'end', defaultValue: 0 },
    { name: 'frequency', defaultValue: 0.5 },
    { name: 'skew', defaultValue: 0.5 },
    { name: 'depth', defaultValue: 1 },
    { name: 'phaseoffset', defaultValue: 0 },
    { name: 'shape', defaultValue: 0 },
    { name: 'curve', defaultValue: 1 },
    { name: 'dcoffset', defaultValue: 0 },
    { name: 'min', defaultValue: -1e9 },
    { name: 'max', defaultValue: 1e9 },
  ],

  createState: () => ({ phase: null }),

  process: (state, _input, output, params, framesToProcess, sampleRate, currentTime) => {
    'worklet';

    const begin = params.begin;
    const end = params.end;
    if (currentTime >= end || currentTime <= begin) {
      // Real Web Audio guarantees a zeroed output buffer per call; ours
      // doesn't promise that (buffers may be reused), so zero explicitly
      // rather than assume.
      for (let channel = 0; channel < output.length; channel++) {
        output[channel].fill(0);
      }
      return;
    }

    const TWO_PI = 2 * Math.PI;
    const frac = (x: number): number => x - Math.floor(x);

    // Matches worklets.mjs's `waveshapes` dict, same order (LFO selects a
    // shape by numeric index into this list — order is load-bearing).
    const shapeNames = ['tri', 'sine', 'ramp', 'saw', 'square', 'custom', 'sawblep'];
    const polyBlep = (phase: number, dt: number): number => {
      dt = Math.min(dt, 1 - dt);
      const invdt = 1 / dt;
      if (phase < dt) {
        phase *= invdt;
        return 2 * phase - phase ** 2 - 1;
      } else if (phase > 1 - dt) {
        phase = (phase - 1) * invdt;
        return phase ** 2 + 2 * phase + 1;
      }
      return 0;
    };
    const waveshape = (name: string, phase: number, skew: number): number => {
      switch (name) {
        case 'tri': {
          const x = 1 - skew;
          if (phase >= skew) {
            return 1 / x - phase / x;
          }
          return phase / skew;
        }
        case 'sine':
          return Math.sin(TWO_PI * phase) * 0.5 + 0.5;
        case 'ramp':
          return phase;
        case 'saw':
          return 1 - phase;
        case 'square':
          return phase >= skew ? 0 : 1;
        case 'custom': {
          // Faithful to upstream, including a real footgun: custom(phase,
          // values=[0,1]) expects an array, but LFO always calls
          // waveshapes[shape](phase, skew) positionally — skew is a plain
          // number here, so `values.length` is undefined and this
          // cascades to NaN. Not this port's bug to fix; matches upstream
          // exactly (confirmed by parity test).
          const values = skew as unknown as number[];
          const numParts = values.length - 1;
          const currPart = Math.floor(phase * numParts);
          const partLength = 1 / numParts;
          const startVal = Math.min(Math.max(values[currPart], 0), 1);
          const endVal = Math.min(Math.max(values[currPart + 1], 0), 1);
          const slope = (endVal - startVal) / partLength;
          return slope * (phase - partLength * currPart) + startVal;
        }
        case 'sawblep': {
          const v = 2 * phase - 1;
          // Reuses `skew` as the polyBlep `dt` arg, matching the original's
          // positional call shape exactly (waveshapes[shape](phase, skew)).
          return v - polyBlep(phase, skew);
        }
        default:
          return phase;
      }
    };

    const frequency = params.frequency;
    const time = params.time;
    const depth = params.depth;
    const skew = params.skew;
    const phaseoffset = params.phaseoffset;
    const curve = params.curve;
    const dcoffset = params.dcoffset;
    const min = params.min;
    const max = params.max;
    const shapeIndex = Math.max(0, Math.min(shapeNames.length - 1, Math.floor(params.shape)));
    const shape = shapeNames[shapeIndex];

    if (state.phase == null) {
      state.phase = frac(time * frequency + phaseoffset);
    }
    const dt = frequency * (1 / sampleRate);

    for (let n = 0; n < framesToProcess; n++) {
      let modval = (waveshape(shape, state.phase, skew) + dcoffset) * depth;
      modval = Math.pow(modval, curve);
      const clamped = Math.min(Math.max(modval, min), max);
      for (let channel = 0; channel < output.length; channel++) {
        output[channel][n] = clamped;
      }

      state.phase += dt;
      if (state.phase > 1.0) {
        state.phase -= 1;
      }
    }
  },
};
