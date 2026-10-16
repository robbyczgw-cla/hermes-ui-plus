import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sketchPoints } from './mapSketch.ts';

const ROME = [
  { lat: 41.8902, lng: 12.4922, n: 1 }, // Colosseum
  { lat: 41.8986, lng: 12.4769, n: 2 }, // Pantheon
  { lat: 41.9029, lng: 12.4534, n: 3 }, // St. Peter's
];

test('sketchPoints: stops keep their relative positions (west left, north up) inside the padded box', () => {
  const pts = sketchPoints(ROME, 350, 200, 30);
  assert.equal(pts.length, 3);
  const [colosseum, pantheon, peter] = pts;
  assert.ok(peter.x < pantheon.x && pantheon.x < colosseum.x, 'west → east');
  assert.ok(peter.y < colosseum.y, 'north is up');
  for (const p of pts) {
    assert.ok(p.x >= 30 - 0.1 && p.x <= 320 + 0.1, `x ${p.x}`);
    assert.ok(p.y >= 30 - 0.1 && p.y <= 170 + 0.1, `y ${p.y}`);
  }
  assert.deepEqual(pts.map((p) => p.n), [1, 2, 3]);
});

test('sketchPoints: one uniform scale (no stretching), centred', () => {
  const pts = sketchPoints(
    [
      { lat: 0.5, lng: 10, n: 1 },
      { lat: 0.5, lng: 11, n: 2 },
    ],
    300,
    200,
    20,
  );
  // same latitude → same y, centred vertically; span fills the width
  assert.equal(pts[0].y, 100);
  assert.equal(pts[1].y, 100);
  assert.equal(pts[0].x, 20);
  assert.equal(pts[1].x, 280);
});

test('sketchPoints: a single stop (or all in one place) sits in the centre; nothing to place → empty', () => {
  assert.deepEqual(sketchPoints([{ lat: 48.2, lng: 16.37, n: 1 }], 300, 200, 20), [{ x: 150, y: 100, n: 1 }]);
  assert.deepEqual(
    sketchPoints(
      [
        { lat: 1, lng: 1, n: 1 },
        { lat: 1, lng: 1, n: 2 },
      ],
      100,
      100,
      10,
    ).map((p) => [p.x, p.y]),
    [
      [50, 50],
      [50, 50],
    ],
  );
  assert.deepEqual(sketchPoints([], 300, 200, 20), []);
  assert.deepEqual(sketchPoints(ROME, 0, 200, 20), []);
});
