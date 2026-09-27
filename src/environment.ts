// Side-effect module: import it FIRST in your app's entry, before anything that imports @strudel/* or superdough.
//
//   import 'rn-strudel/environment';
//
// Installs rn-web-audio-compat's Web Audio globals, plus the minimal browser environment Strudel's packages touch at
// module-evaluation time. ES module imports fully evaluate (including everything they import) before the importing
// module's own statements run, so these must live in a module of their own that is imported first. Found on-device:
//  - @strudel/core's signal.mjs: `if (typeof window !== 'undefined') document.addEventListener('mousemove', ...)` at
//    top level. `window` already exists in React Native, `document` does not, so it threw
//    "Property 'document' doesn't exist" before React mounted (a blank white screen).
//  - superdough's dspworklet.mjs (evaluated by any `import ... from 'superdough'`): top-level
//    `window.addEventListener('message', ...)`.
// These are inert stubs, not a DOM: extend them the same way if a new "Property 'x' doesn't exist" appears at startup.

import 'rn-web-audio-compat/globals';

const g = globalThis as Record<string, unknown>;

if (typeof g.window === 'undefined') {
  g.window = globalThis;
}

if (typeof g.addEventListener === 'undefined') {
  const noop = (): void => {};
  g.addEventListener = noop;
  g.removeEventListener = noop;
  g.postMessage = noop;
}

if (typeof g.document === 'undefined') {
  const noop = (): void => {};
  g.document = {
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    createElement: () => ({ setAttribute: noop, style: {} }),
    getElementById: () => null,
    body: {
      appendChild: noop,
      removeChild: noop,
      clientWidth: 0,
      clientHeight: 0,
    },
  };
}
