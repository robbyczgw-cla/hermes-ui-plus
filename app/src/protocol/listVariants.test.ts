/// <reference types="node" />
// List-like blocks written from memory (E2E round 11, F1: a ```hui checklist written without
// reading the schema rendered as an empty card "No entries yet"). Near-miss shapes are mapped onto
// the spec; when no usable entry remains, the block's content is shown readably, never an empty card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasListContent, isEmptyCollection, normalizeNode } from './validate.ts';
import { parseMessage } from './streamParser.ts';
import type { Segment } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = any;
const block = (json: string) => {
  const h = parseMessage('Hier ist die Liste.\n\n```hui\n' + json + '\n```\n').filter(
    (s): s is Extract<Segment, { kind: 'hui' }> => s.kind === 'hui',
  );
  assert.equal(h.length, 1);
  return h[0];
};
const texts = (n: A) => n.items.map((i: A) => i.text);

test('checklist: items as plain strings, no ids', () => {
  const n = normalizeNode({ type: 'checklist', title: 'Wochenendtrip', items: ['Zahnbürste', 'Ladekabel', 3] }) as A;
  assert.deepEqual(texts(n), ['Zahnbürste', 'Ladekabel', '3']);
  assert.deepEqual(n.items.map((i: A) => i.id), ['i0', 'i1', 'i2']);
});

test('checklist: label / title / name / task instead of text, done instead of checked', () => {
  const n = normalizeNode({
    type: 'checklist',
    items: [{ label: 'Pass', done: true }, { title: 'Jacke' }, { name: 'Socken', completed: false }, { task: 'Fenster zu' }],
  }) as A;
  assert.deepEqual(texts(n), ['Pass', 'Jacke', 'Socken', 'Fenster zu']);
  assert.equal(n.items[0].checked, true);
  assert.equal(n.items[2].checked, false);
});

test('checklist: nested sections / groups are flattened with their title as category', () => {
  const n = normalizeNode({
    type: 'checklist',
    title: 'Packliste',
    sections: [
      { title: 'Kleidung', items: [{ label: 'T-Shirts' }, 'Pullover'] },
      { name: 'Hygiene', entries: ['Zahnbürste'] },
    ],
  }) as A;
  assert.deepEqual(texts(n), ['T-Shirts', 'Pullover', 'Zahnbürste']);
  assert.deepEqual(n.items.map((i: A) => i.category), ['Kleidung', 'Kleidung', 'Hygiene']);
  // groups inside `items` (no own text, a nested list)
  const g = normalizeNode({ type: 'checklist', items: [{ category: 'Technik', items: ['Ladekabel', 'Powerbank'] }] }) as A;
  assert.deepEqual(texts(g), ['Ladekabel', 'Powerbank']);
  assert.equal(g.items[1].category, 'Technik');
  // a {category: [items]} map
  const m = normalizeNode({ type: 'checklist', groups: { Dokumente: ['Ausweis'], Technik: ['Kopfhörer'] } }) as A;
  assert.deepEqual(texts(m), ['Ausweis', 'Kopfhörer']);
  assert.deepEqual(m.items.map((i: A) => i.category), ['Dokumente', 'Technik']);
});

test('checklist: an item category beats the group title; ids stay unique across groups', () => {
  const n = normalizeNode({
    type: 'checklist',
    groups: [
      { title: 'A', items: [{ id: 'x', text: 'eins', category: 'Eigene' }] },
      { title: 'B', items: [{ id: 'x', text: 'zwei' }] },
    ],
  }) as A;
  assert.equal(n.items[0].category, 'Eigene');
  assert.equal(n.items[1].category, 'B');
  assert.equal(new Set(n.items.map((i: A) => i.id)).size, 2);
});

test('checklist block in a message: near-miss shape renders its items, no fallback', () => {
  const s = block('{"type":"checklist","title":"Wochenendtrip","kind":"packing","sections":[{"name":"Kleidung","items":[{"label":"Regenjacke","checked":false}]}]}');
  assert.equal(s.fallback, undefined);
  assert.equal((s.node as A).type, 'checklist');
  assert.deepEqual(texts(s.node), ['Regenjacke']);
});

test('checklist with entries that cannot be used: readable fallback, never an empty card', () => {
  const s = block('{"type":"checklist","title":"Wochenendtrip","things":[{"what":"Zelt","qty":1},{"what":"Schlafsack"}]}');
  assert.equal(s.fallback, true);
  assert.ok(s.error);
  assert.notEqual((s.node as A).type, 'checklist');
  assert.match(JSON.stringify(s.node), /Zelt/);
  assert.match(JSON.stringify(s.node), /Schlafsack/);
});

test('an explicitly empty checklist stays a checklist (a list to fill in)', () => {
  const s = block('{"type":"checklist","title":"Einkauf","items":[]}');
  assert.equal(s.fallback, undefined);
  assert.equal((s.node as A).type, 'checklist');
  assert.deepEqual((s.node as A).items, []);
});

test('steps / timeline / list accept text-like keys; timeline accepts date/year and strings', () => {
  const st = normalizeNode({ type: 'steps', items: [{ text: 'Öffnen', description: 'oben' }, { label: 'Schließen' }] }) as A;
  assert.deepEqual(st.items, [{ title: 'Öffnen', detail: 'oben' }, { title: 'Schließen' }]);
  const tl = normalizeNode({ type: 'timeline', events: [{ year: 1665, event: 'Micrographia' }, { date: '1670s', text: 'Mikroben' }, 'heute'] }) as A;
  assert.deepEqual(tl.items.map((i: A) => [i.time, i.title]), [['1665', 'Micrographia'], ['1670s', 'Mikroben'], ['', 'heute']]);
  const li = normalizeNode({ type: 'list', items: [{ name: 'A' }, { text: 'B' }] }) as A;
  assert.deepEqual(li.items.map((i: A) => i.title), ['A', 'B']);
});

test('other list-like nodes with no usable entries fall back to readable content', () => {
  const cases = [
    '{"type":"steps","items":[{"instruction":"Wasser kochen"}]}',
    '{"type":"timeline","items":[{"jahr":"1590","was":"Mikroskop"}]}',
    '{"type":"products","products":[{"modell":"Robo X1","preis":"299 €"}]}',
    '{"type":"compare","columns":["Robo X1","Robo Y2"]}',
    '{"type":"paths","items":[{"weg":"A → B"}]}',
    '{"type":"blocks","columns":[42]}',
  ];
  for (const c of cases) {
    const s = block(c);
    assert.equal(s.fallback, true, c);
    assert.ok(s.node, c);
    assert.ok(!isEmptyCollection(s.node), c);
  }
});

test('isEmptyCollection / hasListContent', () => {
  assert.equal(isEmptyCollection({ type: 'checklist', items: [] }), true);
  assert.equal(isEmptyCollection({ type: 'checklist', items: [{ text: 'a' }] }), false);
  assert.equal(isEmptyCollection({ type: 'text', text: '' }), false);
  assert.equal(hasListContent({ type: 'checklist', title: 'x', items: [] }), false);
  assert.equal(hasListContent({ type: 'checklist', items: [{ text: '' }] }), false);
  assert.equal(hasListContent({ type: 'checklist', a: { b: ['x'] } }), true);
});
