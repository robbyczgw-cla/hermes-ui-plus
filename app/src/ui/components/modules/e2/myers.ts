/**
 * Myers O((N+M)·D) shortest edit script for line and token sequences (pure, node:test). Common prefix / suffix are
 * trimmed first; past `maxCost` edits the middle falls back to "delete all, insert all" (bounded work for any input).
 */

export type EditOp = 0 | 1 | 2;
/** 0 = equal, 1 = delete (a only), 2 = insert (b only) */
export const EQ: EditOp = 0;
export const DEL: EditOp = 1;
export const INS: EditOp = 2;

/**
 * Edit script turning `a` into `b`: one op per element (equal consumes one of each, delete one of `a`, insert one
 * of `b`), deletions before insertions inside a change. `null` past `maxCost` edits when `strict` (callers that would
 * rather show nothing than a coarse diff); else the coarse fallback.
 */
export function editScript<T>(a: readonly T[], b: readonly T[], maxCost = 2000, strict = false): EditOp[] | null {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const n = a.length - pre - suf;
  const m = b.length - pre - suf;
  const ops: EditOp[] = [];
  for (let i = 0; i < pre; i++) ops.push(EQ);
  const mid = middle(a, b, pre, n, m, maxCost);
  if (!mid) {
    if (strict) return null;
    for (let i = 0; i < n; i++) ops.push(DEL);
    for (let i = 0; i < m; i++) ops.push(INS);
  } else for (const op of mid) ops.push(op);
  for (let i = 0; i < suf; i++) ops.push(EQ);
  return ops;
}

/**
 * greedy forward Myers; for the backtrack it keeps, per D, only the band of V that D can read (k = -D-1 … D+1), so the
 * trace costs O(D²) memory instead of O(D · maxCost) (a 3000-edit diff: ~36 MB → ~9 M ints … ~4 MB at 1000); null past maxCost
 */
function middle<T>(a: readonly T[], b: readonly T[], off: number, n: number, m: number, maxCost: number): EditOp[] | null {
  if (n === 0 || m === 0) {
    const ops: EditOp[] = [];
    for (let i = 0; i < n; i++) ops.push(DEL);
    for (let i = 0; i < m; i++) ops.push(INS);
    return ops;
  }
  const max = Math.min(n + m, maxCost);
  const size = 2 * max + 2;
  const v = new Int32Array(size);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    // band of k = -d-1 … d+1 (index max-d … max+d+2)
    trace.push(v.slice(max - d, max + d + 3));
    for (let k = -d; k <= d; k += 2) {
      const ki = k + max + 1;
      let x = k === -d || (k !== d && v[ki - 1] < v[ki + 1]) ? v[ki + 1] : v[ki - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[off + x] === b[off + y]) {
        x++;
        y++;
      }
      v[ki] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;
  // backtrack from (n, m)
  const rev: EditOp[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    // band index of diagonal k at step d: k + d + 1
    const vd = trace[d];
    const k = x - y;
    const ki = k + d + 1;
    const down = k === -d || (k !== d && vd[ki - 1] < vd[ki + 1]);
    const pk = down ? k + 1 : k - 1;
    const px = vd[pk + d + 1];
    const py = px - pk;
    while (x > px && y > py) {
      rev.push(EQ);
      x--;
      y--;
    }
    rev.push(down ? INS : DEL);
    if (down) y--;
    else x--;
  }
  while (x > 0 && y > 0) {
    rev.push(EQ);
    x--;
    y--;
  }
  rev.reverse();
  return sortChanges(rev);
}

/** inside each run of changes: all deletions first, then the insertions (the unified-diff convention) */
function sortChanges(ops: EditOp[]): EditOp[] {
  const out: EditOp[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i] === EQ) {
      out.push(EQ);
      i++;
      continue;
    }
    let del = 0;
    let ins = 0;
    while (i < ops.length && ops[i] !== EQ) {
      if (ops[i] === DEL) del++;
      else ins++;
      i++;
    }
    for (let j = 0; j < del; j++) out.push(DEL);
    for (let j = 0; j < ins; j++) out.push(INS);
  }
  return out;
}
