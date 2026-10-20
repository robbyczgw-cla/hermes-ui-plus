import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveLocalStore, LIVE_PREFIX, parseRecord } from './localStore.ts';

function memStorage() {
  const m = new Map<string, string>();
  return { m, storage: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v), removeItem: async (k: string) => void m.delete(k) } };
}

test('updates are written at once and survive a new store (app restart)', async () => {
  const { m, storage } = memStorage();
  const a = new LiveLocalStore(storage);
  await a.load('c1');
  a.update('c1', (r) => ({ ...r, pending: { einkauf: { base: 1, ops: [{ check: 'milch' }], bid: 'b-test' } } }));
  await a.flush('c1');
  assert.ok(m.has(`${LIVE_PREFIX}c1`));
  const b = new LiveLocalStore(storage);
  await b.load('c1');
  assert.deepEqual(b.get('c1').pending.einkauf.ops, [{ check: 'milch' }]);
});

test('an edit made before the load finished is not lost', async () => {
  const { storage } = memStorage();
  await storage.setItem(`${LIVE_PREFIX}c1`, JSON.stringify({ pending: { a: { base: 1, ops: [{ check: 'x' }], bid: 'b-1' } }, seen: { a: 2 }, unpinned: [] }));
  const s = new LiveLocalStore(storage);
  s.update('c1', (r) => ({ ...r, pending: { ...r.pending, b: { base: 1, ops: [{ check: 'y' }], bid: 'b-2' } } }));
  await s.load('c1');
  assert.deepEqual(Object.keys(s.get('c1').pending).sort(), ['a', 'b']);
  assert.equal(s.get('c1').seen.a, 2);
});

test('an empty record removes the key; garbage parses to empty', async () => {
  const { m, storage } = memStorage();
  const s = new LiveLocalStore(storage);
  s.update('c1', (r) => ({ ...r, seen: { a: 1 } }));
  await s.flush('c1');
  s.update('c1', (r) => ({ ...r, seen: {} }));
  await s.flush('c1');
  assert.equal(m.has(`${LIVE_PREFIX}c1`), false);
  assert.deepEqual(parseRecord('{nope'), { pending: {}, seen: {}, unpinned: [] });
  assert.deepEqual(parseRecord('[1]'), { pending: {}, seen: {}, unpinned: [] });
});
