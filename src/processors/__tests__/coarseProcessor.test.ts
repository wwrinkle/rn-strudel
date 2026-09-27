// Parity test: our real-time port (coarseProcessor.ts) against superdough's
// actual, unmodified CoarseProcessor class (worklets.mjs). See
// crushProcessor.test.ts / jest.setup.js for the shared mocking approach.

import { coarseProcessor } from '../coarseProcessor';

// Must be a plain require; see crushProcessor.test.ts for why.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('superdough/worklets.mjs');

const CoarseProcessor = (global as unknown as { __registeredProcessors: Record<string, new () => unknown> })
  .__registeredProcessors['coarse-processor'];

interface RealCoarseInstance {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: { coarse: Float32Array }): boolean;
}

const makeSignal = (length: number): Float32Array => {
  const signal = new Float32Array(length);
  for (let n = 0; n < length; n++) {
    signal[n] = Math.sin((n / length) * Math.PI * 6) * 0.8;
  }
  return signal;
};

describe('coarseProcessor parity with superdough CoarseProcessor', () => {
  test.each([1, 2, 3, 4, 8])('matches upstream at coarse=%d', (coarseAmount) => {
    const blockSize = 128;
    const input = makeSignal(blockSize);

    const real = new CoarseProcessor() as unknown as RealCoarseInstance;
    const realOutput = new Float32Array(blockSize);
    real.process([[input]], [[realOutput]], { coarse: new Float32Array([coarseAmount]) });

    const state = coarseProcessor.createState(44100, undefined);
    const ourOutput = new Float32Array(blockSize);
    coarseProcessor.process(state, [input], [ourOutput], { coarse: coarseAmount }, blockSize, 44100, 0);

    expect(Array.from(ourOutput)).toEqual(Array.from(realOutput));
  });
});
