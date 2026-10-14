/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexReducer } from './indexReducer.ts';
import { migrateIndex } from './migrate.ts';
import type { IndexState } from './types';

const profile = { id: 'p1', kind: 'hermes' as const };

function two(): IndexState {
  let s: IndexState = { items: [] };
  s = indexReducer(s, { type: 'create', id: 'a', profile, sessionId: 'hui-a', now: 1 });
  s = indexReducer(s, { type: 'create', id: 'b', profile, sessionId: 'hui-b', now: 2 });
  return s;
}

test('archive: one / many, unarchive drops the flag, unchanged state keeps identity', () => {
  let s = indexReducer(two(), { type: 'archive', ids: ['a'], archived: true });
  assert.equal(s.items.find((c) => c.id === 'a')?.archived, true);
  assert.equal(s.items.find((c) => c.id === 'b')?.archived, undefined);
  const same = indexReducer(s, { type: 'archive', ids: ['a'], archived: true });
  assert.equal(same, s);
  s = indexReducer(s, { type: 'archive', ids: ['a', 'b'], archived: true });
  assert.ok(s.items.every((c) => c.archived === true));
  s = indexReducer(s, { type: 'archive', ids: ['a'], archived: false });
  const a = s.items.find((c) => c.id === 'a')!;
  assert.equal('archived' in a, false);
  // local only: the Hermes session id stays
  assert.equal(a.hermesSessionId, 'hui-a');
});

test('archive: migration keeps the flag, drops junk; old entries are not archived', () => {
  const file = migrateIndex({
    v: 1,
    items: [
      { id: 'a', title: 'A', profileKind: 'hermes', createdAt: 1, updatedAt: 1, preview: 'x', messageCount: 2, archived: true },
      { id: 'b', title: 'B', profileKind: 'claude', createdAt: 1, updatedAt: 1, preview: 'x', messageCount: 2, archived: 'yes' },
      { id: 'c', title: 'C', createdAt: 1, updatedAt: 1, preview: 'x', messageCount: 2 },
    ],
  });
  assert.equal(file.items[0].archived, true);
  assert.equal(file.items[1].archived, undefined);
  assert.equal(file.items[2].archived, undefined);
});

test('branch seed: set, clear, migrate', () => {
  let s = indexReducer(two(), { type: 'setBranchSeed', id: 'a', count: 4 });
  assert.equal(s.items.find((c) => c.id === 'a')?.branchSeed, 4);
  const migrated = migrateIndex({ v: 1, items: s.items });
  assert.equal(migrated.items.find((c) => c.id === 'a')?.branchSeed, 4);
  s = indexReducer(s, { type: 'setBranchSeed', id: 'a', count: undefined });
  assert.equal('branchSeed' in s.items.find((c) => c.id === 'a')!, false);
  assert.equal(migrateIndex({ items: [{ id: 'x', branchSeed: -3 }] }).items[0].branchSeed, undefined);
});
