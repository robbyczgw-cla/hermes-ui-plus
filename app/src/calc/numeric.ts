/** Numeric helpers shared by evaluator and formatter. NaN is the engine's "not computable". */

/** Non-finite -> NaN, -0 -> 0. */
export function fin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  return x === 0 ? 0 : x;
}

const EPS = Number.EPSILON;

/**
 * Round half away from zero to `d` decimals (d may be negative), tolerant to binary
 * representation noise: roundHalfAway(1.005, 2) === 1.01, roundHalfAway(-2.5, 0) === -3.
 */
export function roundHalfAway(x: number, d: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (x === 0) return 0;
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const f = Math.pow(10, Math.abs(d));
  const m = d >= 0 ? abs * f : abs / f;
  if (!Number.isFinite(m)) return x;
  if (m >= 4503599627370496) return x; // 2^52: already integral
  const fl = Math.floor(m);
  const tol = 4 * EPS * Math.max(1, m);
  const r = m - fl >= 0.5 - tol ? fl + 1 : fl;
  const out = d >= 0 ? r / f : r * f;
  return out === 0 ? 0 : sign * out;
}

/** Equality with a small relative tolerance, so 0.1 + 0.2 == 0.3 holds. */
export function approxEq(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Convert a scope value to a number. Booleans -> 1/0, numeric strings accepted, everything else NaN. */
export function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '' || t.length > 40) return NaN;
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return NaN;
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}
