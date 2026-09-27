// rn-strudel: Strudel (https://strudel.cc) on React Native, on top of rn-web-audio-compat.
//
//   import 'rn-strudel/environment';   // first
//   import { initStrudel } from 'rn-strudel';
//   const { scheduler } = await initStrudel();
//   scheduler.setPattern(note('c3 e3 g3').s('sawtooth')); scheduler.start();
//
// The web build (index.web.ts) exposes the same initStrudel() on stock @strudel/webaudio.

import './environment';

export { initStrudel, loadDefaultSamples, DEFAULT_SAMPLE_MANIFESTS } from './setup';
export type { InitStrudelOptions, StrudelEngine, StrudelScheduler } from './setup';
export { getStrudelOption, getStrudelOptions, setStrudelOptions } from './options';
export type { StrudelOptions } from './options';
export { registerStrudelProcessors, STRUDEL_PROCESSORS, STRUDEL_KERNELS, STRUDEL_KERNEL_NAMES } from './register';
export { installFeedbackDelay } from './superdough/feedbackDelay';
