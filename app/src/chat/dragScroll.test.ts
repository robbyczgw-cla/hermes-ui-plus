import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragScrollStep } from './dragScroll.ts';

test('dy > 0 scrolls towards the bottom (offset shrinks)', () => {
  assert.deepEqual(dragScrollStep(100, 30), { next: 70, moved: 30 });
});
test('dy < 0 scrolls up (offset grows)', () => {
  assert.deepEqual(dragScrollStep(100, -30), { next: 130, moved: -30 });
});
test('clamps at the bottom edge', () => {
  assert.deepEqual(dragScrollStep(10, 30), { next: 0, moved: 10 });
  assert.deepEqual(dragScrollStep(0, 30), { next: 0, moved: 0 });
});
test('clamps at the top edge', () => {
  assert.deepEqual(dragScrollStep(95, -30, 100), { next: 100, moved: -5 });
});
