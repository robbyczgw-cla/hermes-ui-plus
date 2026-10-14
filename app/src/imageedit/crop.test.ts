/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centeredCrop, fitContain, moveRect, presetAspect, resizeRect, rotatedSize, toImageRect } from './crop.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('preset aspects follow the image orientation', () => {
  assert.equal(presetAspect('free', 100, 100), null);
  assert.equal(presetAspect('1:1', 400, 300), 1);
  assert.equal(presetAspect('4:3', 400, 300), 4 / 3);
  assert.equal(presetAspect('4:3', 300, 400), 3 / 4);
  assert.equal(presetAspect('16:9', 1080, 1920), 9 / 16);
});

test('fitContain letterboxes', () => {
  assert.deepEqual(fitContain(2000, 1000, 300, 300), { x: 0, y: 75, w: 300, h: 150 });
  assert.deepEqual(fitContain(1000, 2000, 300, 300), { x: 75, y: 0, w: 150, h: 300 });
  assert.deepEqual(fitContain(0, 10, 300, 300), { x: 0, y: 0, w: 0, h: 0 });
});

test('centered crop is the largest rect of the aspect', () => {
  const b = { x: 0, y: 75, w: 300, h: 150 };
  assert.deepEqual(centeredCrop(b, 1), { x: 75, y: 75, w: 150, h: 150 });
  const wide = centeredCrop(b, 16 / 9);
  near(wide.h, 150);
  near(wide.w, 150 * 16 / 9);
  near(wide.x, (300 - wide.w) / 2);
  const free = centeredCrop(b, null);
  near(free.w, 270);
  near(free.h, 135);
  near(free.x, 15);
  near(free.y, 82.5);
});

test('move stays inside the bounds', () => {
  const b = { x: 0, y: 0, w: 300, h: 200 };
  const r = { x: 50, y: 50, w: 100, h: 100 };
  assert.deepEqual(moveRect(r, 10, -20, b), { x: 60, y: 30, w: 100, h: 100 });
  assert.deepEqual(moveRect(r, 500, 500, b), { x: 200, y: 100, w: 100, h: 100 });
  assert.deepEqual(moveRect(r, -500, -500, b), { x: 0, y: 0, w: 100, h: 100 });
});

test('resize: free, aspect-locked, clamped, minimum size', () => {
  const b = { x: 0, y: 0, w: 300, h: 200 };
  const r = { x: 50, y: 50, w: 100, h: 100 };
  assert.deepEqual(resizeRect(r, 30, -10, b, null), { x: 50, y: 50, w: 130, h: 90 });
  assert.deepEqual(resizeRect(r, 1000, 1000, b, null), { x: 50, y: 50, w: 250, h: 150 });
  assert.deepEqual(resizeRect(r, -1000, -1000, b, null), { x: 50, y: 50, w: 40, h: 40 });
  const locked = resizeRect(r, 40, 0, b, 1);
  assert.deepEqual(locked, { x: 50, y: 50, w: 140, h: 140 });
  // limited by the bottom edge: max h 150 → w 150 for 1:1
  assert.deepEqual(resizeRect(r, 1000, 0, b, 1), { x: 50, y: 50, w: 150, h: 150 });
  const wide = resizeRect(r, 0, 1000, b, 2);
  near(wide.w / wide.h, 2);
  assert.ok(wide.x + wide.w <= 300 + 1e-9 && wide.y + wide.h <= 200 + 1e-9);
});

test('display rect → image pixels (scaled, rounded, clamped)', () => {
  const image = { x: 0, y: 75, w: 300, h: 150 }; // 2000x1000 image in a 300x300 box
  assert.deepEqual(toImageRect({ x: 75, y: 75, w: 150, h: 150 }, image, 2000, 1000), { originX: 500, originY: 0, width: 1000, height: 1000 });
  assert.deepEqual(toImageRect({ x: -10, y: 60, w: 400, h: 400 }, image, 2000, 1000), { originX: 0, originY: 0, width: 2000, height: 1000 });
  const tiny = toImageRect({ x: 299.9, y: 224.9, w: 0.01, h: 0.01 }, image, 2000, 1000);
  assert.ok(tiny.width >= 1 && tiny.height >= 1 && tiny.originX + tiny.width <= 2000 && tiny.originY + tiny.height <= 1000);
});

test('rotation swaps the size on odd quarter turns', () => {
  assert.deepEqual(rotatedSize(400, 300, 90), { width: 300, height: 400 });
  assert.deepEqual(rotatedSize(400, 300, 180), { width: 400, height: 300 });
  assert.deepEqual(rotatedSize(400, 300, -90), { width: 300, height: 400 });
  assert.deepEqual(rotatedSize(400, 300, 360), { width: 400, height: 300 });
});
