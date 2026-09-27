// Real-time port of superdough's CoarseProcessor (worklets.mjs) — sample
// rate reduction (sample-and-hold). Registered in webAudioShim.ts as
// 'coarse-processor'. GPLv3-family attribution same as crushProcessor.ts
// (dktr0's WebDirt) — see that file.
//
// No cross-block state needed: the sample-and-hold pattern re-anchors at
// n=0 every block (0 % anything === 0, so the first sample of every block
// always takes the "update" branch) — a faithful port of the original,
// including its minor imperfection of the hold pattern's phase resetting
// at block boundaries rather than continuing smoothly. Not this port's bug
// to fix; matches upstream exactly.

import type { WorkletProcessorModule } from 'rn-web-audio-compat';

export const coarseProcessor: WorkletProcessorModule<null> = {
  kind: 'effect',
  parameterDescriptors: [{ name: 'coarse', defaultValue: 1 }],

  createState: () => null,

  process: (_state, input, output, params, framesToProcess) => {
    'worklet';

    const coarse = Math.max(1, params.coarse ?? 0);

    for (let channel = 0; channel < output.length; channel++) {
      const inChannel = input[channel];
      const outChannel = output[channel];
      for (let n = 0; n < framesToProcess; n++) {
        outChannel[n] = n % coarse === 0 ? inChannel[n] : outChannel[n - 1];
      }
    }
  },
};
