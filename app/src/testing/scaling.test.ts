/// <reference types="node" />
// Load-robust linearity check: instead of an absolute wall-clock budget (flaky on a busy host), compare the
// best-of-N time at size n and 4n. Linear work scales ~4×, quadratic ~16×; a shared slowdown of the host
// affects both sizes alike and cancels out of the ratio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

function best(run: () => void, reps: number): number {
  let b = Infinity;
  for (let r = 0; r < reps; r++) {
    const t0 = performance.now();
    run();
    b = Math.min(b, performance.now() - t0);
  }
  return b;
}

/**
 * Asserts `work(build(4n))` costs < `maxRatio` × `work(build(n))` (default 8: between linear 4 and
 * quadratic 16). Runs that finish under `floorMs` at 4n are too fast to be quadratic and always pass.
 */
export function assertLinear(label: string, build: (n: number) => string, work: (s: string) => void, n = 25_000, opts: { maxRatio?: number; reps?: number; floorMs?: number } = {}): void {
  const { maxRatio = 8, reps = 5, floorMs = 4 } = opts;
  const small = build(n);
  const large = build(n * 4);
  work(small); // warm up the JIT
  let ratio = Infinity;
  let tl = 0;
  // re-measure a few times before failing: one unlucky GC pause on the large input must not fail the suite
  for (let attempt = 0; attempt < 5 && ratio >= maxRatio; attempt++) {
    const ts = Math.max(best(() => work(small), reps), 0.05);
    tl = best(() => work(large), reps);
    if (tl < floorMs) return;
    ratio = tl / ts;
  }
  assert.ok(ratio < maxRatio, `${label}: ×${ratio.toFixed(1)} time for ×4 input (${tl.toFixed(1)} ms) – superlinear`);
}

// the self-test (~5 s of busy CPU) runs only for this file itself, not again in every test file that imports
// assertLinear (node --test runs each file as its own process with the file as argv[1])
const isEntry = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntry) test('assertLinear: accepts linear work, rejects quadratic work', () => {
  const build = (n: number) => 'a'.repeat(n);
  assertLinear('linear', build, (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    if (h === 42) console.log(h);
  }, 200_000);
  assert.throws(() =>
    assertLinear('quadratic', build, (s) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) for (let j = i; j < s.length; j += 1) h = (h + s.charCodeAt(j)) | 0;
      if (h === 42) console.log(h);
    }, 3000), // large enough that the quadratic run is far above floorMs even on a busy machine
  );
});
