/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUploadQueue, UPLOAD_SLOTS } from './uploadQueue.ts';

const BUSY = new Error('busy');
const ABORTED = new Error('aborted');
const options = { backoffMs: [1, 1], isBusy: (e: unknown) => e === BUSY, aborted: () => ABORTED };
const tick = () => new Promise((r) => setTimeout(r, 5));

/** A fake bridge: holds each job until finish(), refuses (like the real one) above its limit. */
function fakeBridge(limit: number) {
  let inFlight = 0;
  let peak = 0;
  const open: (() => void)[] = [];
  const order: string[] = [];
  return {
    job: (name: string) => async () => {
      order.push(name);
      if (inFlight >= limit) throw BUSY;
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((r) => open.push(r));
      inFlight--;
      return name;
    },
    finishOne: () => open.shift()?.(),
    running: () => open.length,
    peak: () => peak,
    order,
  };
}

test('five files at once: never more than the bridge limit, all arrive, in the picked order', async () => {
  const q = createUploadQueue(options);
  const bridge = fakeBridge(UPLOAD_SLOTS);
  const runs = ['a', 'b', 'c', 'd', 'e'].map((n) => q.run('k', undefined, bridge.job(n)));
  await tick();
  assert.equal(bridge.running(), 2);
  while (bridge.running()) {
    bridge.finishOne();
    await tick();
  }
  assert.deepEqual(await Promise.all(runs), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(bridge.peak(), 2);
  assert.deepEqual(bridge.order, ['a', 'b', 'c', 'd', 'e'], 'no job was refused and repeated');
});

test('credentials queue separately', async () => {
  const q = createUploadQueue(options);
  const bridge = fakeBridge(10);
  const runs = ['a', 'b', 'c'].map((n) => q.run('one', undefined, bridge.job(n))).concat(q.run('two', undefined, bridge.job('x')));
  await tick();
  assert.equal(bridge.running(), 3);
  while (bridge.running()) {
    bridge.finishOne();
    await tick();
  }
  await Promise.all(runs);
});

test('a 429 anyway is retried after a backoff, without holding a slot; then it gives up with that error', async () => {
  const q = createUploadQueue(options);
  let tries = 0;
  assert.equal(await q.run('k', undefined, async () => (++tries < 3 ? Promise.reject(BUSY) : 'ok')), 'ok');
  assert.equal(tries, 3);
  tries = 0;
  await assert.rejects(q.run('k', undefined, async () => (tries++, Promise.reject(BUSY))), BUSY);
  assert.equal(tries, 3, 'first try + 2 backoffs');
  // the slot is free again
  assert.equal(await q.run('k', undefined, async () => 'next'), 'next');
});

test('other errors fail at once and free the slot', async () => {
  const q = createUploadQueue({ ...options, slots: 1 });
  let tries = 0;
  const boom = new Error('401');
  const failing = q.run('k', undefined, async () => (tries++, Promise.reject(boom)));
  const after = q.run('k', undefined, async () => 'after');
  await assert.rejects(failing, boom);
  assert.equal(tries, 1);
  assert.equal(await after, 'after');
});

test('removing a waiting file: it never starts and the others go on', async () => {
  const q = createUploadQueue({ ...options, slots: 1 });
  const bridge = fakeBridge(1);
  const first = q.run('k', undefined, bridge.job('a'));
  const ctrl = new AbortController();
  const removed = q.run('k', ctrl.signal, bridge.job('b'));
  const last = q.run('k', undefined, bridge.job('c'));
  await tick();
  ctrl.abort();
  await assert.rejects(removed, ABORTED);
  bridge.finishOne();
  await tick();
  bridge.finishOne();
  assert.deepEqual(await Promise.all([first, last]), ['a', 'c']);
  assert.deepEqual(bridge.order, ['a', 'c']);
});

test('removing a running file frees its slot even if its request never ends', async () => {
  const q = createUploadQueue({ ...options, slots: 1 });
  const ctrl = new AbortController();
  void q.run('k', ctrl.signal, () => new Promise<string>(() => undefined));
  const next = q.run('k', undefined, async () => 'next');
  await tick();
  ctrl.abort();
  assert.equal(await next, 'next');
});

test('removing a file in its backoff ends it without another try', async () => {
  const q = createUploadQueue({ ...options, backoffMs: [60000] });
  const ctrl = new AbortController();
  let tries = 0;
  const run = q.run('k', ctrl.signal, async () => (tries++, Promise.reject(BUSY)));
  await tick();
  ctrl.abort();
  await assert.rejects(run, ABORTED);
  assert.equal(tries, 1);
});
