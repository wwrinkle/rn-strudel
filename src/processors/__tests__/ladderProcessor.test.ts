// Parity test: our real-time port (ladderProcessor.ts) against superdough's
// actual, unmodified LadderProcessor class (worklets.mjs). Runs several
// consecutive blocks through both, not just one — ladder is stateful (the
// four filter stages persist across blocks), so a single-block test
// wouldn't exercise the part most likely to drift: state carried between
// consecutive process() calls. See crushProcessor.test.ts and jest.setup.js
// for the shared mocking approach.

import { ladderProcessor } from '../ladderProcessor';

// Must be a plain require; see crushProcessor.test.ts for why.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('superdough/worklets.mjs');

const LadderProcessor = (global as unknown as { __registeredProcessors: Record<string, new () => unknown> })
  .__registeredProcessors['ladder-processor'];

interface RealLadderInstance {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: { frequency: Float32Array; q: Float32Array; drive: Float32Array }
  ): boolean;
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

describe('ladderProcessor parity with superdough LadderProcessor', () => {
  test.each([
    { frequency: 500, q: 1, drive: 0.69 },
    { frequency: 1200, q: 4, drive: 1.2 },
    { frequency: 200, q: 0.2, drive: 0.1 },
  ])('matches upstream across consecutive blocks: %o', ({ frequency, q, drive }) => {
    // A real Web Audio AudioParam is always float32, so parameters.q[0] etc.
    // arrive float32-quantized in the real processor. Our shim's params come
    // from a float64 JS number — quantize test inputs through
    // Math.fround for both sides so the comparison isolates the DSP math
    // itself, not that separate (tiny, already-documented) precision gap.
    const freq32 = Math.fround(frequency);
    const q32 = Math.fround(q);
    const drive32 = Math.fround(drive);

    const real = new LadderProcessor() as unknown as RealLadderInstance;
    const state = ladderProcessor.createState(sampleRate, undefined);

    for (let b = 0; b < blockCount; b++) {
      const input = makeBlock(b);

      const realOutput = new Float32Array(blockSize);
      real.process(
        [[input]],
        [[realOutput]],
        {
          frequency: new Float32Array([freq32]),
          q: new Float32Array([q32]),
          drive: new Float32Array([drive32]),
        }
      );

      const ourOutput = new Float32Array(blockSize);
      ladderProcessor.process(
        state,
        [input],
        [ourOutput],
        { frequency: freq32, q: q32, drive: drive32 },
        blockSize,
        sampleRate,
        0
      );

      const real64 = Array.from(realOutput);
      const our64 = Array.from(ourOutput);
      for (let n = 0; n < blockSize; n++) {
        expect(our64[n]).toBeCloseTo(real64[n], 10);
      }
    }
  });
});
