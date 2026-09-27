// Real-time port of superdough's LadderProcessor (worklets.mjs), a
// Moog-style ladder filter. Superdough source: https://codeberg.org/uzu/strudel
// (AGPL-3.0-or-later), packages/superdough/worklets.mjs, class
// LadderProcessor. Registered in
// webAudioShim.ts under the same processor name superdough uses:
// 'ladder-processor'.
//
// State (the four filter stages, per channel) is created once per
// constructed node via createState() — matches the original's constructor()
// semantics: superdough gets a brand new AudioWorkletNode per hap, so filter
// state never leaks between notes. Channel count isn't known until the
// first process call, so the array grows lazily to match.
//
// `process` is fully self-contained: every helper (fastTanh, the stage
// shape) is declared INSIDE the function body, not as a module-level const
// referenced from it. Two device-crash iterations got here:
//   1. An early version returned `process` from a factory closing over its
//      own mutable `channels` state — crashed on-device (uncaught exception
//      on WorkletProcessingNode's real-time call path -> std::terminate,
//      see webAudioShim.ts and CLAUDE.md). Fixed by threading state through
//      as an explicit argument instead (this file's current shape).
//   2. That fix stopped the crash (try/catch in webAudioShim.ts now catches
//      it) but the block was still silently failing every call — no sound
//      at all. crushProcessor.ts's `process` only ever referenced Math.*
//      globals; this file's `process` referenced TWO_PI/fastTanh/clamp/
//      makeStage as SEPARATE module-level bindings, which the worklet
//      babel transform (operating on this one function's own AST) has no
//      obvious way to pull in as a "free variable" of a different function
//      — Math.* works because it's a true global, not a module import.
//      Inlining everything into process's own body removes that class of
//      reference entirely, matching crush's confirmed-working shape. Not
//      yet re-verified on-device as of this pass — see CLAUDE.md.

import type { WorkletProcessorModule } from 'rn-web-audio-compat';

interface LadderStage {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p32: number;
  p33: number;
  p34: number;
}

export const ladderProcessor: WorkletProcessorModule<LadderStage[]> = {
  kind: 'effect',
  parameterDescriptors: [
    { name: 'frequency', defaultValue: 500 },
    { name: 'q', defaultValue: 1 },
    { name: 'drive', defaultValue: 0.69 },
  ],

  createState: () => [],

  process: (channels, input, output, params, framesToProcess, sampleRate, _currentTime) => {
    'worklet';

    // Cheap tanh approximation, same as the original processor (exact form
    // matters for matching its output, not just "some" saturation curve).
    const fastTanh = (x: number): number => {
      const x2 = x ** 2;
      return (x * (27.0 + x2)) / (27.0 + 9.0 * x2);
    };

    while (channels.length < output.length) {
      channels.push({ p0: 0, p1: 0, p2: 0, p3: 0, p32: 0, p33: 0, p34: 0 });
    }

    const resonance = params.q;
    const drive = Math.min(Math.max(Math.exp(params.drive), 0.1), 2000);

    let cutoff = params.frequency * (2 * Math.PI) * (1 / sampleRate);
    cutoff = cutoff > 1 ? 1 : cutoff;

    const k = Math.min(8, resonance * 0.13);
    // drive makeup * resonance volume loss makeup
    const makeupGain = (1 / drive) * Math.min(1.75, 1 + k);

    for (let channel = 0; channel < output.length; channel++) {
      const stage = channels[channel];
      const inChannel = input[channel];
      const outChannel = output[channel];

      for (let n = 0; n < framesToProcess; n++) {
        const stageOut = stage.p3 * 0.360891 + stage.p32 * 0.41729 + stage.p33 * 0.177896 + stage.p34 * 0.0439725;

        stage.p34 = stage.p33;
        stage.p33 = stage.p32;
        stage.p32 = stage.p3;

        stage.p0 += (fastTanh(inChannel[n] * drive - k * stageOut) - fastTanh(stage.p0)) * cutoff;
        stage.p1 += (fastTanh(stage.p0) - fastTanh(stage.p1)) * cutoff;
        stage.p2 += (fastTanh(stage.p1) - fastTanh(stage.p2)) * cutoff;
        stage.p3 += (fastTanh(stage.p2) - fastTanh(stage.p3)) * cutoff;

        outChannel[n] = stageOut * makeupGain;
      }
    }
  },
};
