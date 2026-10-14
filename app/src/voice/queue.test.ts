/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChunkQueue } from './queue.ts';

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

function harness(count: number, opts: { failLoad?: number; failPlay?: number; loadMs?: number } = {}) {
  const log: string[] = [];
  const released: number[] = [];
  return {
    log,
    released,
    deps: {
      count,
      async load(i: number) {
        log.push(`load${i}`);
        await tick(opts.loadMs ?? 1);
        if (opts.failLoad === i) throw new Error(`load ${i} failed`);
        return `item${i}`;
      },
      async play(item: string, i: number, signal: AbortSignal) {
        log.push(`play${i}`);
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 5);
          signal.addEventListener('abort', () => {
            clearTimeout(t);
            resolve();
          });
        });
        if (opts.failPlay === i) throw new Error(`play ${i} failed`);
        assert.equal(item, `item${i}`);
      },
      release(_item: string, i: number) {
        released.push(i);
      },
    },
  };
}

test('plays all chunks in order with one-ahead prefetch and releases each once', async () => {
  const h = harness(3);
  assert.equal(await runChunkQueue(h.deps), 'done');
  assert.deepEqual(h.log, ['load0', 'load1', 'play0', 'load2', 'play1', 'play2']);
  assert.deepEqual(h.released.sort(), [0, 1, 2]);
});

test('abort stops playback and releases prefetched items', async () => {
  const h = harness(5);
  const ctrl = new AbortController();
  const p = runChunkQueue(h.deps, ctrl.signal);
  await tick(9);
  ctrl.abort();
  assert.equal(await p, 'aborted');
  await tick(10); // late loads settle → released
  assert.ok(!h.log.includes('play4'));
  const loaded = h.log.filter((l) => l.startsWith('load')).length;
  assert.equal(new Set(h.released).size, h.released.length, 'no double release');
  assert.equal(h.released.length, loaded);
});

test('load error is thrown after cleanup', async () => {
  const h = harness(3, { failLoad: 1 });
  await assert.rejects(runChunkQueue(h.deps), /load 1 failed/);
  await tick(10);
  assert.ok(h.log.includes('play0'));
  assert.ok(!h.log.includes('play1'));
  assert.ok(h.released.includes(0));
});

test('play error is thrown, everything released', async () => {
  const h = harness(3, { failPlay: 0 });
  await assert.rejects(runChunkQueue(h.deps), /play 0 failed/);
  await tick(10);
  assert.deepEqual(h.released.sort(), [0, 1]);
});

test('startAt resumes mid-way; already aborted signal does nothing', async () => {
  const h = harness(3);
  assert.equal(await runChunkQueue({ ...h.deps, startAt: 2 }), 'done');
  assert.deepEqual(h.log, ['load2', 'play2']);
  const ctrl = new AbortController();
  ctrl.abort();
  const h2 = harness(2);
  assert.equal(await runChunkQueue(h2.deps, ctrl.signal), 'aborted');
  assert.deepEqual(h2.log, []);
});

test('onWaiting fires when the next chunk is not loaded yet', async () => {
  const h = harness(2, { loadMs: 20 });
  const waiting: number[] = [];
  const started: number[] = [];
  await runChunkQueue({ ...h.deps, onWaiting: (i) => waiting.push(i), onChunkStart: (i) => started.push(i) });
  // chunk 1 was prefetched while chunk 0 loaded/played → no second wait
  assert.deepEqual(waiting, [0]);
  assert.deepEqual(started, [0, 1]);
  const h2 = harness(2, { loadMs: 20 });
  const waiting2: number[] = [];
  await runChunkQueue({ ...h2.deps, prefetch: 0, onWaiting: (i) => waiting2.push(i) });
  assert.deepEqual(waiting2, [0, 1]);
});

test('growing feed: plays chunks as they arrive, prefetches a chunk added while another plays, ends when the feed ends', async () => {
  // no wall-clock waits: the test steps the feed when the queue is observably parked in waitMore (load-proof)
  const chunks = ['a'];
  let ended = false;
  let wake: (() => void) | null = null;
  let grow: (() => void) | null = null;
  let onPark: (() => void) | null = null;
  const nextPark = () => new Promise<void>((r) => (onPark = r));
  const log: string[] = [];
  const push = (c: string) => {
    chunks.push(c);
    grow?.();
    const w = wake;
    wake = null;
    w?.();
  };
  let parked = nextPark();
  const done = runChunkQueue<string>({
    count: () => chunks.length,
    prefetch: 1,
    waitMore: () => {
      if (ended) return Promise.resolve(false);
      return new Promise<boolean>((r) => {
        wake = () => r(true);
        const p = onPark;
        onPark = null;
        p?.();
      });
    },
    watch: (cb) => {
      grow = cb;
      return () => (grow = null);
    },
    load: async (i) => {
      log.push(`load ${i}`);
      return chunks[i];
    },
    onWaiting: (i) => log.push(`wait ${i}`),
    play: async (item) => {
      log.push(`play ${item}`);
      if (item === 'a') push('b'); // arrives while "a" plays → loaded before "a" ends
      await new Promise((r) => setTimeout(r, 1));
    },
  });
  await parked; // everything known (a, b) was played, the queue waits for chunk 2
  assert.deepEqual(log.filter((l) => l.startsWith('play')), ['play a', 'play b']);
  assert.equal(log.at(-1), 'wait 2');
  parked = nextPark();
  push('c'); // arrives after everything known was played
  await parked; // c was played, the queue waits for chunk 3
  assert.equal(log.at(-1), 'wait 3');
  ended = true;
  const w = wake as (() => void) | null;
  wake = null;
  // the queue is parked in waitMore: ending the feed resolves it with "changed", the next waitMore says "no more"
  w?.();
  assert.equal(await done, 'done');
  assert.deepEqual(log.filter((l) => l.startsWith('play')), ['play a', 'play b', 'play c']);
  assert.ok(log.indexOf('load 1') < log.indexOf('play b'));
  assert.ok(log.indexOf('load 1') < log.indexOf('wait 2'), log.join());
  assert.ok(log.indexOf('wait 2') < log.indexOf('load 2'), log.join());
});
