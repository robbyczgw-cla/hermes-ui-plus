import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evictLru,
  mergeLoaded,
  nodeBytes,
  nodeKey,
  parseRecord,
  recordBytes,
  removeMessageNodes,
  resolveUpdate,
  serializeRecord,
  setNode,
  splitNodeKey,
  utf8Length,
  type ConversationRecord,
} from './model.ts';

const LIM = { maxNodeBytes: 1000, maxConversationBytes: 3000 };

test('keys', () => {
  assert.equal(nodeKey('m1', 'n1'), 'm1:n1');
  assert.deepEqual(splitNodeKey('m1:a:b'), { messageId: 'm1', nodeId: 'a:b' });
});

test('utf8Length', () => {
  assert.equal(utf8Length('abc'), 3);
  assert.equal(utf8Length('ä'), 2);
  assert.equal(utf8Length('€'), 3);
  assert.equal(utf8Length('😀'), 4);
});

test('resolveUpdate handles values and updaters', () => {
  assert.equal(resolveUpdate(1, 2), 2);
  assert.equal(resolveUpdate(1, (p) => p + 5), 6);
});

test('setNode stores node with version and timestamp, immutably', () => {
  const base: ConversationRecord = {};
  const r = setNode(base, 'm:a', { x: 1 }, 2, 1234, LIM);
  assert.deepEqual(r.rec['m:a'], { v: 2, data: { x: 1 }, updatedAt: 1234 });
  assert.deepEqual(base, {});
  assert.equal(r.rejected, undefined);
});

test('setNode refuses oversized and non-serializable data, keeping the old value', () => {
  const r0 = setNode({}, 'm:a', 'ok', 1, 1, LIM);
  const big = setNode(r0.rec, 'm:a', 'x'.repeat(2000), 1, 2, LIM);
  assert.equal(big.rejected, 'too_large');
  assert.equal(big.rec, r0.rec);
  const bad = setNode(r0.rec, 'm:a', undefined, 1, 2, LIM);
  assert.equal(bad.rejected, 'not_serializable');
  const cyc: Record<string, unknown> = {};
  cyc.self = cyc;
  assert.equal(setNode(r0.rec, 'm:a', cyc, 1, 2, LIM).rejected, 'not_serializable');
});

test('conversation cap evicts least recently updated nodes, never the one just written', () => {
  let rec: ConversationRecord = {};
  const payload = 'y'.repeat(700);
  for (let i = 0; i < 5; i++) rec = setNode(rec, `m:n${i}`, payload, 1, 100 + i, LIM).rec;
  assert.ok(recordBytes(rec) <= LIM.maxConversationBytes);
  assert.ok(!('m:n0' in rec), 'oldest evicted');
  assert.ok('m:n4' in rec);
  // touching an old node makes it the newest
  rec = setNode(rec, 'm:n1', payload, 1, 500, LIM).rec;
  const r = setNode(rec, 'm:n9', payload, 1, 600, LIM);
  assert.ok(r.evicted.length >= 1);
  assert.ok('m:n1' in r.rec && 'm:n9' in r.rec);
  assert.ok(!('m:n2' in r.rec));
});

test('evictLru protects the given key even when everything else is gone', () => {
  const rec: ConversationRecord = { a: { v: 1, data: 'x'.repeat(500), updatedAt: 1 }, b: { v: 1, data: 'x'.repeat(500), updatedAt: 2 } };
  const ev = evictLru(rec, 100, 'b');
  assert.deepEqual(ev, ['a']);
  assert.ok('b' in rec);
});

test('nodeBytes is cached per record object', () => {
  const rec = { v: 1, data: { a: 1 }, updatedAt: 1 };
  assert.equal(nodeBytes('k', rec), nodeBytes('k', rec));
});

test('serialize / parse round trip', () => {
  const rec = setNode({}, 'm:a', { list: [1, 2, 'ä'] }, 3, 9, LIM).rec;
  assert.deepEqual(parseRecord(serializeRecord(rec)), rec);
});

test('parseRecord tolerates garbage and drops invalid nodes', () => {
  assert.deepEqual(parseRecord(null), {});
  assert.deepEqual(parseRecord('{nope'), {});
  assert.deepEqual(parseRecord('[]'), {});
  assert.deepEqual(parseRecord(JSON.stringify({ f: 99, nodes: {} })), {});
  const raw = JSON.stringify({ f: 1, nodes: { ok: { v: 1, data: 1, updatedAt: 5 }, bad: { v: 'x' }, bad2: 3, nodata: { v: 1, updatedAt: 1 } } });
  assert.deepEqual(Object.keys(parseRecord(raw)), ['ok']);
});

test('removeMessageNodes only removes that message', () => {
  const rec: ConversationRecord = {
    'm1:a': { v: 1, data: 1, updatedAt: 1 },
    'm1:b': { v: 1, data: 1, updatedAt: 1 },
    'm10:a': { v: 1, data: 1, updatedAt: 1 },
  };
  const r = removeMessageNodes(rec, 'm1');
  assert.deepEqual(r.removed.sort(), ['m1:a', 'm1:b']);
  assert.deepEqual(Object.keys(r.rec), ['m10:a']);
  assert.equal(removeMessageNodes(rec, 'zz').rec, rec);
});

test('mergeLoaded: local writes win for touched keys, touched removals stick', () => {
  const loaded: ConversationRecord = { a: { v: 1, data: 'disk', updatedAt: 1 }, b: { v: 1, data: 'disk', updatedAt: 1 }, c: { v: 1, data: 'disk', updatedAt: 1 } };
  const local: ConversationRecord = { a: { v: 1, data: 'local', updatedAt: 2 } };
  const m = mergeLoaded(loaded, local, new Set(['a', 'b']));
  assert.equal(m.a.data, 'local');
  assert.ok(!('b' in m));
  assert.equal(m.c.data, 'disk');
});
