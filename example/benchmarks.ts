// Developer benchmarks for rn-strudel's processors (the measurements that guided the C++ ports).
// Run from the example app's Benchmarks panel, or build with EXPO_PUBLIC_AUTORUN=bench to run them all on launch; lines
// are also logged with a [BENCH...] / [NATIVE-CHECK] prefix. Budget: 2.67 ms per 128-frame block at 48 kHz.
//
//  - runEffectBenchmark: each JS processor's process() on the JS thread (Hermes, warm loop), plus the one-time JS
//    costs superdough pays per note / per reverb (noise buffers, impulse response).
//  - runAudioRuntimeBenchmark: the same loop inside an audio-thread worklet callback, to separate "Hermes on the audio
//    runtime is slow" from "real-time cadence (cold caches, low CPU clock) is slow".
//  - runNativeKernelBenchmark: every C++ kernel running concurrently through a real graph; the real per-call render
//    thread time, read back natively.
//  - runNativeCheck: native vs JS version of every natively implemented effect through the real graph (analyser peak /
//    rms / held samples). The bit-exact check is `npm run parity` on the desktop; this catches wiring problems (params
//    not applied, wrong channels, missing signal).

import {
  AudioWorkletNode,
  DynamicsCompressorNode,
  FeedbackDelayNode,
  compressorProcessor,
  createNativeKernelNode,
  feedbackDelayProcessor,
  getNativeTimings,
  installWebAudioCompat,
  resetNativeTimings,
  areNativeProcessorsEnabled,
  setNativeProcessorsEnabled,
  type WorkletProcessorModule,
} from 'rn-web-audio-compat';
import { registerStrudelProcessors } from 'rn-strudel';
import {
  coarseProcessor,
  crushProcessor,
  distortProcessor,
  djfProcessor,
  envelopeProcessor,
  ladderProcessor,
  lfoProcessor,
  pulseOscillatorProcessor,
  shapeProcessor,
  supersawOscillatorProcessor,
  transientProcessor,
} from 'rn-strudel/processors';
import { AudioContext } from 'react-native-audio-api';
import { createSynchronizable } from 'react-native-worklets';

registerStrudelProcessors();

const SAMPLE_RATE = 48000;
const FRAMES = 128;
const BUDGET_MS = (FRAMES / SAMPLE_RATE) * 1000;
const WARMUP_BLOCKS = 300;
const MEASURE_BLOCKS = 3000;

interface Case {
  name: string;
  module: WorkletProcessorModule<any>;
  options?: Record<string, unknown>;
  params?: Record<string, number>;
}

const ACTIVE = { begin: 0, end: 1e9 };

const cases: Case[] = [
  { name: 'crush', module: crushProcessor, params: { crush: 4 } },
  { name: 'coarse', module: coarseProcessor, params: { coarse: 8 } },
  { name: 'shape', module: shapeProcessor, params: { shape: 0.5, postgain: 0.8 } },
  ...['scurve', 'soft', 'hard', 'cubic', 'diode', 'asym', 'fold', 'sinefold', 'chebyshev'].map((algorithm) => ({
    name: `distort (${algorithm})`,
    module: distortProcessor,
    options: { algorithm },
    params: { distort: 2, postgain: 0.6 },
  })),
  {
    name: 'transient',
    module: transientProcessor,
    options: { ...ACTIVE, attack: 1, sustain: -1 },
  },
  { name: 'djf (lowpass)', module: djfProcessor, params: { value: 0.2 } },
  { name: 'ladder filter', module: ladderProcessor, params: { frequency: 800, q: 4, drive: 1 } },
  { name: 'feedback delay', module: feedbackDelayProcessor, params: { delayTime: 0.25, feedback: 0.5, wet: 1 } },
  { name: 'compressor', module: compressorProcessor, params: { threshold: -30, knee: 10, ratio: 8 } },
  { name: 'lfo (source)', module: lfoProcessor, params: { ...ACTIVE, frequency: 5, depth: 1 } },
  { name: 'envelope (source)', module: envelopeProcessor, params: { ...ACTIVE } },
  { name: 'pulse oscillator', module: pulseOscillatorProcessor, params: { ...ACTIVE, frequency: 220, pulsewidth: 0.5 } },
  { name: 'supersaw (5 voices)', module: supersawOscillatorProcessor, params: { ...ACTIVE, frequency: 220, voices: 5 } },
  { name: 'supersaw (9 voices)', module: supersawOscillatorProcessor, params: { ...ACTIVE, frequency: 220, voices: 9 } },
];

function now(): number {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

function makeBuffers(): { input: Float32Array[]; output: Float32Array[] } {
  const input = [new Float32Array(FRAMES), new Float32Array(FRAMES)];
  for (let n = 0; n < FRAMES; n++) {
    const saw = ((n * 220) / SAMPLE_RATE) % 1;
    input[0][n] = (saw * 2 - 1) * 0.5;
    input[1][n] = input[0][n];
  }
  return { input, output: [new Float32Array(FRAMES), new Float32Array(FRAMES)] };
}

function runCase(c: Case): number {
  const { module } = c;
  const params: Record<string, number> = {};
  for (const d of module.parameterDescriptors) params[d.name] = d.defaultValue;
  Object.assign(params, c.params);
  const state = module.createState(SAMPLE_RATE, c.options);
  const { input, output } = makeBuffers();
  const inputs = module.kind === 'source' ? [] : input;
  let t = 1;
  for (let i = 0; i < WARMUP_BLOCKS; i++, t += FRAMES / SAMPLE_RATE) {
    module.process(state, inputs, output, params, FRAMES, SAMPLE_RATE, t);
  }
  const start = now();
  for (let i = 0; i < MEASURE_BLOCKS; i++, t += FRAMES / SAMPLE_RATE) {
    module.process(state, inputs, output, params, FRAMES, SAMPLE_RATE, t);
  }
  return (now() - start) / MEASURE_BLOCKS;
}

function timeMs(fn: () => void, repeats = 5): number {
  fn();
  const start = now();
  for (let i = 0; i < repeats; i++) fn();
  return (now() - start) / repeats;
}

// Same loops as superdough's noise.mjs getNoiseBuffer (2 seconds, mono) and reverbGen.generateReverb (per channel).
function noiseBenchmarks(): { name: string; ms: number }[] {
  const size = 2 * SAMPLE_RATE;
  const out = new Float32Array(size);
  const gens: Record<string, () => void> = {
    'noise: white (2s buffer)': () => {
      for (let i = 0; i < size; i++) out[i] = Math.random() * 2 - 1;
    },
    'noise: brown (2s buffer)': () => {
      let last = 0;
      for (let i = 0; i < size; i++) {
        const w = Math.random() * 2 - 1;
        out[i] = (last + 0.02 * w) / 1.02;
        last = out[i];
      }
    },
    'noise: pink (2s buffer)': () => {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < size; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    },
    'noise: crackle (2s buffer; per note without crackleCache)': () => {
      for (let i = 0; i < size; i++) out[i] = Math.random() < 0.0002 ? Math.random() * 2 - 1 : 0;
    },
    'reverb IR generation (0.9s x 2ch, one-time)': () => {
      const total = Math.round(0.9 * SAMPLE_RATE);
      const decayBase = Math.pow(1 / 1000, 1 / Math.round(0.6 * SAMPLE_RATE));
      const chan = new Float32Array(total);
      for (let ch = 0; ch < 2; ch++) for (let j = 0; j < total; j++) chan[j] = (Math.random() * 2 - 1) * Math.pow(decayBase, j);
    },
  };
  return Object.entries(gens).map(([name, fn]) => ({ name, ms: timeMs(fn) }));
}

export async function runEffectBenchmark(onLine: (line: string) => void): Promise<void> {
  const emit = (line: string): void => {
    console.log(`[BENCH] ${line}`);
    onLine(line);
  };
  emit(`budget per 128-frame block: ${BUDGET_MS.toFixed(2)} ms (${MEASURE_BLOCKS} blocks each, 1 voice, stereo)`);

  const results: { name: string; ms: number }[] = [];
  for (const c of cases) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      results.push({ name: c.name, ms: runCase(c) });
    } catch (err) {
      emit(`${c.name}: FAILED ${String(err)}`);
    }
  }
  results.sort((a, b) => b.ms - a.ms);
  results.forEach(({ name, ms }) => {
    emit(`${name.padEnd(28)} ${(ms * 1000).toFixed(0).padStart(6)} us/block  ${((ms / BUDGET_MS) * 100).toFixed(1).padStart(5)}% of budget`);
  });

  emit('--- one-time / per-note JS-thread costs (not audio thread) ---');
  for (const { name, ms } of noiseBenchmarks()) {
    emit(`${name.padEnd(48)} ${ms.toFixed(1)} ms`);
  }
  emit('done');
}

// Same processors, but the timing loop runs INSIDE an audio-runtime worklet callback (back-to-back calls in one
// callback, warm caches). Compare with runEffectBenchmark (JS thread) and with a live pattern's measured audio load.
export async function runAudioRuntimeBenchmark(onLine: (line: string) => void): Promise<void> {
  const emit = (line: string): void => {
    console.log(`[BENCH-AUDIO] ${line}`);
    onLine(line);
  };
  const names = ['coarse', 'crush', 'shape', 'distort (soft)', 'distort (chebyshev)', 'transient', 'djf (lowpass)', 'ladder filter'];
  const picked = cases.filter((c) => names.includes(c.name));
  emit('runs the loop inside the audio-thread worklet runtime (each case blocks audio ~0.5s)');
  for (const c of picked) {
    const ctx = new AudioContext();
    const params: Record<string, number> = {};
    for (const d of c.module.parameterDescriptors) params[d.name] = d.defaultValue;
    Object.assign(params, c.params);
    const state = c.module.createState(SAMPLE_RATE, c.options);
    const process = c.module.process;
    const result = createSynchronizable(-1);
    const coldFirst = createSynchronizable(-1);
    const localResult = createSynchronizable(-1);
    const done = createSynchronizable(0);
    const node = ctx.createWorkletProcessingNode((inputData, outputData, frames, currentTime) => {
      'worklet';
      if (done.getBlocking() === 1) return;
      done.setBlocking(1);
      try {
        const a = performance.now();
        process(state, inputData, outputData, params, frames, 48000, 1);
        const b = performance.now();
        coldFirst.setBlocking((b - a) * 1000);
        const start = performance.now();
        const N = 1000;
        for (let i = 0; i < N; i++) process(state, inputData, outputData, params, frames, 48000, 1 + i * 0.00267);
        result.setBlocking(((performance.now() - start) * 1000) / N);

        // Variant: same work on ordinary worklet-local typed arrays (copy in, process, copy out).
        const localIn = [new Float32Array(frames), new Float32Array(frames)];
        const localOut = [new Float32Array(frames), new Float32Array(frames)];
        const start2 = performance.now();
        for (let i = 0; i < N; i++) {
          localIn[0].set(inputData[0]);
          localIn[1].set(inputData[inputData.length > 1 ? 1 : 0]);
          process(state, localIn, localOut, params, frames, 48000, 1 + i * 0.00267);
          outputData[0].set(localOut[0]);
          if (outputData.length > 1) outputData[1].set(localOut[1]);
        }
        localResult.setBlocking(((performance.now() - start2) * 1000) / N);
      } catch {
        result.setBlocking(-2);
      }
    }, 'AudioRuntime');
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 220;
    osc.connect(node);
    node.connect(ctx.destination);
    osc.start();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    emit(`${c.name.padEnd(24)} warm loop ${result.getBlocking().toFixed(0)} us/block   with local buffers ${localResult.getBlocking().toFixed(0)} us/block   first call ${coldFirst.getBlocking().toFixed(0)} us`);
    osc.stop();
    await ctx.close();
  }
  emit('done');
}

const ACTIVE_SRC = { begin: 0, end: 1e9 };

// One representative case per C++ kernel, with the same params as runEffectBenchmark / runNativeCheck, addressed by
// the processor name createNativeKernelNode knows.
const KERNEL_CASES: {
  label: string;
  processorName: string;
  source?: boolean;
  options?: Record<string, unknown>;
  values?: Record<string, number>;
}[] = [
  { label: 'coarse', processorName: 'coarse-processor', values: { coarse: 8 } },
  { label: 'transient', processorName: 'transient-processor', options: { ...ACTIVE_SRC, attack: 1, sustain: -1 } },
  { label: 'djf', processorName: 'djf-processor', values: { value: 0.2 } },
  { label: 'ladder filter', processorName: 'ladder-processor', values: { frequency: 800, q: 4, drive: 1 } },
  { label: 'feedback delay', processorName: 'feedback-delay', values: { delayTime: 0.25, feedback: 0.5, wet: 1 } },
  { label: 'compressor', processorName: 'compressor', values: { threshold: -30, knee: 10, ratio: 8 } },
  { label: 'lfo', processorName: 'lfo-processor', source: true, options: ACTIVE_SRC, values: { frequency: 5, depth: 1 } },
  { label: 'envelope', processorName: 'envelope-processor', source: true, options: ACTIVE_SRC },
  { label: 'pulse oscillator', processorName: 'pulse-oscillator', source: true, options: ACTIVE_SRC, values: { frequency: 220, pulsewidth: 0.5 } },
  { label: 'supersaw (9 voices)', processorName: 'supersaw-oscillator', source: true, options: ACTIVE_SRC, values: { frequency: 220, voices: 9 } },
  { label: 'fdn reverb', processorName: 'fdn-reverb', values: { decayTime: 2 } },
];

// Real on-device cost of the C++ kernel path, timed natively around each kernel call (rn-web-audio-compat's
// getNativeTimings). All kernels run concurrently through a real graph at real render cadence.
export async function runNativeKernelBenchmark(onLine: (line: string) => void): Promise<void> {
  const emit = (line: string): void => {
    console.log(`[BENCH-KERNEL] ${line}`);
    onLine(line);
  };
  const wasEnabled = areNativeProcessorsEnabled(); // always measures the kernel path, whatever the A/B switch says
  setNativeProcessorsEnabled(true);

  const ctx = new AudioContext();
  const cleanup: { stop?: () => void }[] = [];
  try {
    const mute = ctx.createGain();
    mute.gain.value = 0;
    mute.connect(ctx.destination);

    for (const c of KERNEL_CASES) {
      const node: any = createNativeKernelNode(ctx, c.processorName, c.options);
      for (const [k, v] of Object.entries(c.values ?? {})) {
        node.parameters.get(k).value = v;
      }
      if (!c.source) {
        const osc = ctx.createOscillator();
        osc.frequency.value = 220;
        const amp = ctx.createGain();
        amp.gain.value = 0.3;
        osc.connect(amp);
        amp.connect(node);
        osc.start();
        cleanup.push(osc);
      }
      node.connect(mute);
    }

    resetNativeTimings(ctx);
    emit(`running all ${KERNEL_CASES.length} kernels concurrently for 2s (real audio-thread wall time per call)...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const timings = getNativeTimings(ctx).filter((t) => t.id !== 0);

    const BUDGET_US = (FRAMES / SAMPLE_RATE) * 1e6;
    timings
      .filter((t) => t.count > 0)
      .sort((a, b) => b.avgUs - a.avgUs)
      .forEach((t) => {
        emit(
          `${t.name.padEnd(16)} ${t.avgUs.toFixed(1).padStart(7)} us/block avg  ${t.maxUs.toFixed(1).padStart(7)} us max  ${((t.avgUs / BUDGET_US) * 100).toFixed(2).padStart(6)}% of budget  (n=${t.count})`
        );
      });
    const missing = timings.filter((t) => t.count === 0).map((t) => t.name);
    if (missing.length > 0) {
      emit(`no calls recorded for: ${missing.join(', ')}`);
    }
  } finally {
    for (const n of cleanup) n.stop?.();
    await ctx.close();
    setNativeProcessorsEnabled(wasEnabled);
  }
  emit('done');
}

// Native vs JS through the real audio graph: every natively implemented effect runs once natively and once as the JS
// worklet, on the same 0.3-amplitude 220 Hz sine (effects) or on its own (sources), and the analyser statistics are
// compared. Returns the number of failures.
export async function runNativeCheck(onLine: (line: string) => void): Promise<number> {
  const emit = (line: string): void => {
    console.log(`[NATIVE-CHECK] ${line}`);
    onLine(line);
  };
  const wasEnabled = areNativeProcessorsEnabled();
  type Cfg = {
    label: string;
    kind: 'worklet' | 'compressor' | 'delay';
    name: string;
    options?: Record<string, unknown>;
    values: Record<string, number>;
    source?: boolean;
    tolerance?: number;
  };
  const ACTIVE = { begin: 0, end: 1e9 };
  const cfgs: Cfg[] = [
    { label: 'shape 0.5', kind: 'worklet', name: 'shape-processor', values: { shape: 0.5 } },
    { label: 'distort 0.6', kind: 'worklet', name: 'distort-processor', values: { distort: 0.6 } },
    { label: 'distort 3 fold', kind: 'worklet', name: 'distort-processor', options: { algorithm: 'fold' }, values: { distort: 3 } },
    { label: 'crush 4', kind: 'worklet', name: 'crush-processor', values: { crush: 4 } },
    { label: 'coarse 8', kind: 'worklet', name: 'coarse-processor', values: { coarse: 8 } },
    { label: 'transient', kind: 'worklet', name: 'transient-processor', options: { ...ACTIVE, attack: 1, sustain: -1 }, values: {} },
    { label: 'djf 0.2', kind: 'worklet', name: 'djf-processor', values: { value: 0.2 } },
    { label: 'ladder', kind: 'worklet', name: 'ladder-processor', values: { frequency: 800, q: 4, drive: 1 } },
    { label: 'compressor', kind: 'compressor', name: 'compressor', values: { threshold: -30, knee: 10, ratio: 8 } },
    { label: 'delay', kind: 'delay', name: 'delay', values: { delayTime: 0.02, feedback: 0.6, wet: 1 } },
    // 500Hz so the 43ms analyser window spans many cycles (a slow LFO would just compare two different phases).
    { label: 'lfo 500Hz', kind: 'worklet', name: 'lfo-processor', source: true, values: { ...ACTIVE, frequency: 500, depth: 0.8, shape: 1 } },
    { label: 'pulse 220', kind: 'worklet', name: 'pulse-oscillator', source: true, values: { ...ACTIVE, frequency: 220, pulsewidth: 0.5 } },
    { label: 'supersaw 5', kind: 'worklet', name: 'supersaw-oscillator', source: true, values: { ...ACTIVE, frequency: 220, voices: 5 }, tolerance: 0.7 }, // random start phases in both versions: level is phase dependent, so only a sanity range is checked here
  ];
  const stats = (data: ArrayLike<number>): { peak: number; rms: number; held: number } => {
    let peak = 0;
    let sum = 0;
    let held = 0;
    for (let i = 0; i < data.length; i++) {
      peak = Math.max(peak, Math.abs(data[i]));
      sum += data[i] * data[i];
      if (i > 0 && data[i] === data[i - 1]) held++;
    }
    return { peak, rms: Math.sqrt(sum / data.length), held: held / data.length };
  };
  const measure = async (cfg: Cfg, native: boolean): Promise<{ peak: number; rms: number; held: number }> => {
    setNativeProcessorsEnabled(native);
    const ctx = new AudioContext();
    installWebAudioCompat(ctx);
    let node: any;
    if (cfg.kind === 'compressor') {
      node = new DynamicsCompressorNode(ctx as never, cfg.values);
    } else if (cfg.kind === 'delay') {
      node = new FeedbackDelayNode(ctx as never, cfg.values.wet, cfg.values.delayTime, cfg.values.feedback);
    } else {
      node = new AudioWorkletNode(ctx, cfg.name, cfg.options ? { processorOptions: cfg.options } : undefined) as any;
      for (const [k, v] of Object.entries(cfg.values)) node.parameters.get(k).value = v;
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    const mute = ctx.createGain();
    mute.gain.value = 0;
    let osc: any = null;
    if (!cfg.source) {
      osc = ctx.createOscillator();
      osc.frequency.value = 220;
      const amp = ctx.createGain();
      amp.gain.value = 0.3;
      osc.connect(amp);
      amp.connect(node);
    }
    node.connect(analyser);
    analyser.connect(mute);
    mute.connect(ctx.destination);
    osc?.start();
    await new Promise((resolve) => setTimeout(resolve, 700));
    const data = new Float32Array(2048);
    analyser.getFloatTimeDomainData(data);
    const result = stats(data);
    osc?.stop();
    await ctx.close();
    return result;
  };
  const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(1e-6, Math.abs(b));
  let failures = 0;
  for (const cfg of cfgs) {
    try {
      const nat = await measure(cfg, true);
      const js = await measure(cfg, false);
      const tol = cfg.tolerance ?? 0.03;
      const ok = rel(nat.peak, js.peak) <= tol && rel(nat.rms, js.rms) <= tol && Math.abs(nat.held - js.held) <= 0.05;
      if (!ok) failures++;
      const f = (r: { peak: number; rms: number; held: number }): string => `peak=${r.peak.toFixed(3)} rms=${r.rms.toFixed(3)} held=${r.held.toFixed(2)}`;
      emit(`${ok ? 'PASS' : 'FAIL'} ${cfg.label.padEnd(16)} native ${f(nat)} | js ${f(js)}`);
    } catch (err) {
      failures++;
      emit(`FAIL ${cfg.label} threw ${String(err)}`);
    }
  }
  setNativeProcessorsEnabled(wasEnabled);
  emit(`done: ${cfgs.length - failures}/${cfgs.length} match`);
  return failures;
}
