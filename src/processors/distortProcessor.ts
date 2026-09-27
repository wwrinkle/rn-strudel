// Real-time port of superdough's DistortProcessor (worklets.mjs), including
// its 9 waveshaping algorithms (helpers.mjs's distortionAlgorithms: scurve,
// soft, hard, cubic, diode, asym, fold, sinefold, chebyshev). Registered in
// webAudioShim.ts as 'distort-processor'.
//
// The original selects an algorithm FUNCTION at construction time
// (`this.algorithm = getDistortionAlgorithm(processorOptions.algorithm)`)
// and calls it per-sample. Storing a function reference in state and
// calling it from `process` would reintroduce exactly the "closure over a
// value that isn't itself self-contained" risk documented in
// webAudioShim.ts's header — so instead, the algorithm is resolved to a
// plain number index once (JS thread, at construction), and `process`
// switches on that index with every algorithm's math inlined as nested
// functions in its own body (self-contained, matches crush/ladder's
// confirmed-working shape).

import type { WorkletProcessorModule } from 'rn-web-audio-compat';

const ALGORITHM_NAMES = ['scurve', 'soft', 'hard', 'cubic', 'diode', 'asym', 'fold', 'sinefold', 'chebyshev'];

function resolveAlgorithmIndex(algorithm: unknown): number {
  if (typeof algorithm === 'number') {
    return ((algorithm % ALGORITHM_NAMES.length) + ALGORITHM_NAMES.length) % ALGORITHM_NAMES.length;
  }
  if (typeof algorithm === 'string') {
    const index = ALGORITHM_NAMES.indexOf(algorithm);
    return index === -1 ? 0 : index;
  }
  return 0;
}

interface DistortState {
  algorithmIndex: number;
}

export const distortProcessor: WorkletProcessorModule<DistortState> = {
  kind: 'effect',
  parameterDescriptors: [
    { name: 'distort', defaultValue: 0 },
    { name: 'postgain', defaultValue: 1 },
  ],

  createState: (_sampleRate, processorOptions) => ({
    algorithmIndex: resolveAlgorithmIndex(processorOptions?.algorithm),
  }),

  process: (state, input, output, params, framesToProcess) => {
    'worklet';

    // Everything that only depends on the block-constant params is hoisted
    // out of the per-sample loop (Hermes is an interpreter: per-sample
    // closure calls and repeated log1p/cosh cost real audio budget).
    const algorithm = state.algorithmIndex;
    const postgain = Math.min(Math.max(params.postgain, 0.001), 1);
    const k = Math.expm1(params.distort);
    const k1 = 1 + k;
    const k2 = 1 + 2 * k;
    const halfPi = Math.PI / 2;

    // cubic (3)
    const tCubic = Math.log1p(k) / (1 + Math.log1p(k));
    const cubicA = tCubic / 3;
    const cubicDenom = 1 - cubicA;

    // diode (4) / asym (5)
    const asym = algorithm === 5;
    const g = 1 + 2 * k;
    const bias = 0.07 * tCubic;
    const sech = 1 / Math.cosh(g * bias);
    const diodeDenom = Math.max(1e-8, (asym ? 1 : 2) * g * sech * sech);

    // fold (6) / sinefold (7)
    const foldGain = 1 + 0.5 * k;

    // chebyshev (8)
    const kl = 10 * Math.log1p(k);
    const chebSoft = 1 + kl / 20;

    for (let channel = 0; channel < output.length; channel++) {
      const inChannel = input[channel];
      const outChannel = output[channel];

      for (let n = 0; n < framesToProcess; n++) {
        const x = inChannel[n];
        let y: number;
        switch (algorithm) {
          case 0: // scurve
            y = (k1 * x) / (1 + k * (x < 0 ? -x : x));
            break;
          case 1: // soft
            y = Math.tanh(x * k1);
            break;
          case 2: // hard
            y = Math.min(Math.max(k1 * x, -1), 1);
            break;
          case 3: // cubic
            y = Math.tanh(((x - cubicA * x * x * x) / cubicDenom) * k1);
            break;
          case 4: // diode
          case 5: { // asym
            const pos = Math.tanh((x + bias) * k2);
            const neg = Math.tanh((asym ? bias : -x + bias) * k2);
            y = Math.tanh(((pos - neg) / diodeDenom) * k1);
            break;
          }
          case 6: { // fold
            const w = (((foldGain * x + 1) % 4) + 4) % 4;
            y = 1 - Math.abs(w - 2);
            break;
          }
          case 7: { // sinefold
            const w = (((foldGain * x + 1) % 4) + 4) % 4;
            y = Math.sin(halfPi * (1 - Math.abs(w - 2)));
            break;
          }
          case 8: { // chebyshev
            let tnm1 = 1;
            let tnm2 = x;
            let acc = x; // i === 1 contributes tnm2 (= x)
            for (let i = 2; i < 64; i++) {
              const tn = 2 * x * tnm1 - tnm2;
              tnm2 = tnm1;
              tnm1 = tn;
              if (i % 2 === 0) {
                const w = (1.3 * kl) / i;
                acc += (w < 2 ? w : 2) * tn;
              }
            }
            y = Math.tanh(acc * chebSoft);
            break;
          }
          default:
            y = x;
        }
        outChannel[n] = postgain * y;
      }
    }
  },
};
