// Strudel / superdough features on React Native, one row each, with the pattern code that exercises it. COVERAGE.md is
// generated from this file (npm run coverage); the example app and the web demo render one button per row from it.
// The standard Web Audio API underneath is covered row by row in rn-web-audio-compat's COVERAGE.md.

import type { StrudelRow } from './types';

const KERNELS = '[StrudelKernels.cpp](native/rnaa-0.13.5/files/common/cpp/audioapi/dsp/rnwac_ext/StrudelKernels.cpp)';
const SHAPERS = '[nativeShapers.ts](src/nativeShapers.ts)';
const proc = (file: string) => `[${file}.ts](src/processors/${file}.ts)`;
const COMPAT = 'rn-web-audio-compat';
const NATIVE_NODES = `superdough's own code on react-native-audio-api's built-in nodes (through ${COMPAT})`;

const MELODY = 'note("c3 eb3 g3 c4")';

function row(r: Omit<StrudelRow, 'id'>): StrudelRow {
  return { ...r, id: `${r.group}:${r.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-') };
}

export const ROWS: StrudelRow[] = [
  // ---------------------------------------------------------------------------------------------------------------
  row({
    group: 'Sounds',
    name: 'Basic waveforms (`s("sawtooth")` etc.)',
    covered: 'yes',
    how: NATIVE_NODES,
    code: `${MELODY}.s("<sawtooth square triangle sine>")`,
  }),
  row({
    group: 'Sounds',
    name: 'Samples (`s("bd sd")`)',
    covered: 'yes',
    how: 'superdough\'s sampler: fetch + decodeAudioData + AudioBufferSourceNode, all native. Loads strudel.cc\'s default sample manifests (`loadDefaultSamples()`)',
    source: '[setup.ts](src/setup.ts) (`loadDefaultSamples`)',
    code: 's("bd sd [~ bd] sd")',
    needsSamples: true,
  }),
  row({
    group: 'Sounds',
    name: 'Bundled samples (`bundledSamples({ name: require(...) })`)',
    covered: 'yes',
    how: 'Clips shipped inside the app, no network. Decoded up front by react-native-audio-api (which reads bundled assets in release builds, where `fetch` can\'t on Android) and handed to superdough\'s sampler under private `rn-asset:` URLs',
    source: '[bundledSamples.ts](src/bundledSamples.ts)',
    code: 's("bundled-click*4")',
    needsBundled: true,
  }),
  row({
    group: 'Sounds',
    name: 'Noise (`s("white")`, `pink`, `brown`)',
    covered: 'yes',
    how: NATIVE_NODES,
    code: 's("<white pink brown>*2").gain(0.4)',
  }),
  row({
    group: 'Sounds',
    name: 'Crackle (`s("crackle")`)',
    covered: 'yes',
    how: 'superdough\'s voice, with the noise from a small pool of buffers instead of a new 2 s buffer per note (option `crackleCache`)',
    source: '[crackle.ts](src/superdough/crackle.ts)',
    savings: 'Done: 1.4-3.5 ms of JS per note instead of 19 ms (Pixel 10)',
    code: 's("crackle*8").density("<0.05 0.2>")',
  }),
  row({
    group: 'Sounds',
    name: 'Pulse oscillator (`s("pulse")`, `pulse-oscillator`)',
    covered: 'yes',
    how: 'C++ kernel (JS worklet fallback)',
    source: `${KERNELS}, ${proc('pulseOscillatorProcessor')}`,
    code: `${MELODY}.s("pulse")`,
  }),
  row({
    group: 'Sounds',
    name: 'Supersaw (`s("supersaw")`, `supersaw-oscillator`)',
    covered: 'partial',
    how: 'C++ kernel (JS worklet fallback). Mono: react-native-audio-api worklet sources have no `outputChannelCount`, so the stereo spread collapses',
    source: `${KERNELS}, ${proc('supersawOscillatorProcessor')}`,
    code: `${MELODY}.s("supersaw")`,
  }),
  row({
    group: 'Sounds',
    name: 'Wavetables (`wavetable-oscillator-processor`)',
    covered: 'no',
    how: '— (needs wavetable sample data plus ~18 phase-warp modes; not ported)',
  }),
  row({
    group: 'Sounds',
    name: 'Bytebeat (`s("bytebeat")`, `byte-beat-processor`)',
    covered: 'no',
    how: '— (evaluates code per sample inside the processor; needs an expression interpreter)',
  }),
  row({
    group: 'Sounds',
    name: 'Kabelsalat (`generic-processor`)',
    covered: 'no',
    how: '— (a separate synthesis system compiled at runtime)',
  }),
  row({
    group: 'Sounds',
    name: 'Supradough (`dough()`)',
    covered: 'no',
    how: '— (loads a worklet from generated code and relies on browser `window.postMessage`)',
  }),

  // ---------------------------------------------------------------------------------------------------------------
  row({ group: 'Filters', name: 'Lowpass (`.cutoff()`)', covered: 'yes', how: NATIVE_NODES, code: `${MELODY}.s("sawtooth").cutoff(1200)` }),
  row({ group: 'Filters', name: 'Highpass (`.hcutoff()`)', covered: 'yes', how: NATIVE_NODES, code: `${MELODY}.s("sawtooth").hcutoff(800)` }),
  row({ group: 'Filters', name: 'Bandpass (`.bandf()`)', covered: 'yes', how: NATIVE_NODES, code: `${MELODY}.s("sawtooth").bandf(1000).bandq(6)` }),
  row({
    group: 'Filters',
    name: 'Vowel (`.vowel()`)',
    covered: 'yes',
    how: `${NATIVE_NODES}; needs the fan-out fix (5 parallel filters). Quiet by design, as in browsers`,
    code: `${MELODY}.s("sawtooth").vowel("<a e i o>")`,
  }),
  row({
    group: 'Filters',
    name: 'Ladder filter (`.ftype("ladder")`, `ladder-processor`)',
    covered: 'yes',
    how: 'C++ kernel (JS worklet fallback)',
    source: `${KERNELS}, ${proc('ladderProcessor')}`,
    code: 'note("c2 eb2 g2 c3").s("sawtooth").lpf(800).ftype("ladder")',
  }),
  row({
    group: 'Filters',
    name: 'DJ filter (`.djf()`, `djf-processor`)',
    covered: 'yes',
    how: 'C++ kernel (JS worklet fallback)',
    source: `${KERNELS}, ${proc('djfProcessor')}`,
    code: `${MELODY}.s("sawtooth").djf("0.9 0.5 0.1 0.5")`,
  }),

  // ---------------------------------------------------------------------------------------------------------------
  row({
    group: 'Distortion and dynamics',
    name: 'Bitcrush (`.crush()`, `crush-processor`)',
    covered: 'yes',
    how: 'native WaveShaperNode curve computed from the ported processor (JS worklet fallback)',
    source: `${SHAPERS}, ${proc('crushProcessor')}`,
    code: `${MELODY}.s("sawtooth").crush(4)`,
  }),
  row({
    group: 'Distortion and dynamics',
    name: 'Sample-rate reduction (`.coarse()`, `coarse-processor`)',
    covered: 'yes',
    how: 'C++ kernel (JS worklet fallback)',
    source: `${KERNELS}, ${proc('coarseProcessor')}`,
    code: `${MELODY}.s("sawtooth").coarse(8)`,
  }),
  row({
    group: 'Distortion and dynamics',
    name: 'Waveshaping (`.shape()`, `shape-processor`)',
    covered: 'yes',
    how: 'native WaveShaperNode curve (JS worklet fallback)',
    source: `${SHAPERS}, ${proc('shapeProcessor')}`,
    code: `${MELODY}.s("sawtooth").shape(0.5)`,
  }),
  row({
    group: 'Distortion and dynamics',
    name: 'Distortion (`.distort()`, `distort-processor`)',
    covered: 'partial',
    how: 'native WaveShaperNode curve (JS worklet fallback). Input is clamped to [-1, 1], which only matters for very hot signals into fold/sinefold/chebyshev',
    source: `${SHAPERS}, ${proc('distortProcessor')}`,
    code: `${MELODY}.s("sawtooth").distort("<0.6 3:0.6:fold>")`,
  }),
  row({
    group: 'Distortion and dynamics',
    name: 'Compressor (`.compressor()`)',
    covered: 'yes',
    how: `${COMPAT}'s DynamicsCompressorNode (C++ kernel)`,
    code: `${MELODY}.s("sawtooth").compressor("-20:20:10:.002:.02")`,
  }),
  row({
    group: 'Distortion and dynamics',
    name: 'Transient shaper (`.transient()`, `transient-processor`)',
    covered: 'yes',
    how: 'C++ kernel (JS worklet fallback)',
    source: `${KERNELS}, ${proc('transientProcessor')}`,
    code: 's("bd*4").transient("1:-1")',
    needsSamples: true,
  }),

  // ---------------------------------------------------------------------------------------------------------------
  row({
    group: 'Modulation',
    name: 'Tremolo (`.tremolo()`, `lfo-processor`)',
    covered: 'yes',
    how: 'C++ kernel (JS worklet fallback)',
    source: `${KERNELS}, ${proc('lfoProcessor')}`,
    code: `${MELODY}.s("sawtooth").tremolo(6).tremolodepth(0.8)`,
  }),
  row({
    group: 'Modulation',
    name: 'Phaser (`.phaser()`, `lfo-processor`)',
    covered: 'yes',
    how: `native filters + the lfo C++ kernel`,
    source: KERNELS,
    code: `${MELODY}.s("sawtooth").phaser(4).phaserdepth(0.8)`,
  }),
  row({
    group: 'Modulation',
    name: 'Envelope modulator (`.env()`, `envelope-processor`)',
    covered: 'yes',
    how: 'C++ kernel (JS worklet fallback)',
    source: `${KERNELS}, ${proc('envelopeProcessor')}`,
    code: 'note("F1 F2").s("sawtooth").lpf(500).env({ a: 0.3, d: 0.5 })',
  }),
  row({ group: 'Modulation', name: 'Panning (`.pan()`)', covered: 'yes', how: NATIVE_NODES, code: `${MELODY}.s("sawtooth").pan("0.1 0.9 0.1 0.9")` }),

  // ---------------------------------------------------------------------------------------------------------------
  row({
    group: 'Orbit effects',
    name: 'Delay (`.delay()`)',
    covered: 'yes',
    how: `${COMPAT}'s FeedbackDelayNode (C++ kernel) replaces superdough's graph-cycle delay, which gives one echo and no repeats on react-native-audio-api`,
    source: '[feedbackDelay.ts](src/superdough/feedbackDelay.ts)',
    code: `${MELODY}.s("sawtooth").delay(0.5).delaytime(0.25).delayfeedback(0.5)`,
  }),
  row({
    group: 'Orbit effects',
    name: 'Reverb (`.room()`)',
    covered: 'yes',
    how: `${COMPAT}'s C++ FDN reverb by default (option \`fdnReverb\`); otherwise superdough's convolution reverb, guarded against a native crash and capped at 0.6 s`,
    source: '[reverb.ts](src/superdough/reverb.ts)',
    savings: 'Done: 41% vs 78% audio-thread load for `.room(0.6)` on a Pixel 10',
    code: `${MELODY}.s("sawtooth").room(0.6)`,
  }),
  row({
    group: 'Orbit effects',
    name: 'Long reverb (`.roomsize()`)',
    covered: 'yes',
    how: 'FDN reverb: any length at the same cost (convolution would be capped at 0.6 s)',
    source: '[reverb.ts](src/superdough/reverb.ts)',
    code: 'note("c3 ~ g3 ~").s("sawtooth").room(0.7).roomsize(4)',
  }),
  row({
    group: 'Orbit effects',
    name: 'Custom impulse response (`.ir()`)',
    covered: 'partial',
    how: 'superdough\'s convolution reverb with the given sample (always convolution; guarded, IR capped at 0.6 s)',
    source: '[reverb.ts](src/superdough/reverb.ts)',
    code: `${MELODY}.s("sawtooth").room(0.6).ir("bd")`,
    needsSamples: true,
  }),

  // ---------------------------------------------------------------------------------------------------------------
  row({
    group: 'Time and pitch',
    name: 'Time-stretch (`.stretch()`, `phase-vocoder-processor`)',
    covered: 'no',
    how: '— (an FFT overlap-add subsystem; not ported)',
  }),
];

export const GROUPS: string[] = Array.from(new Set(ROWS.map((r) => r.group)));
