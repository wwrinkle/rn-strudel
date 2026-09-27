// Parity test: our real-time port (envelopeProcessor.ts) against
// superdough's actual, unmodified EnvelopeProcessor class (worklets.mjs).
// Steps `currentTime` across enough blocks to cover the full attack ->
// decay -> sustain -> release arc. See lfoProcessor.test.ts / jest.setup.js
// for the shared currentTime-stepping approach.

import { envelopeProcessor } from '../envelopeProcessor';

// Must be a plain require; see crushProcessor.test.ts for why.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('superdough/worklets.mjs');

const EnvelopeProcessor = (global as unknown as { __registeredProcessors: Record<string, new () => unknown> })
  .__registeredProcessors['envelope-processor'];

type RealParams = Record<
  | 'begin'
  | 'end'
  | 'attack'
  | 'decay'
  | 'sustain'
  | 'release'
  | 'attackCurve'
  | 'decayCurve'
  | 'releaseCurve'
  | 'depth'
  | 'min'
  | 'max'
  | 'retrigger',
  Float32Array
>;

interface RealEnvelopeInstance {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: RealParams): boolean;
}

const blockSize = 128;
const sampleRate = 44100;
const blockCount = 30; // ~0.087s, covers begin=0.01 through release ending ~0.06

const REAL_PARAMS: Record<keyof RealParams, number> = {
  begin: 0.01,
  end: 0.03,
  attack: 0.005,
  decay: 0.01,
  sustain: 0.4,
  release: 0.015,
  attackCurve: 0,
  decayCurve: 0,
  releaseCurve: 0,
  depth: 1,
  min: -1e9,
  max: 1e9,
  retrigger: 1,
};

const makeRealParams = (): RealParams => {
  const result = {} as RealParams;
  for (const key of Object.keys(REAL_PARAMS) as (keyof RealParams)[]) {
    result[key] = new Float32Array([REAL_PARAMS[key]]);
  }
  return result;
};

describe('envelopeProcessor parity with superdough EnvelopeProcessor', () => {
  test('matches upstream across the full attack/decay/sustain/release arc', () => {
    const realParams = makeRealParams();
    const ourParams = { ...REAL_PARAMS };

    const real = new EnvelopeProcessor() as unknown as RealEnvelopeInstance;
    const state = envelopeProcessor.createState(sampleRate, undefined);

    (global as unknown as { currentTime: number }).currentTime = 0;

    for (let b = 0; b < blockCount; b++) {
      const realOutput = new Float32Array(blockSize);
      real.process([[]], [[realOutput]], realParams);

      const ourOutput = new Float32Array(blockSize);
      envelopeProcessor.process(
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
        expect(our64[n]).toBeCloseTo(real64[n], 5);
      }

      (global as unknown as { currentTime: number }).currentTime += blockSize / sampleRate;
    }
  });
});
