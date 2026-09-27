// Parity test: our real-time port (pulseOscillatorProcessor.ts) against
// superdough's actual, unmodified PulseOscillatorProcessor class
// (worklets.mjs). See lfoProcessor.test.ts / jest.setup.js for the shared
// currentTime-stepping approach.

import { pulseOscillatorProcessor } from '../pulseOscillatorProcessor';

// Must be a plain require; see crushProcessor.test.ts for why.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('superdough/worklets.mjs');

const PulseOscillatorProcessor = (global as unknown as { __registeredProcessors: Record<string, new () => unknown> })
  .__registeredProcessors['pulse-oscillator'];

type RealParams = Record<'begin' | 'end' | 'frequency' | 'detune' | 'pulsewidth', Float32Array>;

interface RealPulseInstance {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: RealParams): boolean;
}

const blockSize = 128;
const sampleRate = 44100;
const blockCount = 10;

const REAL_PARAMS: Record<keyof RealParams, number> = {
  begin: 0.003,
  end: 0.02,
  frequency: 220,
  detune: 0,
  pulsewidth: 0.3,
};

const makeRealParams = (): RealParams => {
  const result = {} as RealParams;
  for (const key of Object.keys(REAL_PARAMS) as (keyof RealParams)[]) {
    result[key] = new Float32Array([REAL_PARAMS[key]]);
  }
  return result;
};

describe('pulseOscillatorProcessor parity with superdough PulseOscillatorProcessor', () => {
  test('matches upstream across consecutive blocks, both channels', () => {
    const realParams = makeRealParams();
    const ourParams = { ...REAL_PARAMS };

    const real = new PulseOscillatorProcessor() as unknown as RealPulseInstance;
    const state = pulseOscillatorProcessor.createState(sampleRate, undefined);

    (global as unknown as { currentTime: number }).currentTime = 0;

    for (let b = 0; b < blockCount; b++) {
      const realOutputL = new Float32Array(blockSize);
      const realOutputR = new Float32Array(blockSize);
      real.process([[]], [[realOutputL, realOutputR]], realParams);

      const ourOutputL = new Float32Array(blockSize);
      const ourOutputR = new Float32Array(blockSize);
      pulseOscillatorProcessor.process(
        state,
        [],
        [ourOutputL, ourOutputR],
        ourParams,
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
