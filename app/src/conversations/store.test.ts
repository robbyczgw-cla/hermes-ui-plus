/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexReducer, isDraft } from './indexReducer.ts';
import { migrateIndex, migrateMessages } from './migrate.ts';
import type { IndexState } from './types';

const empty: IndexState = { items: [] };
const profile = { id: 'p1', kind: 'hermes' as const };

function created(): IndexState {
  return indexReducer(empty, { type: 'create', id: 'c1', profile, sessionId: 'hui-1', now: 100 });
}

test('create adds a draft with session id and makes it active', () => {
  const s = created();
  assert.equal(s.activeId, 'c1');
  assert.equal(s.items[0].hermesSessionId, 'hui-1');
  assert.equal(s.items[0].title, 'Neuer Chat');
  assert.ok(isDraft(s.items[0]));
});

test('saved sets auto title, preview, updatedAt; user title is kept', () => {
  let s = indexReducer(created(), { type: 'saved', id: 'c1', now: 200, firstUserText: 'Wie wird das Wetter morgen in Berlin?', preview: 'Sonnig', messageCount: 2 });
  assert.equal(s.items[0].title, 'Wie wird das Wetter morgen in Berlin?');
  assert.equal(s.items[0].updatedAt, 200);
  assert.ok(!isDraft(s.items[0]));
  s = indexReducer(s, { type: 'rename', id: 'c1', title: 'Wetter' });
  s = indexReducer(s, { type: 'saved', id: 'c1', now: 300, firstUserText: 'anderes', preview: 'x', messageCount: 4 });
  assert.equal(s.items[0].title, 'Wetter');
  assert.equal(s.items[0].titleSource, 'user');
});

test('rename ignores empty titles; pin toggles / sets', () => {
  let s = created();
  assert.equal(indexReducer(s, { type: 'rename', id: 'c1', title: '  ' }), s);
  s = indexReducer(s, { type: 'pin', id: 'c1' });
  assert.equal(s.items[0].pinned, true);
  s = indexReducer(s, { type: 'pin', id: 'c1' });
  assert.equal(s.items[0].pinned, undefined);
  s = indexReducer(s, { type: 'pin', id: 'c1', pinned: true });
  assert.equal(s.items[0].pinned, true);
});

test('remove clears activeId; unknown ids are no-ops', () => {
  const s = created();
  assert.equal(indexReducer(s, { type: 'pin', id: 'nope' }), s);
  const r = indexReducer(s, { type: 'remove', id: 'c1' });
  assert.equal(r.items.length, 0);
  assert.equal(r.activeId, undefined);
});

test('setSession and pruneDrafts', () => {
  let s = created();
  s = indexReducer(s, { type: 'setSession', id: 'c1', sessionId: 'hui-9' });
  assert.equal(s.items[0].hermesSessionId, 'hui-9');
  assert.equal(indexReducer(s, { type: 'pruneDrafts' }).items.length, 0);
  assert.equal(indexReducer(s, { type: 'pruneDrafts', keep: 'c1' }).items.length, 1);
});

test('migrateIndex: v0 array, garbage, duplicates, bad activeId', () => {
  const f = migrateIndex([{ id: 'a', title: 'A', profileKind: 'claude' }, { id: 'a' }, null, { nope: 1 }, { id: 'b', createdAt: 5, updatedAt: 'x' }], 10);
  assert.equal(f.v, 1);
  assert.deepEqual(f.items.map((c) => c.id), ['a', 'b']);
  assert.equal(f.items[0].profileKind, 'hermes'); // a kind this build does not know reads as Hermes
  assert.equal(f.items[1].updatedAt, 5);
  assert.equal(migrateIndex({ items: [{ id: 'a' }], activeId: 'zzz' }).activeId, undefined);
  assert.deepEqual(migrateIndex('garbage').items, []);
  assert.deepEqual(migrateIndex(undefined).items, []);
});

test('migrateMessages drops malformed entries and repairs status', () => {
  const f = migrateMessages({ v: 1, messages: [{ id: 'a', role: 'user', text: 'hi', status: 'streaming', createdAt: 1 }, { id: 'b' }, 5, { id: 'c', role: 'assistant', text: 'x', status: 'done', tools: 'bad' }] });
  assert.deepEqual(f.messages.map((m) => m.id), ['a', 'c']);
  assert.equal(f.messages[0].status, 'stopped');
  assert.deepEqual(f.messages[1].tools, []);
});

test('setModel sets, clears and survives migration', () => {
  let s = created();
  s = indexReducer(s, { type: 'setModel', id: 'c1', model: ' kimi-k2 ' });
  assert.equal(s.items[0].model, 'kimi-k2');
  const same = indexReducer(s, { type: 'setModel', id: 'c1', model: 'kimi-k2' });
  assert.equal(same, s);
  const migrated = migrateIndex({ v: 1, items: s.items, activeId: 'c1' }, 0);
  assert.equal(migrated.items[0].model, 'kimi-k2');
  s = indexReducer(s, { type: 'setModel', id: 'c1', model: undefined });
  assert.equal('model' in s.items[0], false);
  assert.equal('model' in migrateIndex({ v: 1, items: s.items }, 0).items[0], false);
});

test('setProfile re-binds a chat to another profile of the same kind, persistently', () => {
  let s = created();
  s = indexReducer(s, { type: 'setProfile', id: 'c1', profileId: 'p2', profileKind: 'hermes' });
  assert.equal(s.items[0].profileId, 'p2');
  assert.equal(s.items[0].profileKind, 'hermes');
  assert.equal(migrateIndex({ v: 1, items: s.items, activeId: 'c1' }, 0).items[0].profileId, 'p2');
  assert.equal(indexReducer(s, { type: 'setProfile', id: 'c1', profileId: 'p2', profileKind: 'hermes' }), s);
});

test('setProfile never switches the chat to a different kind', () => {
  const s = created();
  const r = indexReducer(s, { type: 'setProfile', id: 'c1', profileId: 'x1', profileKind: 'demo' });
  assert.equal(r, s);
  assert.equal(r.items[0].profileId, 'p1');
  assert.equal(r.items[0].profileKind, 'hermes');
});

test('saved: historyTruncated is set when the cap dropped messages and stays set (sticky); migrate keeps it', () => {
  let s = indexReducer(created(), { type: 'saved', id: 'c1', now: 200, preview: 'x', messageCount: 2 });
  assert.equal(s.items[0].historyTruncated, undefined);
  s = indexReducer(s, { type: 'saved', id: 'c1', now: 300, preview: 'y', messageCount: 300, truncated: true });
  assert.equal(s.items[0].historyTruncated, true);
  s = indexReducer(s, { type: 'saved', id: 'c1', now: 400, preview: 'z', messageCount: 300, truncated: false });
  assert.equal(s.items[0].historyTruncated, true, 'older messages are still gone');
  const m = migrateIndex(JSON.parse(JSON.stringify({ v: 1, items: s.items })), 500);
  assert.equal(m.items[0].historyTruncated, true);
  const plain = migrateIndex({ v: 1, items: [{ ...s.items[0], historyTruncated: 'yes' }] }, 500);
  assert.equal(plain.items[0].historyTruncated, undefined);
});
