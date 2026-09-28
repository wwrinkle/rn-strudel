// Shared by rn-strudel's Expo example app (React Native) and its web demo (stock Strudel in a browser, the reference):
// one row per Strudel/superdough feature, each with the pattern code that exercises it. Both demos evaluate the same
// code text, so the web result is a like-for-like reference.

export type Coverage = 'yes' | 'partial' | 'no';

export interface StrudelRow {
  id: string;
  group: string;
  name: string; // markdown
  covered: Coverage; // on React Native (the web always has everything)
  how: string; // how React Native gets it (markdown)
  source?: string; // markdown links, relative to the repo root
  code?: string; // pattern code; absent = not implemented on React Native (the button is disabled)
  needsSamples?: boolean; // loads strudel.cc's default sample manifests first (network)
  savings?: string;
}

export interface StrudelEngineLike {
  scheduler: { setPattern: (p: unknown) => void; start: () => void; stop: () => void };
  context: any;
  sleep: (ms: number) => Promise<void>;
  evaluate: (code: string) => Promise<unknown>;
}

export interface StrudelTestEnv {
  platform: 'native' | 'web';
  engine(): Promise<StrudelEngineLike>;
  loadSamples(): Promise<void>;
  audible: boolean;
  playMs: number;
}

export interface StrudelResult {
  ok: boolean;
  detail: string;
  ms: number;
}
