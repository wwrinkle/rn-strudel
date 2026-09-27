// Parity test: our real-time port (shapeProcessor.ts) against superdough's
// actual, unmodified ShapeProcessor class (worklets.mjs). See
// crushProcessor.test.ts / jest.setup.js for the shared mocking approach.

import { shapeProcessor } from '../shapeProcessor';

// Must be a plain require; see crushProcessor.test.ts for why.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('superdough/worklets.mjs');

const ShapeProcessor = (global as unknown as { __registeredProcessors: Record<string, new () => unknown> })
  .__registeredProcessors['shape-processor'];

interface RealShapeInstance {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: { shape: Float32Array; postgain: Float32Array }
  ): boolean;
}

const makeSignal = (length: number): Float32Array => {
  const signal = new Float32Array(length);
  for (let n = 0; n < length; n++) {
    signal[n] = Math.sin((n / length) * Math.PI * 6) * 0.9;
  }
  return signal;
};

describe('shapeProcessor parity with superdough ShapeProcessor', () => {
  test.each([
    { shape: 0, postgain: 1 },
    { shape: 0.5, postgain: 0.8 },
    { shape: 0.95, postgain: 0.5 },
  ])('matches upstream at %o', ({ shape, postgain }) => {
    // A real Web Audio AudioParam is float32; ours is a float64 SharedValue
    // — quantize test inputs through Math.fround for both sides so the
    // comparison isolates the DSP math, not that separate, already-
    // documented precision gap (see ladderProcessor.test.ts).
    shape = Math.fround(shape);
    postgain = Math.fround(postgain);

    const blockSize = 128;
    const input = makeSignal(blockSize);

    const real = new ShapeProcessor() as unknown as RealShapeInstance;
    const realOutput = new Float32Array(blockSize);
    real.process([[input]], [[realOutput]], {
      shape: new Float32Array([shape]),
      postgain: new Float32Array([postgain]),
    });

    const state = shapeProcessor.createState(44100, undefined);
    const ourOutput = new Float32Array(blockSize);
    shapeProcessor.process(state, [input], [ourOutput], { shape, postgain }, blockSize, 44100, 0);

    const real64 = Array.from(realOutput);
    const our64 = Array.from(ourOutput);
    for (let n = 0; n < blockSize; n++) {
      expect(our64[n]).toBeCloseTo(real64[n], 10);
    }
  });
});
