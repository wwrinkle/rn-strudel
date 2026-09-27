// Parity test: our real-time port (supersawOscillatorProcessor.ts) against
// superdough's actual, unmodified SuperSawOscillatorProcessor class
// (worklets.mjs). Math.random() (per-voice initial phase) is mocked to a
// fixed value so both sides draw identical "random" phases — otherwise
// they'd diverge from the first sample by definition. Also exercises the
// .port.postMessage({type:'initialize'}) reset path directly (this is the
// one processor in this pass that genuinely needs it — see
// supersawOscillatorProcessor.ts's header).

import { supersawOscillatorProcessor } from '../supersawOscillatorProcessor';

// Must be a plain require; see crushProcessor.test.ts for why.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('superdough/worklets.mjs');

const SuperSawOscillatorProcessor = (
  global as unknown as { __registeredProcessors: Record<string, new () => unknown> }
).__registeredProcessors['supersaw-oscillator'];

type RealParams = Record<'begin' | 'end' | 'frequency' | 'panspread' | 'freqspread' | 'detune' | 'voices', Float32Array>;

interface RealSupersawInstance {
  port: { onmessage: ((event: { data: unknown }) => void) | null };
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: RealParams): boolean;
}

const blockSize = 128;
const sampleRate = 44100;
const blockCount = 6;

const REAL_PARAMS: Record<keyof RealParams, number> = {
  begin: 0.002,
  end: 0.02,
  frequency: 220,
  panspread: 0.4,
  freqspread: 0.2,
  detune: 0,
  voices: 4,
};

const makeRealParams = (): RealParams => {
  const result = {} as RealParams;
  for (const key of Object.keys(REAL_PARAMS) as (keyof RealParams)[]) {
    result[key] = new Float32Array([REAL_PARAMS[key]]);
  }
  return result;
};

describe('supersawOscillatorProcessor parity with superdough SuperSawOscillatorProcessor', () => {
  test('matches upstream across consecutive blocks, with a fixed random phase seed', () => {
    const originalRandom = Math.random;
    Math.random = () => 0.5;

    try {
      const realParams = makeRealParams();
      const ourParams = { ...REAL_PARAMS };

      const real = new SuperSawOscillatorProcessor() as unknown as RealSupersawInstance;
      real.port.onmessage?.({ data: { type: 'initialize' } });

      const state = supersawOscillatorProcessor.createState(sampleRate, undefined);
      supersawOscillatorProcessor.onMessage?.(state, { type: 'initialize' });

      (global as unknown as { currentTime: number }).currentTime = 0;

      for (let b = 0; b < blockCount; b++) {
        const realOutputL = new Float32Array(blockSize);
        const realOutputR = new Float32Array(blockSize);
        real.process([[]], [[realOutputL, realOutputR]], realParams);

        const ourOutputL = new Float32Array(blockSize);
        const ourOutputR = new Float32Array(blockSize);
        supersawOscillatorProcessor.process(
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
    } finally {
      Math.random = originalRandom;
    }
  });
});
