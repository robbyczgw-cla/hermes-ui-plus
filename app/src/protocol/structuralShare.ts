/**
 * Structural sharing for re-normalised (streaming) hui nodes: returns `next`, but every subtree
 * that is deep-equal to the corresponding subtree of `prev` is replaced by the `prev` object.
 * When nothing changed at all, `prev` itself is returned.
 *
 * Effect: while a ```hui block streams, completed rows / points / child nodes keep their object
 * identity across updates, so `memo`'d renderers (HuiView's Child, rows, series) and `useMemo`
 * keyed on node fields skip work for everything but the growing tail.
 *
 * Plain JSON-like values only (what `normalizeNode` produces). O(size of `next`).
 */
export function shareStructure<T>(prev: unknown, next: T, depth = 0): T {
  if (prev === next) return next;
  if (depth > 64 || prev === null || next === null || typeof prev !== 'object' || typeof next !== 'object') {
    return (Object.is(prev, next) ? prev : next) as T;
  }
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next;
    let same = prev.length === next.length;
    const out = new Array(next.length);
    for (let i = 0; i < next.length; i++) {
      const v = i < prev.length ? shareStructure(prev[i], next[i], depth + 1) : next[i];
      out[i] = v;
      if (same && !Object.is(v, prev[i])) same = false;
    }
    return (same ? prev : out) as T;
  }
  if (Array.isArray(prev)) return next;
  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const keys = Object.keys(n);
  let same = keys.length === Object.keys(p).length;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const has = Object.prototype.hasOwnProperty.call(p, k);
    const v = has ? shareStructure(p[k], n[k], depth + 1) : n[k];
    out[k] = v;
    if (same && (!has || !Object.is(v, p[k]))) same = false;
  }
  return (same ? p : out) as T;
}
