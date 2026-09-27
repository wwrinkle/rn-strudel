// Parity test: our real-time port (transientProcessor.ts) against
// superdough's actual, unmodified TransientProcessor class (worklets.mjs).
// Unlike most other processors here, all config comes from processorOptions
// at construction — no live AudioParams. See crushProcessor.test.ts /
// jest.setup.js for the shared mocking approach.

import { transientProcessor } from '../transientProcessor';

// Must be a plain require; see crushProcessor.test.ts for why.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('superdough/worklets.mjs');

const TransientProcessor = (global as unknown as { __registeredProcessors: Record<string, new (opts: unknown) => unknown> })
  .__registeredProcessors['transient-processor'];

interface RealTransientInstance {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, never>): boolean;
}

const blockSize = 128;
const sampleRate = 44100;
const blockCount = 6;

const makeBlock = (blockIndex: number): Float32Array => {
  const block = new Float32Array(blockSize);
  for (let n = 0; n < blockSize; n++) {
    const t = (blockIndex * blockSize + n) / sampleRate;
    // A sharp transient followed by decay, to actually exercise the
    // attack/sustain envelope-follower split.
    block[n] = (blockIndex === 1 ? 1 : 0.1) * Math.sin(2 * Math.PI * 440 * t);
  }
  return block;
};

describe('transientProcessor parity with superdough TransientProcessor', () => {
  test('matches upstream across consecutive blocks, both channels', () => {
    const options = {
      attackTime: 0.003,
      sustainTime: 0.08,
      attack: 0.6,
      sustain: -0.3,
      sensitivity: 0.5,
      mix: 1,
      begin: 0,
      end: 10,
    };

    const real = new TransientProcessor({ processorOptions: options }) as unknown as RealTransientInstance;
    const state = transientProcessor.createState(sampleRate, options);

    (global as unknown as { currentTime: number }).currentTime = 0;

    for (let b = 0; b < blockCount; b++) {
      const inputL = makeBlock(b);
      const inputR = makeBlock(b).map((v) => v * 0.8);

      const realOutputL = new Float32Array(blockSize);
      const realOutputR = new Float32Array(blockSize);
      real.process(
        [[inputL, inputR]],
        [[realOutputL, realOutputR]],
        {} as Record<string, never>
      );

      const ourOutputL = new Float32Array(blockSize);
      const ourOutputR = new Float32Array(blockSize);
      transientProcessor.process(
        state,
        [inputL, inputR],
        [ourOutputL, ourOutputR],
        {},
        blockSize,
        sampleRate,
        (global as unknown as { currentTime: number }).currentTime
      );

      for (const [real, ours] of [
        [realOutputL, ourOutputL],
        [realOutputR, ourOutputR],
      ] as const) {
        const real64 = Array.from(real);
        const our64 = Array.from(ours);
        for (let n = 0; n < blockSize; n++) {
          expect(our64[n]).toBeCloseTo(real64[n], 6);
        }
      }

      (global as unknown as { currentTime: number }).currentTime += blockSize / sampleRate;
    }
  });
});
