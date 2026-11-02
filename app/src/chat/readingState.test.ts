import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forgetReadingIn, seenCandidate, MAX_DRAFT_CHARS, MAX_READING_ENTRIES, parseReading, patchReading, unreadAfter, type ReadingMap } from './readingState.ts';

test('draft, quotes and position per chat; a no-op patch keeps the same map (no write)', () => {
  let m: ReadingMap = {};
  m = patchReading(m, 'c1', { draft: 'Halb getippt' }, 1);
  m = patchReading(m, 'c2', { anchor: { id: 'a7' }, seen: 'a9' }, 2);
  m = patchReading(m, 'c1', { quotes: [{ ref: 'a1', role: 'assistant', text: 'Zitat' }] }, 3);
  assert.deepEqual(m, {
    c1: { draft: 'Halb getippt', quotes: [{ ref: 'a1', role: 'assistant', text: 'Zitat' }], at: 3 },
    c2: { anchor: 'a7', seen: 'a9', at: 2 },
  });
  assert.equal(patchReading(m, 'c1', { draft: 'Halb getippt' }, 9), m);
  assert.equal(patchReading(m, 'c2', { anchor: { id: 'a7' }, quotes: null }, 9), m);
  // cleared fields; an empty entry goes
  m = patchReading(m, 'c2', { anchor: null, seen: '' }, 4);
  assert.equal(m.c2, undefined);
  m = patchReading(m, 'c1', { draft: '', quotes: [] }, 5);
  assert.deepEqual(m, {});
});

test('survives a restart: stored JSON round trip, malformed parts dropped', () => {
  const m = patchReading({}, 'c1', { draft: 'x', quotes: [{ role: 'user', text: 'q' }], seen: 's' }, 7);
  assert.deepEqual(parseReading(JSON.stringify(m)), m);
  assert.deepEqual(parseReading(null), {});
  assert.deepEqual(parseReading('{kaputt'), {});
  assert.deepEqual(parseReading('[1,2]'), {});
  assert.deepEqual(
    parseReading(JSON.stringify({ a: { draft: 5, quotes: [{ text: '' }, { text: 'ok', role: 'x', ref: 3 }], at: 'x' }, b: null, c: { anchor: 'm1' } })),
    { a: { quotes: [{ role: 'assistant', text: 'ok' }], at: 0 }, c: { anchor: 'm1', at: 0 } },
  );
  // position with its offset; an offset without an anchor or with a bad count is dropped
  const pos = patchReading({}, 'c', { anchor: { id: 'm3', offset: 812.4, count: 40 } }, 1);
  assert.deepEqual(pos, { c: { anchor: 'm3', offset: 812, count: 40, at: 1 } });
  assert.deepEqual(parseReading(JSON.stringify(pos)), pos);
  assert.deepEqual(parseReading(JSON.stringify({ c: { offset: 5, count: 2, seen: 's' }, d: { anchor: 'x', offset: -1, count: 2 } })), { c: { seen: 's', at: 0 }, d: { anchor: 'x', at: 0 } });
  // back at the bottom: anchor and offset go together
  assert.deepEqual(patchReading(pos, 'c', { anchor: null, seen: 'm9' }, 2), { c: { seen: 'm9', at: 2 } });
});

test('a huge draft is stored cut; the map keeps the most recent chats', () => {
  const m = patchReading({}, 'c', { draft: 'x'.repeat(MAX_DRAFT_CHARS + 50) }, 1);
  assert.equal(m.c.draft?.length, MAX_DRAFT_CHARS);
  let big: ReadingMap = {};
  for (let i = 0; i <= MAX_READING_ENTRIES; i++) big = patchReading(big, `c${i}`, { seen: 'm' }, i);
  assert.equal(Object.keys(big).length, MAX_READING_ENTRIES);
  assert.equal(big.c0, undefined);
  assert.ok(big[`c${MAX_READING_ENTRIES}`]);
  assert.equal(forgetReadingIn(big, 'c5').c5, undefined);
  assert.equal(forgetReadingIn(big, 'nope'), big);
});

test('unreadAfter: answers after the last seen message; unknown = 0', () => {
  const msgs = [
    { id: 'u1', role: 'user' },
    { id: 'a1', role: 'assistant' },
    { id: 'u2', role: 'user' },
    { id: 'a2', role: 'assistant' },
    { id: 'a3', role: 'assistant' },
  ];
  assert.equal(unreadAfter(msgs, 'a1'), 2);
  assert.equal(unreadAfter(msgs, 'u1'), 3);
  assert.equal(unreadAfter(msgs, 'a3'), 0);
  assert.equal(unreadAfter(msgs, undefined), 0);
  assert.equal(unreadAfter(msgs, 'gone'), 0);
});

test('seenCandidate: a streaming answer is not seen yet (it counts as new when the user scrolls up meanwhile)', () => {
  assert.equal(seenCandidate([{ id: 'u1', status: 'done' }, { id: 'a1', status: 'streaming' }]), 'u1');
  assert.equal(seenCandidate([{ id: 'u1', status: 'done' }, { id: 'a1', status: 'done' }]), 'a1');
  assert.equal(seenCandidate([{ id: 'a1', status: 'streaming' }]), undefined);
  assert.equal(seenCandidate([]), undefined);
  assert.equal(unreadAfter([{ id: 'u1', role: 'user' }, { id: 'a1', role: 'assistant' }], 'u1'), 1);
});
