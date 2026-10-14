/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNode as n } from './validate.ts';
import { createStreamParser, parseMessage } from './streamParser.ts';
import { huiStreamView, guessNodeType } from './streamPlaceholder.ts';
import { HUI_NODE_TYPES, INTERACTIVE_NODE_TYPES, ROUTE_FORMATS, isKnownNodeType } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = any;
const big = <T>(len: number, f: (i: number) => T): T[] => Array.from({ length: len }, (_, i) => f(i));
const V4 = ['summary', 'places', 'products', 'guide', 'workout', 'studyplan', 'vocab', 'mindmap'];
const V4_ROUTES = ['places', 'products', 'guide', 'workout', 'studyplan', 'vocab', 'mindmap', 'timer'];
const V4_INTERACTIVE = ['places', 'products', 'guide', 'workout', 'studyplan', 'vocab', 'mindmap'];

test('registry: v4 types known, routes exist, interactive set, no prefix clashes', () => {
  for (const t of V4) {
    assert.ok(isKnownNodeType(t), t);
    assert.equal(guessNodeType(t), t);
  }
  for (const t of V4_ROUTES) assert.ok((ROUTE_FORMATS as readonly string[]).includes(t), `route ${t}`);
  for (const t of V4_INTERACTIVE) assert.ok(INTERACTIVE_NODE_TYPES.has(t as never), t);
  assert.ok(!INTERACTIVE_NODE_TYPES.has('summary' as never));
  for (const t of HUI_NODE_TYPES) for (const u of HUI_NODE_TYPES) if (t !== u) assert.ok(!u.startsWith(t), `${t} prefix of ${u}`);
  assert.equal(new Set(HUI_NODE_TYPES).size, HUI_NODE_TYPES.length);
  assert.equal(new Set(ROUTE_FORMATS).size, ROUTE_FORMATS.length);
});

test('interactive v4 nodes always get a deterministic, unique id', () => {
  for (const t of V4_INTERACTIVE) {
    assert.equal((n({ type: t }, { path: 'seg-2' }) as A).id, `${t}-seg-2`);
    assert.equal((n({ type: t, id: ' x ' }) as A).id, 'x');
  }
});

test('unknown fields are ignored on every v4 node', () => {
  for (const t of V4) {
    const out = n({ type: t, bogus: 1, __proto__: { x: 1 } } as A) as A;
    assert.equal(out.bogus, undefined, t);
  }
});

// ───────────────────────── summary ─────────────────────────

test('summary: text, points capped 4, verdict', () => {
  const s = n({ type: 'summary', text: 'Kurz.', points: ['a', '', 'b', 'c', 'd', 'e'], verdict: ' Ja ' }) as A;
  assert.deepEqual(s, { type: 'summary', text: 'Kurz.', points: ['a', 'b', 'c', 'd'], verdict: 'Ja' });
  assert.deepEqual(n({ type: 'summary' }), { type: 'summary', text: '' });
  assert.equal((n({ type: 'summary', text: 'x', points: 'nope' }) as A).points, undefined);
});

// ───────────────────────── places ─────────────────────────

test('places: valid place, normalized fields, dropped garbage', () => {
  const p = n({
    type: 'places',
    layout: 'list',
    places: [
      {
        name: ' Trattoria Roma ',
        category: 'Italienisch',
        lat: 48.2,
        lng: 16.37,
        rating: 4.46,
        reviews: 120.4,
        price: '$$',
        openNow: true,
        hours: ['Mo 9-18', 'Di 9-18'],
        phone: '+43 660 123 456',
        website: 'https://example.com/x',
        image: 'javascript:alert(1)',
        tags: ['a', 'b'],
        extra: 1,
      },
      { category: 'no name' },
      'junk',
      { name: 'Bad', lat: 999, lng: 3, website: 'ftp://x.y', phone: 'abc', rating: 9, price: 'teuer' },
    ],
  }) as A;
  assert.equal(p.layout, 'list');
  assert.equal(p.places.length, 2);
  const a = p.places[0];
  assert.equal(a.id, 'p0');
  assert.equal(a.name, 'Trattoria Roma');
  assert.deepEqual([a.lat, a.lng], [48.2, 16.37]);
  assert.equal(a.rating, 4.5);
  assert.equal(a.reviews, 120);
  assert.equal(a.price, '€€');
  assert.equal(a.phone, '+43660123456');
  assert.equal(a.website, 'https://example.com/x');
  assert.equal(a.image, undefined);
  assert.equal(a.extra, undefined);
  const b = p.places[1];
  assert.equal(b.id, 'p3'); // original index → stable while streaming
  assert.equal(b.lat, undefined);
  assert.equal(b.lng, undefined);
  assert.equal(b.website, undefined);
  assert.equal(b.phone, undefined);
  assert.equal(b.rating, 5);
  assert.equal(b.price, undefined);
});

test('places: capped at 10, hours at 7, tags at 8; duplicate ids made unique; layout validated', () => {
  const p = n({
    type: 'places',
    layout: 'grid',
    places: big(14, (i) => ({ id: 'same', name: `P${i}`, hours: big(10, (k) => `h${k}`), tags: big(12, (k) => `t${k}`) })),
    basis: 'sourced',
    source: 'Google Maps',
  }) as A;
  assert.equal(p.layout, undefined);
  assert.equal(p.places.length, 10);
  assert.equal(new Set(p.places.map((x: A) => x.id)).size, 10);
  assert.equal(p.places[0].hours.length, 7);
  assert.equal(p.places[0].tags.length, 8);
  assert.equal(p.basis, 'sourced');
  assert.equal(p.source, 'Google Maps');
  assert.deepEqual((n({ type: 'places' }) as A).places, []);
  assert.deepEqual((n({ type: 'places', places: 'x' }) as A).places, []);
});

// ───────────────────────── products ─────────────────────────

test('products: fields, specs/pros/cons/offers caps, invalid items dropped', () => {
  const p = n({
    type: 'products',
    layout: 'grid',
    compare: true,
    products: [
      {
        name: 'Sony WH-1000XM6',
        brand: 'Sony',
        price: '249,00',
        currency: 'EUR',
        rating: 4.7,
        reviews: 900,
        badge: 'Bester Preis',
        specs: big(9, (i) => ({ label: `L${i}`, value: `V${i}` })).concat([{ label: 'x' } as A]),
        pros: big(9, (i) => `pro${i}`),
        cons: ['c'],
        offers: [
          { merchant: 'Shop A', price: 249, url: 'https://a.example.com/p' },
          { merchant: 'Shop B', price: '239,50', url: 'https://b.example.com' },
          { merchant: 'Shop C', price: 'ab 230 €', url: 'https://c.example.com' },
          { merchant: 'No url', price: 1 },
          { merchant: 'Bad url', url: 'javascript:x' },
          { price: 5, url: 'https://x.example.com' },
          { merchant: 'Shop D', url: 'https://d.example.com' },
          { merchant: 'Shop E', url: 'https://e.example.com' },
        ],
        url: 'https://sony.example.com',
      },
      { brand: 'no name' },
    ],
  }) as A;
  assert.equal(p.compare, true);
  assert.equal(p.layout, 'grid');
  assert.equal(p.products.length, 1);
  const a = p.products[0];
  assert.equal(a.price, 249);
  assert.equal(a.specs.length, 6);
  assert.equal(a.pros.length, 6);
  assert.deepEqual(a.cons, ['c']);
  assert.equal(a.offers.length, 4);
  assert.deepEqual(a.offers[1], { merchant: 'Shop B', price: 239.5, url: 'https://b.example.com' });
  assert.equal(a.offers[2].price, 'ab 230 €');
  assert.equal(a.offers[3].price, undefined);
  assert.equal(a.url, 'https://sony.example.com');
});

test('products: object specs tolerated, cap 10 products', () => {
  const p = n({ type: 'products', products: big(12, (i) => ({ name: `N${i}`, specs: { Akku: '30 h', Gewicht: '250 g' } })) }) as A;
  assert.equal(p.products.length, 10);
  assert.deepEqual(p.products[0].specs, [
    { label: 'Akku', value: '30 h' },
    { label: 'Gewicht', value: '250 g' },
  ]);
  assert.equal((n({ type: 'products', products: [{ name: 'x', price: -5, rating: -2 }] }) as A).products[0].price, undefined);
});

// ───────────────────────── timer v2 ─────────────────────────

test('timer: v1 shape unchanged (backward compatible)', () => {
  assert.deepEqual(n({ type: 'timer', id: 't', label: 'Nudeln', seconds: 600, autostart: true }), {
    type: 'timer',
    id: 't',
    label: 'Nudeln',
    seconds: 600,
    autostart: true,
  });
  assert.deepEqual(n({ type: 'timer', id: 't' }), { type: 'timer', id: 't', label: '', seconds: 0 });
  assert.equal((n({ type: 'timer', id: 't', seconds: 99999 }) as A).seconds, 86400);
});

test('timer v2: until, mode, timers (≤ 6, invalid dropped)', () => {
  const t = n({
    type: 'timer',
    id: 't',
    label: 'Silvester',
    until: '2026-12-31T23:59:00',
    mode: 'stopwatch',
    timers: [
      { label: 'A', seconds: 60 },
      { label: 'B' },
      { label: 'C', seconds: 0 },
      { label: 'D', seconds: '90' },
      'x',
      ...big(8, (i) => ({ label: `E${i}`, seconds: 10 })),
    ],
  }) as A;
  assert.equal(t.until, '2026-12-31T23:59:00');
  assert.equal(t.mode, 'stopwatch');
  assert.equal(t.timers.length, 6);
  assert.deepEqual(t.timers[0], { id: 't0', label: 'A', seconds: 60 });
  assert.equal(t.timers[1].seconds, 90);
  assert.equal(new Set(t.timers.map((x: A) => x.id)).size, 6);
  const bad = n({ type: 'timer', id: 't', until: 'morgen', mode: 'foo' }) as A;
  assert.equal(bad.until, undefined);
  assert.equal(bad.mode, undefined);
  assert.equal(bad.timers, undefined);
});

// ───────────────────────── guide ─────────────────────────

test('guide: steps normalized, capped 20, title derived, invalid dropped', () => {
  const g = n({
    type: 'guide',
    id: 'g',
    title: 'Rührei',
    intro: 'Los',
    stuckLabel: 'Hilfe',
    steps: [
      { title: 'Eier', body: '**Zwei** Eier', tip: 'frisch', warning: 'heiß', seconds: 30.4, imageQuery: 'Eier' },
      { body: 'Nur ein Text ohne Titel, der länger ist als sechzig Zeichen und dann abgeschnitten wird' },
      { title: '' },
      42,
      { title: 'Zeit', seconds: 0 },
      ...big(30, (i) => ({ title: `S${i}` })),
    ],
  }) as A;
  assert.equal(g.steps.length, 20);
  assert.equal(g.stuckLabel, 'Hilfe');
  assert.deepEqual(g.steps[0], { id: 's0', title: 'Eier', body: '**Zwei** Eier', imageQuery: 'Eier', tip: 'frisch', warning: 'heiß', seconds: 30 });
  assert.ok(g.steps[1].title.length > 0 && g.steps[1].title.length <= 60);
  assert.equal(g.steps[2].title, 'Zeit');
  assert.equal(g.steps[2].seconds, undefined);
  assert.equal(g.steps[2].body, '');
  assert.deepEqual(n({ type: 'guide', id: 'g' }), { type: 'guide', id: 'g', title: '', steps: [] });
});

// ───────────────────────── workout ─────────────────────────

test('workout: kind, exercises, reps number|string, caps', () => {
  const w = n({
    type: 'workout',
    id: 'w',
    title: 'Push',
    kind: 'strength',
    warmup: '5 min',
    cooldown: 'Dehnen',
    exercises: [
      { name: 'Kniebeuge', sets: 3, reps: '10', weight: '60 kg', restSeconds: 90, note: 'tief' },
      { name: 'Klimmzug', sets: 3, reps: '8-12' },
      { name: 'Plank', sets: 2, seconds: 45, reps: 0 },
      { name: 'Lauf', reps: 12.6, sets: 999 },
      { sets: 3 },
      ...big(30, (i) => ({ name: `E${i}` })),
    ],
  }) as A;
  assert.equal(w.kind, 'strength');
  assert.equal(w.exercises.length, 20);
  assert.equal(w.exercises[0].reps, 10);
  assert.equal(w.exercises[0].restSeconds, 90);
  assert.equal(w.exercises[1].reps, '8-12');
  assert.equal(w.exercises[2].reps, undefined);
  assert.equal(w.exercises[2].seconds, 45);
  assert.equal(w.exercises[3].reps, 13);
  assert.equal(w.exercises[3].sets, 50);
  assert.equal(w.exercises[4].name, 'E0');
  assert.equal((n({ type: 'workout', id: 'w', kind: 'yoga' }) as A).kind, undefined);
});

// ───────────────────────── studyplan ─────────────────────────

test('studyplan: weeks/days/tasks with stable ids and caps', () => {
  const s = n({
    type: 'studyplan',
    id: 'sp',
    title: 'Spanisch A1',
    goal: 'Urlaub',
    weeks: [
      {
        label: 'Woche 1',
        days: [
          { label: 'Mo', tasks: [{ text: 'Vokabeln', minutes: 20, kind: 'learn' }, 'Hören', { text: '' }, { text: 'Test', kind: 'exam' }] },
          { label: 'Di', tasks: [] },
          {},
        ],
      },
      'x',
      { label: 'Woche 3', days: big(20, (i) => ({ label: `T${i}`, tasks: big(30, (k) => ({ id: 'dup', text: `a${k}` })) })) },
    ],
  }) as A;
  assert.equal(s.weeks.length, 2);
  const [w1, w3] = s.weeks;
  assert.equal(w1.id, 'w0');
  assert.equal(w3.id, 'w2'); // original index
  assert.equal(w1.days.length, 2);
  assert.deepEqual(w1.days[0].tasks[0], { id: 't0-0-0', text: 'Vokabeln', minutes: 20, kind: 'learn' });
  assert.equal(w1.days[0].tasks[1].id, 't0-0-1');
  assert.equal(w1.days[0].tasks[2].kind, undefined);
  assert.equal(w3.days.length, 14);
  assert.equal(w3.days[0].tasks.length, 20);
  const ids = s.weeks.flatMap((w: A) => w.days.flatMap((d: A) => d.tasks.map((t: A) => t.id)));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal((n({ type: 'studyplan', id: 's' }) as A).weeks, undefined);
  assert.equal((n({ type: 'studyplan', id: 's', weeks: big(40, () => ({ label: 'W' })) }) as A).weeks.length, 26);
});

// ───────────────────────── vocab ─────────────────────────

test('vocab: lang codes, items need term + translation, cap 40', () => {
  const v = n({
    type: 'vocab',
    id: 'v',
    from: 'ES',
    to: 'Deutsch',
    mode: 'type',
    items: [
      { term: 'casa', translation: 'Haus', example: 'Mi casa', romanization: 'x' },
      { term: 'solo' },
      { translation: 'nur' },
      ...big(50, (i) => ({ term: `t${i}`, translation: `u${i}` })),
    ],
  }) as A;
  assert.equal(v.from, 'es');
  assert.equal(v.to, 'und');
  assert.equal(v.mode, 'type');
  assert.equal(v.items.length, 40);
  assert.deepEqual(v.items[0], { id: 'v0', term: 'casa', translation: 'Haus', example: 'Mi casa', romanization: 'x' });
  assert.equal(v.items[1].id, 'v3');
  assert.equal((n({ type: 'vocab', id: 'v', mode: 'hard' }) as A).mode, undefined);
  assert.deepEqual((n({ type: 'vocab', id: 'v' }) as A).items, []);
});

// ───────────────────────── mindmap ─────────────────────────

test('mindmap: tree normalized, depth ≤ 4, ≤ 60 nodes, bad nodes dropped with subtree', () => {
  const m = n({
    type: 'mindmap',
    id: 'm1',
    title: 'Plan',
    root: {
      label: 'Wurzel',
      note: 'n',
      children: [{ label: 'A', children: [{ label: 'A1' }, { note: 'no label', children: [{ label: 'lost' }] }] }, 'x', { label: 'B' }],
    },
  }) as A;
  assert.equal(m.root.id, 'm');
  assert.deepEqual(
    m.root.children.map((c: A) => c.id),
    ['m-0', 'm-2'],
  );
  assert.equal(m.root.children[0].children.length, 1);
  assert.equal(m.root.children[0].children[0].id, 'm-0-0');

  // depth: root = 0, levels 1..4 allowed
  const chain = (d: number): A => ({ label: `L${d}`, children: d < 8 ? [chain(d + 1)] : undefined });
  const deep = n({ type: 'mindmap', id: 'm', root: chain(0) }) as A;
  let depth = 0;
  for (let cur = deep.root; cur.children?.length; cur = cur.children[0]) depth++;
  assert.equal(depth, 4);

  // node cap
  const wide = n({ type: 'mindmap', id: 'm', root: { label: 'R', children: big(10, (i) => ({ label: `c${i}`, children: big(10, (k) => ({ label: `g${i}-${k}` })) })) } }) as A;
  const count = (x: A): number => 1 + (x.children ?? []).reduce((s: number, c: A) => s + count(c), 0);
  assert.equal(count(wide.root), 60);

  // duplicate explicit ids made unique
  const dup = n({ type: 'mindmap', id: 'm', root: { id: 'a', label: 'R', children: [{ id: 'a', label: 'X' }, { id: 'a', label: 'Y' }] } }) as A;
  assert.equal(new Set([dup.root.id, ...dup.root.children.map((c: A) => c.id)]).size, 3);

  // streaming: no root yet → empty root slot
  assert.deepEqual((n({ type: 'mindmap', id: 'm' }) as A).root, { id: 'm', label: '' });
  assert.deepEqual((n({ type: 'mindmap', id: 'm', root: 'x' }) as A).root, { id: 'm', label: '' });
});

// ───────────────────────── streaming ─────────────────────────

function view(prefix: string, route: string | null = null) {
  const seg = createStreamParser().push('```hui\n' + prefix).find((x) => x.kind === 'hui');
  assert.ok(seg && seg.kind === 'hui');
  return huiStreamView(seg, route);
}

test('streaming: partial type string -> skeleton of the unique v4 type', () => {
  for (const t of V4) {
    for (let k = 1; k < t.length; k++) assert.equal(view(`{"type":"${t.slice(0, k)}`).kind, 'skeleton', `${t}/${k}`);
  }
  assert.deepEqual(view('{"type":"summ'), { kind: 'skeleton', shape: 'summary' });
  assert.deepEqual(view('{"type":"pla'), { kind: 'skeleton', shape: 'places' });
  assert.deepEqual(view('{"type":"mind'), { kind: 'skeleton', shape: 'mindmap' });
  assert.deepEqual(view('', 'places'), { kind: 'skeleton', shape: 'places' });
});

test('streaming: open items are hidden until complete, arrays keep filling in', () => {
  const stages = ['{"type":"places","id":"p","places":[{"name":"A","rating":4', '{"type":"places","id":"p","places":[{"name":"A","rating":4.5},{"name":"B'];
  const counts = stages.map((raw) => {
    const v = view(raw);
    assert.equal(v.kind, 'node');
    return ((v as A).node.places as A[]).map((p) => p.name);
  });
  assert.deepEqual(counts[0], []);
  assert.deepEqual(counts[1], ['A']);
  // mindmap root children appear one by one
  const v = view('{"type":"mindmap","id":"m","root":{"label":"R","children":[{"label":"A"},{"label":"B"');
  assert.equal(v.kind, 'node');
  assert.deepEqual((v as A).node.root.children.map((c: A) => c.label), ['A']);
});

test('full messages round-trip through parseMessage for every v4 node', () => {
  const nodes = [
    { type: 'summary', text: 'T' },
    { type: 'places', id: 'p', places: [{ name: 'A' }] },
    { type: 'products', id: 'q', products: [{ name: 'A' }] },
    { type: 'timer', id: 't', label: 'x', seconds: 5, timers: [{ label: 'a', seconds: 5 }] },
    { type: 'guide', id: 'g', title: 'G', steps: [{ title: 'a' }] },
    { type: 'workout', id: 'w', title: 'W', exercises: [{ name: 'a' }] },
    { type: 'studyplan', id: 's', title: 'S', weeks: [{ label: 'W', days: [] }] },
    { type: 'vocab', id: 'v', from: 'es', to: 'de', items: [{ term: 'a', translation: 'b' }] },
    { type: 'mindmap', id: 'm', root: { label: 'R' } },
  ];
  const segs = parseMessage(nodes.map((x) => '```hui\n' + JSON.stringify(x) + '\n```\n').join('\n'));
  const hui = segs.filter((s) => s.kind === 'hui');
  assert.equal(hui.length, nodes.length);
  hui.forEach((s, i) => {
    assert.ok(s.kind === 'hui' && s.complete && s.node, String(i));
    assert.equal((s as A).node.type, nodes[i].type);
  });
});

test('products: ranked flag, verdict and category scores', () => {
  const p = n({
    type: 'products',
    ranked: true,
    products: [
      { name: 'A', verdict: '  Beste Ergonomie  ', scores: [{ label: 'Ergonomie', value: 9 }, { label: '2D', value: 12 }, { label: '3D', value: -1 }, { label: '', value: 5 }, { label: 'Akku', value: 'x' }, { label: 'Display', value: 7.25 }, { label: 'Preis', value: 6 }, { label: 'Extra', value: 1 }] },
      { name: 'B', scores: { Ergonomie: 8, '2D': 9 } },
      { name: 'C', scores: [] },
    ],
  }) as A;
  assert.equal(p.ranked, true);
  assert.equal(p.products[0].verdict, 'Beste Ergonomie');
  assert.deepEqual(p.products[0].scores, [
    { label: 'Ergonomie', value: 9 },
    { label: '2D', value: 10 },
    { label: '3D', value: 0 },
    { label: 'Display', value: 7.3 },
    { label: 'Preis', value: 6 },
  ]);
  assert.deepEqual(p.products[1].scores, [{ label: 'Ergonomie', value: 8 }, { label: '2D', value: 9 }]);
  assert.equal(p.products[2].scores, undefined);
  assert.equal((n({ type: 'products', ranked: 'yes', products: [{ name: 'x' }] }) as A).ranked, undefined);
});
