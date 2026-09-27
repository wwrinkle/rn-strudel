// Parity test: our real-time port (distortProcessor.ts) against superdough's
// actual, unmodified DistortProcessor class + all 9 distortionAlgorithms
// (worklets.mjs / helpers.mjs). See crushProcessor.test.ts / jest.setup.js
// for the shared mocking approach.

import { distortProcessor } from '../distortProcessor';

// Must be a plain require; see crushProcessor.test.ts for why.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('superdough/worklets.mjs');

const DistortProcessor = (global as unknown as { __registeredProcessors: Record<string, new (opts: unknown) => unknown> })
  .__registeredProcessors['distort-processor'];

interface RealDistortInstance {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: { distort: Float32Array; postgain: Float32Array }
  ): boolean;
}

const makeSignal = (length: number): Float32Array => {
  const signal = new Float32Array(length);
  for (let n = 0; n < length; n++) {
    signal[n] = Math.sin((n / length) * Math.PI * 6) * 0.9;
  }
  return signal;
};

const ALGORITHMS = ['scurve', 'soft', 'hard', 'cubic', 'diode', 'asym', 'fold', 'sinefold', 'chebyshev'];

describe('distortProcessor parity with superdough DistortProcessor', () => {
  test.each(ALGORITHMS)('matches upstream for algorithm=%s', (algorithm) => {
    const blockSize = 128;
    const input = makeSignal(blockSize);
    // A real Web Audio AudioParam is float32; ours is a float64 SharedValue
    // — quantize test inputs through Math.fround for both sides so the
    // comparison isolates the DSP math (see ladderProcessor.test.ts).
    const distort = Math.fround(2);
    const postgain = Math.fround(0.9);

    const real = new DistortProcessor({ processorOptions: { algorithm } }) as unknown as RealDistortInstance;
    const realOutput = new Float32Array(blockSize);
    real.process([[input]], [[realOutput]], {
      distort: new Float32Array([distort]),
      postgain: new Float32Array([postgain]),
    });

    const state = distortProcessor.createState(44100, { algorithm });
    const ourOutput = new Float32Array(blockSize);
    distortProcessor.process(state, [input], [ourOutput], { distort, postgain }, blockSize, 44100, 0);

    const real64 = Array.from(realOutput);
    const our64 = Array.from(ourOutput);
    for (let n = 0; n < blockSize; n++) {
      expect(our64[n]).toBeCloseTo(real64[n], 9);
    }
  });
});
