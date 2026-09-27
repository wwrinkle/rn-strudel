// Real-time port of superdough's CrushProcessor (worklets.mjs).
// superdough itself credits this processor's bitcrush math to dktr0's
// WebDirt (GPLv3): https://github.com/dktr0/WebDirt/blob/5ce3d698362c54d6e1b68acc47eb2955ac62c793/dist/AudioWorklets.js
// Superdough source: https://codeberg.org/uzu/strudel (AGPL-3.0-or-later),
// packages/superdough/worklets.mjs, class CrushProcessor. Registered in webAudioShim.ts
// under the same processor name superdough uses: 'crush-processor'
// (superdough.mjs: `getWorklet(ac, 'crush-processor', { crush: fx.crush })`).
//
// `process` is marked 'worklet' at its definition site (not just the call
// site) — the standard Reanimated/worklets pattern for a function meant to
// run on a worklet runtime when it's defined in a different module than
// where it's installed. Confirmed working on-device (see webAudioShim.ts).

import type { WorkletProcessorModule } from 'rn-web-audio-compat';

export const crushProcessor: WorkletProcessorModule<null> = {
  kind: 'effect',
  parameterDescriptors: [{ name: 'crush', defaultValue: 0 }],

  createState: () => null,

  process: (_state, input, output, params, framesToProcess, _sampleRate, _currentTime) => {
    'worklet';

    const crush = Math.max(1, params.crush ?? 8);
    const x = Math.pow(2, crush - 1);

    for (let channel = 0; channel < output.length; channel++) {
      const inChannel = input[channel];
      const outChannel = output[channel];
      for (let n = 0; n < framesToProcess; n++) {
        outChannel[n] = Math.round(inChannel[n] * x) / x;
      }
    }
  },
};
