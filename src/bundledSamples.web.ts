/// <reference path="./strudel.d.ts" />
// Web build of bundledSamples(): a bundled asset already has a URL in the browser (what require() or a bundler's
// import returns), so this is stock samples() plus loading each clip up front, like the native version, so the first
// hit of a clip plays. Call it after initStrudel().

import { getAudioContext, loadBuffer, samples } from 'superdough';

export type BundledSample = number | string;

// One clip, several (name:0, name:1, ...), or clips by the note they were recorded at (bundledSamples.ts).
export type BundledSamples =
  BundledSample | readonly BundledSample[] | Readonly<Record<string, BundledSample | readonly BundledSample[]>>;

export async function bundledSamples(map: Record<string, BundledSamples>): Promise<void> {
  const all: string[] = [];
  const toUrls = (name: string, value: BundledSample | readonly BundledSample[]) =>
    (Array.isArray(value) ? value : [value as BundledSample]).map((source) => {
      if (typeof source !== 'string') throw new Error(`rn-strudel: bundled sample "${name}" is not a URL on web`);
      all.push(source);
      return source;
    });
  const urls: Record<string, string[] | Record<string, string[]>> = {};
  for (const [name, value] of Object.entries(map)) {
    urls[name] =
      typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value as Record<string, BundledSample | readonly BundledSample[]>).map(([note, clips]) => [
              note,
              toUrls(name, clips),
            ])
          )
        : toUrls(name, value as BundledSample | readonly BundledSample[]);
  }
  await samples(urls);
  const context = getAudioContext();
  await Promise.all(all.map((url) => loadBuffer(url, context)));
}
