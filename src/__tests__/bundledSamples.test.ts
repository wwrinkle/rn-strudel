// bundledSamples() against the real superdough: a registered clip's URL, loaded the way superdough's sampler loads
// every sample (loadBuffer: fetch, then decodeAudioData), must come back as the buffer decoded from the asset, without
// touching the network; other URLs must still reach the real fetch.
import { getSound, loadBuffer, setAudioContext } from 'superdough';
import { bundledSamples } from '../bundledSamples';

const realFetch = jest.fn(async (url: string) => ({ url }));
(globalThis as any).fetch = realFetch;

// Stands in for react-native-audio-api's context: decodeAudioData takes an asset id (what require() returns).
const decode = jest.fn(async (source: unknown) => ({ decodedFrom: source }));
const context = { decodeAudioData: decode };

beforeAll(() => setAudioContext(context));

test('a bundled clip loads through superdough as its decoded buffer', async () => {
  await bundledSamples({ hello: 7, count: [11, 12] });

  expect(decode).toHaveBeenCalledTimes(3);
  const bank = getSound('count').data.samples;
  expect(bank).toEqual(['rn-asset:count/0', 'rn-asset:count/1']);
  await expect(loadBuffer(bank[1], context)).resolves.toEqual({ decodedFrom: 12 });
  await expect(loadBuffer(getSound('hello').data.samples[0], context)).resolves.toEqual({ decodedFrom: 7 });
  expect(realFetch).not.toHaveBeenCalled();
});

test('other URLs still reach the real fetch', async () => {
  await fetch('https://example.com/a.wav');
  expect(realFetch).toHaveBeenCalledWith('https://example.com/a.wav', undefined);
});

test('an unknown bundled URL fails instead of reaching the network', async () => {
  await expect(fetch('rn-asset:missing/0')).rejects.toThrow('no bundled sample');
  expect(realFetch).toHaveBeenCalledTimes(1);
});
