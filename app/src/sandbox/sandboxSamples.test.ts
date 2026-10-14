import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkString, SANDBOX_SAMPLES } from './sandboxSamples.ts';

test('chunkString round-trips and respects bounds', () => {
  for (const s of SANDBOX_SAMPLES) {
    const chunks = chunkString(s.html, { min: 3, max: 9, seed: 7 });
    assert.equal(chunks.join(''), s.html);
    for (const c of chunks.slice(0, -1)) assert.ok(c.length >= 3 && c.length <= 9);
  }
});

test('chunkString is deterministic per seed', () => {
  assert.deepEqual(chunkString('abcdefghijklmnop', { seed: 3 }), chunkString('abcdefghijklmnop', { seed: 3 }));
  assert.deepEqual(chunkString(''), []);
});

test('samples have unique ids and German titles', () => {
  assert.equal(new Set(SANDBOX_SAMPLES.map((s) => s.id)).size, SANDBOX_SAMPLES.length);
  assert.ok(SANDBOX_SAMPLES.length >= 3);
});
