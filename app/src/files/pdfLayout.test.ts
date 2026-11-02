/// <reference types="node" />
// PDF viewer layout (pdfLayout.ts): page size per zoom, canvas pixel budget on phones, current page, zoom anchor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampZoom, MAX_CANVAS_PIXELS, MAX_ZOOM, pageAt, pageBox, zoomScroll } from './pdfLayout.ts';

test('pageBox: A4 on a 390 px phone at 3x renders at 2x, sharp but bounded', () => {
  const b = pageBox({ pageWidthPt: 595, pageHeightPt: 842, availWidth: 366, zoom: 1, dpr: 3 });
  assert.equal(b.cssWidth, 366);
  assert.equal(b.cssHeight, Math.round(842 * (366 / 595)));
  assert.equal(b.pixelWidth, 732);
  assert.ok(Math.abs(b.renderScale - (366 / 595) * 2) < 1e-9);
});

test('pageBox: zoomed pages stay inside the canvas pixel budget (iOS canvas limit)', () => {
  const b = pageBox({ pageWidthPt: 595, pageHeightPt: 842, availWidth: 1200, zoom: MAX_ZOOM, dpr: 2 });
  assert.equal(b.cssWidth, 4800);
  assert.ok(b.pixelWidth * b.pixelHeight <= MAX_CANVAS_PIXELS * 1.001);
  assert.ok(b.pixelWidth < b.cssWidth * 2);
});

test('clampZoom', () => {
  assert.equal(clampZoom(0.2), 1);
  assert.equal(clampZoom(9), MAX_ZOOM);
  assert.equal(clampZoom(Number.NaN), 1);
  assert.equal(clampZoom(2.5), 2.5);
});

test('pageAt: the page at the reading line (a third down the viewport)', () => {
  const tops = [0, 1000, 2000, 3000];
  assert.equal(pageAt(tops, 0, 900), 1);
  assert.equal(pageAt(tops, 800, 900), 2);
  assert.equal(pageAt(tops, 2950, 900), 4);
  assert.equal(pageAt([], 0, 900), 1);
});

test('zoomScroll keeps the point under the fingers in place', () => {
  assert.deepEqual(zoomScroll({ scrollLeft: 0, scrollTop: 100, x: 200, y: 300, factor: 2 }), { left: 200, top: 500 });
  assert.deepEqual(zoomScroll({ scrollLeft: 0, scrollTop: 0, x: 10, y: 10, factor: 0.5 }), { left: 0, top: 0 });
});
