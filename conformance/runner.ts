import { getSuperdoughAudioController } from 'superdough';
import type { StrudelEngineLike, StrudelResult, StrudelRow, StrudelTestEnv } from './types';

// Taps superdough's output bus (the channel merger every orbit feeds) with an AnalyserNode, so a pattern can be
// checked for real output; the speakers get it only when env.audible.
function tap(engine: StrudelEngineLike, audible: boolean) {
  const ctx = engine.context;
  const output = (getSuperdoughAudioController() as any).output;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const sink = ctx.createGain();
  sink.gain.value = 0;
  output.channelMerger.connect(analyser);
  analyser.connect(sink);
  sink.connect(ctx.destination);
  if (!audible) output.destinationGain.gain.value = 0;
  let peak = 0;
  let sum = 0;
  let n = 0;
  const buf = new Float32Array(analyser.fftSize);
  return {
    read() {
      analyser.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) {
        sum += buf[i] * buf[i];
        peak = Math.max(peak, Math.abs(buf[i]));
      }
      n += buf.length;
    },
    result: () => ({ rms: Math.sqrt(sum / Math.max(1, n)), peak }),
    release() {
      try {
        output.channelMerger.disconnect(analyser);
      } catch {
        // the output may have been reset already
      }
      analyser.disconnect();
      sink.disconnect();
      output.destinationGain.gain.value = 1;
    },
  };
}

// Plays the row's pattern for env.playMs and checks that sound came out.
export async function runStrudelRow(row: StrudelRow, env: StrudelTestEnv): Promise<StrudelResult> {
  const started = Date.now();
  if (!row.code) return { ok: false, detail: 'not implemented', ms: 0 };
  const engine = await env.engine();
  let t: ReturnType<typeof tap> | null = null;
  try {
    if (row.needsSamples) await env.loadSamples();
    const pattern = await engine.evaluate(row.code);
    engine.scheduler.setPattern(pattern);
    engine.scheduler.start(); // resets orbit effects, so tap afterwards
    t = tap(engine, env.audible);
    const steps = Math.max(1, Math.round(env.playMs / 100));
    for (let i = 0; i < steps; i++) {
      await engine.sleep(100);
      t.read();
    }
    const { rms, peak } = t.result();
    const ok = peak > 0.001;
    return { ok, detail: `${ok ? 'sound' : 'SILENT'}: rms ${rms.toFixed(3)}, peak ${peak.toFixed(3)}`, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, detail: String((err as Error)?.message ?? err), ms: Date.now() - started };
  } finally {
    engine.scheduler.stop();
    t?.release();
  }
}

export function summarizeStrudel(results: Map<string, StrudelResult>, rows: StrudelRow[]): string {
  const tested = rows.filter((r) => r.code);
  const passed = tested.filter((r) => results.get(r.id)?.ok).length;
  return `${passed}/${tested.length} produce sound (${rows.length - tested.length} not implemented on React Native)`;
}
