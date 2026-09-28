# rn-strudel: notes for working on this repo

Read [README.md](README.md) and [docs/FINDINGS.md](docs/FINDINGS.md), and rn-web-audio-compat's docs/FINDINGS.md
before touching anything that runs on the audio thread.

- **License:** AGPL-3.0-or-later (ports superdough code). Anything generic (not derived from Strudel) belongs in the MIT
  sibling `rn-web-audio-compat` instead.
- **Processors:** `src/processors/*.ts` are ports of superdough's `worklets.mjs`, parity-tested against the real
  classes (`npm test`). They are the spec for the C++ kernels in `native/.../rnwac_ext/StrudelKernels.cpp`
  (`npm run parity`). `process()` must be self-contained with its own 'worklet' directive; grep a new processor for
  references to module-level bindings from inside `process()`: Jest can't catch that, only a device can.
- **Native files:** only ADD files under `rnwac_ext/` (ids 100-255); never edit files rn-web-audio-compat's patch
  touches. `scripts/apply-native.js` copies them after applying the compat patch.
- **Single source of truth:** `conformance/rows.ts` feeds COVERAGE.md (`npm run coverage`), the example app and the web
  demo.
- **Device runs:** `rm -rf example/android/app/build/generated/assets/react` before `./gradlew :app:assembleRelease`
  (stale bundle otherwise). `EXPO_PUBLIC_AUTORUN=1` tests every row on launch; read `[STRUDEL]` lines from logcat.
  Keep the phone unlocked (`adb shell svc power stayon usb`).
- **Pinned upstream versions** (@strudel/* 1.2.6 / 1.3.0): superdough internals are patched by name
  (`createFeedbackDelay`, `createReverb`, the crackle sound); re-check them when upgrading.
- **iOS:** run the `iOS example build` workflow (free: public repo), sideload the .ipa, read `[STRUDEL]` lines from the
  device log (`pymobiledevice3 syslog live`, started before opening the app). A free Apple ID allows 3 sideloaded apps;
  profiles of uninstalled apps still count (`pymobiledevice3 provision list` / `remove`).
