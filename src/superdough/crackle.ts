// s("crackle") without regenerating its noise buffer on every note (option 'crackleCache').
//
// superdough caches the white/pink/brown noise buffers but deliberately regenerates crackle's for every note
// ("Prevent caching to randomize crackles", noise.mjs): 2 s of Math.random() calls (96,000 at 48 kHz, about 3 ms of
// JS-thread work plus a 384 KB allocation per note). Here each density gets a small pool of buffers, generated the
// same way, and every note plays a random one from a random start offset (the buffer loops), so consecutive notes
// still get different crackles.
//
// Installed by re-registering the 'crackle' sound after registerSynthSounds(): same voice as superdough's
// (synth.mjs's noise sound: gain 0.3, linear ADSR with the same defaults, release handling), only the source buffer
// differs. With the switch off it calls superdough's original voice.

import { getAudioContext, gainNode, getADSRValues, getParamADSR, getSound, onceEnded, registerSound, releaseAudioNode } from 'superdough';
import type { AudioBuffer, AudioBufferSourceNode, BaseAudioContext } from 'react-native-audio-api';
import { getStrudelOption } from '../options';

const POOL_SIZE = 4;
const DEFAULT_DENSITY = 0.02; // noise.mjs getNoiseOscillator's default

const pools = new Map<string, AudioBuffer[]>();

// Same generation as noise.mjs getNoiseBuffer('crackle', density).
function generateCrackle(ac: BaseAudioContext, density: number): AudioBuffer {
  const bufferSize = 2 * ac.sampleRate;
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const output = buffer.getChannelData(0);
  const probability = density * 0.01;
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() < probability ? Math.random() * 2 - 1 : 0;
  }
  return buffer;
}

function getCrackleBuffer(ac: BaseAudioContext, density: number): AudioBuffer {
  const key = `${ac.sampleRate}|${density}`;
  let pool = pools.get(key);
  if (!pool) {
    pool = [];
    pools.set(key, pool);
  }
  // Fill the pool lazily: the first few notes at a density pay for generation, later ones reuse.
  if (pool.length < POOL_SIZE) {
    const buffer = generateCrackle(ac, density);
    pool.push(buffer);
    return buffer;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

type Trigger = (t: number, value: Record<string, number>, onended: () => void) => unknown;

export function installCrackleCache(): void {
  const original = getSound('crackle') as { onTrigger: Trigger; data: Record<string, unknown> } | undefined;
  if (!original) return;

  const trigger: Trigger = (t, value, onended) => {
    if (!getStrudelOption('crackleCache')) {
      return original.onTrigger(t, value, onended);
    }
    const [attack, decay, sustain, release] = getADSRValues(
      [value.attack, value.decay, value.sustain, value.release],
      'linear',
      [0.001, 0.05, 0.6, 0.01],
    );

    const ac = getAudioContext() as BaseAudioContext;
    const buffer = getCrackleBuffer(ac, value.density ?? DEFAULT_DENSITY);
    const o = ac.createBufferSource() as AudioBufferSourceNode;
    o.buffer = buffer;
    o.loop = true;
    o.start(t, Math.random() * buffer.duration);

    // turn down
    const g = gainNode(0.3);

    const { duration } = value;

    onceEnded(o, () => {
      releaseAudioNode(o);
      releaseAudioNode(g);
      onended();
    });

    const envGain = gainNode(1);
    const node = o.connect(g).connect(envGain) as typeof envGain;
    const holdEnd = t + duration;
    getParamADSR(node.gain, attack, decay, sustain, release, 0, 1, t, holdEnd, 'linear');
    const envEnd = holdEnd + release + 0.01;
    o.stop(envEnd);
    return {
      node,
      nodes: { source: [o] },
      stop: (endTime: number) => {
        o.stop(endTime);
      },
    };
  };

  registerSound('crackle', trigger, original.data);
}
