// Registers superdough's worklet processors with rn-web-audio-compat: each as a JS worklet processor (the spec and
// fallback) and, where one exists, a native implementation (a C++ kernel from native/.../rnwac_ext, or a WaveShaper
// chain from nativeShapers.ts). Idempotent.

import {
  createNativeKernelNode,
  registerKernel,
  registerNativeProcessor,
  registerWorkletProcessor,
  type KernelEntry,
  type WorkletProcessorModule,
} from 'rn-web-audio-compat';
import type { AudioNode } from 'react-native-audio-api';
import { createNativeShaper, SHAPER_PROCESSORS } from './nativeShapers';
import { coarseProcessor } from './processors/coarseProcessor';
import { crushProcessor } from './processors/crushProcessor';
import { distortProcessor } from './processors/distortProcessor';
import { djfProcessor } from './processors/djfProcessor';
import { envelopeProcessor } from './processors/envelopeProcessor';
import { ladderProcessor } from './processors/ladderProcessor';
import { lfoProcessor } from './processors/lfoProcessor';
import { pulseOscillatorProcessor } from './processors/pulseOscillatorProcessor';
import { shapeProcessor } from './processors/shapeProcessor';
import { supersawOscillatorProcessor } from './processors/supersawOscillatorProcessor';
import { transientProcessor } from './processors/transientProcessor';

// superdough's registerProcessor() names -> the TS ports.
export const STRUDEL_PROCESSORS: Record<string, WorkletProcessorModule<any>> = {
  'crush-processor': crushProcessor,
  'ladder-processor': ladderProcessor,
  'coarse-processor': coarseProcessor,
  'shape-processor': shapeProcessor,
  'distort-processor': distortProcessor,
  'lfo-processor': lfoProcessor,
  'envelope-processor': envelopeProcessor,
  'transient-processor': transientProcessor,
  'pulse-oscillator': pulseOscillatorProcessor,
  'supersaw-oscillator': supersawOscillatorProcessor,
  'djf-processor': djfProcessor,
};

const num = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);

// C++ kernels (ids must match StrudelKernelId in native/.../rnwac_ext/StrudelKernels.cpp).
export const STRUDEL_KERNELS: Record<string, KernelEntry> = {
  'coarse-processor': { id: 101, kind: 'effect', module: coarseProcessor },
  'transient-processor': {
    id: 102,
    kind: 'effect',
    module: transientProcessor,
    extraParams: (o) => [
      num(o?.attackTime, 0.003),
      num(o?.sustainTime, 0.08),
      num(o?.attack, 0),
      num(o?.sustain, 0),
      num(o?.sensitivity, 0.1),
      num(o?.mix, 1),
      num(o?.begin, 0),
      num(o?.end, 0),
    ],
  },
  'djf-processor': { id: 103, kind: 'effect', module: djfProcessor },
  'ladder-processor': { id: 104, kind: 'effect', module: ladderProcessor },
  'lfo-processor': { id: 105, kind: 'source', module: lfoProcessor },
  'envelope-processor': { id: 106, kind: 'source', module: envelopeProcessor },
  'pulse-oscillator': { id: 107, kind: 'source', module: pulseOscillatorProcessor },
  'supersaw-oscillator': {
    id: 108,
    kind: 'source',
    module: supersawOscillatorProcessor,
    extraParams: () => [0],
    // superdough posts {type: 'initialize'} to reset a pooled supersaw's phases; the kernel re-seeds when extra param 0
    // changes.
    configure: (setExtraParam) => {
      let token = 0;
      return {
        port: {
          onmessage: null,
          postMessage: (data: { type?: string } | null) => {
            if (data && data.type === 'initialize') {
              token += 1;
              setExtraParam(0, token);
            }
          },
        },
      };
    },
  },
};

export const STRUDEL_KERNEL_NAMES = ['coarse', 'transient', 'djf', 'ladder', 'lfo', 'envelope', 'pulse', 'supersaw'];

let registered = false;

export function registerStrudelProcessors(): void {
  if (registered) return;
  registered = true;
  for (const [name, module] of Object.entries(STRUDEL_PROCESSORS)) {
    registerWorkletProcessor(name, module);
  }
  for (const [name, entry] of Object.entries(STRUDEL_KERNELS)) {
    registerKernel(name, entry);
    registerNativeProcessor(name, (ctx, opts) => createNativeKernelNode(ctx, name, opts) as AudioNode);
  }
  for (const name of SHAPER_PROCESSORS) {
    registerNativeProcessor(name, (ctx, opts) => createNativeShaper(ctx, name, opts) as AudioNode);
  }
}
