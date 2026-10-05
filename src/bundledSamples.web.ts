/// <reference path="./strudel.d.ts" />
// Web build of bundledSamples(): a bundled asset already has a URL in the browser (what require() or a bundler's
// import returns), so this is stock samples() plus loading each clip up front, like the native version, so the first
// hit of a clip plays. Call it after initStrudel().

import { getAudioContext, loadBuffer, samples } from 'superdough';

export type BundledSample = number | string;

export async function bundledSamples(map: Record<string, BundledSample | readonly BundledSample[]>): Promise<void> {
  const urls: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(map)) {
    const sources = Array.isArray(value) ? value : [value as BundledSample];
    urls[name] = sources.map((source) => {
      if (typeof source !== 'string') throw new Error(`rn-strudel: bundled sample "${name}" is not a URL on web`);
      return source;
    });
  }
  await samples(urls);
  const context = getAudioContext();
  await Promise.all(Object.values(urls).flat().map((url) => loadBuffer(url, context)));
}
