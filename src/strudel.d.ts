// @strudel/* and superdough ship no TypeScript declarations at all (pure
// .mjs). This is proof-of-life integration code, not something depending on
// precise types for correctness — every call site is verified at runtime
// instead. See web-demo/src/strudel.d.ts, same reasoning.
declare module '@strudel/core';
declare module '@strudel/mini';
declare module '@strudel/webaudio';
declare module 'superdough';
