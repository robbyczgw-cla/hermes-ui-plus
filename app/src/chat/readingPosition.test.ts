import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreTarget } from './readingPosition.ts';

const list = ['m9', 'm8', 'm7', 'm6', 'm5'].map((id) => ({ id }));

test('restoreTarget: the stored message, bottom for the newest, wait while the history is missing', () => {
  assert.deepEqual(restoreTarget(list, { anchor: 'm6' }), { index: 3 });
  assert.equal(restoreTarget(list, { anchor: 'm9' }), null);
  assert.equal(restoreTarget(list, { anchor: 'm8' }), null);
  assert.equal(restoreTarget(list, undefined), null);
  assert.equal(restoreTarget(list, {}), null);
  assert.equal(restoreTarget(list, { anchor: 'gone' }), 'wait');
  assert.equal(restoreTarget([], { anchor: 'm1' }), 'wait');
  assert.equal(restoreTarget([], undefined), null);
});

test('restoreTarget: the exact offset while the chat has the same messages, else the anchor message', () => {
  assert.deepEqual(restoreTarget(list, { anchor: 'm8', offset: 1240, count: 5 }), { index: 1, offset: 1240 });
  // a new answer arrived since: the offset no longer points at the same text
  assert.deepEqual(restoreTarget(list, { anchor: 'm6', offset: 1240, count: 4 }), { index: 3 });
  assert.equal(restoreTarget(list, { anchor: 'm9', offset: 0, count: 5 }), null);
});
