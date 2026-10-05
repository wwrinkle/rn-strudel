/// <reference path="./strudel.d.ts" />
// bundledSamples(): samples shipped inside the app, by name, for s("name"). Call it after initStrudel().
//
//   await bundledSamples({ hello: require('./assets/hello.wav'), count: [require('./one.wav'), require('./two.wav')] });
//   s("hello count:1")
//
// superdough loads every sample with fetch(url) and then decodes the bytes. A release build's bundled asset has no URL
// fetch can read on Android (it's a name inside the APK, and Android's fetch only speaks http/https), so each clip is
// decoded here instead, with react-native-audio-api, which reads bundled assets on every platform and build. The clips
// are registered under private rn-asset: URLs, and fetch and decodeAudioData answer those URLs with the decoded
// buffers. Every other URL goes through untouched. Decoding up front also means the first hit of a clip plays: a clip
// superdough loads on first use is dropped if loading takes longer than the scheduler's lookahead.

import { getAudioContext, samples } from 'superdough';

// What require('./clip.wav') returns (an asset id), or a URI react-native-audio-api can decode.
export type BundledSample = number | string;

const PREFIX = 'rn-asset:';
const decoded = new Map<string, unknown>();
// What the rn-asset: fetch hands superdough in place of the file's bytes; decodeAudioData turns it back into the buffer.
const TOKEN = Symbol('rn-strudel bundled sample');

let installedOn: unknown = null;

function install(context: any): void {
  if (installedOn === context) return;
  if (installedOn === null) {
    const fetch = globalThis.fetch;
    globalThis.fetch = ((input: any, init?: any) => {
      if (typeof input === 'string' && input.startsWith(PREFIX)) {
        if (!decoded.has(input)) return Promise.reject(new Error(`rn-strudel: no bundled sample ${input}`));
        return Promise.resolve({ ok: true, status: 200, arrayBuffer: async () => ({ [TOKEN]: input, byteLength: 0 }) });
      }
      return fetch(input, init);
    }) as typeof fetch;
  }
  const decode = context.decodeAudioData.bind(context);
  context.decodeAudioData = (input: any, ...rest: unknown[]) =>
    input && typeof input === 'object' && TOKEN in input ? Promise.resolve(decoded.get(input[TOKEN])) : decode(input, ...rest);
  installedOn = context;
}

export async function bundledSamples(map: Record<string, BundledSample | readonly BundledSample[]>): Promise<void> {
  const context = getAudioContext();
  install(context);
  const urls: Record<string, string[]> = {};
  await Promise.all(
    Object.entries(map).map(async ([name, value]) => {
      const sources = Array.isArray(value) ? value : [value as BundledSample];
      urls[name] = await Promise.all(
        sources.map(async (source, i) => {
          const url = `${PREFIX}${name}/${i}`;
          decoded.set(url, await context.decodeAudioData(source));
          return url;
        })
      );
    })
  );
  await samples(urls);
}
