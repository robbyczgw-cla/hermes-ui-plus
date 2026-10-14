/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFileStorage, fileNameOf, keyOfFileName, memoryFs } from './fileKv.ts';
import { createStorageHealth, isQuotaError } from './health.ts';
import { createIdbStorage, openIdb } from './idbKv.ts';
import { createMigratingStorage, deferredStorage, memoryStorage, type KeyValueStorage } from './kv.ts';

const P = 'hui.conv.msgs.';

test('file storage: one file per key, atomic replace via temp file, keys round-trip', async () => {
  const fs = memoryFs();
  const s = createFileStorage(fs);
  await s.setItem(P + 'c-1', '{"v":1}');
  await s.setItem(P + 'r-a/b c', '{"v":2}');
  assert.deepEqual([...fs.files.keys()].sort(), [fileNameOf(P + 'c-1'), fileNameOf(P + 'r-a/b c')].sort());
  assert.equal(keyOfFileName(fileNameOf(P + 'r-a/b c')), P + 'r-a/b c');
  assert.equal(await s.getItem(P + 'c-1'), '{"v":1}');
  assert.equal(await s.getItem(P + 'missing'), null);
  assert.deepEqual([...(await s.getAllKeys!())].sort(), [P + 'c-1', P + 'r-a/b c'].sort());
  await s.removeItem(P + 'c-1');
  assert.equal(await s.getItem(P + 'c-1'), null);
});

test('file storage: a failed write keeps the old value and leaves no temp file behind', async () => {
  let full = false;
  const fs = memoryFs({ failWrite: () => full });
  const s = createFileStorage(fs);
  await s.setItem(P + 'x', '{"old":true}');
  full = true;
  await assert.rejects(s.setItem(P + 'x', '{"new":true}'), /ENOSPC/);
  assert.equal(await s.getItem(P + 'x'), '{"old":true}');
  assert.deepEqual([...fs.files.keys()], [fileNameOf(P + 'x')]);
});

test('file storage: interrupted replace (main gone, complete temp) is recovered; a torn temp is ignored', async () => {
  const fs = memoryFs();
  const s = createFileStorage(fs);
  fs.files.set(fileNameOf(P + 'a') + '.tmp', '{"messages":[]}');
  assert.equal(await s.getItem(P + 'a'), '{"messages":[]}');
  assert.equal(fs.files.has(fileNameOf(P + 'a')), true); // moved into place
  fs.files.set(fileNameOf(P + 'b') + '.tmp', '{"messa');
  assert.equal(await s.getItem(P + 'b'), null);
});

test('migrating storage: lazy per-key move on read, writes drop the stale legacy copy', async () => {
  const primary = memoryStorage();
  const legacy = memoryStorage({ [P + 'a']: 'A', [P + 'b']: 'B', 'hui.prefs': 'keep' });
  const s = createMigratingStorage(primary, legacy, P);
  assert.equal(await s.getItem(P + 'a'), 'A');
  assert.equal(primary.data.get(P + 'a'), 'A');
  assert.equal(legacy.data.has(P + 'a'), false);
  await s.setItem(P + 'b', 'B2');
  assert.equal(legacy.data.has(P + 'b'), false, 'stale legacy copy removed (frees AsyncStorage space)');
  assert.equal(await s.getItem(P + 'b'), 'B2');
  assert.equal(legacy.data.get('hui.prefs'), 'keep', 'other keys untouched');
  await s.removeItem(P + 'b');
  assert.equal(await s.getItem(P + 'b'), null);
});

test('migrating storage: migrate() is safe (legacy removed only after the copy) and resumable', async () => {
  const primary = memoryStorage();
  let failFor: string | null = P + 'b';
  const flaky: KeyValueStorage = {
    ...primary,
    setItem: async (k, v) => {
      if (k === failFor) throw new Error('QuotaExceededError');
      primary.data.set(k, v);
    },
  };
  const legacy = memoryStorage({ [P + 'a']: 'A', [P + 'b']: 'B', [P + 'c']: 'C', other: 'x' });
  primary.data.set(P + 'c', 'C-newer'); // crash after copy, before the legacy delete: primary wins
  const s = createMigratingStorage(flaky, legacy, P);
  const r1 = await s.migrate();
  assert.deepEqual(r1, { moved: 2, failed: 1 });
  assert.equal(legacy.data.get(P + 'b'), 'B', 'failed key stays readable in legacy');
  assert.equal(await s.getItem(P + 'b'), 'B');
  assert.equal(primary.data.get(P + 'c'), 'C-newer');
  failFor = null;
  const r2 = await s.migrate();
  assert.deepEqual(r2, { moved: 1, failed: 0 });
  assert.deepEqual([...legacy.data.keys()], ['other']);
  assert.deepEqual([...primary.data.keys()].sort(), [P + 'a', P + 'b', P + 'c']);
});

test('migrating storage: getAllKeys covers both stores (orphan sweep sees legacy keys)', async () => {
  const primary = memoryStorage({ [P + 'a']: 'A' });
  const legacy = memoryStorage({ [P + 'b']: 'B', 'hui.conv.index': '{}' });
  const s = createMigratingStorage(primary, legacy, P);
  assert.deepEqual([...(await s.getAllKeys!())].sort(), [P + 'a', P + 'b']);
});

test('deferred storage waits for the backend', async () => {
  let resolve!: (s: KeyValueStorage) => void;
  const s = deferredStorage(new Promise((r) => (resolve = r)));
  const pending = s.setItem('k', 'v');
  const mem = memoryStorage();
  resolve(mem);
  await pending;
  assert.equal(await s.getItem('k'), 'v');
});

test('quota detection and one-shot health notice', () => {
  assert.equal(isQuotaError(new Error('database or disk is full (code 13 SQLITE_FULL)')), true);
  assert.equal(isQuotaError({ name: 'QuotaExceededError', message: '' }), true);
  assert.equal(isQuotaError(new Error('ENOSPC: no space left on device')), true);
  assert.equal(isQuotaError(new Error('network down')), false);
  const h = createStorageHealth(() => 1);
  let n = 0;
  h.subscribe(() => n++);
  h.reportError(new Error('timeout'), 'x');
  assert.equal(h.get(), null);
  h.reportError(new Error('SQLITE_FULL'), 'conversations.saveMessages');
  h.reportError(new Error('SQLITE_FULL'), 'conversations.saveMessages');
  assert.equal(h.get()?.kind, 'full');
  assert.equal(n, 1);
  h.reportOk();
  assert.equal(h.get(), null);
  assert.equal(n, 2);
});

// ---- minimal IndexedDB fake (async callbacks like the real thing)
function fakeIndexedDB(opts: { quotaBytes?: number } = {}) {
  const stores = new Map<string, Map<string, unknown>>();
  const later = (fn: () => void) => setTimeout(fn, 0);
  const request = <T>(fn: () => T) => {
    const r: { result?: T; error?: unknown; onsuccess?: () => void; onerror?: () => void } = {};
    later(() => {
      try {
        r.result = fn();
        r.onsuccess?.();
      } catch (e) {
        r.error = e;
        r.onerror?.();
      }
    });
    return r;
  };
  const db = {
    objectStoreNames: { contains: (n: string) => stores.has(n) },
    createObjectStore: (n: string) => stores.set(n, new Map()),
    onversionchange: null as null | (() => void),
    close() {},
    transaction(name: string) {
      const store = stores.get(name)!;
      const ops: (() => void)[] = [];
      const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; error?: unknown; objectStore: () => unknown } = {
        objectStore: () => ({
          get: (k: string) => request(() => store.get(k)),
          getAllKeys: () => request(() => [...store.keys()]),
          put: (v: string, k: string) => void ops.push(() => {
            const used = [...store.values()].reduce((a: number, x) => a + String(x).length, 0);
            if (opts.quotaBytes !== undefined && used + v.length > opts.quotaBytes) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
            store.set(k, v);
          }),
          delete: (k: string) => void ops.push(() => store.delete(k)),
        }),
      };
      later(() => {
        try {
          for (const op of ops) op();
          tx.oncomplete?.();
        } catch (e) {
          tx.error = e;
          tx.onabort?.();
        }
      });
      return tx;
    },
  };
  return {
    stores,
    open: () => {
      const r: { result?: unknown; onupgradeneeded?: () => void; onsuccess?: () => void } = {};
      later(() => {
        r.result = db;
        if (!stores.size) r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r;
    },
  };
}

test('IndexedDB storage: put/get/delete/keys per object store; quota errors reject the write', async () => {
  const idb = fakeIndexedDB({ quotaBytes: 50 });
  const db = await openIdb(idb as unknown as IDBFactory, 'test-db-1');
  assert.deepEqual([...idb.stores.keys()].sort(), ['conv', 'nodestate']);
  const conv = createIdbStorage(db, 'conv');
  const ns = createIdbStorage(db, 'nodestate');
  await conv.setItem(P + 'a', '{"m":1}');
  await ns.setItem('hui.nodestate.a', '{}');
  assert.equal(await conv.getItem(P + 'a'), '{"m":1}');
  assert.equal(await conv.getItem('hui.nodestate.a'), null);
  assert.deepEqual(await conv.getAllKeys!(), [P + 'a']);
  await assert.rejects(conv.setItem(P + 'big', 'x'.repeat(100)), (e: Error) => isQuotaError(e));
  await conv.removeItem(P + 'a');
  assert.equal(await conv.getItem(P + 'a'), null);
  await assert.rejects(openIdb(undefined, 'test-db-2'), /not available/);
});

/** legacy storage whose reads capture the value at once but resolve only when `release()` is called */
function gatedLegacy(initial: Record<string, string>) {
  const inner = memoryStorage(initial);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let reading!: () => void;
  const started = new Promise<void>((r) => (reading = r));
  const s: KeyValueStorage = {
    ...inner,
    getItem: async (k) => {
      const v = await inner.getItem(k);
      reading();
      await gate;
      return v;
    },
  };
  return { s, inner, release, started };
}

test('migrating storage (H2): a write during migration of the same key is not overwritten by the old legacy value', async () => {
  const primary = memoryStorage();
  const legacy = gatedLegacy({ [P + 'a']: 'OLD' });
  const s = createMigratingStorage(primary, legacy.s, P);
  const migration = s.migrate();
  await legacy.started; // migration read "absent" from primary and is reading legacy
  const write = s.setItem(P + 'a', 'NEW');
  legacy.release();
  await migration;
  await write;
  assert.equal(primary.data.get(P + 'a'), 'NEW');
  assert.equal(await s.getItem(P + 'a'), 'NEW');
});

test('migrating storage (H2): a delete during migration of the same key is not undone', async () => {
  const primary = memoryStorage();
  const legacy = gatedLegacy({ [P + 'a']: 'OLD' });
  const s = createMigratingStorage(primary, legacy.s, P);
  const migration = s.migrate();
  await legacy.started;
  const del = s.removeItem(P + 'a');
  legacy.release();
  await migration;
  await del;
  assert.equal(primary.data.has(P + 'a'), false);
  assert.equal(await s.getItem(P + 'a'), null);
});

test('migrating storage (H3): an unreadable primary is not treated as absent (newer value kept, key counted failed)', async () => {
  const inner = memoryStorage({ [P + 'a']: 'NEWER' });
  let failOnce = true;
  const primary: KeyValueStorage = {
    ...inner,
    getItem: async (k) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('EIO');
      }
      return inner.getItem(k);
    },
  };
  const legacy = memoryStorage({ [P + 'a']: 'OLDER' });
  const s = createMigratingStorage(primary, legacy, P);
  const res = await s.migrate();
  assert.deepEqual(res, { moved: 0, failed: 1 });
  assert.equal(inner.data.get(P + 'a'), 'NEWER');
  assert.equal(legacy.data.has(P + 'a'), true, 'legacy kept for a later, successful retry');
  await s.migrate();
  assert.equal(inner.data.get(P + 'a'), 'NEWER');
  assert.equal(legacy.data.has(P + 'a'), false);
});
