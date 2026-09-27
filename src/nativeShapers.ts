// Native (no-JS-per-block) versions of superdough's memoryless waveshaping effects: shape-processor,
// distort-processor and crush-processor. Each is a plain GainNode -> WaveShaperNode -> GainNode(postgain) chain whose curve is computed
// once by running the existing processor's own math over a -1..1 ramp (so there is no duplicated DSP logic, and the
// Jest parity tests for the processors cover the curves too).
//
// Known differences from the JS worklet versions:
//  - WaveShaperNode clamps its input to [-1, 1]; the worklet computes the curve for any input, so signals louder than
//    1.0 hit the curve edge instead of continuing (matters for fold/sinefold/chebyshev when driven very hard).
//  - The curve is a lookup table (CURVE_SIZE points, linear interpolation), not exact per-sample math.
//  - react-native-audio-api only allows setting a WaveShaperNode's curve ONCE, so changing the amount after the node
//    exists swaps in a fresh WaveShaperNode. superdough sets the amount once, right after construction and before
//    connecting, so the curve is built lazily on first connect to avoid building it twice.

import { WaveShaperNode, type BaseAudioContext } from 'react-native-audio-api';
import { crushProcessor } from './processors/crushProcessor';
import { distortProcessor } from './processors/distortProcessor';
import { shapeProcessor } from './processors/shapeProcessor';

const CURVE_SIZE = 8192;
// crush is a staircase with 2^bits steps, so it needs a finer table than the smooth curves.
const CRUSH_CURVE_SIZE = 32768;
const MAX_CACHED_CURVES = 32;
const curveCache = new Map<string, Float32Array>();

// The processor names this module implements natively (registered by register.ts).
export const SHAPER_PROCESSORS = ['shape-processor', 'distort-processor', 'crush-processor'];

function buildCurve(kind: 'shape' | 'distort' | 'crush', algorithm: string | undefined, amount: number): Float32Array {
  const key = `${kind}:${algorithm ?? ''}:${amount}`;
  const cached = curveCache.get(key);
  if (cached) return cached;

  const size = kind === 'crush' ? CRUSH_CURVE_SIZE : CURVE_SIZE;
  const ramp = new Float32Array(size);
  for (let i = 0; i < size; i++) ramp[i] = -1 + (2 * i) / (size - 1);
  const out = new Float32Array(size);

  if (kind === 'shape') {
    shapeProcessor.process(null, [ramp], [out], { shape: amount, postgain: 1 }, size, 48000, 0);
  } else if (kind === 'crush') {
    crushProcessor.process(null, [ramp], [out], { crush: amount }, size, 48000, 0);
  } else {
    const state = distortProcessor.createState(48000, { algorithm });
    distortProcessor.process(state, [ramp], [out], { distort: amount, postgain: 1 }, size, 48000, 0);
  }

  if (curveCache.size >= MAX_CACHED_CURVES) curveCache.delete(curveCache.keys().next().value as string);
  curveCache.set(key, out);
  return out;
}

interface ShaperParam {
  value: number;
  setValueAtTime: (v: number, t?: number) => ShaperParam;
  linearRampToValueAtTime: (v: number, t?: number) => ShaperParam;
  exponentialRampToValueAtTime: (v: number, t?: number) => ShaperParam;
  cancelScheduledValues: (t?: number) => ShaperParam;
}

function makeParam(get: () => number, set: (v: number) => void): ShaperParam {
  const param: ShaperParam = {
    get value() {
      return get();
    },
    set value(v: number) {
      set(v);
    },
    setValueAtTime(v) {
      set(v);
      return param;
    },
    linearRampToValueAtTime(v) {
      set(v);
      return param;
    },
    exponentialRampToValueAtTime(v) {
      set(v);
      return param;
    },
    cancelScheduledValues() {
      return param;
    },
  };
  return param;
}

// Returns an object shaped like an AudioWorkletNode: a real AudioNode (the input gain) with a
// `parameters` map and overridden connect/disconnect that route through the internal chain.
export function createNativeShaper(
  context: BaseAudioContext,
  processorName: string,
  processorOptions?: Record<string, unknown>
): unknown {
  const kind = processorName === 'shape-processor' ? 'shape' : processorName === 'crush-processor' ? 'crush' : 'distort';
  const algorithm = processorOptions?.algorithm as string | undefined;
  let amount = 0;

  const input = context.createGain();
  const output = context.createGain();
  const inputConnect = input.connect.bind(input) as (...a: unknown[]) => unknown;
  const inputDisconnect = input.disconnect.bind(input) as (...a: unknown[]) => unknown;
  const outputConnect = output.connect.bind(output) as (...a: unknown[]) => unknown;
  const outputDisconnect = output.disconnect.bind(output) as (...a: unknown[]) => unknown;
  let shaper: WaveShaperNode | null = null;

  const rebuild = (): void => {
    // The curve must be assigned after construction: passing it in the constructor options was silently ignored by
    // the native node on-device (output stayed an unchanged pass-through). Not connected yet, so no race.
    const next = new WaveShaperNode(context, {
      oversample: 'none',
      channelCount: 2,
      channelCountMode: 'explicit',
    } as never);
    next.curve = buildCurve(kind, algorithm, amount);
    next.connect(output);
    inputConnect(next);
    if (shaper) {
      inputDisconnect(shaper);
      shaper.disconnect();
    }
    shaper = next;
  };

  const parameters = new Map<string, ShaperParam>([
    [
      kind,
      makeParam(
        () => amount,
        (v) => {
          amount = v;
          if (shaper) rebuild();
        }
      ),
    ],
    [
      'postgain',
      makeParam(
        () => output.gain.value,
        (v) => {
          output.gain.value = Math.min(Math.max(v, 0.001), 1);
        }
      ),
    ],
  ]);

  return Object.assign(input, {
    parameters,
    connect: (...a: unknown[]) => {
      if (!shaper) rebuild();
      return outputConnect(...a);
    },
    disconnect: (...a: unknown[]) => {
      if (a.length > 0) return outputDisconnect(...a);
      inputDisconnect();
      shaper?.disconnect();
      return outputDisconnect();
    },
  });
}
