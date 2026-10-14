/// <reference types="node" />
// Time-bounded execution for adversarial regression tests: the call runs in a worker thread that is
// terminated after `ms`, so a regression back to an infinite loop / catastrophic regex fails the test
// instead of hanging the whole suite. (A synchronous hang cannot be interrupted in-process.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

const WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
import(workerData.mod).then((m) => {
  const t0 = performance.now();
  const value = m[workerData.fn](...workerData.args);
  parentPort.postMessage({ ok: true, value, ms: performance.now() - t0 });
}, (e) => parentPort.postMessage({ ok: false, error: String(e && e.stack || e) }))
  .catch((e) => parentPort.postMessage({ ok: false, error: String(e && e.stack || e) }));
`;

export type Bounded<T> = { status: 'ok'; value: T; ms: number } | { status: 'timeout' } | { status: 'error'; error: string };

/**
 * Import `mod` (a file URL, e.g. `new URL('./x.ts', import.meta.url).href`) in a worker and call the export
 * `fn(...args)`. `ms` bounds module load + the call; the generous default absorbs a loaded CI host while still
 * catching hangs (the pre-fix inputs never finish). Arguments/results must be structured-cloneable.
 */
export function runBounded<T = unknown>(mod: string, fn: string, args: unknown[], ms = 8000): Promise<Bounded<T>> {
  return new Promise((resolve) => {
    const w = new Worker(WORKER, { eval: true, workerData: { mod, fn, args }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    let done = false;
    const finish = (r: Bounded<T>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void w.terminate();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ status: 'timeout' }), ms);
    w.on('message', (m: { ok: boolean; value?: T; ms?: number; error?: string }) =>
      finish(m.ok ? { status: 'ok', value: m.value as T, ms: m.ms ?? 0 } : { status: 'error', error: m.error ?? '?' }),
    );
    w.on('error', (e) => finish({ status: 'error', error: String(e) }));
    w.on('exit', () => finish({ status: 'error', error: 'worker exited' }));
  });
}

/** Assert the call finished in time and return its value. */
export async function expectBounded<T = unknown>(mod: string, fn: string, args: unknown[], ms?: number): Promise<T> {
  const r = await runBounded<T>(mod, fn, args, ms);
  if (r.status === 'timeout') assert.fail(`${fn} did not finish within ${ms ?? 8000} ms (hang / catastrophic backtracking)`);
  if (r.status === 'error') assert.fail(`${fn} threw: ${r.error}`);
  return r.value;
}

test('runBounded: returns values and terminates a synchronous hang', async () => {
  const mod = 'data:text/javascript,' + encodeURIComponent('export const echo = (...a) => a; export function spin() { for (;;) {} }');
  const ok = await runBounded<unknown[]>(mod, 'echo', [1, 'a']);
  assert.equal(ok.status, 'ok');
  if (ok.status === 'ok') assert.deepEqual(ok.value, [1, 'a']);
  assert.deepEqual(await runBounded(mod, 'spin', [], 1500), { status: 'timeout' });
});
