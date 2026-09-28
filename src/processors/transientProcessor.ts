// Real-time port of superdough's TransientProcessor (worklets.mjs) — an
// attack/sustain transient shaper (envelope-follower based), effect-style.
// Registered (register.ts) as 'transient-processor'.
//
// Unlike every other processor here, the original has NO live AudioParams
// at all (`parameterDescriptors` is `[]`) — every setting comes from
// processorOptions, fixed at construction. Coefficients derived from
// sampleRate (timeToCoeff) are computed once in createState, matching the
// original computing them once in its constructor.

import type { WorkletProcessorModule } from 'rn-web-audio-compat';

interface TransientState {
  attackCoeff: number;
  sustainCoeff: number;
  gainCoeff: number;
  attackAmt: number;
  sustainAmt: number;
  scaling: number;
  mix: number;
  begin: number;
  end: number;
  avgGain: number;
  attackEnv: number[];
  sustainEnv: number[];
}

interface TransientProcessorOptions {
  attackTime?: number;
  sustainTime?: number;
  attack?: number;
  sustain?: number;
  sensitivity?: number;
  mix?: number;
  begin?: number;
  end?: number;
}

export const transientProcessor: WorkletProcessorModule<TransientState> = {
  kind: 'effect',
  parameterDescriptors: [],

  createState: (sampleRate, processorOptions) => {
    const options = (processorOptions ?? {}) as TransientProcessorOptions;
    const invSampleRate = 1 / sampleRate;
    const timeToCoeff = (t: number): number => 1 - Math.exp(-invSampleRate / t);

    const attackTime = Math.min(Math.max(options.attackTime ?? 0.003, 0.0005), 0.05);
    const sustainTime = Math.min(Math.max(options.sustainTime ?? 0.08, 0.01), 0.5);

    return {
      attackCoeff: timeToCoeff(attackTime),
      sustainCoeff: timeToCoeff(sustainTime),
      gainCoeff: timeToCoeff(0.2),
      attackAmt: Math.min(Math.max(options.attack ?? 0, -1), 1),
      sustainAmt: Math.min(Math.max(options.sustain ?? 0, -1), 1),
      scaling: 0.5 + 5 * Math.min(Math.max(options.sensitivity ?? 0.1, 0), 1),
      mix: Math.min(Math.max(options.mix ?? 1, 0), 1),
      begin: options.begin ?? 0,
      end: options.end ?? 0,
      avgGain: 1,
      attackEnv: [0, 0],
      sustainEnv: [0, 0],
    };
  },

  process: (state, input, output, _params, framesToProcess, _sampleRate, currentTime) => {
    'worklet';

    if (currentTime >= state.end) {
      for (let channel = 0; channel < output.length; channel++) {
        output[channel].fill(0);
      }
      return;
    }
    if (currentTime <= state.begin) {
      for (let channel = 0; channel < output.length; channel++) {
        output[channel].fill(0);
      }
      return;
    }

    // Hot loop: everything hoisted/inlined on purpose (Hermes is an
    // interpreter; per-sample closure calls and Math.pow were ~5us/sample on
    // Android). dbToLin(x) = 10^(x/20) = exp(x * ln(10)/20).
    const DB_TO_EXP = 0.11512925464970229;
    const channels = input.length;
    while (state.attackEnv.length < channels) {
      state.attackEnv.push(0);
      state.sustainEnv.push(0);
    }

    const attackCoeff = state.attackCoeff;
    const sustainCoeff = state.sustainCoeff;
    const gainCoeff = state.gainCoeff;
    const attackAmt18 = state.attackAmt * 18 * DB_TO_EXP;
    const sustainAmt36 = state.sustainAmt * 36 * DB_TO_EXP;
    const scaling = state.scaling;
    const mix = state.mix;

    let avgGain = state.avgGain;
    for (let ch = 0; ch < channels; ch++) {
      let attEnv = state.attackEnv[ch];
      let susEnv = state.sustainEnv[ch];
      const inChannel = input[ch];
      const outChannel = output[ch];

      for (let n = 0; n < framesToProcess; n++) {
        const sample = inChannel[n];
        const x = sample < 0 ? -sample : sample;
        attEnv += (x - attEnv) * attackCoeff;
        susEnv += (x - susEnv) * sustainCoeff;
        let peakiness = (scaling * (attEnv - susEnv)) / (susEnv + 1e-6);
        peakiness = peakiness < -1.5 ? -1.5 : peakiness > 1.5 ? 1.5 : peakiness;
        // attackGain*sustainGain = exp(att term + sus term); only one of the two scales is nonzero.
        let gain = Math.exp(peakiness > 0 ? attackAmt18 * peakiness : -sustainAmt36 * peakiness);
        gain = gain > 8 ? 8 : gain;
        avgGain += (gain - avgGain) * gainCoeff;
        const makeup = avgGain > 1e-3 ? 1 / avgGain : 1;
        const wet = sample * gain * makeup;
        let y = sample + (wet - sample) * mix;
        y /= 1 + (y < 0 ? -y : y);
        outChannel[n] = y;
      }
      state.attackEnv[ch] = attEnv;
      state.sustainEnv[ch] = susEnv;
    }
    state.avgGain = avgGain;
  },
};
