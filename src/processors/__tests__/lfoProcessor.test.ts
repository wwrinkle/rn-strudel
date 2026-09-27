// Parity test: our real-time port (lfoProcessor.ts) against superdough's
// actual, unmodified LFOProcessor class (worklets.mjs). Steps `currentTime`
// forward across several simulated blocks (real AudioWorkletGlobalScope
// provides it as a live global; jest.setup.js exposes a settable one for
// the real class to read). See crushProcessor.test.ts / jest.setup.js for
// the shared mocking approach.

import { lfoProcessor } from '../lfoProcessor';

// Must be a plain require; see crushProcessor.test.ts for why.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('superdough/worklets.mjs');

const LFOProcessor = (global as unknown as { __registeredProcessors: Record<string, new () => unknown> })
  .__registeredProcessors['lfo-processor'];

type RealParams = Record<'begin' | 'time' | 'end' | 'frequency' | 'skew' | 'depth' | 'phaseoffset' | 'shape' | 'curve' | 'dcoffset' | 'min' | 'max', Float32Array>;

interface RealLfoInstance {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: RealParams): boolean;
}

const blockSize = 128;
const sampleRate = 44100;
const blockCount = 8;

const makeRealParams = (overrides: Partial<Record<keyof RealParams, number>>): RealParams => {
  const defaults: Record<keyof RealParams, number> = {
    begin: 0,
    time: 0,
    end: 10,
    frequency: 2,
    skew: 0.5,
    depth: 1,
    phaseoffset: 0,
    shape: 1, // 'sine'
    curve: 1,
    dcoffset: 0,
    min: -1e9,
    max: 1e9,
  };
  const merged = { ...defaults, ...overrides };
  const result = {} as RealParams;
  for (const key of Object.keys(merged) as (keyof RealParams)[]) {
    result[key] = new Float32Array([merged[key]]);
  }
  return result;
};

const toOurParams = (real: RealParams): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const key of Object.keys(real) as (keyof RealParams)[]) {
    out[key] = real[key][0];
  }
  return out;
};

describe('lfoProcessor parity with superdough LFOProcessor', () => {
  test.each([0, 1, 2, 3, 4, 5, 6])('matches upstream for shape index=%d', (shapeIndex) => {
    const realParams = makeRealParams({ shape: shapeIndex });
    const ourParams = toOurParams(realParams);

    const real = new LFOProcessor() as unknown as RealLfoInstance;
    const state = lfoProcessor.createState(sampleRate, undefined);

    (global as unknown as { currentTime: number }).currentTime = 0;

    for (let b = 0; b < blockCount; b++) {
      const realOutput = new Float32Array(blockSize);
      real.process([[]], [[realOutput]], realParams);

      const ourOutput = new Float32Array(blockSize);
      lfoProcessor.process(
        state,
        [],
        [ourOutput],
        ourParams,
        blockSize,
        sampleRate,
        (global as unknown as { currentTime: number }).currentTime
      );

      const real64 = Array.from(realOutput);
      const our64 = Array.from(ourOutput);
      for (let n = 0; n < blockSize; n++) {
        // shape=5 ('custom') is a genuine upstream footgun that produces
        // NaN when driven by LFO (see lfoProcessor.ts) — matched
        // faithfully rather than "fixed", so NaN parity counts as a pass.
        if (Number.isNaN(real64[n])) {
          expect(our64[n]).toBeNaN();
        } else {
          expect(our64[n]).toBeCloseTo(real64[n], 6);
        }
      }

      (global as unknown as { currentTime: number }).currentTime += blockSize / sampleRate;
    }
  });
});
