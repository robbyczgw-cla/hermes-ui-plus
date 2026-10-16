/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNode as n, normalizeAction as a, collectInteractiveIds, parseIso, safeHttpUrl, normalizePhone, isValidEmail, parseQuantity } from './validate.ts';
import { parsePartialJson } from './partialJson.ts';
import { createStreamParser, parseMessage } from './streamParser.ts';
import { HUI_NODE_TYPES, INTERACTIVE_NODE_TYPES, isKnownNodeType, isInteractiveNodeType } from './types.ts';
import type { HuiNode } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = any;
const big = <T>(len: number, f: (i: number) => T): T[] => Array.from({ length: len }, (_, i) => f(i));

test('registry: every v2 node type is known; interactive set', () => {
  for (const t of ['choice', 'checklist', 'calc', 'map', 'recipe', 'tabs', 'accordion', 'quiz', 'flashcards', 'sources', 'timer', 'slots', 'confirm']) {
    assert.ok(isKnownNodeType(t), t);
  }
  assert.deepEqual(
    [...INTERACTIVE_NODE_TYPES].sort(),
    ['agenda', 'calc', 'changes', 'checklist', 'choice', 'confirm', 'decision', 'flashcards', 'form', 'guide', 'map', 'mindmap', 'paths', 'places', 'poll', 'products', 'quiz', 'rank', 'recipe', 'scale', 'slots', 'studyplan', 'timer', 'vocab', 'workout'],
  );
  assert.ok(isInteractiveNodeType('choice'));
  // map keeps persisted state (animation played) → needs a stable, per-message-unique id (GPT review #7)
  assert.ok(isInteractiveNodeType('map'));
  assert.ok(!isInteractiveNodeType('constructor'));
  assert.equal(new Set(HUI_NODE_TYPES).size, HUI_NODE_TYPES.length);
});

// ───────────────────────── fallback ids ─────────────────────────

test('interactive nodes: explicit id kept (trimmed), else deterministic fallback <type>-<path>', () => {
  assert.equal((n({ type: 'choice', id: ' pick ', options: [] }) as A).id, 'pick');
  assert.equal((n({ type: 'choice', options: [] }) as A).id, 'choice-n');
  assert.equal((n({ type: 'choice', id: '   ', options: [] }) as A).id, 'choice-n');
  assert.equal((n({ type: 'choice', id: 7, options: [] }) as A).id, '7');
  assert.equal((n({ type: 'timer', seconds: 5 }, { path: 'seg-4' }) as A).id, 'timer-seg-4');
  // form uses the same scheme now
  assert.equal((n({ type: 'form', fields: [] }, { path: 'seg-1' }) as A).id, 'form-seg-1');
  assert.equal((n({ type: 'form', id: 'trip', fields: [] }) as A).id, 'trip');
  // very long ids are capped
  assert.equal((n({ type: 'timer', id: 'x'.repeat(500), seconds: 1 }) as A).id.length, 100);
  // non-interactive nodes get no synthetic id
  assert.equal('id' in (n({ type: 'sources', items: [] }) as object), false);
  assert.equal('id' in (n({ type: 'tabs', tabs: [] }) as object), false);
});

test('fallback ids of nested interactive nodes use original array index paths', () => {
  const node = n(
    {
      type: 'card',
      children: [
        { type: 'text', text: 'x' },
        null, // dropped, but still occupies index 2? no: index 1
        { type: 'choice', options: [] },
        { type: 'tabs', tabs: [{ label: 'a', children: [{ type: 'timer', seconds: 3 }] }, 'bad', { label: 'b', children: [{ type: 'quiz', questions: [] }, { type: 'confirm', title: 't' }] }] },
        { type: 'accordion', items: [{ title: 'x', children: [{ type: 'flashcards', cards: [] }] }] },
      ],
    },
    { path: 'seg-2' },
  );
  assert.deepEqual(collectInteractiveIds(node), [
    'choice-seg-2.2',
    'timer-seg-2.3.0.0',
    'quiz-seg-2.3.2.0',
    'confirm-seg-2.3.2.1',
    'flashcards-seg-2.4.0.0',
  ]);
  // deterministic
  assert.deepEqual(n(JSON.parse(JSON.stringify(node)), { path: 'seg-2' }), node);
});

test('duplicate ids are made unique in document order, also vs reservedIds', () => {
  const node = n({ type: 'stack', children: [{ type: 'choice', id: 'a', options: [] }, { type: 'choice', id: 'a', options: [] }, { type: 'timer', id: 'a', seconds: 1 }] });
  assert.deepEqual(collectInteractiveIds(node), ['a', 'a-2', 'a-3']);
  const r = n({ type: 'choice', id: 'a', options: [] }, { reservedIds: ['a', 'a-2'] }) as A;
  assert.equal(r.id, 'a-3');
  // a model id equal to a fallback of a sibling does not collide
  const s = n({ type: 'stack', children: [{ type: 'choice', options: [] }, { type: 'choice', id: 'choice-n.0', options: [] }] }) as A;
  assert.equal(new Set(collectInteractiveIds(s)).size, 2);
});

test('stream parser: ids unique across segments of one message, stable while streaming', () => {
  const md = 'a\n```hui\n{"type":"choice","options":[{"label":"x"}]}\n```\nb\n```hui\n{"type":"choice","id":"choice-seg-1","options":[]}\n```\n```hui\n{"type":"checklist","items":[]}\n```\n';
  const segs = parseMessage(md);
  const ids = segs.flatMap((sg) => (sg.kind === 'hui' ? collectInteractiveIds(sg.node) : []));
  assert.deepEqual(ids, ['choice-seg-1', 'choice-seg-1-2', 'checklist-seg-4']);
  // char by char equals the one-shot result
  const p = createStreamParser();
  for (const ch of md) p.push(ch);
  assert.deepEqual(p.end(), segs);
});

// ───────────────────────── choice ─────────────────────────

test('choice: normalizes options (strings, ids, caps), flags and layout', () => {
  const r = n({
    type: 'choice', id: 'c', question: 'Welche?', multiple: true, min: '1', max: 2, allowOther: true, layout: 'grid', submitLabel: 'Los',
    options: ['Rom', { label: 'Paris', description: 'd', icon: '🗼', imageQuery: ' Paris ' }, { id: 'x', label: 'Wien' }, { id: 'x', label: 'Bern' }, { description: 'no label' }, 5, null, {}],
  }) as A;
  assert.equal(r.question, 'Welche?');
  assert.equal(r.multiple, true);
  assert.equal(r.min, 1);
  assert.equal(r.max, 2);
  assert.equal(r.allowOther, true);
  assert.equal(r.layout, 'grid');
  assert.equal(r.submitLabel, 'Los');
  assert.deepEqual(r.options, [
    { id: 'o0', label: 'Rom' },
    { id: 'o1', label: 'Paris', description: 'd', icon: '🗼', imageQuery: 'Paris' },
    { id: 'x', label: 'Wien' },
    { id: 'o3', label: 'Bern' },
    { id: 'o5', label: '5' },
  ]);
});

test('choice: caps options at 12, rejects bad enums/types, min>max dropped', () => {
  const r = n({ type: 'choice', id: 'c', options: big(40, (i) => `o${i}`), layout: 'carousel', multiple: 'yes', min: 5, max: 2 }) as A;
  assert.equal(r.options.length, 12);
  assert.equal(r.layout, undefined);
  assert.equal(r.multiple, undefined);
  assert.equal(r.min, undefined);
  assert.equal(r.max, 2);
  assert.deepEqual((n({ type: 'choice', id: 'c', options: 'nope' }) as A).options, []);
  assert.equal((n({ type: 'choice', id: 'c', options: [{ label: 'a'.repeat(5000) }] }) as A).options[0].label.length, 200);
});

test('choice: partial streaming shapes', () => {
  const full = '{"type":"choice","id":"c","question":"Q?","options":[{"label":"Alpha","icon":"A"},{"label":"Beta"}],"multiple":false}';
  let prevOpts = 0;
  for (let i = 1; i <= full.length; i++) {
    const p = parsePartialJson(full.slice(0, i));
    if (p === undefined) continue;
    const r = n(p, { path: 'seg-0' }) as A;
    if (!r) continue;
    if (r.type !== 'choice') {
      assert.ok('choice'.startsWith(r.type)); // partial "type" value: passes through as unknown node
      continue;
    }
    assert.equal(typeof r.id, 'string');
    assert.ok(Array.isArray(r.options));
    assert.ok(r.options.length >= prevOpts - 0);
    prevOpts = r.options.length;
  }
  assert.equal(prevOpts, 2);
});

// ───────────────────────── checklist ─────────────────────────

test('checklist: items from strings/objects, qty coercion, ids, checked', () => {
  const r = n({
    type: 'checklist', id: 'k', title: 'Einkauf', kind: 'shopping', groupBy: 'category', editable: false,
    items: [
      'Milch',
      { text: 'Äpfel', qty: 6, unit: 'Stk', category: 'Obst & Gemüse', checked: true, note: 'bio' },
      { text: 'Mehl', qty: '1 kg' },
      { text: 'Käse', qty: Infinity, checked: 'yes' },
      { qty: 3 },
      7,
      null,
    ],
  }) as A;
  assert.equal(r.kind, 'shopping');
  assert.equal(r.groupBy, 'category');
  assert.equal(r.editable, false);
  assert.deepEqual(r.items, [
    { id: 'i0', text: 'Milch' },
    { id: 'i1', text: 'Äpfel', qty: 6, unit: 'Stk', category: 'Obst & Gemüse', checked: true, note: 'bio' },
    { id: 'i2', text: 'Mehl', qty: '1 kg' },
    { id: 'i3', text: 'Käse' },
    { id: 'i5', text: '7' },
  ]);
});

test('checklist: caps at 200 items, bad enums dropped', () => {
  const r = n({ type: 'checklist', kind: 'weird', groupBy: 3, items: big(1000, (i) => `t${i}`) }) as A;
  assert.equal(r.items.length, 200);
  assert.equal(r.kind, undefined);
  assert.equal(r.groupBy, undefined);
  assert.equal(r.id, 'checklist-n');
  assert.deepEqual((n({ type: 'checklist', items: { a: 1 } }) as A).items, []);
});

test('checklist: duplicate item ids fall back to index ids', () => {
  const r = n({ type: 'checklist', items: [{ id: 'a', text: '1' }, { id: 'a', text: '2' }] }) as A;
  assert.deepEqual(r.items.map((i: A) => i.id), ['a', 'i1']);
});

// ───────────────────────── calc ─────────────────────────

const loan = {
  type: 'calc', id: 'kredit', title: 'Kredit', basis: 'calculated', source: 'Annuitätenformel',
  inputs: [
    { name: 'betrag', label: 'Kreditsumme', kind: 'slider', min: 1000, max: 100000, step: 500, default: 20000, unit: '€' },
    { name: 'zins', label: 'Zins', kind: 'number', min: 0, max: 20, default: '4,5', unit: '%' },
    { name: 'monate', label: 'Laufzeit', kind: 'select', options: [{ label: '5 Jahre', value: 60 }, { label: '10 Jahre', value: 120 }, '24'], default: 60 },
    { name: 'sonder', label: 'Sondertilgung', kind: 'toggle', default: true },
  ],
  outputs: [
    { name: 'rate', label: 'Rate', expr: 'betrag * (zins/1200) / (1 - pow(1 + zins/1200, -monate))', format: 'currency', decimals: 2, emphasis: true },
    { label: 'Gesamt', expr: 'rate * monate', format: 'currency', unit: '€' },
  ],
  chart: { kind: 'line', sweep: { input: 'monate', from: 12, to: 240, steps: 20 }, y: 'rate', label: 'Rate' },
  note: 'Ohne Gebühren.',
};

test('calc: well-formed node round-trips with coercions', () => {
  const r = n(loan) as A;
  assert.equal(r.id, 'kredit');
  assert.equal(r.basis, 'calculated');
  assert.equal(r.source, 'Annuitätenformel');
  assert.deepEqual(r.inputs[0], { name: 'betrag', label: 'Kreditsumme', kind: 'slider', unit: '€', min: 1000, max: 100000, step: 500, default: 20000 });
  assert.equal(r.inputs[1].default, 4.5);
  assert.deepEqual(r.inputs[2].options, [{ label: '5 Jahre', value: 60 }, { label: '10 Jahre', value: 120 }, { label: '24', value: '24' }]);
  assert.equal(r.inputs[2].default, 60);
  assert.deepEqual(r.inputs[3], { name: 'sonder', label: 'Sondertilgung', kind: 'toggle', default: true });
  assert.equal(r.outputs.length, 2);
  assert.equal(r.outputs[0].name, 'rate');
  assert.equal(r.outputs[0].emphasis, true);
  assert.equal(r.outputs[0].decimals, 2);
  assert.deepEqual(r.chart, { kind: 'line', sweep: { input: 'monate', from: 12, to: 240, steps: 20 }, y: 'rate', label: 'Rate' });
  assert.equal(r.note, 'Ohne Gebühren.');
});

test('calc: input defaults are clamped / derived, min/max swapped, bad names dropped', () => {
  const r = n({
    type: 'calc',
    inputs: [
      { name: 'a', kind: 'slider', min: 10, max: 0, default: 99 },
      { name: 'b', kind: 'number' },
      { name: 'c', kind: 'weird', default: 'x' },
      { name: 'a', label: 'dup' },
      { name: '1bad' },
      { name: 'has space' },
      { name: '' },
      { label: 'nameless' },
      { name: 'd', kind: 'select', options: ['x', 'y'], default: 'z' },
      { name: 'e', kind: 'toggle', default: 'true' },
      { name: 's', kind: 'slider', step: -1 },
    ],
    outputs: [],
  }) as A;
  assert.deepEqual(r.inputs.map((i: A) => i.name), ['a', 'b', 'c', 'd', 'e', 's']);
  assert.deepEqual([r.inputs[0].min, r.inputs[0].max, r.inputs[0].default], [0, 10, 10]);
  assert.equal(r.inputs[1].default, 0);
  assert.equal(r.inputs[2].kind, 'number');
  assert.equal(r.inputs[3].default, 'x');
  assert.equal(r.inputs[4].default, false);
  assert.equal(r.inputs[5].step, undefined);
});

test('calc: prototype-pollution style names are rejected', () => {
  const r = n({
    type: 'calc',
    inputs: [{ name: '__proto__' }, { name: 'constructor' }, { name: 'toString' }, { name: '__x' }, { name: 'ok' }],
    outputs: [{ name: '__proto__', label: 'p', expr: '1' }, { name: 'hasOwnProperty', label: 'h', expr: '2' }],
  }) as A;
  assert.deepEqual(r.inputs.map((i: A) => i.name), ['ok']);
  assert.deepEqual(r.outputs.map((o: A) => o.name), [undefined, undefined]);
  assert.equal(Object.getPrototypeOf(r.inputs[0]), Object.prototype);
});

test('calc: caps (12 inputs, 12 outputs, 500 char expressions)', () => {
  const r = n({
    type: 'calc',
    inputs: big(30, (i) => ({ name: `i${i}`, default: i })),
    outputs: [
      ...big(30, (i) => ({ label: `o${i}`, expr: 'i0 + 1' })),
    ],
  }) as A;
  assert.equal(r.inputs.length, 12);
  assert.equal(r.outputs.length, 12);
  const long = n({
    type: 'calc', inputs: [{ name: 'x', default: 1 }],
    outputs: [{ label: 'ok', expr: 'x'.repeat(500) }, { label: 'too long', expr: 'x'.repeat(501) }, { label: 'num', expr: 5 }, { label: 'obj', expr: {} }],
    chart: { kind: 'bar', sweep: { input: 'x', from: 0, to: 10, steps: 5000 }, y: 'x'.repeat(501) },
  }) as A;
  assert.deepEqual(long.outputs.map((o: A) => o.label), ['ok']);
  assert.equal(long.chart, undefined); // chart with an oversized y expression is dropped entirely
  const ch = n({ type: 'calc', outputs: [], chart: { sweep: { input: 'x', from: '0', to: 10, steps: 5000 }, y: 'x*2' } }) as A;
  assert.deepEqual(ch.chart, { kind: 'line', sweep: { input: 'x', from: 0, to: 10, steps: 200 }, y: 'x*2' });
  assert.equal((n({ type: 'calc', outputs: [], chart: { sweep: { input: 'x', from: 0 }, y: 'x' } }) as A).chart, undefined);
});

test('calc: output expression is never truncated and control chars are normalized', () => {
  const r = n({ type: 'calc', outputs: [{ label: 'a', expr: ' a +\n b ' }] }) as A;
  assert.equal(r.outputs[0].expr, 'a + b');
  const half = n({ type: 'calc', outputs: [{ label: 'a', expr: '' }, { label: 'b' }] }) as A;
  assert.deepEqual(half.outputs, [{ label: 'a', expr: '' }]); // empty expr = streaming intermediate; missing expr dropped
});

test('calc: output names must not clash with inputs; invalid format/decimals', () => {
  const r = n({
    type: 'calc', inputs: [{ name: 'x', default: 1 }],
    outputs: [{ name: 'x', label: 'clash', expr: '1', format: 'hex', decimals: 99 }, { name: 'y', label: 'ok', expr: '2', decimals: -3, emphasis: 'yes' }],
  }) as A;
  assert.equal(r.outputs[0].name, undefined);
  assert.equal(r.outputs[0].format, undefined);
  assert.equal(r.outputs[0].decimals, 10);
  assert.equal(r.outputs[1].name, 'y');
  assert.equal(r.outputs[1].decimals, 0);
  assert.equal(r.outputs[1].emphasis, undefined);
});

test('calc: streaming prefixes never throw; ids stable', () => {
  const full = JSON.stringify(loan);
  const ids = new Set<string>();
  for (let i = 1; i <= full.length; i += 3) {
    const p = parsePartialJson(full.slice(0, i));
    if (p === undefined) continue;
    const r = n(p, { path: 'seg-1' }) as A;
    if (r && r.type === 'calc') {
      assert.ok(Array.isArray(r.inputs) && Array.isArray(r.outputs));
      if (i > full.indexOf('"inputs"')) ids.add(r.id);
    }
  }
  assert.deepEqual([...ids], ['kredit']);
});

// ───────────────────────── provenance ─────────────────────────

test('provenance: basis + source on table, chart, stats, compare, calc, map', () => {
  const p = { basis: 'illustrative', source: 'Beispiel' };
  assert.deepEqual(n({ type: 'table', columns: ['a'], rows: [], source: 'S', basis: 'sourced' }), { type: 'table', columns: ['a'], rows: [], source: 'S', basis: 'sourced' });
  assert.deepEqual((n({ type: 'chart', series: [], ...p }) as A).basis, 'illustrative');
  assert.deepEqual((n({ type: 'chart', series: [], ...p }) as A).source, 'Beispiel');
  assert.equal((n({ type: 'stats', items: [], ...p }) as A).basis, 'illustrative');
  assert.equal((n({ type: 'compare', columns: [], ...p }) as A).source, 'Beispiel');
  assert.equal((n({ type: 'calc', ...p }) as A).basis, 'illustrative');
  assert.equal((n({ type: 'map', markers: [], ...p }) as A).source, 'Beispiel');
  for (const t of ['table', 'chart', 'stats', 'compare', 'calc', 'map']) {
    assert.equal((n({ type: t, basis: 'made-up' }) as A).basis, undefined, t);
    assert.equal((n({ type: t, basis: { x: 1 } }) as A).basis, undefined, t);
  }
  assert.equal((n({ type: 'chart', series: [], source: 'x'.repeat(1000) }) as A).source.length, 300);
  // existing nodes without provenance are unchanged
  assert.deepEqual(n({ type: 'stats', items: [{ label: 'a', value: 'b' }] }), { type: 'stats', items: [{ label: 'a', value: 'b' }] });
});

// ───────────────────────── map ─────────────────────────

test('map: markers validated (lat/lng ranges), numeric strings, caps, center, zoom', () => {
  const r = n({
    type: 'map', title: 'Rom', route: true, animate: false, zoom: '30', center: { lat: '41.9', lng: 12.5 },
    markers: [
      { lat: 41.89, lng: 12.49, title: 'Kolosseum', description: 'd', number: 1, imageQuery: 'Kolosseum' },
      { lat: '41,9', lng: '12.45', title: 'Forum' },
      { lat: 91, lng: 0, title: 'bad lat' },
      { lat: 0, lng: -181, title: 'bad lng' },
      { lat: NaN, lng: 0, title: 'nan' },
      { lat: 10, title: 'no lng' },
      { lat: null, lng: null },
      'x', null, [],
      { lat: -90, lng: 180, number: 99999 },
    ],
  }) as A;
  assert.equal(r.route, true);
  assert.equal(r.animate, false);
  assert.equal(r.zoom, 19);
  assert.deepEqual(r.center, { lat: 41.9, lng: 12.5 });
  assert.deepEqual(r.markers, [
    { lat: 41.89, lng: 12.49, title: 'Kolosseum', description: 'd', number: 1, imageQuery: 'Kolosseum' },
    { lat: 41.9, lng: 12.45, title: 'Forum' },
    { lat: -90, lng: 180, title: '', number: 999 },
  ]);
  assert.equal(r.id, 'map-n'); // interactive now: deterministic fallback id
});

test('map: 30 marker cap, invalid center dropped, strings Infinity', () => {
  const r = n({ type: 'map', center: { lat: 100, lng: 0 }, markers: big(100, (i) => ({ lat: i % 90, lng: i, title: `m${i}` })) }) as A;
  assert.equal(r.markers.length, 30);
  assert.equal(r.center, undefined);
  assert.deepEqual((n({ type: 'map', markers: [{ lat: 'Infinity', lng: '1e999', title: 'x' }] }) as A).markers, []);
  assert.deepEqual((n({ type: 'map' }) as A).markers, []);
});

// ───────────────────────── recipe ─────────────────────────

test('recipe: full node, quantity parsing, step timers, caps', () => {
  const r = n({
    type: 'recipe', id: 'r', title: 'Carbonara', imageQuery: 'Spaghetti alla carbonara', servings: '2', time: { prep: 10, cook: '15', total: 25, extra: 3 },
    ingredients: [
      { qty: 200, unit: 'g', item: 'Spaghetti' },
      { qty: '1/2', item: 'Zwiebel' },
      { qty: '1 1/2', unit: 'EL', item: 'Öl' },
      { qty: '½', unit: 'TL', item: 'Salz', group: 'Gewürze' },
      { qty: 'eine Prise', item: 'Pfeffer' },
      { qty: '2-3', unit: 'Stk', item: 'Eier' },
      { qty: -4, item: 'neg' },
      { unit: 'g' },
      'Parmesan',
      null,
    ],
    steps: ['Wasser kochen', { text: 'Spaghetti garen', timerSeconds: '600' }, { text: 'x', timerSeconds: 0 }, { text: '' }, { timerSeconds: 5 }, { text: 'huge', timerSeconds: 1e12 }],
    tips: ['Pasta-Wasser aufheben', 5, {}],
  }) as A;
  assert.equal(r.servings, 2);
  assert.deepEqual(r.time, { prep: 10, cook: 15, total: 25 });
  assert.deepEqual(r.ingredients, [
    { item: 'Spaghetti', qty: 200, unit: 'g' },
    { item: 'Zwiebel', qty: 0.5 },
    { item: 'Öl', qty: 1.5, unit: 'EL' },
    { item: 'Salz', qty: 0.5, unit: 'TL', group: 'Gewürze' },
    { item: 'Pfeffer', unit: 'eine Prise' },
    { item: 'Eier', unit: '2-3 Stk' },
    { item: 'neg' },
    { item: 'Parmesan' },
  ]);
  assert.deepEqual(r.steps, [
    { text: 'Wasser kochen' },
    { text: 'Spaghetti garen', timerSeconds: 600 },
    { text: 'x' },
    { text: 'huge', timerSeconds: 86400 },
  ]);
  assert.deepEqual(r.tips, ['Pasta-Wasser aufheben', '5']);
});

test('recipe: caps, defaults and hostile servings', () => {
  const r = n({ type: 'recipe', servings: -1, ingredients: big(500, (i) => ({ item: `i${i}`, qty: 1 })), steps: big(500, (i) => `s${i}`), tips: big(99, (i) => `t${i}`) }) as A;
  assert.equal(r.id, 'recipe-n');
  assert.equal(r.title, '');
  assert.equal(r.servings, 4);
  assert.equal(r.ingredients.length, 60);
  assert.equal(r.steps.length, 40);
  assert.equal(r.tips.length, 10);
  assert.equal((n({ type: 'recipe', servings: 1e9 }) as A).servings, 4);
  assert.equal((n({ type: 'recipe', servings: '3,5' }) as A).servings, 3.5);
  assert.equal((n({ type: 'recipe', time: {} }) as A).time, undefined);
  assert.equal((n({ type: 'recipe', ingredients: 'x', steps: 5 }) as A).steps.length, 0);
});

test('parseQuantity', () => {
  assert.equal(parseQuantity(3), 3);
  assert.equal(parseQuantity('1,5'), 1.5);
  assert.equal(parseQuantity('1/4'), 0.25);
  assert.equal(parseQuantity('2 1/2'), 2.5);
  assert.equal(parseQuantity('1½'), 1.5);
  assert.equal(parseQuantity('¾'), 0.75);
  assert.equal(parseQuantity('1/0'), undefined);
  assert.equal(parseQuantity('abc'), undefined);
  assert.equal(parseQuantity(-1), undefined);
  assert.equal(parseQuantity(Infinity), undefined);
  assert.equal(parseQuantity({}), undefined);
});

// ───────────────────────── tabs / accordion ─────────────────────────

test('tabs: ≤ 6, labels default, children normalised, junk dropped', () => {
  const r = n({
    type: 'tabs',
    tabs: [
      { label: 'Eins', children: [{ type: 'text', text: 'a' }, null, { type: 'wat' }] },
      { children: 'nope' },
      'bad',
      ...big(10, (i) => ({ label: `t${i}`, children: [] })),
    ],
  }) as A;
  assert.equal(r.tabs.length, 6);
  assert.deepEqual(r.tabs[0], { label: 'Eins', children: [{ type: 'text', text: 'a' }, { type: 'wat' }] });
  assert.deepEqual(r.tabs[1], { label: 'Tab 2', children: [] });
  assert.deepEqual((n({ type: 'tabs' }) as A).tabs, []);
});

test('accordion: items, open index, nested interactive ids', () => {
  const r = n({
    type: 'accordion', open: 1,
    items: [{ title: 'A', children: [{ type: 'checklist', items: ['x'] }] }, { children: [] }, null, ...big(40, () => ({ title: 't', children: [] }))],
  }) as A;
  assert.equal(r.open, 1);
  assert.equal(r.items.length, 20);
  assert.equal(r.items[1].title, 'Abschnitt 2');
  assert.equal(r.items[0].children[0].id, 'checklist-n.0.0');
  assert.equal((n({ type: 'accordion', items: [], open: -1 }) as A).open, undefined);
  assert.equal((n({ type: 'accordion', items: [], open: 1.5 }) as A).open, undefined);
  assert.equal((n({ type: 'accordion', items: [], open: 'x' }) as A).open, undefined);
});

test('tabs/accordion nesting is depth-capped and never throws', () => {
  let x: unknown = { type: 'text', text: 'leaf' };
  for (let i = 0; i < 40; i++) x = i % 2 ? { type: 'tabs', tabs: [{ label: 'a', children: [x] }] } : { type: 'accordion', items: [{ title: 'a', children: [x] }] };
  assert.doesNotThrow(() => n(x));
  const cyc: A = { type: 'tabs' };
  cyc.tabs = [{ label: 'c', children: [cyc] }];
  assert.doesNotThrow(() => n(cyc));
});

// ───────────────────────── quiz / flashcards ─────────────────────────

test('quiz: answer forms (index, letter, numeric string, multi), invalid questions dropped', () => {
  const r = n({
    type: 'quiz', id: 'q', title: 'Test',
    questions: [
      { q: 'A?', options: ['a', 'b', 'c'], answer: 1, explanation: 'weil' },
      { q: 'B?', options: ['a', 'b', 'c'], answer: '2' },
      { q: 'C?', options: ['a', 'b', 'c'], answer: 'C' },
      { q: 'D?', options: ['a', 'b', 'c'], answer: [2, 0, 2] },
      { q: 'E?', options: ['a', 'b', 'c'], answer: [1] },
      { q: 'out of range', options: ['a', 'b'], answer: 2 },
      { q: 'negative', options: ['a', 'b'], answer: -1 },
      { q: 'fraction', options: ['a', 'b'], answer: 0.5 },
      { q: 'partly bad', options: ['a', 'b'], answer: [0, 7] },
      { q: 'no answer', options: ['a', 'b'] },
      { q: 'one option', options: ['a'], answer: 0 },
      { q: 'bad option', options: ['a', {}, 'c'], answer: 2 },
      { options: ['a', 'b'], answer: 0 },
      { q: 'empty answer', options: ['a', 'b'], answer: [] },
      'x',
    ],
  }) as A;
  assert.deepEqual(r.questions, [
    { q: 'A?', options: ['a', 'b', 'c'], answer: 1, explanation: 'weil' },
    { q: 'B?', options: ['a', 'b', 'c'], answer: 2 },
    { q: 'C?', options: ['a', 'b', 'c'], answer: 2 },
    { q: 'D?', options: ['a', 'b', 'c'], answer: [0, 2] },
    { q: 'E?', options: ['a', 'b', 'c'], answer: 1 },
  ]);
});

test('quiz: caps (30 questions, 10 options) and hostile input', () => {
  const r = n({ type: 'quiz', questions: big(100, (i) => ({ q: `q${i}`, options: big(50, (j) => `o${j}`), answer: 3 })) }) as A;
  assert.equal(r.questions.length, 30);
  assert.equal(r.questions[0].options.length, 10);
  assert.deepEqual((n({ type: 'quiz', questions: 'x' }) as A).questions, []);
  assert.deepEqual((n({ type: 'quiz', questions: [{ q: 'x', options: ['a', 'b'], answer: big(1000, () => 0) }] }) as A).questions, []);
  assert.equal(r.id, 'quiz-n');
});

test('flashcards: cards need a front; back defaults to empty; capped at 100', () => {
  const r = n({ type: 'flashcards', id: 'f', cards: [{ front: 'a', back: 'b' }, { front: 'only front' }, { back: 'x' }, 'z', null, { front: 5, back: 6 }] }) as A;
  assert.deepEqual(r.cards, [{ front: 'a', back: 'b' }, { front: 'only front', back: '' }, { front: '5', back: '6' }]);
  assert.equal((n({ type: 'flashcards', cards: big(500, (i) => ({ front: `f${i}`, back: 'b' })) }) as A).cards.length, 100);
  assert.equal((n({ type: 'flashcards', cards: [{ front: 'x'.repeat(9999), back: 'y'.repeat(9999) }] }) as A).cards[0].front.length, 500);
});

// ───────────────────────── sources ─────────────────────────

test('sources: http(s) only, ≤ 12, title/host fallback', () => {
  const r = n({
    type: 'sources',
    items: [
      { title: 'Wiki', url: 'https://de.wikipedia.org/wiki/Rom', snippet: 's', siteName: 'Wikipedia' },
      { url: 'http://example.com/a?b=1#c' },
      'https://example.org',
      { title: 'JS', url: 'javascript:alert(1)' },
      { title: 'JS2', url: ' JaVaScRiPt:alert(1)' },
      { title: 'data', url: 'data:text/html,<script>alert(1)</script>' },
      { title: 'file', url: 'file:///etc/passwd' },
      { title: 'intent', url: 'intent://x#Intent;scheme=http;end' },
      { title: 'creds', url: 'https://user:pw@evil.example.com/' },
      { title: 'creds2', url: 'https://good.example.com@evil.example.com/' },
      { title: 'nohost', url: 'https:///x' },
      { title: 'nodot', url: 'https://localhost/x' },
      { title: 'ws', url: 'https://exa mple.com/' },
      { title: 'newline', url: 'https://example.com/\njavascript:x' },
      { title: 'rel', url: '/relative' },
      { title: 'proto-rel', url: '//evil.com' },
      { title: 'num', url: 5 },
      { title: 'none' },
      null,
    ],
  }) as A;
  assert.deepEqual(r.items, [
    { title: 'Wiki', url: 'https://de.wikipedia.org/wiki/Rom', snippet: 's', siteName: 'Wikipedia' },
    { title: 'example.com', url: 'http://example.com/a?b=1#c' },
    { title: 'example.org', url: 'https://example.org' },
  ]);
  assert.equal((n({ type: 'sources', items: big(50, (i) => ({ url: `https://s${i}.example.com` })) }) as A).items.length, 12);
  assert.equal(r.id, undefined);
  assert.deepEqual((n({ type: 'sources', items: 'x' }) as A).items, []);
  assert.deepEqual((n({ type: 'sources', items: [{ url: 'https://example.com/' + 'a'.repeat(3000) }] }) as A).items, []);
});

test('safeHttpUrl', () => {
  assert.equal(safeHttpUrl('https://a.b/c'), 'https://a.b/c');
  assert.equal(safeHttpUrl('  http://localhost:8080/x '), 'http://localhost:8080/x');
  assert.equal(safeHttpUrl('http://localhost:8080/x', true), undefined);
  assert.equal(safeHttpUrl('http://[::1]/'), undefined);
  assert.equal(safeHttpUrl('mailto:a@b.de'), undefined);
  assert.equal(safeHttpUrl('tel:+49'), undefined);
  assert.equal(safeHttpUrl('httpss://a.b'), undefined);
  assert.equal(safeHttpUrl('https://-a.b'), undefined);
});

// ───────────────────────── timer / slots / confirm ─────────────────────────

test('timer: seconds integer-clamped, label, autostart', () => {
  assert.deepEqual(n({ type: 'timer', id: 't', label: 'Nudeln', seconds: '600.4', autostart: true }), { type: 'timer', id: 't', label: 'Nudeln', seconds: 600, autostart: true });
  assert.equal((n({ type: 'timer', id: 't', seconds: 1e9 }) as A).seconds, 86400);
  assert.equal((n({ type: 'timer', id: 't', seconds: -5 }) as A).seconds, 0);
  assert.equal((n({ type: 'timer', id: 't', seconds: 'abc' }) as A).seconds, 0);
  assert.deepEqual(n({ type: 'timer', id: 't', autostart: 'yes' }), { type: 'timer', id: 't', label: '', seconds: 0 });
});

test('slots: ISO validation, end ordering, timezone, none label, caps, ids', () => {
  const r = n({
    type: 'slots', id: 's', title: 'Termin', timezone: 'Europe/Berlin', noneLabel: 'Keiner passt',
    slots: [
      { start: '2026-10-12T09:00', end: '2026-10-12T10:00', label: 'Mo 9 Uhr', note: 'n' },
      { start: '2026-10-13 14:30:00+02:00', end: '2026-10-13T13:00:00+02:00' }, // end before start -> end dropped
      { start: '2026-02-30T10:00' },
      { start: '2026-13-01' },
      { start: '2026-10-12T25:00' },
      { start: 'morgen' },
      { start: '2026-10-14' },
      '2026-10-15T08:00',
      { id: 'dup', start: '2026-10-16T08:00' },
      { id: 'dup', start: '2026-10-17T08:00' },
      { label: 'no start' },
      null,
    ],
  }) as A;
  assert.equal(r.timezone, 'Europe/Berlin');
  assert.equal(r.noneLabel, 'Keiner passt');
  assert.deepEqual(r.slots, [
    { id: 's0', start: '2026-10-12T09:00', end: '2026-10-12T10:00', label: 'Mo 9 Uhr', note: 'n' },
    { id: 's1', start: '2026-10-13T14:30:00+02:00' },
    { id: 's6', start: '2026-10-14' },
    { id: 's7', start: '2026-10-15T08:00' },
    { id: 'dup', start: '2026-10-16T08:00' },
    { id: 's9', start: '2026-10-17T08:00' },
  ]);
  assert.equal((n({ type: 'slots', timezone: 'Europe/../../etc' }) as A).timezone, undefined);
  assert.equal((n({ type: 'slots', timezone: '<script>' }) as A).timezone, undefined);
  assert.equal((n({ type: 'slots', timezone: 'UTC' }) as A).timezone, 'UTC');
  assert.equal((n({ type: 'slots', slots: big(100, (i) => ({ start: `2026-10-${String((i % 28) + 1).padStart(2, '0')}` })) }) as A).slots.length, 20);
});

test('parseIso', () => {
  assert.deepEqual(parseIso('2026-10-10'), { value: '2026-10-10', hasTime: false });
  assert.deepEqual(parseIso('2026-10-10T14:30Z'), { value: '2026-10-10T14:30Z', hasTime: true });
  assert.deepEqual(parseIso('2026-10-10 14:30:15.123+05:30'), { value: '2026-10-10T14:30:15.123+05:30', hasTime: true });
  assert.ok(parseIso('2028-02-29'));
  assert.equal(parseIso('2026-02-29'), undefined);
  assert.equal(parseIso('2026-10-10T14'), undefined);
  assert.equal(parseIso('2026-10-10T24:00'), undefined);
  assert.equal(parseIso('2026-10-10T10:00+25:00'), undefined);
  assert.equal(parseIso('10.10.2026'), undefined);
  assert.equal(parseIso(20261010), undefined);
  assert.equal(parseIso('2026-10-10T10:00' + 'x'.repeat(50)), undefined);
});

test('confirm: title/text/labels/tone', () => {
  assert.deepEqual(n({ type: 'confirm', id: 'c', title: 'Löschen?', text: 'Wirklich?', confirmLabel: 'Ja', cancelLabel: 'Nein', tone: 'danger' }), {
    type: 'confirm', id: 'c', title: 'Löschen?', text: 'Wirklich?', confirmLabel: 'Ja', cancelLabel: 'Nein', tone: 'danger',
  });
  assert.deepEqual(n({ type: 'confirm', tone: 'rainbow', text: 5 }), { type: 'confirm', id: 'confirm-n', title: '', text: '5' });
});

// ───────────────────────── actions ─────────────────────────

test('open_url: http(s) only (v0 behaviour tightened)', () => {
  assert.deepEqual(a({ type: 'open_url', url: 'https://git-scm.com/docs' }), { type: 'open_url', url: 'https://git-scm.com/docs' });
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///x', 'intent://x', 'tel:123', 'mailto:a@b.de', '', '/x', 'https://u:p@a.com/', 5, null]) {
    assert.equal(a({ type: 'open_url', url }), null, String(url));
  }
});

test('calendar action', () => {
  assert.deepEqual(
    a({ type: 'calendar', title: ' Zahnarzt ', start: '2026-10-12T09:00', end: '2026-10-12T09:30', allDay: false, location: 'Praxis', notes: 'Karte mitbringen' }),
    { type: 'calendar', title: 'Zahnarzt', start: '2026-10-12T09:00', end: '2026-10-12T09:30', allDay: false, location: 'Praxis', notes: 'Karte mitbringen' },
  );
  assert.deepEqual(a({ type: 'calendar', title: 'Urlaub', start: '2026-10-12', allDay: true }), { type: 'calendar', title: 'Urlaub', start: '2026-10-12', allDay: true });
  assert.deepEqual(a({ type: 'calendar', title: 'x', start: '2026-10-12T09:00', end: '2026-10-12T08:00' }), { type: 'calendar', title: 'x', start: '2026-10-12T09:00' });
  assert.deepEqual(a({ type: 'calendar', title: 'x', start: '2026-10-12T09:00', end: 'later', allDay: 'yes' }), { type: 'calendar', title: 'x', start: '2026-10-12T09:00' });
  assert.equal(a({ type: 'calendar', title: 'x', start: 'tomorrow' }), null);
  assert.equal(a({ type: 'calendar', title: 'x', start: '2026-02-31' }), null);
  assert.equal(a({ type: 'calendar', title: '', start: '2026-10-12' }), null);
  assert.equal(a({ type: 'calendar', start: '2026-10-12' }), null);
});

test('reminder action', () => {
  assert.deepEqual(a({ type: 'reminder', title: 'Tablette', at: '2026-10-11T08:00:00+02:00' }), { type: 'reminder', title: 'Tablette', at: '2026-10-11T08:00:00+02:00' });
  assert.equal(a({ type: 'reminder', title: 'x', at: 'bald' }), null);
  assert.equal(a({ type: 'reminder', at: '2026-10-11' }), null);
});

test('maps action: query or lat+lng; mode enum', () => {
  assert.deepEqual(a({ type: 'maps', query: 'Kolosseum Rom', mode: 'walking' }), { type: 'maps', query: 'Kolosseum Rom', mode: 'walking' });
  assert.deepEqual(a({ type: 'maps', lat: '41.89', lng: 12.49 }), { type: 'maps', lat: 41.89, lng: 12.49 });
  assert.deepEqual(a({ type: 'maps', query: 'x', mode: 'flying' }), { type: 'maps', query: 'x' });
  assert.equal(a({ type: 'maps' }), null);
  assert.equal(a({ type: 'maps', lat: 41 }), null);
  assert.equal(a({ type: 'maps', lat: 91, lng: 0 }), null);
  assert.equal(a({ type: 'maps', lat: 0, lng: 181 }), null);
  assert.deepEqual(a({ type: 'maps', query: 'ok', lat: 999, lng: 999 }), { type: 'maps', query: 'ok' });
  assert.equal((a({ type: 'maps', query: 'q'.repeat(999) }) as A).query.length, 200);
});

test('call / sms actions: phone format', () => {
  assert.deepEqual(a({ type: 'call', phone: '+49 (30) 123-456' }), { type: 'call', phone: '+4930123456' });
  assert.deepEqual(a({ type: 'call', phone: '112' }), { type: 'call', phone: '112' });
  assert.deepEqual(a({ type: 'sms', to: '0170 1234567', body: 'Hallo' }), { type: 'sms', to: '01701234567', body: 'Hallo' });
  for (const phone of ['', 'abc', '12', '+', '1234567890123456', 'tel:123', '123;ext=5', '+49 30 123\n456', '1,2,3', '*21#', {}, null, '++4930']) {
    assert.equal(a({ type: 'call', phone }), null, String(phone));
  }
  assert.equal(a({ type: 'sms', to: 'nope' }), null);
  assert.equal(a({ type: 'sms' }), null);
  assert.equal(normalizePhone(1234567), '1234567');
});

test('email action: address validation, header injection, lists', () => {
  assert.deepEqual(a({ type: 'email', to: 'max@example.com', subject: 'Hi', body: 'Zeile1\nZeile2' }), { type: 'email', to: 'max@example.com', subject: 'Hi', body: 'Zeile1\nZeile2' });
  assert.deepEqual(a({ type: 'email', to: 'a@b.de; c@d.org' }), { type: 'email', to: 'a@b.de,c@d.org' });
  assert.deepEqual(a({ type: 'email', to: 'a@b.de', subject: 'Betreff\r\nBcc: evil@example.net' }), { type: 'email', to: 'a@b.de', subject: 'Betreff Bcc: evil@example.net' });
  for (const to of ['', 'nope', 'a@b', '@b.de', 'a@.de', 'a b@c.de', 'a@b.de\nBcc:x@y.de', 'a@b.de,nope', 'a..b@example.com', '<a@b.de>', 'a@b.d', big(6, () => 'a@b.de').join(','), 5, null]) {
    assert.equal(a({ type: 'email', to }), null, String(to));
  }
  assert.ok(isValidEmail('first.last+tag@sub.example.com'));
  assert.ok(!isValidEmail('a'.repeat(70) + '@b.de'));
});

test('timer action', () => {
  assert.deepEqual(a({ type: 'timer', seconds: 90, label: 'Eier' }), { type: 'timer', seconds: 90, label: 'Eier' });
  assert.deepEqual(a({ type: 'timer', seconds: '300' }), { type: 'timer', seconds: 300, label: 'Timer' });
  for (const seconds of [0, -1, 86401, 'x', null, NaN]) assert.equal(a({ type: 'timer', seconds, label: 'x' }), null, String(seconds));
});

test('add_to_list action', () => {
  assert.deepEqual(a({ type: 'add_to_list', items: ['Milch', ' Brot ', '', 5, {}, null], listTitle: 'Einkauf' }), { type: 'add_to_list', items: ['Milch', 'Brot', '5'], listTitle: 'Einkauf' });
  assert.equal(a({ type: 'add_to_list', items: [] }), null);
  assert.equal(a({ type: 'add_to_list', items: 'Milch' }), null);
  assert.equal(a({ type: 'add_to_list' }), null);
  assert.equal((a({ type: 'add_to_list', items: big(500, (i) => `i${i}`) }) as A).items.length, 50);
});

test('ask action: text + include ids', () => {
  assert.deepEqual(a({ type: 'ask', text: 'Erkläre das', include: ['kredit', 'wahl', 5, '', null] }), { type: 'ask', text: 'Erkläre das', include: ['kredit', 'wahl', '5'] });
  assert.deepEqual(a({ type: 'ask', text: 'x' }), { type: 'ask', text: 'x' });
  assert.deepEqual(a({ type: 'ask', text: 'x', include: 'kredit' }), { type: 'ask', text: 'x' });
  assert.equal(a({ type: 'ask', text: '' }), null);
  assert.equal(a({ type: 'ask' }), null);
  assert.equal((a({ type: 'ask', text: 'x', include: big(100, (i) => `n${i}`) }) as A).include.length, 8);
});

test('existing actions unchanged; unknown / non-object actions rejected', () => {
  assert.deepEqual(a({ type: 'send', text: 'hi' }), { type: 'send', text: 'hi' });
  assert.deepEqual(a({ type: 'submit' }), { type: 'submit' });
  assert.deepEqual(a({ type: 'copy', text: 'x' }), { type: 'copy', text: 'x' });
  for (const x of [null, 5, 'send', [], { type: 'rm -rf' }, { type: 'constructor' }, {}]) assert.equal(a(x), null);
});

test('buttons accept the new actions and drop invalid ones', () => {
  const r = n({
    type: 'buttons',
    items: [
      { label: 'Termin', action: { type: 'calendar', title: 'T', start: '2026-10-12T09:00' } },
      { label: 'bad', action: { type: 'calendar', title: 'T', start: 'x' } },
      { label: 'XSS', action: { type: 'open_url', url: 'javascript:alert(1)' } },
      { label: 'Anrufen', action: { type: 'call', phone: '+49301234' } },
      { label: 'Frage', action: { type: 'ask', text: 'Warum?', include: ['a'] } },
    ],
  }) as A;
  assert.deepEqual(r.items.map((i: A) => i.label), ['Termin', 'Anrufen', 'Frage']);
});

// ───────────────────────── hostile / generic ─────────────────────────

test('hostile: wrong types never throw for any v2 node', () => {
  const junk: unknown[] = [null, undefined, 0, -1, 1e999, NaN, '', 'x', [], {}, [[]], { a: 1 }, true, false, () => 1, Symbol.iterator];
  const types = ['choice', 'checklist', 'calc', 'map', 'recipe', 'tabs', 'accordion', 'quiz', 'flashcards', 'sources', 'timer', 'slots', 'confirm'];
  const keys = ['id', 'title', 'question', 'options', 'items', 'inputs', 'outputs', 'chart', 'markers', 'center', 'zoom', 'ingredients', 'steps', 'tips', 'time', 'servings', 'tabs', 'questions', 'cards', 'slots', 'seconds', 'label', 'text', 'basis', 'source', 'children', 'open', 'timezone'];
  for (const t of types) {
    for (const j of junk) {
      for (const k of keys) {
        let r: unknown;
        assert.doesNotThrow(() => { r = n({ type: t, [k]: j }); }, `${t}.${k}=${String(j)}`);
        assert.ok(r && (r as A).type === t);
        assert.doesNotThrow(() => JSON.stringify(r));
      }
    }
  }
  for (const t of ['calendar', 'reminder', 'maps', 'call', 'email', 'sms', 'timer', 'add_to_list', 'ask']) {
    for (const j of junk) for (const k of ['title', 'start', 'end', 'at', 'query', 'lat', 'lng', 'phone', 'to', 'subject', 'body', 'seconds', 'label', 'items', 'text', 'include', 'mode']) {
      assert.doesNotThrow(() => a({ type: t, [k]: j }));
    }
  }
});

test('hostile: huge arrays are processed quickly and capped', () => {
  const t0 = Date.now();
  const hugeArr = (f: (i: number) => unknown) => big(200_000, f);
  n({ type: 'choice', options: hugeArr((i) => `o${i}`) });
  n({ type: 'checklist', items: hugeArr((i) => `i${i}`) });
  n({ type: 'map', markers: hugeArr((i) => ({ lat: 1, lng: 1, title: `${i}` })) });
  n({ type: 'quiz', questions: hugeArr(() => ({ q: 'q', options: ['a', 'b'], answer: 0 })) });
  n({ type: 'flashcards', cards: hugeArr(() => ({ front: 'f', back: 'b' })) });
  n({ type: 'sources', items: hugeArr(() => ({ url: 'https://a.example.com' })) });
  n({ type: 'tabs', tabs: hugeArr(() => ({ label: 'a', children: [] })) });
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
});

test('hostile: output contains only plain data (no functions/symbols, JSON round-trips)', () => {
  const r = n({ type: 'calc', inputs: [{ name: 'a', default: () => 1 }], outputs: [{ label: 'x', expr: Symbol('s') }], __proto__: { polluted: true } });
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  assert.equal(({} as A).polluted, undefined);
});

test('unknown fields on v2 nodes are ignored', () => {
  const r = n({ type: 'timer', id: 't', label: 'x', seconds: 1, evil: '<script>', onPress: 'x' }) as A;
  assert.deepEqual(Object.keys(r).sort(), ['id', 'label', 'seconds', 'type']);
});

// ───────────────────────── streaming through the parser ─────────────────────────

const V2_BLOCKS: Record<string, unknown> = {
  choice: { type: 'choice', id: 'wahl', question: 'Welches Ziel?', options: [{ label: 'Rom', icon: '🏛️' }, { label: 'Paris' }, { label: 'Wien' }], allowOther: true },
  checklist: { type: 'checklist', id: 'einkauf', kind: 'shopping', items: [{ text: 'Milch', qty: 2, unit: 'l', category: 'Kühlregal' }, { text: 'Äpfel', checked: true }] },
  calc: loan,
  map: { type: 'map', title: 'Rom', route: true, markers: [{ lat: 41.89, lng: 12.49, title: 'Kolosseum', number: 1 }, { lat: 41.9, lng: 12.47, title: 'Pantheon', number: 2 }], basis: 'illustrative' },
  recipe: { type: 'recipe', id: 'pasta', title: 'Pasta', servings: 2, ingredients: [{ qty: 200, unit: 'g', item: 'Nudeln' }], steps: [{ text: 'Kochen', timerSeconds: 600 }], tips: ['Salzen'] },
  tabs: { type: 'tabs', tabs: [{ label: 'A', children: [{ type: 'text', text: 'hallo' }, { type: 'timer', label: 'T', seconds: 5 }] }, { label: 'B', children: [{ type: 'sources', items: [{ title: 'W', url: 'https://example.com' }] }] }] },
  accordion: { type: 'accordion', open: 0, items: [{ title: 'Frage 1', children: [{ type: 'text', text: 'Antwort' }] }] },
  quiz: { type: 'quiz', id: 'quiz1', questions: [{ q: 'Hauptstadt von Italien?', options: ['Rom', 'Mailand'], answer: 0, explanation: 'Klar.' }, { q: 'Zwei?', options: ['a', 'b', 'c'], answer: [0, 2] }] },
  flashcards: { type: 'flashcards', id: 'vok', cards: [{ front: 'casa', back: 'Haus' }, { front: 'gatto', back: 'Katze' }] },
  sources: { type: 'sources', items: [{ title: 'Wikipedia', url: 'https://de.wikipedia.org/wiki/Rom', siteName: 'Wikipedia' }, { title: 'B', url: 'https://example.org/x' }] },
  timer: { type: 'timer', id: 'eier', label: 'Eier', seconds: 420, autostart: false },
  slots: { type: 'slots', id: 'termin', slots: [{ start: '2026-10-12T09:00', end: '2026-10-12T10:00', label: 'Mo' }, { start: '2026-10-13T14:00' }], noneLabel: 'Keiner passt' },
  confirm: { type: 'confirm', id: 'ok', title: 'Fortfahren?', text: 'Das ändert Daten.', tone: 'warning' },
};

for (const [name, node] of Object.entries(V2_BLOCKS)) {
  test(`stream: ${name} survives every prefix and converges to the one-shot result`, () => {
    const md = 'Text davor.\n\n```hui\n' + JSON.stringify(node, null, 1) + '\n```\n\nDanach.';
    const full = parseMessage(md);
    const hui = full.find((sg) => sg.kind === 'hui');
    assert.ok(hui && hui.kind === 'hui');
    assert.equal(hui.error, undefined);
    assert.ok(hui.node, 'node parsed');
    assert.equal(hui.node.type, name);
    if (isInteractiveNodeType(name)) assert.equal(typeof (hui.node as A).id, 'string');
    // every prefix: no throw, node type stable once known, id stable once the explicit id is complete
    const parser = createStreamParser();
    let last: unknown;
    for (let i = 0; i < md.length; i += 7) {
      const segs = parser.push(md.slice(i, i + 7));
      for (const sg of segs) {
        if (sg.kind === 'hui' && sg.node) {
          if (sg.node.type !== name) assert.ok(name.startsWith(sg.node.type), `${sg.node.type} !~ ${name}`);
          JSON.stringify(sg.node);
        }
      }
      last = segs;
    }
    void last;
    assert.deepEqual(parser.end(), full);
  });
}

test('stream: partial v2 nodes never show half-validated data as valid (lat/lng, urls, iso)', () => {
  // partial markers (no lng yet) are skipped, not zero-filled
  const m = n(parsePartialJson('{"type":"map","markers":[{"lat":41.8,"lng":12.4,"title":"A"},{"lat":41.9')) as A;
  assert.equal(m.markers.length, 1);
  // partial url without a dotted host is not accepted as a source yet
  const s = n(parsePartialJson('{"type":"sources","items":[{"title":"x","url":"https://exa')) as A;
  assert.equal(s.items.length, 0);
  // partial ISO date in a slot is dropped
  const sl = n(parsePartialJson('{"type":"slots","slots":[{"start":"2026-10-1')) as A;
  assert.equal(sl.slots.length, 0);
  // partial quiz question without answer is not shown (it would be ungradable)
  const q = n(parsePartialJson('{"type":"quiz","questions":[{"q":"A?","options":["x","y"],"answer":0},{"q":"B?","options":["x","y"]')) as A;
  assert.equal(q.questions.length, 1);
});

test('unknown nodes nested in tabs are passed through; ids of known siblings still assigned', () => {
  const r = n({ type: 'tabs', tabs: [{ label: 'x', children: [{ type: 'hologram', foo: 1 }, { type: 'confirm', title: 'a' }] }] }, { path: 'seg-0' }) as HuiNode & A;
  assert.deepEqual(r.tabs[0].children[0], { type: 'hologram', foo: 1 });
  assert.equal(r.tabs[0].children[1].id, 'confirm-seg-0.0.1');
});
