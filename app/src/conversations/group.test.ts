/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationMeta } from './types';
import { bucketOf, groupConversations } from './group.ts';

const NOW = new Date(2026, 9, 10, 15, 0, 0).getTime(); // 10 Oct 2026 15:00 local
const day = (back: number, h = 12) => new Date(2026, 9, 10 - back, h, 0, 0).getTime();

function meta(id: string, updatedAt: number, pinned = false): ConversationMeta {
  return { id, title: id, titleSource: 'auto', profileId: 'p', profileKind: 'hermes', createdAt: 0, updatedAt, pinned: pinned || undefined, preview: 'x', messageCount: 1 };
}

test('bucketOf boundaries', () => {
  assert.equal(bucketOf(day(0, 0), NOW), 'today');
  assert.equal(bucketOf(day(1, 23), NOW), 'yesterday');
  assert.equal(bucketOf(day(2), NOW), 'week');
  assert.equal(bucketOf(day(7, 0), NOW), 'week');
  assert.equal(bucketOf(day(8), NOW), 'older');
});

test('groups in order, pinned first, empty groups omitted, newest first', () => {
  const g = groupConversations(
    [meta('old', day(30)), meta('t1', day(0, 9)), meta('t2', day(0, 11)), meta('pin', day(40), true), meta('y', day(1))],
    NOW
  );
  assert.deepEqual(g.map((x) => x.key), ['pinned', 'today', 'yesterday', 'older']);
  assert.deepEqual(g[1].items.map((c) => c.id), ['t2', 't1']);
});
