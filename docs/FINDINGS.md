# Findings: Strudel on React Native

What it took to run unmodified [Strudel](https://strudel.cc) (`@strudel/core`, `@strudel/mini`, `@strudel/webaudio`,
`superdough`) on React Native, found on real devices (iPhone, Pixel 10). Everything about the Web Audio layer underneath
(worklets, graph cycles, fan-out, tail-time, `onended`, native crashes) is in
[rn-web-audio-compat's FINDINGS.md](https://github.com/wwrinkle/rn-web-audio-compat/blob/main/docs/FINDINGS.md); this
file covers what is specific to Strudel.

## How Strudel makes sound

Strudel's pattern engine (`@strudel/core`) schedules events; `@strudel/webaudio` hands each event to `superdough`, which
builds a small Web Audio graph per note (source → effects → orbit bus → output). Anything that makes sound goes through
superdough. So "Strudel on React Native" means: superdough's Web Audio usage has to work, and superdough's 15
AudioWorklet processors need React Native versions.

`supradough` / `dough()` is a separate, opt-in engine (one monolithic worklet compiled from generated code at runtime,
driven through `window.postMessage`); normal patterns never touch it. Not supported.

## Startup: browser globals touched at import time

- `@strudel/core`'s `signal.mjs` runs `document.addEventListener(...)` at module top level behind a
  `typeof window !== 'undefined'` guard. React Native has a `window`, not a `document`, so the app died with
  `Property 'document' doesn't exist` before React mounted (a white screen, and fast enough that a log capture started a
  second late shows nothing).
- superdough's `dspworklet.mjs` (evaluated by any `import ... from 'superdough'`) calls `window.addEventListener` at top
  level.
- superdough constructs nodes and patches prototypes through bare globals (`new GainNode`, `BaseAudioContext.prototype
  .createVowelFilter = ...`, `instanceof AudioNode`, `typeof AudioContext` guards). One missing `AudioParam` global
  made node-pool cleanup throw halfway through a note's release, leaking a filter into the output bus that coloured
  every later sound until restart.

`import 'rn-strudel/environment'` first handles all of this: rn-web-audio-compat's globals plus inert `window` /
`document` stubs.

## Packaging and setup quirks

- **`@kabelsalat/web`'s `main` points at a UMD build that exports nothing** under a module system, so `@strudel/core`'s
  `repl()` fails with `undefined cannot be used as a constructor` (`new SalatRepl()`). Its `module` build is correct;
  rn-strudel's install step points `main` at it. (Upstream bug, worth reporting.)
- `initAudio()` returns early when `typeof window === 'undefined'`, silently skipping worklet setup.
- `initAudioOnFirstClick()` needs `document`; call `initAudio()` (`initStrudel()` does) instead.
- **`registerSynthSounds()` is required** for `s("sawtooth")` and friends (`sound sawtooth not found`), although the
  `@strudel/webaudio` README's minimal example omits it.
- **Default samples:** strudel.cc loads six manifests from `felixroos/dough-samples`, in order;
  `loadDefaultSamples()` does the same, sequentially (order matters where two define the same name). Plain `bd` / `sd`
  come from EmuSP12 in that set. Note that `sn` and `sd` are different sounds.
- **Bundled clips can't go through `samples()` in an Android release build.** superdough loads every sample with
  `fetch(url)` and then `decodeAudioData(bytes)`. A bundled asset's URL is Metro's `http://` URL in a dev build and a
  `file://` path in an iOS release, both of which `fetch` reads, but in an Android release it is a raw resource name
  inside the APK (`res/ky.wav`), and Android's `fetch` (OkHttp) only speaks http and https. react-native-audio-api's
  `decodeAudioData(require(...))` reads all three, so `bundledSamples()` decodes with it and answers superdough's
  `fetch` and `decodeAudioData` for its own `rn-asset:` URLs with the decoded buffers. Checked in an Android release
  build on the emulator (the "Bundled samples" row).

## Scheduling

- Timing lives entirely in `@strudel/core` (`Cyclist`); superdough only renders one already-scheduled event at a time.
- The Cyclist is driven by `setInterval`, which stops on Android when the screen locks (React Native drives JS timers
  from display frames). `initStrudel()` gives `repl()` rn-web-audio-compat's audio clock instead, so patterns keep
  playing with the screen off.
- **Orbit effects are sticky.** superdough adds orbit-level effects (the DJ filter, delay, reverb) once per orbit, and
  they keep the last value they were given, so a pattern played after a `.djf()` pattern still went through that
  filter (nearly inaudible) until restart. `initStrudel()` calls `resetGlobalEffects()` on every `scheduler.start()`
  (option `resetEffectsOnStart`).
- `evaluate(code)` (pattern code as text, like the REPL) works on Hermes: `@strudel/core` evaluates with `Function()`,
  which Hermes supports.

## Effects

- **Delay repeats.** superdough's `feedbackdelay.mjs` gets its repeats from a graph cycle, which react-native-audio-api
  silently refuses: one echo, no repeats. rn-strudel replaces `createFeedbackDelay` with rn-web-audio-compat's
  `FeedbackDelayNode`. It must be installed *after* superdough's modules evaluate, or superdough's own patch of the same
  method silently wins; `initStrudel()` installs it and asserts it is still in place.
- **Reverb (`.room()`).** Convolution on the phone was both fragile and expensive: rendering before the impulse
  response was set crashed the audio thread, and a 0.6 s reverb used 78% of the audio thread on a Pixel 10 (audible
  overload). By default `.room()` now uses rn-web-audio-compat's C++ FDN reverb: 41% load, length-independent cost,
  level calibrated to a browser. User impulse responses (`.ir()`) still use convolution, guarded against the crash and
  capped at 0.6 s.
- **JS processors are too slow on the audio thread**, so each of superdough's processors has a native version: C++
  kernels (coarse, transient, djf, ladder, lfo, envelope, pulse, supersaw) or a `WaveShaperNode` curve computed from the
  ported processor (crush, shape, distort). The TS ports stay as the spec (kernel parity: max |diff| ≤ 2e-6 per sample)
  and the fallback.
- **Crackle** made a new 2 s noise buffer per note (19 ms of JS on a Pixel); it now plays from a small pool (1-3 ms).
- **Supersaw is mono**: react-native-audio-api worklet sources have no `outputChannelCount`, so the stereo spread
  collapses.
- **Vowel is quiet**, in browsers too: narrow formant filters discard most of a sawtooth's energy.
- **Not ported:** wavetable (needs wavetable data and ~18 phase-warp modes), bytebeat and kabelsalat (compile code at
  runtime inside the processor), phase vocoder (`.stretch()`, an FFT overlap-add subsystem).
