// Runs before any test module loads (see package.json's "jest.setupFiles").
// superdough's worklets.mjs assumes a real AudioWorkletGlobalScope: it
// references `AudioWorkletProcessor`, `registerProcessor`, and `sampleRate`
// as bare globals, including at module top-level (`const INVSR = 1 /
// sampleRate`), so they must exist before that module is first required —
// this file runs early enough for that, a plain import in a test file would
// not (import/require is hoisted above other statements in the same file).
//
// registerProcessor is captured into __registeredProcessors so parity tests
// can pull out the real processor classes by name, the same way a real
// AudioWorkletGlobalScope would register them.

global.sampleRate = 44100;

// Several processors (lfo, envelope, transient, pulse-oscillator, supersaw)
// read `currentTime` — a live-updating global in a real AudioWorkletGlobalScope
// reflecting the context's playhead. Tests for those set this directly
// between simulated blocks (see e.g. lfoProcessor.test.ts).
global.currentTime = 0;

// A real AudioWorkletProcessor's `this.port` is a live MessagePort,
// provided automatically by the native constructor. Some processors
// (supersaw-oscillator) wire up `this.port.onmessage` in their own
// constructor, so this fake base class needs a minimal stand-in or
// construction itself throws.
global.AudioWorkletProcessor = class {
  constructor() {
    this.port = { onmessage: null, postMessage: () => {} };
  }
};

global.__registeredProcessors = {};
global.registerProcessor = (name, ProcessorClass) => {
  global.__registeredProcessors[name] = ProcessorClass;
};
