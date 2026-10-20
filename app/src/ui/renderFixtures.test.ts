import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUI_NODE_TYPES } from '../protocol/types.ts';
import { createStreamParser } from '../protocol/streamParser.ts';
import { RENDER_FIXTURES } from './renderFixtures.ts';

test('render fixtures: every node type has its degenerate variants (a new type must be added to the sweep)', () => {
  for (const type of HUI_NODE_TYPES) {
    const ids = RENDER_FIXTURES.filter((f) => f.type === type).map((f) => f.id);
    assert.ok(ids.includes(`${type}-bare`), `${type}: bare`);
    assert.ok(ids.some((id) => id.startsWith(`${type}-empty-`)), `${type}: empty list`);
    assert.ok(ids.includes(`${type}-unknown-fields`), `${type}: unknown fields`);
  }
  assert.equal(new Set(RENDER_FIXTURES.map((f) => f.id)).size, RENDER_FIXTURES.length, 'ids are unique');
});

test('render fixtures: the reported gallery and the image failure modes are part of the sweep', () => {
  const ids = new Set(RENDER_FIXTURES.map((f) => f.id));
  for (const id of ['gallery-reported-web-queries', 'gallery-partial', 'gallery-real-urls', 'image-web-query', 'image-url-404', 'products-no-image-search']) assert.ok(ids.has(id), id);
});

test('render fixtures: every fixture parses to one complete hui segment (a node or a visible error/fallback)', () => {
  for (const f of RENDER_FIXTURES) {
    const p = createStreamParser();
    p.push('```hui\n' + f.raw + '\n```\n');
    p.end();
    const segs = p.segments().filter((s) => s.kind === 'hui');
    assert.equal(segs.length, 1, f.id);
    const s = segs[0];
    assert.ok(s.kind === 'hui' && s.complete, f.id);
    // nothing to render AND no error line would be an empty answer block
    assert.ok(s.kind === 'hui' && (s.node || s.error), `${f.id}: neither node nor error`);
  }
});
