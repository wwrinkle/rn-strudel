// Real-time port of superdough's ShapeProcessor (worklets.mjs) — a
// waveshaping distortion (distinct algorithm/params from distortProcessor).
// Registered (register.ts) as 'shape-processor'. GPLv3-family
// attribution same as crushProcessor.ts (dktr0's WebDirt) — see that file.
//
// Stateless — no cross-block state needed.

import type { WorkletProcessorModule } from 'rn-web-audio-compat';

export const shapeProcessor: WorkletProcessorModule<null> = {
  kind: 'effect',
  parameterDescriptors: [
    { name: 'shape', defaultValue: 0 },
    { name: 'postgain', defaultValue: 1 },
  ],

  createState: () => null,

  process: (_state, input, output, params, framesToProcess) => {
    'worklet';

    let shape = params.shape;
    shape = shape < 1 ? shape : 1.0 - 4e-10;
    shape = (2.0 * shape) / (1.0 - shape);
    const postgain = Math.max(0.001, Math.min(1, params.postgain));

    for (let channel = 0; channel < output.length; channel++) {
      const inChannel = input[channel];
      const outChannel = output[channel];
      for (let n = 0; n < framesToProcess; n++) {
        const x = inChannel[n];
        outChannel[n] = (((1 + shape) * x) / (1 + shape * Math.abs(x))) * postgain;
      }
    }
  },
};
