// Writes src/strudel.d.ts (npm run gen-types): TypeScript declarations for @strudel/core, @strudel/mini and
// @strudel/tonal, which ship none. Don't edit src/strudel.d.ts by hand; change this script and rerun it.
//
// The names come from the packages themselves: this loads them the way src/language.ts does and lists every export and
// every method on Pattern.prototype, so the declarations cover exactly what the pinned versions provide. A pattern
// method that doesn't exist (a typo, or one from a package that isn't loaded) is then a type error instead of
// "x is not a function" at runtime. Argument types are loose (any): Strudel's functions take patterns, mini-notation
// strings, numbers and arrays almost everywhere, so only names and return types are checked, plus the hand-written
// signatures below.
import * as fs from 'fs';
import * as path from 'path';

const OUT = path.join(__dirname, '..', 'src', 'strudel.d.ts');

// Exports that aren't pattern methods but do return a pattern (checked by calling each one when this list was made).
const PATTERN_FUNCTIONS = new Set([
  'arrange', 'binary', 'binaryL', 'binaryN', 'binaryNL', 'brandBy', 'chooseCycles', 'chooseIn', 'chooseInWith',
  'chooseOut', 'chooseWith', 'gap', 'irand', 'morph', 'pm', 'polymeter', 'polyrhythm', 'pr', 'pure', 'randL',
  'randcat', 'randrun', 'reify', 'run', 's_alt', 's_cat', 'sequenceP', 'signal', 'slowcatPrime', 'stackBy',
  'stackCentre', 'stackLeft', 'stackRight', 'steady', 'stepalt', 'stepcat', 'timeCat', 'timecat', 'wchooseCycles',
  'wrandcat',
  // @strudel/mini
  'm', 'mini', 'h',
]);

// Pattern methods that return something else.
const NON_PATTERN_METHODS = new Set(['queryArc', 'firstCycle']);

// Pattern getters that return an operator: callable, with variants (pat.add(1), pat.add.squeeze(1), pat.add.out(1)).
// The other getters are plain values.
const OPERATOR_GETTERS = new Set([
  'set', 'keep', 'keepif', 'add', 'sub', 'mul', 'div', 'mod', 'pow', 'log2', 'band', 'bor', 'bxor', 'blshift',
  'brshift', 'lt', 'gt', 'lte', 'gte', 'eq', 'eqt', 'ne', 'net', 'and', 'or', 'func',
]);

// Hand-written signatures, used instead of the generated ones. Keep them loose where Strudel is.
type Arg = 'Pattern | string | number | (Pattern | string | number)[]';
const ARG: Arg = 'Pattern | string | number | (Pattern | string | number)[]';
const SIGNATURES: Record<string, string> = {
  isPattern: 'export function isPattern(value: unknown): value is Pattern;',
  stack: `// Plays the patterns at the same time.\n  export function stack(...patterns: (${ARG})[]): Pattern;`,
  cat: `// One pattern per cycle, in turn.\n  export function cat(...patterns: (${ARG})[]): Pattern;`,
  seq: `// All the patterns within one cycle.\n  export function seq(...patterns: (${ARG})[]): Pattern;`,
  pure: '// A pattern that repeats one value, once per cycle.\n  export function pure(value: unknown): Pattern;',
  signal:
    '// A continuous pattern: fn is called with the time in cycles each time the scheduler queries it.\n' +
    '  export function signal(fn: (t: number) => unknown): Pattern;',
  wchooseCycles:
    "// Picks one value per cycle, weighted: wchooseCycles(['0', 3], [silence, 22]).\n" +
    '  export function wchooseCycles(...pairs: [unknown, number][]): Pattern;',
  chooseCycles: `// Picks one of the patterns per cycle.\n  export function chooseCycles(...patterns: (${ARG})[]): Pattern;`,
};

async function main() {
  // Same order as src/language.ts: core, then the packages that register pattern methods on core's Pattern.
  const core = await import('@strudel/core');
  const mini = await import('@strudel/mini');
  const tonal = await import('@strudel/tonal');
  const Pattern = core.Pattern;
  const proto = Pattern.prototype;

  const version = (pkg: string) =>
    JSON.parse(fs.readFileSync(require.resolve(`${pkg}/package.json`), 'utf8')).version as string;
  const isIdentifier = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name);

  // --- Pattern class ---
  const members: string[] = [];
  for (const name of Object.getOwnPropertyNames(proto).sort()) {
    if (name === 'constructor' || !isIdentifier(name)) continue;
    const d = Object.getOwnPropertyDescriptor(proto, name)!;
    if (d.get || d.set) {
      members.push(OPERATOR_GETTERS.has(name) ? `readonly ${name}: PatternOperator;` : `readonly ${name}: any;`);
    } else if (typeof d.value === 'function') {
      members.push(`${name}(...args: any[]): ${NON_PATTERN_METHODS.has(name) ? 'any' : 'Pattern'};`);
    } else {
      members.push(`${name}: any;`);
    }
  }

  // --- module exports ---
  const exportsOf = (mod: Record<string, unknown>) => {
    const lines: string[] = [];
    for (const name of Object.keys(mod).sort()) {
      if (!isIdentifier(name) || name === 'Pattern') continue;
      const value = mod[name];
      if (SIGNATURES[name]) lines.push(SIGNATURES[name]);
      else if (value instanceof Pattern) lines.push(`export const ${name}: Pattern;`);
      else if (typeof value === 'function' && (name in proto || PATTERN_FUNCTIONS.has(name)))
        lines.push(`export function ${name}(...args: any[]): Pattern;`);
      else lines.push(`export const ${name}: any;`);
    }
    return lines;
  };
  for (const name of PATTERN_FUNCTIONS) {
    if (!(name in core) && !(name in mini)) throw new Error(`PATTERN_FUNCTIONS: ${name} is not exported any more`);
  }
  for (const name of [...NON_PATTERN_METHODS, ...OPERATOR_GETTERS]) {
    if (!(name in proto)) throw new Error(`${name} is not a Pattern method any more`);
  }

  const indent = (lines: string[], spaces = 2) => lines.map((l) => ' '.repeat(spaces) + l).join('\n');
  const out = `// Generated by scripts/gen-strudel-types.ts (npm run gen-types) from @strudel/core ${version('@strudel/core')},
// @strudel/mini ${version('@strudel/mini')} and @strudel/tonal ${version('@strudel/tonal')}. Do not edit by hand.
//
// Strudel ships no TypeScript declarations. These list every export and every Pattern method of those versions, with
// tonal's methods (scale, transpose, voicing, ...) on Pattern: import 'rn-strudel/language' (initStrudel() does) so
// they exist at runtime. Arguments are loose (any); names and return types are checked. @strudel/webaudio and
// superdough stay untyped.

// What a Pattern getter like .add returns: call it (pat.add(1)) or pick a variant (pat.add.squeeze(1)).
interface PatternOperator {
  (...args: any[]): import('@strudel/core').Pattern;
  readonly [variant: string]: (...args: any[]) => import('@strudel/core').Pattern;
}

declare module '@strudel/core' {
  export class Pattern {
    constructor(query: (state: any) => any[], steps?: any);
    query: (state: any) => any[];
${indent(members, 4)}
  }

${indent(exportsOf(core))}
}

declare module '@strudel/mini' {
${indent(exportsOf(mini))}
}

declare module '@strudel/tonal' {
${indent(exportsOf(tonal))}
}

declare module '@strudel/webaudio';
declare module 'superdough';
`;
  fs.writeFileSync(OUT, out);
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${members.length} Pattern members`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
