# rn-strudel

[Strudel](https://strudel.cc) on React Native. The real, unmodified `@strudel/core`, `@strudel/mini`, `@strudel/webaudio` and
`superdough` packages, playing patterns natively on iOS and Android, including with the screen locked.

```ts
const { scheduler, evaluate } = await initStrudel();
scheduler.setPattern(await evaluate('note("c3 eb3 g3").s("sawtooth").cutoff(800).room(0.5)'));
scheduler.start();
```

Strudel's sound engine, superdough, is written against the browser's Web Audio API. Most of that comes from
[rn-web-audio-compat](https://github.com/wwrinkle/rn-web-audio-compat), which this library builds on. rn-strudel adds
the Strudel-specific parts:

- **Worklet ports:** superdough's AudioWorklet processors, ported to TypeScript, with native C++ or WaveShaper versions
  (JS on a phone's audio thread is too slow).
- **Working delay and reverb.**
- **Screen-lock-safe scheduling:** the scheduler is driven by an audio-thread clock.
- **Import-time fixes:** the browser stubs Strudel's packages touch while loading.
- **Samples:** strudel.cc's default sample banks.

Coverage (**79%** of superdough's features): [COVERAGE.md](COVERAGE.md). What we found getting here:
[docs/FINDINGS.md](docs/FINDINGS.md).

## Status

- **Android:** 26/26 on a Pixel 10, the same as in Chrome.
- **iOS:** 26/26 on an iPhone 13 (iOS 26.5), built by this repo's `iOS example build` workflow. Playing with the
  screen locked hasn't been re-checked on iOS with this version (it worked with an earlier one).
- **Distribution:** not on npm. Install from GitHub.
- **Pinned versions:** `@strudel/core` / `@strudel/mini` 1.2.6, `@strudel/webaudio` / `superdough` 1.3.0, and
  react-native-audio-api 0.13.5 (the native patch is version-specific).

## Install

```sh
npm install github:wwrinkle/rn-strudel github:wwrinkle/rn-web-audio-compat \
  react-native-audio-api@0.13.5 react-native-worklets
```

This needs a development build; Expo Go won't work. rn-web-audio-compat is a peer dependency.

rn-strudel's `postinstall` does three things:
1. applies rn-web-audio-compat's native patch
2. adds its own C++ kernels (new files only)
3. fixes an upstream packaging bug in `@kabelsalat/web`

Run it from your app's `postinstall` too, so it re-runs after any install:

```json
"scripts": { "postinstall": "rn-strudel-apply" }
```

On Android, add the Expo plugin and the permissions that let audio keep playing with the screen locked:

```json
"plugins": ["react-native-audio-api"],
"android": { "permissions": ["android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK", "android.permission.POST_NOTIFICATIONS"] }
```

Rebuild the native app.

## Use

```ts
// index.ts: FIRST, before anything imports @strudel/* or superdough
import 'rn-strudel/environment';
```

```ts
import { initStrudel, loadDefaultSamples } from 'rn-strudel';

const engine = await initStrudel(); // one engine; later calls return it
await loadDefaultSamples();         // strudel.cc's sample banks (only if you use samples)

engine.scheduler.setPattern(await engine.evaluate('s("bd sd [~ bd] sd").bank("RolandTR909")'));
engine.scheduler.start();
// ...
engine.scheduler.stop();
```

You can also build patterns with the functions from `@strudel/core` / `@strudel/mini` (`note`, `s`, ...) and pass them
to `setPattern` directly.

`initStrudel(options)`:

| Option | Default | What it does |
| --- | --- | --- |
| `context` | new `AudioContext` | Use your own context |
| `nativeClock` | `true` | Tick the scheduler from native buffer-source events (no JS on the audio thread); `false` uses a JS worklet clock |
| `backgroundPlayback` | `true` | Show the Android playback notification while playing, so audio survives the screen locking |
| `resetEffectsOnStart` | `true` | Reset superdough's orbit effects on each `start()`; otherwise they keep the last pattern's values |

`setStrudelOptions({ fdnReverb, reverbIrCache, crackleCache })` switches rn-strudel's optimizations; all are on by
default, and each was A/B tested on a Pixel. `setNativeProcessorsEnabled(false)` from rn-web-audio-compat runs the JS
ports instead of the native effects.

**The same code on the web:** in a browser, `rn-strudel` resolves to a thin wrapper over stock Strudel, with the same
`initStrudel()` / `evaluate` / `loadDefaultSamples()` API, so app code shared between web and native needs no platform
checks.

## Demos

Both render one row per [COVERAGE.md](COVERAGE.md) feature, from the same source (`conformance/rows.ts`), with the pattern that
exercises it. **Play** loops the pattern and **Test** plays it briefly and checks that sound came out. Features that
don't work on React Native have a disabled button.

- **`example/`:** Expo app. It uses rn-web-audio-compat from a checkout next to this one
  (`git clone https://github.com/wwrinkle/rn-web-audio-compat ../rn-web-audio-compat`), so you can work on both at once.
  Run `cd example && npm install && npx expo run:android`.
  - The **CPU savings** panel has every A/B switch and a 10-second audio-load meter.
  - `EXPO_PUBLIC_AUTORUN=1` tests every row on launch and logs `[STRUDEL]` lines.
- **`web-demo/`:** the same rows on stock Strudel in a browser, as the reference for comparing by ear and by result.
  Run `cd web-demo && npm install && npm run dev`; `#run` tests everything.

Tests:
- `npm test`: parity tests of the TS ports against superdough's own processors.
- `npm run parity`: the C++ kernels against the TS ports, sample by sample.
- `npm run coverage`: regenerates COVERAGE.md.

## Credits

Written by **Willie Wrinkle** and **Claude** (Anthropic's AI model, via Claude Code), as co-authors.
- **Claude** designed and wrote most of the code: the processor ports and C++ kernels, the superdough integration, the
  demos and these docs. It also diagnosed the device bugs in [docs/FINDINGS.md](docs/FINDINGS.md) from crash dumps
  and logs.
- **Willie** directed the work, made the design decisions and tested everything by ear on real devices.

Built on:
- [Strudel](https://codeberg.org/uzu/strudel) by Felix Roos and contributors (AGPL-3.0-or-later). The processors in
  `src/processors` are ports of superdough's `worklets.mjs`. The bitcrush math traces back to dktr0's
  [WebDirt](https://github.com/dktr0/WebDirt) (GPL-3.0).
- [react-native-audio-api](https://github.com/software-mansion/react-native-audio-api) by Software Mansion.

## License

AGPL-3.0-or-later (it ports AGPL code from superdough), see [LICENSE](LICENSE). rn-web-audio-compat, which contains no
Strudel code, is MIT.
