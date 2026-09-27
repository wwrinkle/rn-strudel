// Writes parity reference data for rn-strudel's C++ kernels; `npm run parity` compares them using rn-web-audio-compat's
// harness, with this repo's native/.../rnwac_ext compiled in exactly as it is when installed.
import { writeParityRefs, type ParityCase } from 'rn-web-audio-compat/scripts/kernel-parity/writeRefs';
import {
  coarseProcessor,
  djfProcessor,
  envelopeProcessor,
  ladderProcessor,
  lfoProcessor,
  pulseOscillatorProcessor,
  supersawOscillatorProcessor,
  transientProcessor,
} from '../processors';

const ACTIVE = { begin: 0, end: 1e9 };

// The C++ supersaw seeds its random voice phases from an LCG; preset the JS phases from the same one.
const presetSupersawPhases = (voices: number) => (state: unknown) => {
  let rng = 0x9e3779b9;
  const phases: number[] = [];
  for (let i = 0; i < voices; i++) {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    phases.push((rng >>> 8) / 16777216);
  }
  (state as { phase: number[] }).phase = phases;
};

const transientExtras = (o: Record<string, number>) => [
  o.attackTime ?? 0.003,
  o.sustainTime ?? 0.08,
  o.attack ?? 0,
  o.sustain ?? 0,
  o.sensitivity ?? 0.1,
  o.mix ?? 1,
  o.begin ?? 0,
  o.end ?? 0,
];

// Kernel ids: StrudelKernelId in native/rnaa-0.13.5/files/common/cpp/audioapi/dsp/rnwac_ext/StrudelKernels.cpp.
const tA = { ...ACTIVE, attack: 1, sustain: -1 };
const tB = { ...ACTIVE, attack: 0.5, sustain: 0.3, sensitivity: 0.5, mix: 0.6, attackTime: 0.01, sustainTime: 0.2 };
const cases: ParityCase[] = [
  { name: 'coarse_8', kernelId: 101, module: coarseProcessor, values: { coarse: 8 } },
  { name: 'coarse_2p5', kernelId: 101, module: coarseProcessor, values: { coarse: 2.5 } },
  { name: 'transient_a', kernelId: 102, module: transientProcessor, options: tA, extraParams: transientExtras(tA) },
  { name: 'transient_b', kernelId: 102, module: transientProcessor, options: tB, extraParams: transientExtras(tB) },
  { name: 'djf_lo', kernelId: 103, module: djfProcessor, values: { value: 0.2 } },
  { name: 'djf_hi', kernelId: 103, module: djfProcessor, values: { value: 0.8 } },
  { name: 'djf_bypass', kernelId: 103, module: djfProcessor, values: { value: 0.5 } },
  { name: 'ladder_a', kernelId: 104, module: ladderProcessor, values: { frequency: 800, q: 4, drive: 1 } },
  { name: 'ladder_b', kernelId: 104, module: ladderProcessor, values: { frequency: 3000, q: 8, drive: 0.69 } },
  ...[0, 1, 2, 3, 4, 6].map((shape) => ({
    name: `lfo_shape${shape}`,
    kernelId: 105,
    module: lfoProcessor,
    values: { ...ACTIVE, frequency: 5, depth: 0.8, dcoffset: 0.1, shape, skew: shape === 6 ? 0.05 : 0.3 },
  })),
  { name: 'envelope_a', kernelId: 106, module: envelopeProcessor, values: { begin: 0.999, end: 1.2, attack: 0.005, decay: 0.05, sustain: 0.3, release: 0.05, depth: 1 } },
  { name: 'envelope_curved', kernelId: 106, module: envelopeProcessor, values: { begin: 0.999, end: 1.2, attack: 0.02, decay: 0.05, sustain: 0.5, release: 0.05, attackCurve: 0.5, decayCurve: -0.5, depth: 0.7 } },
  { name: 'pulse_a', kernelId: 107, module: pulseOscillatorProcessor, values: { ...ACTIVE, frequency: 220, pulsewidth: 0.5 } },
  { name: 'pulse_b', kernelId: 107, module: pulseOscillatorProcessor, values: { ...ACTIVE, frequency: 440, detune: 50, pulsewidth: -0.3 } },
  { name: 'supersaw_5', kernelId: 108, module: supersawOscillatorProcessor, values: { ...ACTIVE, frequency: 220, voices: 5 }, extraParams: [0], prepareState: presetSupersawPhases(5) },
  { name: 'supersaw_9', kernelId: 108, module: supersawOscillatorProcessor, values: { ...ACTIVE, frequency: 330, voices: 9, panspread: 0.8, freqspread: 0.4, detune: 30 }, extraParams: [0], prepareState: presetSupersawPhases(9) },
];

test('write kernel parity references', () => {
  writeParityRefs(cases);
});
