import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASK_MAX_CHARS, buildAskMessage, findNode, pickRecord } from './ask.ts';

const calc = {
  type: 'calc',
  id: 'kredit',
  inputs: [
    { name: 'k', label: 'Kredit', kind: 'number', default: 20000, unit: '€' },
    { name: 'n', label: 'Monate', kind: 'slider', min: 12, max: 120, step: 12, default: 60 },
  ],
  outputs: [{ label: 'Rate', expr: 'k / n', format: 'currency', emphasis: true }],
};
const choice = { type: 'choice', id: 'farbe', question: 'Welche Farbe?', options: [{ id: 'r', label: 'Rot' }, { id: 'b', label: 'Blau' }] };
const tree = [{ type: 'card', children: [calc, { type: 'tabs', tabs: [{ label: 'x', children: [choice] }] }] }];

test('findNode searches nested children and tabs', () => {
  assert.equal(findNode(tree, 'kredit')?.type, 'calc');
  assert.equal(findNode(tree, 'farbe')?.type, 'choice');
  assert.equal(findNode(tree, 'nope'), null);
});

test('pickRecord prefers the same message, else the newest', () => {
  const recs = { 'm1:x': { data: 1, updatedAt: 5 }, 'm2:x': { data: 2, updatedAt: 9 }, 'm3:y': { data: 3, updatedAt: 99 } };
  assert.equal(pickRecord(recs, 'x', 'm1'), 1);
  assert.equal(pickRecord(recs, 'x', 'mZ'), 2);
  assert.equal(pickRecord(recs, 'z'), undefined);
});

test('calc uses defaults overlaid with stored values', () => {
  const plain = buildAskMessage('Lohnt sich das?', ['kredit'], tree, {}, 'm1');
  assert.match(plain, /^Lohnt sich das\?\n\n\[calc:kredit\] Kredit 20\.000/);
  const stored = buildAskMessage('Und so?', ['kredit'], tree, { 'm1:kredit': { data: { v: { n: 120 } } } }, 'm1');
  assert.match(stored, /Monate 120/);
});

test('choice / checklist / unknown ids', () => {
  const recs = {
    'm1:farbe': { data: { status: 'answered', selected: ['b'], labels: ['Blau'] } },
    'm1:liste': { data: { kind: 'checklist', createdAt: 1, items: [{ id: 'a', text: 'Milch', checked: true }, { id: 'b', text: 'Brot', checked: false }] } },
  };
  const msg = buildAskMessage('Passt das?', ['farbe', 'liste', 'gibtsnicht'], tree, recs, 'm1');
  const lines = msg.split('\n');
  assert.equal(lines[0], 'Passt das?');
  assert.ok(lines.some((l) => l.startsWith('[choice:farbe] Welche Farbe? → Blau')));
  assert.ok(lines.some((l) => l.startsWith('[checklist:liste]') && l.includes('Milch') && l.includes('Brot')));
  assert.ok(!msg.includes('gibtsnicht'));
});

test('no include → just the text; capped at 4000 chars', () => {
  assert.equal(buildAskMessage('  Hallo  ', undefined, [], {}), 'Hallo');
  const big = { 'm1:x': { data: { blob: 'x'.repeat(9000) } } };
  const ids = Array.from({ length: 6 }, (_, i) => `x${i}`);
  const recs = Object.fromEntries(ids.map((id) => [`m1:${id}`, big['m1:x']]));
  const out = buildAskMessage('T', ids, [], recs, 'm1');
  assert.ok(out.length <= ASK_MAX_CHARS);
});
