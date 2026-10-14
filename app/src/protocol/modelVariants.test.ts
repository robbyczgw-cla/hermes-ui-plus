/// <reference types="node" />
// Model-produced variants of ```hui blocks that used to fail with
// 'Ungültiger hui-Block: erwartet ein Objekt mit "type"' (incident 2026-10-12, APK bd98b78:
// a ranked `products` list wrapped in a {"version","title","blocks"} envelope, `items`/`title`
// instead of `products`/`name`, display-string prices and plain-string specs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalType, coerceRoot, normalizeNode, readableFallback } from './validate.ts';
import { parseLenientJson, parsePartialJson, stripJsonComments } from './partialJson.ts';
import { createStreamParser, parseMessage } from './streamParser.ts';
import type { Segment } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = any;
const INCIDENT = readFileSync(new URL('./fixtures/04-products-envelope-incident.md', import.meta.url), 'utf8');
const huiSegs = (segs: Segment[]) => segs.filter((s): s is Extract<Segment, { kind: 'hui' }> => s.kind === 'hui');
const one = (text: string) => {
  const h = huiSegs(parseMessage(text));
  assert.equal(h.length, 1);
  return h[0];
};
const block = (json: string) => one('Text davor.\n\n```hui\n' + json + '\n```\n');

test('incident fixture: envelope + items/title renders as a ranked products node', () => {
  const s = one(INCIDENT);
  assert.equal(s.error, undefined);
  assert.equal(s.fallback, undefined);
  const node = s.node as A;
  assert.equal(node.type, 'products');
  assert.equal(node.ranked, true);
  assert.equal(node.title, 'Komfort für kleinere Männerhände'); // envelope title moved onto the node
  assert.equal(node.id, 'products-seg-1');
  assert.deepEqual(node.products.map((p: A) => p.name), ['Retroid Pocket Nova', 'AYANEO Pocket ACE', 'AYN Odin 2 Mini']);
  const p0 = node.products[0];
  assert.equal(p0.price, undefined);
  assert.equal(p0.priceNote, 'ca. 229–244 USD'); // display price kept, not dropped
  assert.equal(p0.badge, '2D-Sieger');
  assert.ok(p0.verdict.startsWith('Komfortabelstes'));
  assert.equal(p0.specs.length, 3);
  assert.deepEqual(p0.specs[1], { label: '', value: '4,5" 4:3 AMOLED, 1280×960, 120 Hz' }); // "4:3" is no label
  assert.equal(p0.pros.length, 3);
  assert.equal(p0.cons.length, 2);
  assert.ok(p0.url.startsWith('https://'));
});

test('incident fixture streams without errors and ends identical to the one-shot parse', () => {
  const p = createStreamParser();
  for (let i = 0; i < INCIDENT.length; i += 37) {
    const segs = p.push(INCIDENT.slice(i, i + 37));
    for (const s of huiSegs(segs)) if (s.node) assert.equal(typeof (s.node as A).type, 'string');
  }
  const end = huiSegs(p.end());
  assert.deepEqual(end[0].node, one(INCIDENT).node);
});

test('top-level array → stack of nodes; single element → the node itself', () => {
  const s = block('[{"type":"text","text":"a"},{"type":"callout","tone":"info","text":"b"}]');
  assert.equal((s.node as A).type, 'stack');
  assert.deepEqual((s.node as A).children.map((c: A) => c.type), ['text', 'callout']);
  assert.equal((block('[{"type":"text","text":"a"}]').node as A).type, 'text');
});

test('{"nodes":[…]} and other envelopes; {"node":{…}} / {"component":{…}} wrappers', () => {
  assert.equal((block('{"nodes":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}').node as A).children.length, 2);
  const titled = block('{"title":"Top","blocks":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}').node as A;
  assert.deepEqual(titled.children.map((c: A) => c.variant ?? c.text), ['title', 'a', 'b']);
  assert.equal((block('{"node":{"type":"text","text":"x"}}').node as A).text, 'x');
  assert.equal((block('{"component":{"type":"table","columns":["a"],"rows":[[1]]}}').node as A).type, 'table');
});

test('single known-type key wrapper and missing type next to a self-named list', () => {
  const a = block('{"products":{"ranked":true,"products":[{"name":"X"}]}}').node as A;
  assert.equal(a.type, 'products');
  assert.equal(a.ranked, true);
  const b = block('{"title":"Top 2","ranked":true,"products":[{"name":"X"},{"name":"Y"}]}').node as A;
  assert.equal(b.type, 'products');
  assert.equal(b.title, 'Top 2');
  assert.equal(b.products.length, 2);
  const c = block('{"places":[{"title":"Café A"}]}').node as A;
  assert.equal(c.type, 'places');
  assert.equal(c.places[0].name, 'Café A');
  const d = block('{"checklist":[{"text":"Milch"}]}').node as A;
  assert.equal(d.type, 'checklist');
  assert.equal(d.items[0].text, 'Milch');
});

test('type aliases: product / productList / ranked-products / place / Mind_Map …', () => {
  assert.equal(canonicalType('product'), 'products');
  assert.equal(canonicalType('productList'), 'products');
  assert.equal(canonicalType('products_list'), 'products');
  assert.equal(canonicalType('Product-Cards'), 'products');
  assert.equal(canonicalType('place'), 'places');
  assert.equal(canonicalType('place_list'), 'places');
  assert.equal(canonicalType('Mind_Map'), 'mindmap');
  assert.equal(canonicalType('hui:table'), 'table');
  assert.equal(canonicalType('charts'), 'chart');
  assert.equal(canonicalType('table-block'), 'table');
  // unchanged: known types, unknown names, and "tab" (prefix of "table" while streaming)
  assert.equal(canonicalType('tabs'), 'tabs');
  assert.equal(canonicalType('tab'), 'tab');
  assert.equal(canonicalType('banana'), 'banana');
  const r = normalizeNode({ type: 'ranked-products', items: [{ title: 'A' }] }) as A;
  assert.equal(r.type, 'products');
  assert.equal(r.ranked, true);
  assert.equal(r.products[0].name, 'A');
  // nested alias inside a card
  const c = normalizeNode({ type: 'card', children: [{ type: 'product', products: [{ name: 'B' }] }] }) as A;
  assert.equal(c.children[0].type, 'products');
  // interactive id keeps the canonical type prefix
  assert.equal((normalizeNode({ type: 'productList', products: [{ name: 'B' }] }, { path: 'seg-0' }) as A).id, 'products-seg-0');
});

test('product price strings: plain amounts become numbers, ranges stay a display note', () => {
  const p = (price: unknown) => (normalizeNode({ type: 'products', products: [{ name: 'X', price }] }) as A).products[0];
  assert.deepEqual([p('229 €').price, p('229 €').currency], [229, 'EUR']);
  assert.deepEqual([p('$199').price, p('$199').currency], [199, 'USD']);
  assert.equal(p('19,99').price, 19.99);
  assert.equal(p('ab ca. 366 USD').priceNote, 'ab ca. 366 USD');
  assert.equal(p('ab ca. 366 USD').price, undefined);
  assert.equal(p(-5).price, undefined);
  // explicit priceNote wins over the display string
  const q = (normalizeNode({ type: 'products', products: [{ name: 'X', price: 'ca. 300', priceNote: 'UVP' }] }) as A).products[0];
  assert.equal(q.priceNote, 'UVP');
});

test('product specs: "Label: value" strings split, other strings value-only, objects unchanged', () => {
  const specs = (normalizeNode({ type: 'products', products: [{ name: 'X', specs: ['Akku: 30 h', '255 g', { label: 'ANC', value: 'ja' }, { name: 'Gewicht', value: '250 g' }] }] }) as A).products[0].specs;
  assert.deepEqual(specs, [
    { label: 'Akku', value: '30 h' },
    { label: '', value: '255 g' },
    { label: 'ANC', value: 'ja' },
    { label: 'Gewicht', value: '250 g' },
  ]);
});

test('lenient JSON: comments, trailing commas, leading prose, several objects in one fence', () => {
  assert.equal(stripJsonComments('{"a":"http://x" /* c */, // d\n"b":1}'), '{"a":"http://x"  , \n"b":1}' /* block comment → one space (#18) */);
  assert.deepEqual(parsePartialJson('{"a":1, // note\n"b":[1,2,],}'), { a: 1, b: [1, 2] });
  const c = block('{\n  // Rangliste\n  "type": "list", "items": [{"title": "A"},],\n}');
  assert.equal((c.node as A).type, 'list');
  assert.equal(c.fallback, undefined);
  const two = block('{"type":"text","text":"a"}\n{"type":"text","text":"b"}');
  assert.deepEqual((two.node as A).children.map((x: A) => x.text), ['a', 'b']);
  const pro = block('json\n{"type":"text","text":"a"}');
  assert.equal((pro.node as A).text, 'a');
  assert.deepEqual(parseLenientJson('{"a":1},{"b":2}'), [{ a: 1 }, { b: 2 }]);
  assert.equal(parseLenientJson('kein json'), undefined);
});

test('unrenderable but readable content → readable fallback node + raw kept, never a bare error', () => {
  const s = block('{"heading":"Meine Liste","entries":[{"name":"A","pros":["gut","leicht"],"score":9},{"name":"B","note":"teuer"}]}');
  assert.equal(s.fallback, true);
  assert.ok(s.error);
  assert.ok(s.raw.includes('"entries"'));
  const n = s.node as A;
  assert.equal(n.type, 'stack');
  assert.equal(n.children[0].text, 'Meine Liste');
  const acc = n.children[1];
  assert.equal(acc.type, 'accordion');
  assert.deepEqual(acc.items.map((i: A) => i.title), ['A', 'B']);
  assert.deepEqual(acc.items[0].children.map((c: A) => c.text), ['**Pros:** gut · leicht', '**Score:** 9']);
  // plain object → card with fields
  const o = readableFallback({ title: 'T', a: 1, link: 'https://example.org/x' }) as A;
  assert.equal(o.type, 'card');
  assert.deepEqual(o.children.map((c: A) => c.text), ['**A:** 1', '**Link:** [example.org](https://example.org/x)']);
  // nothing readable → error segment (UI shows the raw block on demand)
  const e = block('42');
  assert.equal(e.node, null);
  assert.ok(e.error);
  const bad = block('{oops');
  assert.equal(bad.node, null);
  assert.match(bad.error ?? '', /Ungültiges JSON/);
});

test('coerceRoot leaves valid nodes and unrelated objects alone; never throws', () => {
  const ok = { type: 'text', text: 'x' };
  assert.equal(coerceRoot(ok), ok);
  assert.deepEqual(coerceRoot({ foo: 1 }), { foo: 1 });
  for (const v of [null, undefined, 1, 'x', [], [1, 2], { blocks: [] }, { node: 'x' }, { products: 3 }]) {
    assert.doesNotThrow(() => normalizeNode(v));
    assert.doesNotThrow(() => readableFallback(v));
  }
  // deep nesting is bounded
  let deep: A = { type: 'text', text: 'x' };
  for (let i = 0; i < 50; i++) deep = { node: deep };
  assert.doesNotThrow(() => normalizeNode(deep));
});

// E2E 2026-10 (real device, real Hermes): ONE stray `]` after the third product's `cons` array made the
// whole block "Ungültiges JSON … Unexpected character: ]" (raw data instead of product cards).
const PRODUCT = (n: number, tail: string) =>
  `{"name":"Produkt ${n}","brand":"Marke","price":${100 * n},"pros":["a","b"],"cons":["c","d"${tail}`;

test('lenient JSON: one stray `]` after a cons array (real-world shape) still renders product cards', () => {
  // `]]}` and `]],` where only one `]` belongs, in the third product
  for (const third of [PRODUCT(3, ']]}'), PRODUCT(3, ']],"badge":"Tipp"}')]) {
    const json = '{"type":"products","title":"Test","products":[' + [PRODUCT(1, ']}'), PRODUCT(2, ']}'), third].join(',') + ']}';
    assert.throws(() => JSON.parse(json));
    const s = block(json);
    const node = s.node as A;
    assert.equal(node.type, 'products', third);
    assert.equal(s.fallback, undefined);
    assert.deepEqual(node.products.map((p: A) => p.name), ['Produkt 1', 'Produkt 2', 'Produkt 3']);
    assert.deepEqual(node.products[2].cons, ['c', 'd']);
  }
});

test('lenient JSON: stray closers, wrong-kind closers, missing final closers', () => {
  // stray `]` / `}` of the wrong kind are dropped
  assert.deepEqual(parseLenientJson('{"a":["x","y"]],"b":1}'), { a: ['x', 'y'], b: 1 });
  assert.deepEqual(parseLenientJson('{"a":["x","y"]]}'), { a: ['x', 'y'] });
  assert.deepEqual(parseLenientJson('{"a":[1,2}}'), { a: [1, 2] });
  assert.deepEqual(parseLenientJson('{"a":[{"b":1}}],"c":2}'), { a: [{ b: 1 }], c: 2 });
  // stray closer after the value: the value stays one value (no second "value")
  assert.deepEqual(parseLenientJson('{"a":1}]'), { a: 1 });
  // missing final closers
  assert.deepEqual(parseLenientJson('{"a":[{"b":1},{"b":2}]'), { a: [{ b: 1 }, { b: 2 }] });
  assert.deepEqual(parseLenientJson('{"a":{"b":[1,2]'), { a: { b: [1, 2] } });
  // together with comments + trailing commas
  assert.deepEqual(parseLenientJson('{ // c\n"a":["x",]],\n"b":2,}'), { a: ['x'], b: 2 });
  // brackets inside strings are not closers
  assert.deepEqual(parseLenientJson('{"a":"]]}","b":["}"]]}'), { a: ']]}', b: ['}'] });
  // several values still split correctly, also with a stray closer in the first
  assert.deepEqual(parseLenientJson('{"a":[1]]}\n{"b":2}'), [{ a: [1] }, { b: 2 }]);
  // valid JSON is never altered (JSON.parse path) and unrepairable input stays undefined
  assert.deepEqual(parsePartialJson('{"a":["]]",{"b":[]}]}'), { a: [']]', { b: [] }] });
  assert.equal(parsePartialJson(']]'), undefined);
  assert.equal(parsePartialJson('}'), undefined);
  assert.equal(parseLenientJson(']]}'), undefined);
});
