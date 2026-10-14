import { fin, roundHalfAway } from './numeric.ts';

export interface FnDef {
  min: number;
  /** Infinity = variadic. */
  max: number;
  /** Receives only non-NaN arguments. Must return a number (NaN = not computable). */
  run: (a: number[]) => number;
}

/** `if(c, a, b)` is a lazy special form handled by the evaluator; arity is registered here. */
export const IF_NAME = 'if';

const table = new Map<string, FnDef>([
  ['min', { min: 1, max: Infinity, run: (a) => Math.min(...a) }],
  ['max', { min: 1, max: Infinity, run: (a) => Math.max(...a) }],
  [
    'round',
    {
      min: 1,
      max: 2,
      run: (a) => {
        const d = a.length > 1 ? a[1] : 0;
        if (!Number.isInteger(d) || d < -10 || d > 15) return NaN;
        return roundHalfAway(a[0], d);
      },
    },
  ],
  ['floor', { min: 1, max: 1, run: (a) => Math.floor(a[0]) }],
  ['ceil', { min: 1, max: 1, run: (a) => Math.ceil(a[0]) }],
  ['abs', { min: 1, max: 1, run: (a) => Math.abs(a[0]) }],
  ['sqrt', { min: 1, max: 1, run: (a) => (a[0] < 0 ? NaN : Math.sqrt(a[0])) }],
  ['pow', { min: 2, max: 2, run: (a) => fin(Math.pow(a[0], a[1])) }],
  ['log', { min: 1, max: 1, run: (a) => (a[0] <= 0 ? NaN : Math.log10(a[0])) }],
  ['ln', { min: 1, max: 1, run: (a) => (a[0] <= 0 ? NaN : Math.log(a[0])) }],
  ['exp', { min: 1, max: 1, run: (a) => fin(Math.exp(a[0])) }],
  [
    'clamp',
    { min: 3, max: 3, run: (a) => (a[1] > a[2] ? NaN : Math.min(Math.max(a[0], a[1]), a[2])) },
  ],
  [IF_NAME, { min: 3, max: 3, run: () => NaN }],
]);

export function getFunction(name: string): FnDef | undefined {
  return table.get(name);
}

export function functionNames(): string[] {
  return Array.from(table.keys());
}

export const CONSTANTS: ReadonlyMap<string, number> = new Map([
  ['pi', Math.PI],
  ['e', Math.E],
]);

/** Names that must never be usable as identifiers (prototype-pollution style probes). */
export const RESERVED_NAMES: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
