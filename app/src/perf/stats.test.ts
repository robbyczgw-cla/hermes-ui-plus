import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addGap, emptyFrames, FRAME_MS, framesOut, hermesDelta, Samples } from './stats.ts';

test('frame gaps: on-time frames drop nothing, long gaps count missed vsyncs and blocked time', () => {
  const s = emptyFrames();
  for (let i = 0; i < 60; i++) addGap(s, FRAME_MS);
  assert.equal(s.dropped, 0);
  assert.equal(s.long50, 0);
  assert.equal(s.blockedMs, 0);
  addGap(s, 120); // one 120 ms task: ~6 missed vsyncs
  assert.equal(s.dropped, 6);
  assert.equal(s.long50, 1);
  assert.equal(s.long100, 1);
  assert.equal(Math.round(s.blockedMs), Math.round(120 - FRAME_MS));
  addGap(s, 2 * FRAME_MS); // exactly two frames: one dropped, not "blocked"
  assert.equal(s.dropped, 7);
  assert.equal(Math.round(s.blockedMs), Math.round(120 - FRAME_MS));
  const o = framesOut(s);
  assert.equal(o.frames, 62);
  assert.equal(o.maxGap, 120);
  assert.ok(o.fps > 40 && o.fps < 60);
});

test('samples summary: n, sum, max, p50, p95', () => {
  const s = new Samples();
  assert.deepEqual(s.summary(), { n: 0, sum: 0, max: 0, p50: 0, p95: 0 });
  for (let i = 1; i <= 100; i++) s.add(i);
  assert.deepEqual(s.summary(), { n: 100, sum: 5050, max: 100, p50: 51, p95: 96 });
});

test('hermes stats delta: GC count/time, allocation, heap; null without stats', () => {
  assert.equal(hermesDelta(null, { js_numGCs: 1 }), null);
  const a = { js_numGCs: 10, js_gcTime: 0.5, js_totalAllocatedBytes: 1048576, js_heapSize: 1 };
  const b = { js_numGCs: 14, js_gcTime: 0.75, js_totalAllocatedBytes: 3 * 1048576, js_heapSize: 8 * 1048576 };
  assert.deepEqual(hermesDelta(a, b), { gcs: 4, gcMs: 250, allocMB: 2, heapMB: 8 });
});
