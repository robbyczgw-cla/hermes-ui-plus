/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNode } from './validate.ts';
import { hashItemId } from '../live/model.ts';

const n = (x: unknown) => normalizeNode(x) as unknown as Record<string, unknown> & { items: { id: string }[] };

const LIVE = {
  type: 'checklist', id: 'einkauf', live: true, title: 'Einkauf Samstag', kind: 'shopping', groupBy: 'category',
  items: [{ id: 'tomaten', text: 'Tomaten', qty: 6, category: 'Obst & Gemüse' }, { id: 'milch', text: 'Milch', qty: 1, unit: 'l' }],
};

test('live checklist keeps live (and closed) with its explicit id', () => {
  const out = n({ ...LIVE, closed: true });
  assert.equal(out.live, true);
  assert.equal(out.closed, true);
  assert.equal(out.id, 'einkauf');
});

test('live needs an explicit slug id; live:"yes" or a missing id is a plain checklist', () => {
  assert.equal((n({ ...LIVE, id: undefined })).live, undefined);
  assert.equal((n({ ...LIVE, id: 'mein einkauf!' })).live, undefined);
  assert.equal((n({ ...LIVE, live: 'yes' })).live, undefined);
  assert.equal((n({ ...LIVE, live: false, closed: true })).closed, undefined);
});

test('live items without id get h<hash(text)>, plain ones keep i<index>', () => {
  const items = [{ text: 'Brot' }, { text: 'Butter' }];
  const live = n({ ...LIVE, items });
  assert.deepEqual(live.items.map((i) => i.id), [hashItemId('Brot'), hashItemId('Butter')]);
  const plain = n({ ...LIVE, live: undefined, items });
  assert.deepEqual(plain.items.map((i) => i.id), ['i0', 'i1']);
});

test('compat: a live version is a plain checklist plus the live fields (older apps drop them and render it as today)', () => {
  const { live: _live, ...plainInput } = LIVE;
  const { live, closed, ...rest } = n(LIVE);
  assert.equal(live, true);
  assert.equal(closed, undefined);
  assert.deepEqual(rest, n(plainInput));
});
