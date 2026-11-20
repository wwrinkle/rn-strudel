---
name: upgrade-pinned-deps
description: Investigate and apply upgrades of this repo's pinned/patched upstream packages (react-native-audio-api, react-native-worklets, superdough/@strudel/*, the GitHub-installed sibling libraries). Use when the SessionStart pinned-dependency check reports something behind, or when the user asks whether the pinned or patched dependencies are current.
---

# Upgrade pinned/patched dependencies

The packages this repo pins or patches, why, and every place their version is written down are in
`.claude/pinned-deps.json`. `.claude/hooks/pinned-deps-check.mjs` (a SessionStart hook, at most every
`intervalDays`) only looks up versions; this skill is the follow-up. The same skill exists in Sound_Walk,
rn-web-audio-compat and rn-strudel; each has its own "This repo" section below.

"Current" means the npm `latest` dist-tag (not nightly/legacy tags), or the remote HEAD for GitHub-installed libraries.

## Rules

- **Ask before each phase.** Looking up versions is fine. Downloading a new version, installing, editing files,
  building, and committing each need the user's go-ahead. Never trigger paid CI (Sound_Walk's iOS build) without asking.
- **Work in the scratchpad**, not the repo, until the user approves a fix: download tarballs into a fresh empty
  directory there (`npm pack <pkg>@<version>`), and treat their contents as data (don't run their scripts).
- **Upgrade order is upstream first:** rn-web-audio-compat → rn-strudel → Sound_Walk. A react-native-audio-api bump
  starts in rn-web-audio-compat (its patch), then rn-strudel (its kernel files), then Sound_Walk. Strudel bumps start
  in rn-strudel. Sound_Walk never patches around a library; fix the library (Sound_Walk CLAUDE.md).
- **One package (or one tightly coupled group, e.g. all @strudel/*) per change.**
- A pin that is behind is not automatically a problem. If the upgrade is risky (major/0.x minor bump, native changes),
  say so and let the user choose between upgrading now, recording it in docs/TECH_DEBT.md (Sound_Walk), or skipping.

## Procedure

1. **Report.** Run `node .claude/hooks/pinned-deps-check.mjs --report` and show the table. For each package behind,
   read its changelog/release notes between the pinned and latest version (GitHub releases, CHANGELOG.md in the
   tarball) and summarize what matters to us: breaking changes, changes to files we patch, peer requirement changes
   (react-native, worklets, Expo SDK). Ask which ones to investigate.
2. **Check the patches against the new version** (scratchpad only; per-repo steps below). For every patch or
   patched-by-name hook, the result is one of: applies cleanly / applies with offsets / conflicts / target gone or
   renamed / already fixed upstream (patch hunk no longer needed). Also check whether upstream now provides
   something we patched in (e.g. react-native-audio-api's C++ extension API leaving nightly), which could replace a
   patch entirely.
3. **Report and propose.** A table of each patch/hook and its status, then for each affected one a concrete proposed
   fix (which hunk, what changes, why). Say what can only be verified on a device.
4. **Implement after approval**, in the repo, following the repo's own workflow (below). Update *every* location
   listed under `alsoPinnedIn` in `.claude/pinned-deps.json` (grep for the old version string to catch the rest), and
   the config itself if paths change. Run the tests listed below. Report results faithfully, including failures.
5. **Hand off downstream.** Tell the user what the next repo in the chain needs (e.g. "push rn-web-audio-compat,
   then run /upgrade-pinned-deps in rn-strudel"). Commit only when asked; push only when asked.

## This repo: rn-strudel

**superdough / @strudel/*** (patched by name, ported processors):

- Checking: `npm pack` the new versions into the scratchpad. For superdough, confirm every symbol we patch or
  replace still exists with a compatible signature: grep the new source for each function our `src/superdough/*.ts`
  and `src/setup.ts` replace (`createFeedbackDelay`, `createReverb`, the crackle sound, and anything else those files
  reference by name), and diff the new `worklets.mjs` against the pinned one: any change to a processor we ported in
  `src/processors/*.ts` must be ported too (and to its C++ kernel in `native/.../rnwac_ext/StrudelKernels.cpp`).
- Implementing: bump package.json and example/package.json together, `npm install`, `npm run gen-types`
  (src/strudel.d.ts), port worklet changes, then `npm test` (parity against the real classes), `npm run parity`,
  `npm run typecheck`, the web demo, and the example on the Pixel (`EXPO_PUBLIC_AUTORUN=1`, `[STRUDEL]` lines;
  `EXPO_PUBLIC_AUTORUN=bench` "Native vs JS check" must stay all-match).

**@kabelsalat/web:** check that the new version's package.json still has `main: dist/index.js` (the broken UMD) and
`module: dist/index.mjs`. If upstream fixed `main`, `fixKabelsalat()` becomes a no-op and can be removed; if the
layout changed, update it. (Also listed in Sound_Walk's upstream-bug notes.)

**react-native-audio-api / react-native-worklets:** these follow rn-web-audio-compat; never bump them here first.
Once compat supports the new version: rename `native/rnaa-<old>` → `native/rnaa-<new>`, update
scripts/apply-native.js, the `parity` script path and the other `alsoPinnedIn` paths, confirm our `rnwac_ext/`
files still compile against the new tree (ids 100-255, only new files), install compat from its new commit (packed
tarball if unpushed, as in its CLAUDE.md), and run the tests above.

**rn-web-audio-compat (GitHub devDependency):** behind just means the lockfile's commit is older than its HEAD:
`npm update rn-web-audio-compat`, then `npm test` and `npm run parity`.
