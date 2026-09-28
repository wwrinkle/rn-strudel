// Real-time port of superdough's SuperSawOscillatorProcessor (worklets.mjs)
// — a detuned-unison sawtooth stack, source-style, always stereo (writes
// output[0]/output[1] directly, matching the original — superdough
// constructs this specific node with `{ outputChannelCount: [2] }`).
// Registered (register.ts) as 'supersaw-oscillator'.
//
// superdough pools and reuses these nodes across notes (getNodeFromPool in
// synth.mjs) and resets per-voice phase via
// `node.port.postMessage({ type: 'initialize' })` before each reuse — the
// one processor in this pass that genuinely needs AudioWorkletNode's .port
// mailbox, not just parameters. See onMessage below.

import type { WorkletProcessorModule } from 'rn-web-audio-compat';

interface SupersawState {
  phase: number[];
}

export const supersawOscillatorProcessor: WorkletProcessorModule<SupersawState> = {
  kind: 'source',
  parameterDescriptors: [
    { name: 'begin', defaultValue: -1 },
    { name: 'end', defaultValue: -1 },
    { name: 'frequency', defaultValue: 440 },
    { name: 'panspread', defaultValue: 0.4 },
    { name: 'freqspread', defaultValue: 0.2 },
    { name: 'detune', defaultValue: 0 },
    { name: 'voices', defaultValue: 5 },
  ],

  createState: () => ({ phase: [] }),

  onMessage: (state, data) => {
    'worklet';
    const message = data as { type?: string } | null;
    if (message && message.type === 'initialize') {
      state.phase = [];
    }
  },

  process: (state, _input, output, params, framesToProcess, sampleRate, currentTime) => {
    'worklet';

    const begin = params.begin;
    const end = params.end;
    const beginDefined = begin >= 0;
    const endDefined = end >= 0;
    const ended = endDefined && currentTime >= end;
    const notStarted = currentTime <= begin;
    if (ended || notStarted || !beginDefined) {
      for (let channel = 0; channel < output.length; channel++) {
        output[channel].fill(0);
      }
      return;
    }

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    outL.fill(0);
    if (outR !== outL) outR.fill(0);

    const invSampleRate = 1 / sampleRate;
    const applySemitoneDetuneToFrequency = (frequency: number, detune: number): number => {
      return frequency * Math.pow(2, detune / 12);
    };
    const frac = (x: number): number => x - Math.floor(x);
    const polyBlep = (phase: number, dt: number): number => {
      dt = Math.min(dt, 1 - dt);
      const invdt = 1 / dt;
      if (phase < dt) {
        phase *= invdt;
        return 2 * phase - phase ** 2 - 1;
      } else if (phase > 1 - dt) {
        phase = (phase - 1) * invdt;
        return phase ** 2 + 2 * phase + 1;
      }
      return 0;
    };
    const sawblep = (phase: number, dt: number): number => {
      const v = 2 * phase - 1;
      return v - polyBlep(phase, dt);
    };
    const getDetuner = (unison: number, detune: number): ((voiceIdx: number) => number) => {
      if (unison < 2) return () => 0;
      const scale = detune / (unison - 1);
      const center = detune * 0.5;
      return (voiceIdx: number) => voiceIdx * scale - center;
    };

    const voices = Math.max(1, Math.floor(params.voices));

    for (let i = 0; i < framesToProcess; i++) {
      const detune = params.detune;
      const freqspread = params.freqspread;
      const panspread = params.panspread * 0.5 + 0.5;
      let gainL = Math.sqrt(1 - panspread);
      let gainR = Math.sqrt(panspread);
      let freq = params.frequency;
      freq = applySemitoneDetuneToFrequency(freq, detune / 100);
      const detuner = getDetuner(voices, freqspread);

      for (let n = 0; n < voices; n++) {
        const freqVoice = applySemitoneDetuneToFrequency(freq, detuner(n));
        const dt = frac(freqVoice * invSampleRate);
        if (state.phase[n] === undefined) {
          state.phase[n] = Math.random();
        }
        const v = sawblep(state.phase[n], dt);

        outL[i] += v * gainL;
        outR[i] += v * gainR;

        let pn = state.phase[n] + dt;
        if (pn >= 1.0) pn -= 1.0;
        state.phase[n] = pn;

        const tmp = gainL;
        gainL = gainR;
        gainR = tmp;
      }
    }
  },
};
