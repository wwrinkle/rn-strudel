// Parity test: our real-time port (djfProcessor.ts) against superdough's
// actual, unmodified DJFProcessor class (worklets.mjs). Runs several
// consecutive blocks through both — djf is stateful (the two-pole filter's
// s0/s1 persist across blocks), so a single-block test wouldn't exercise
// the part most likely to drift. See ladderProcessor.test.ts for the same
// pattern applied to a different stateful processor.

import { djfProcessor } from '../djfProcessor';

// Must be a plain require; see crushProcessor.test.ts for why.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('superdough/worklets.mjs');

const DJFProcessor = (global as unknown as { __registeredProcessors: Record<string, new () => unknown> })
  .__registeredProcessors['djf-processor'];

interface RealDJFInstance {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: { value: Float32Array }): boolean;
}

const blockSize = 128;
const sampleRate = 44100;
const blockCount = 5;

const makeBlock = (blockIndex: number): Float32Array => {
  const block = new Float32Array(blockSize);
  for (let n = 0; n < blockSize; n++) {
    const t = (blockIndex * blockSize + n) / sampleRate;
    block[n] = Math.sin(2 * Math.PI * 220 * t) * 0.8;
  }
  return block;
};

describe('djfProcessor parity with superdough DJFProcessor', () => {
  test.each([
    { value: 0.5 }, // bypass (dead zone)
    { value: 0.9 }, // hipass, wide open
    { value: 0.6 }, // hipass, mostly closed
    { value: 0.1 }, // lopass, mostly closed
    { value: 0.0 }, // lopass, fully closed
  ])('matches upstream across consecutive blocks: %o', ({ value }) => {
    // A real Web Audio AudioParam is always float32; our shim's params come
    // from a float64 JS number — quantize through Math.fround
    // on both sides so the comparison isolates the DSP math itself, not that
    // separate, already-documented precision gap (see ladderProcessor.test.ts).
    const value32 = Math.fround(value);

    const real = new DJFProcessor() as unknown as RealDJFInstance;
    const state = djfProcessor.createState(sampleRate, undefined);

    for (let b = 0; b < blockCount; b++) {
      const input = makeBlock(b);

      const realOutput = new Float32Array(blockSize);
      real.process([[input]], [[realOutput]], { value: new Float32Array([value32]) });

      const ourOutput = new Float32Array(blockSize);
      djfProcessor.process(state, [input], [ourOutput], { value: value32 }, blockSize, sampleRate, 0);

      const real64 = Array.from(realOutput);
      const our64 = Array.from(ourOutput);
      for (let n = 0; n < blockSize; n++) {
        expect(our64[n]).toBeCloseTo(real64[n], 10);
      }
    }
  });
});
