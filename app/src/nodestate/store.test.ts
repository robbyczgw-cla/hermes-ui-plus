import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storageKey } from './model.ts';
import { NodeStateStore, type KeyValueStorage } from './store.ts';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const log: string[] = [];
  let getDelay: Promise<void> | null = null;
  const storage: KeyValueStorage = {
    async getItem(k) {
      if (getDelay) await getDelay;
      return data.get(k) ?? null;
    },
    async setItem(k, v) {
      log.push(`set ${k}`);
      data.set(k, v);
    },
    async removeItem(k) {
      log.push(`remove ${k}`);
      data.delete(k);
    },
    async getAllKeys() {
      return [...data.keys()];
    },
  };
  return {
    storage,
    data,
    log,
    holdReads(): () => void {
      let release!: () => void;
      getDelay = new Promise<void>((r) => (release = r));
      return () => {
        getDelay = null;
        release();
      };
    },
  };
}

/** manual timer so debounce is deterministic */
function fakeTimers() {
  const pending = new Map<number, () => void>();
  let n = 0;
  return {
    setTimer: (fn: () => void) => {
      pending.set(++n, fn);
      return n;
    },
    clearTimer: (h: unknown) => void pending.delete(h as number),
    fire: () => {
      const fns = [...pending.values()];
      pending.clear();
      fns.forEach((f) => f());
    },
    count: () => pending.size,
  };
}

const tick = () => new Promise<void>((r) => setImmediate(r));

function make(initial: Record<string, string> = {}) {
  const fs = fakeStorage(initial);
  const tm = fakeTimers();
  let t = 1000;
  const store = new NodeStateStore({ storage: fs.storage, setTimer: tm.setTimer, clearTimer: tm.clearTimer, now: () => ++t, onReject: () => {} });
  return { fs, tm, store };
}

test('set is visible immediately; writes are debounced and coalesced', async () => {
  const { fs, tm, store } = make();
  await store.load('c1');
  store.set('c1', 'm:a', { n: 1 });
  store.set('c1', 'm:a', { n: 2 });
  store.set('c1', 'm:b', 'x');
  assert.deepEqual(store.peek('c1', 'm:a')?.data, { n: 2 });
  assert.equal(fs.log.length, 0);
  assert.equal(tm.count(), 1);
  tm.fire();
  await store.flush();
  assert.deepEqual(fs.log, [`set ${storageKey('c1')}`]);
  const saved = JSON.parse(fs.data.get(storageKey('c1'))!);
  assert.deepEqual(Object.keys(saved.nodes).sort(), ['m:a', 'm:b']);
});

test('flush writes immediately and cancels the timer', async () => {
  const { fs, tm, store } = make();
  await store.load('c1');
  store.set('c1', 'm:a', 1);
  await store.flush();
  assert.equal(tm.count(), 0);
  assert.equal(fs.log.length, 1);
  await store.flush();
  assert.equal(fs.log.length, 1, 'nothing dirty, nothing written');
});

test('state survives a new store instance (restart)', async () => {
  const a = make();
  await a.store.load('c1');
  a.store.set('c1', 'm:a', { checked: [1, 2] }, 3);
  await a.store.flush();
  const b = make(Object.fromEntries(a.fs.data));
  assert.equal(b.store.peek('c1', 'm:a'), undefined, 'not loaded yet');
  await b.store.load('c1');
  assert.deepEqual(b.store.peek('c1', 'm:a')?.data, { checked: [1, 2] });
  assert.equal(b.store.peek('c1', 'm:a')?.v, 3);
});

test('writes made while the initial load is pending are merged, not lost, and not clobbered', async () => {
  const { fs, store } = make({
    [storageKey('c1')]: JSON.stringify({ f: 1, nodes: { 'm:a': { v: 1, data: 'disk', updatedAt: 1 }, 'm:keep': { v: 1, data: 'k', updatedAt: 1 } } }),
  });
  const release = fs.holdReads();
  const loading = store.load('c1');
  store.set('c1', 'm:a', 'local');
  assert.equal(store.peek('c1', 'm:a')?.data, 'local');
  release();
  await loading;
  await store.flush();
  assert.equal(store.peek('c1', 'm:a')?.data, 'local');
  assert.equal(store.peek('c1', 'm:keep')?.data, 'k');
  const saved = JSON.parse(fs.data.get(storageKey('c1'))!);
  assert.equal(saved.nodes['m:a'].data, 'local');
  assert.equal(saved.nodes['m:keep'].data, 'k');
});

test('never writes before the load finished', async () => {
  const { fs, store } = make();
  const release = fs.holdReads();
  store.set('c1', 'm:a', 1);
  const flushing = store.flush(); // waits for the load
  await tick();
  assert.equal(fs.log.length, 0);
  release();
  await flushing;
  await store.flush();
  assert.equal(fs.log.length, 1);
});

test('subscribers are notified on set, remove and eviction', async () => {
  const { store } = make();
  await store.load('c1');
  let a = 0;
  let b = 0;
  const offA = store.subscribe('c1', 'm:a', () => a++);
  store.subscribe('c1', 'm:b', () => b++);
  store.set('c1', 'm:a', 1);
  assert.deepEqual([a, b], [1, 0]);
  store.remove('c1', 'm:a');
  assert.equal(a, 2);
  offA();
  store.set('c1', 'm:a', 2);
  assert.equal(a, 2);
});

test('refused (too large) writes keep the old value and report', async () => {
  const fs = fakeStorage();
  const rejects: string[] = [];
  const store = new NodeStateStore({ storage: fs.storage, onReject: (i) => rejects.push(i.reason) });
  await store.load('c1');
  assert.equal(store.set('c1', 'm:a', 'ok'), true);
  assert.equal(store.set('c1', 'm:a', 'x'.repeat(40 * 1024)), false);
  assert.equal(store.peek('c1', 'm:a')?.data, 'ok');
  assert.deepEqual(rejects, ['too_large']);
  await store.flush();
});

test('per-conversation cap evicts oldest nodes from cache and storage', async () => {
  const { fs, store } = make();
  await store.load('c1');
  const chunk = 'z'.repeat(30 * 1024);
  for (let i = 0; i < 20; i++) store.set('c1', `m:n${i}`, chunk);
  assert.equal(store.peek('c1', 'm:n0'), undefined);
  assert.ok(store.peek('c1', 'm:n19'));
  await store.flush();
  const raw = fs.data.get(storageKey('c1'))!;
  assert.ok(raw.length <= 512 * 1024 + 2048);
});

test('removeMessage and deleteConversation', async () => {
  const { fs, store } = make();
  await store.load('c1');
  store.set('c1', 'm1:a', 1);
  store.set('c1', 'm1:b', 1);
  store.set('c1', 'm2:a', 1);
  store.removeMessage('c1', 'm1');
  assert.equal(store.peek('c1', 'm1:a'), undefined);
  assert.ok(store.peek('c1', 'm2:a'));
  await store.flush();
  assert.ok(fs.data.has(storageKey('c1')));
  let notified = 0;
  store.subscribe('c1', 'm2:a', () => notified++);
  await store.deleteConversation('c1');
  assert.ok(!fs.data.has(storageKey('c1')));
  assert.equal(store.peek('c1', 'm2:a'), undefined);
  assert.equal(notified, 1);
});

test('empty record removes the storage key', async () => {
  const { fs, store } = make();
  await store.load('c1');
  store.set('c1', 'm:a', 1);
  await store.flush();
  store.remove('c1', 'm:a');
  await store.flush();
  assert.ok(!fs.data.has(storageKey('c1')));
});

test('exportConversation / exportAll', async () => {
  const { store } = make();
  await store.load('c1');
  store.set('c1', 'm:a', { q: 1 });
  store.set('c2', 'm:b', 2);
  const one = await store.exportConversation('c1');
  assert.equal(one.conversationId, 'c1');
  assert.deepEqual(one.nodes['m:a'].data, { q: 1 });
  const all = await store.exportAll();
  assert.deepEqual(Object.keys(all.conversations).sort(), ['c1', 'c2']);
});

test('a failing storage write is retried on the next flush', async () => {
  const fs = fakeStorage();
  let fail = true;
  const orig = fs.storage.setItem;
  fs.storage.setItem = async (k, v) => {
    if (fail) throw new Error('disk');
    return orig(k, v);
  };
  const store = new NodeStateStore({ storage: fs.storage, onReject: () => {} });
  await store.load('c1');
  store.set('c1', 'm:a', 1);
  await store.flush();
  assert.equal(fs.data.size, 0);
  fail = false;
  await store.flush();
  assert.equal(fs.data.size, 1);
});

test('a failed write is reported (storage-full notice) and retried on the next flush', async () => {
  let fail = true;
  const data = new Map<string, string>();
  const errors: string[] = [];
  const store = new NodeStateStore({
    storage: {
      getItem: async (k) => data.get(k) ?? null,
      setItem: async (k, v) => {
        if (fail) throw new Error('QuotaExceededError');
        data.set(k, v);
      },
      removeItem: async (k) => void data.delete(k),
    },
    debounceMs: 1,
    onWriteError: (_e, id) => errors.push(id),
  });
  await store.load('c');
  store.set('c', 'm:n', { v: 1 });
  await store.flush();
  assert.deepEqual(errors, ['c']);
  assert.equal(data.size, 0);
  fail = false;
  await store.flush();
  assert.equal(data.size, 1);
});
