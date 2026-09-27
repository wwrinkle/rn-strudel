// Runtime switches for rn-strudel's optional behaviour (all were A/B-tested on a Pixel 10, 2026-09-27; the defaults
// are the measured winners). Read at the point of use, so changes apply to the next reverb/crackle that is created.

export interface StrudelOptions {
  // .room() uses rn-web-audio-compat's C++ FDN reverb instead of convolution: 41% vs 78% audio-thread load on a Pixel
  // for .room(0.6), and uncapped .roomsize. User impulse responses (.ir()) always use convolution.
  fdnReverb: boolean;
  // Convolution reverb reuses generated impulse responses instead of regenerating one per orbit / param change.
  reverbIrCache: boolean;
  // s("crackle") plays from a small pool of pre-generated buffers instead of making a 2 s buffer per note (19 ms -> 1-3 ms
  // of JS per note on a Pixel).
  crackleCache: boolean;
}

const options: StrudelOptions = {
  fdnReverb: true,
  reverbIrCache: true,
  crackleCache: true,
};

export function getStrudelOption<K extends keyof StrudelOptions>(key: K): StrudelOptions[K] {
  return options[key];
}

export function setStrudelOptions(next: Partial<StrudelOptions>): void {
  Object.assign(options, next);
}

export function getStrudelOptions(): StrudelOptions {
  return { ...options };
}
