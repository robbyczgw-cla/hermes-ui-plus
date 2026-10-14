// Tiny benchmark helpers for scripts/bench/*.bench.mjs (not part of CI / `npm test`).
//
// Timings are Node (V8) or Hermes-CLI measurements, not device frame times: relative costs and growth
// (O(n) vs O(n²) per step) carry over, absolute numbers do not. `scripts/bench/run.sh --hermes` bundles a bench
// and runs it on a Hermes VM (no JIT, like the app); `--jitless` runs Node without JIT.
// Allocation numbers (Node only) need `--expose-gc --min-semi-space-size=512 --max-semi-space-size=512`
// (run.sh): with a young generation that large no scavenge runs during a measurement, so the heap delta is what
// the workload allocated; when a GC still happened the number is reported as "gc".
// No imports: the file is also bundled for the Hermes CLI (globals only: performance / Date, print).

/* global print */
if (typeof console === 'undefined' && typeof print === 'function') globalThis.console = { log: print };

const isNode = typeof process !== 'undefined' && !!process.versions?.node;
export const engine = isNode ? (process.execArgv.includes('--jitless') ? 'node --jitless' : 'node') : 'hermes';
export const jitless = engine !== 'node';
const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

let gcCount = 0;
if (typeof PerformanceObserver !== 'undefined') {
  new PerformanceObserver((list) => {
    gcCount += list.getEntries().length;
  }).observe({ entryTypes: ['gc'] });
}
const canGc = isNode && typeof globalThis.gc === 'function';

/** Hermes CLI has only Date.now (1 ms): every timed sample repeats `fn` until it took at least this long */
const MIN_SAMPLE_MS = engine === 'hermes' ? 30 : 2;

/** median over `runs` samples of the time per call of `fn` (after one warm-up), ms */
export function medianMs(fn, runs = jitless ? 3 : 7) {
  fn();
  // calls per sample so that one sample lasts >= MIN_SAMPLE_MS
  let reps = 1;
  for (;;) {
    const t0 = now();
    for (let i = 0; i < reps; i++) fn();
    if (now() - t0 >= MIN_SAMPLE_MS || reps >= 1 << 16) break;
    reps *= 2;
  }
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = now();
    for (let k = 0; k < reps; k++) fn();
    times.push((now() - t0) / reps);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

/** bytes allocated by one call of `fn` (null without --expose-gc or when a GC ran meanwhile) */
export function allocBytes(fn) {
  if (!canGc) return null;
  fn(); // warm-up (lazy compilation, caches)
  globalThis.gc();
  const before = gcCount;
  const a = process.memoryUsage().heapUsed;
  fn();
  const b = process.memoryUsage().heapUsed;
  // gc entries are delivered asynchronously; a scavenge also shows up as a shrinking heap
  if (gcCount !== before || b < a) return null;
  return b - a;
}

/**
 * Per-step timing of a stateful sequence: `setup()` returns a fresh step function, `steps` is the input list.
 * Returns total / mean / p95 / max per step (µs) and allocations per step (bytes, or null).
 */
export function perStep(setup, steps) {
  const runAll = () => {
    const step = setup();
    for (const s of steps) step(s);
  };
  const totalMs = medianMs(runAll);
  // one extra run with per-step clocks for the distribution (not with a 1 ms clock)
  const each = [];
  if (engine !== 'hermes') {
    const step = setup();
    for (const s of steps) {
      const t0 = now();
      step(s);
      each.push(now() - t0);
    }
    each.sort((a, b) => a - b);
  }
  const alloc = allocBytes(runAll);
  return {
    steps: steps.length,
    totalMs,
    meanUs: (totalMs / steps.length) * 1000,
    p95Us: each.length ? each[Math.floor(each.length * 0.95)] * 1000 : null,
    maxUs: each.length ? each[each.length - 1] * 1000 : null,
    allocPerStep: alloc === null ? null : alloc / steps.length,
  };
}

// `-`: not measured (Hermes: no fine clock, no heap numbers) · `gc`: a GC ran during the allocation measurement
const missing = isNode && canGc ? 'gc' : '-';
const fmt = (n, d = 1) => (n === null || n === undefined ? '-' : n >= 100 ? n.toFixed(0) : n.toFixed(d));
const kb = (b) => (b === null ? missing : b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + ' MB' : (b / 1024).toFixed(1) + ' KB');

/** one result line: name, steps, total, mean/p95/max per step, alloc per step */
export function report(name, r) {
  console.log(
    `${name.padEnd(58)} ${String(r.steps).padStart(5)} steps  total ${fmt(r.totalMs).padStart(7)} ms  ` +
      `mean ${fmt(r.meanUs).padStart(7)} µs  p95 ${fmt(r.p95Us).padStart(7)} µs  max ${fmt(r.maxUs).padStart(7)} µs  ` +
      `alloc/step ${kb(r.allocPerStep).padStart(9)}`,
  );
}

/** plain one-shot line: name + median ms (+ allocation) */
export function reportOnce(name, fn) {
  const ms = medianMs(fn);
  const alloc = allocBytes(fn);
  console.log(`${name.padEnd(58)} ${fmt(ms, 2).padStart(8)} ms  alloc ${kb(alloc).padStart(9)}`);
  return ms;
}

/**
 * Growth check: mean step cost at size n and 4n. ~1× = O(1) per step (linear total), ~4× = O(n) per step
 * (quadratic total).
 */
export function growth(name, small, large) {
  const ratio = large.meanUs / small.meanUs;
  const verdict = ratio > 2.5 ? 'O(n) per step → O(n²) total' : ratio > 1.6 ? 'sub-linear growth' : 'flat';
  console.log(`  growth ${name}: ×${ratio.toFixed(2)} per step for 4× length (${verdict})`);
}

/** `text` cut into streaming deltas of `size` chars */
export function chunks(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** prefixes of `text` after every `every` chars (the texts a throttled UI sees) */
export function prefixes(text, every) {
  const out = [];
  for (let i = every; i < text.length; i += every) out.push(text.slice(0, i));
  out.push(text);
  return out;
}

export function header(title) {
  console.log(`\n## ${title} [${engine}]`);
}
