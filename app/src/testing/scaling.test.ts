/// <reference types="node" />
// Load-robust linearity check: no absolute time budget (flaky on a busy host); the cost of the same work at size n
// and 16n is compared instead. Linear work scales ~16×, quadratic ~256×; the limit (64) is 4× from both, so cache
// effects on a busy host (measured up to ~2× more per char for the large input) pass, and a quadratic term that is
// only a fifth of the cost at n still fails.
//  - cost = CPU time of this thread (process.threadCpuUsage), not wall time: time spent waiting for a core (a loaded
//    host, a CPU-quota'd cgroup, other test files running in parallel) is not counted. That clock ticks in 1 ms
//    steps, so a call is repeated until a few ms were spent and the cost per call is taken.
//  - minimum of several interleaved runs per size (a GC pause, a cold cache or an interrupt only ever adds), each after
//    a full GC (when it can be exposed) and one untimed call; re-measured before failing.
// Why not an operation counter: the regressions these tests guard against happen inside builtins (regex
// backtracking, slice / concat / indexOf from the start in a loop), which a counter in the JS code would not see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import vm from 'node:vm';

const threadCpu = (process as { threadCpuUsage?: () => { user: number; system: number } }).threadCpuUsage;
/** ms of CPU time of this thread; wall clock where the runtime cannot tell (then the minimum still filters spikes) */
const cpuMs: () => number = threadCpu
  ? () => {
      const u = threadCpu.call(process);
      return (u.user + u.system) / 1000;
    }
  : () => performance.now();

const gc: () => void = (() => {
  try {
    v8.setFlagsFromString('--expose_gc');
    const f = vm.runInNewContext('gc') as unknown;
    if (typeof f === 'function') return f as () => void;
  } catch {
    /* not available */
  }
  return () => {};
})();

/** CPU ms per call of `run`, repeated until at least `budgetMs` were spent */
function perCall(run: () => void, budgetMs: number): number {
  gc();
  run(); // untimed: the first call after a full GC pays for regrowing the young generation
  let n = 0;
  let spent = 0;
  const t0 = cpuMs();
  do {
    run();
    n++;
    spent = cpuMs() - t0;
  } while (spent < budgetMs);
  return spent / n;
}

export type LinearOpts = {
  /** large input = `factor` × n (default 16) */
  factor?: number;
  /** fail when the large input costs ≥ maxRatio × the small one (default 4 × factor) */
  maxRatio?: number;
  /** interleaved runs per size; the minimum counts (default 5) */
  reps?: number;
  /** a large input under this many CPU ms per call is too cheap to be quadratic: passes (default 4) */
  floorMs?: number;
  /** CPU ms spent per run, repeating the call (default 8; the clock ticks in 1 ms steps) */
  budgetMs?: number;
};

/** The measured cost ratio `work(build(factor·n))` / `work(build(n))` (minimum per size), or null under the floor. */
export function linearRatio(build: (n: number) => string, work: (s: string) => void, n: number, opts: LinearOpts = {}): { ratio: number; small: number; large: number } | null {
  const { factor = 16, reps = 5, floorMs = 4, budgetMs = 8 } = opts;
  const small = build(n);
  const large = build(n * factor);
  work(small); // warm up the JIT
  work(large);
  let ts = Infinity;
  let tl = Infinity;
  for (let r = 0; r < reps; r++) {
    ts = Math.min(ts, perCall(() => work(small), budgetMs));
    tl = Math.min(tl, perCall(() => work(large), budgetMs));
  }
  if (tl < floorMs) return null;
  return { ratio: tl / Math.max(ts, 0.001), small: ts, large: tl };
}

/**
 * Asserts `work(build(16n))` costs < 64 × `work(build(n))` in CPU time (see the top of this file). Re-measured up to
 * 3 times before failing.
 */
export function assertLinear(label: string, build: (n: number) => string, work: (s: string) => void, n = 12_500, opts: LinearOpts = {}): void {
  const { factor = 16, maxRatio = 4 * factor } = opts;
  let last: { ratio: number; small: number; large: number } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    last = linearRatio(build, work, n, opts);
    if (!last || last.ratio < maxRatio) return;
  }
  assert.fail(`${label}: ×${last!.ratio.toFixed(1)} CPU time for ×${factor} input (${last!.small.toFixed(2)} → ${last!.large.toFixed(1)} ms per call) – superlinear`);
}

// the self-test runs only for this file itself, not again in every test file that imports assertLinear
// (node --test runs each file as its own process with the file as argv[1])
const isEntry = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  if (h === 42) console.log(h);
};

if (isEntry) test('assertLinear: accepts linear work, rejects quadratic work (also a quadratic term next to linear work)', () => {
  const build = (n: number) => 'a'.repeat(n);
  assertLinear('linear', build, hash, 500_000); // 8 M chars at 16n: above the floor, so the ratio is really measured
  // pure quadratic
  assert.throws(() =>
    assertLinear('quadratic', build, (s) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) for (let j = i; j < s.length; j++) h = (h + s.charCodeAt(j)) | 0;
      if (h === 42) console.log(h);
    }, 800),
  /superlinear/);
  // the typical regression: a builtin that rescans from the start for every match (here ~40 % of the cost at n)
  assert.throws(() =>
    assertLinear('rescan', (n) => 'ab '.repeat(n / 3), (s) => {
      hash(s);
      hash(s);
      for (let i = 0; i < s.length; i += 300) if (s.slice(0, i).lastIndexOf('x') !== -1) console.log(i);
    }, 15_000),
  /superlinear/);
});

if (isEntry) test('CPU time, not wall time: waiting for a core does not count', () => {
  if (!threadCpu) return; // runtime without thread CPU time: nothing to show
  const t0 = cpuMs();
  const w0 = performance.now();
  const until = w0 + 30;
  while (performance.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); // sleeps, no CPU
  assert.ok(cpuMs() - t0 < 15, `a 30 ms sleep counted ${(cpuMs() - t0).toFixed(0)} ms of CPU time`);
});
