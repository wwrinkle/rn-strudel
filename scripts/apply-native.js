#!/usr/bin/env node
// rn-strudel's install step (idempotent; safe to run from this package's postinstall and the app's own postinstall):
//   1. makes sure rn-web-audio-compat's react-native-audio-api patch is applied (its apply step), then
//   2. copies rn-strudel's C++ kernels into react-native-audio-api as NEW files under dsp/rnwac_ext/ (they register
//      through rn-web-audio-compat's extension hook; nothing existing is edited), and
//   3. fixes @kabelsalat/web's package.json "main" (points at a browser-global UMD build that exports nothing under a
//      module system; @strudel/core's repl() does `new SalatRepl()` from it and throws). Its "module" build is correct.
// Rebuild the native app after it changes anything.
//
// Usage: npx rn-strudel-apply [--rnaa <path to react-native-audio-api>]

const fs = require('fs');
const path = require('path');

const TAG = '[rn-strudel]';

function resolveFrom(bases, request) {
  for (const base of bases) {
    try {
      return require.resolve(request, { paths: [base] });
    } catch {
      // next
    }
  }
  return null;
}

function bases() {
  return [process.env.INIT_CWD, process.cwd(), path.resolve(__dirname, '..')].filter(Boolean);
}

function fixKabelsalat() {
  const core = resolveFrom(bases(), '@strudel/core/package.json');
  const pkgPath = resolveFrom([core ? path.dirname(core) : null, ...bases()].filter(Boolean), '@kabelsalat/web/package.json');
  if (!pkgPath) return 'not installed';
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.main === 'dist/index.js' && pkg.module === 'dist/index.mjs') {
    pkg.main = 'dist/index.mjs';
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    return 'fixed';
  }
  return 'ok';
}

function main() {
  const compatScript = resolveFrom(bases(), 'rn-web-audio-compat/scripts/apply-native');
  if (!compatScript) {
    console.warn(`${TAG} rn-web-audio-compat not found (it is a peer dependency); skipping native setup.`);
    return;
  }
  const { applyExtensionFiles } = require(compatScript);
  const i = process.argv.indexOf('--rnaa');
  const filesDir = path.resolve(__dirname, '..', 'native', 'rnaa-0.13.5', 'files');
  const result = applyExtensionFiles('rn-strudel', filesDir, i > 0 ? process.argv[i + 1] : undefined);
  const kabelsalat = fixKabelsalat();
  if (!result) return;
  const changed = result.copied > 0 || result.compat.copied > 0 || result.compat.patched === 'applied';
  console.log(
    `${TAG} ${result.rnaaDir}: compat patch ${result.compat.patched}, ${result.compat.copied + result.copied} file(s) copied; ` +
      `@kabelsalat/web ${kabelsalat}.` + (changed ? ' Rebuild the native app.' : '')
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
