/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_HINT_MS, historyPendingFor, initialRenderCount, messageAreaFor } from './messageArea.ts';

test('message area: messages win, a pending history shows the placeholder, never the empty surface', () => {
  assert.equal(messageAreaFor(0, true), 'placeholder');
  assert.equal(messageAreaFor(0, false), 'empty');
  assert.equal(messageAreaFor(3, true), 'list'); // e.g. a cached copy shown while it is revalidated
  assert.equal(messageAreaFor(3, false), 'list');
  assert.equal(HISTORY_HINT_MS, 250);
});

test('history pending: until the transcript settled AND the fetched one is merged', () => {
  assert.equal(historyPendingFor({ settled: false, applyPending: false }), true); // fetch running
  assert.equal(historyPendingFor({ settled: true, applyPending: true }), true); // fetched, merge not committed yet
  assert.equal(historyPendingFor({ settled: true, applyPending: false }), false); // done / failed / timed out / cached
});

const msgs = (...lengths: number[]) => lengths.map((n) => ({ text: 'x'.repeat(n) }));

test('first frame of a long chat: newest messages up to the text budget, at least the last turn, at most 12', () => {
  // short chat messages: the old fixed 12
  assert.equal(initialRenderCount(msgs(...Array<number>(40).fill(40))), 12);
  assert.equal(initialRenderCount(msgs(...Array<number>(40).fill(100))), 10); // 10 × (100 + 300) = the 4K budget
  // big answers (11K chars): just the last question + answer
  assert.equal(initialRenderCount(msgs(...Array.from({ length: 40 }, (_, i) => (i % 2 ? 11_000 : 60)))), 2);
  // medium answers (1.5K): until ~4K chars of text
  assert.equal(initialRenderCount(msgs(...Array.from({ length: 40 }, (_, i) => (i % 2 ? 1500 : 60)))), 4);
  // newest first: a huge OLD answer does not shrink the first frame
  assert.equal(initialRenderCount(msgs(50_000, ...Array<number>(20).fill(40))), 12);
  // tiny chats / edge cases
  assert.equal(initialRenderCount(msgs(20_000)), 1);
  assert.equal(initialRenderCount([]), 1);
  assert.equal(initialRenderCount(msgs(10, 10, 10), { max: 2 }), 2);
  assert.equal(initialRenderCount(msgs(9000, 9000, 9000), { min: 3 }), 3);
});
