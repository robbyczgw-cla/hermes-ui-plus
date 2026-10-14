import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDrag, maxOffset, offsetForPage, pageAfterDrag, pageAtOffset } from './galleryPaging.ts';

// 3 slides of 300 px (84 % of 357), gap 8 → interval 308, strip 916, max offset 559
const g = { n: 3, slideW: 300, gap: 8, viewW: 357 };

test('offsets and pages round-trip; the last page is the end of the strip', () => {
  assert.equal(maxOffset(g), 559);
  assert.deepEqual([0, 1, 2].map((p) => offsetForPage(g, p)), [0, 308, 559]);
  assert.deepEqual([0, 308, 559].map((x) => pageAtOffset(g, x)), [0, 1, 2]);
  assert.equal(offsetForPage(g, 9), 559);
  assert.equal(offsetForPage(g, -1), 0);
  assert.equal(pageAtOffset({ ...g, n: 1 }, 100), 0);
});

test('mouse drag: flick advances one page, long drag lands on the nearest page, tiny drag stays', () => {
  assert.equal(pageAfterDrag(g, 0, -50, 50), 1);
  assert.equal(pageAfterDrag(g, 1, 60, 250), 0);
  assert.equal(pageAfterDrag(g, 0, -500, 500), 2);
  assert.equal(pageAfterDrag(g, 0, -10, 10), 0);
  assert.equal(pageAfterDrag(g, 2, -80, 559), 2);
});

test('tap vs drag', () => {
  assert.equal(isDrag(3, 4), false);
  assert.equal(isDrag(-9, 0), true);
  assert.equal(isDrag(0, 12), true);
});
