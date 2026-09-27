// Parity test: our real-time port (crushProcessor.ts) against superdough's
// actual, unmodified CrushProcessor class (worklets.mjs) — not a
// reimplementation compared to itself, the genuine upstream source. See
// jest.setup.js for how AudioWorkletProcessor/registerProcessor/sampleRate
// are faked so that module loads outside a real AudioWorkletGlobalScope.

import { crushProcessor } from '../crushProcessor';

// Must be a plain require, not a static import: jest.setup.js's globals need
// to exist before this module's top-level code runs, and static imports are
// hoisted above other statements in this file.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('superdough/worklets.mjs');

const CrushProcessor = (global as unknown as { __registeredProcessors: Record<string, new () => unknown> })
  .__registeredProcessors['crush-processor'];

interface RealCrushInstance {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: { crush: Float32Array }): boolean;
}

const makeSignal = (length: number): Float32Array => {
  const signal = new Float32Array(length);
  for (let n = 0; n < length; n++) {
    signal[n] = Math.sin((n / length) * Math.PI * 4) * 0.8;
  }
  return signal;
};

describe('crushProcessor parity with superdough CrushProcessor', () => {
  test.each([1, 2, 4, 8, 16])('matches upstream at crush=%d', (crushAmount) => {
    const blockSize = 128;
    const input = makeSignal(blockSize);

    // Real superdough processor: single input bus, single channel.
    const real = new CrushProcessor() as unknown as RealCrushInstance;
    const realOutput = new Float32Array(blockSize);
    real.process([[input]], [[realOutput]], { crush: new Float32Array([crushAmount]) });

    // Our port.
    const state = crushProcessor.createState(44100, undefined);
    const ourOutput = new Float32Array(blockSize);
    crushProcessor.process(state, [input], [ourOutput], { crush: crushAmount }, blockSize, 44100, 0);

    expect(Array.from(ourOutput)).toEqual(Array.from(realOutput));
  });
});
