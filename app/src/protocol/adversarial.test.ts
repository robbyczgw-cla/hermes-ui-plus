/// <reference types="node" />
// Regression tests for docs/reviews/gpt-parts/2-parsers-ui.md (protocol part): hostile-but-valid JSON must
// never throw out of the stream parser, legacy containers are capped, ids/field names are prototype-safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStreamParser, parseMessage } from './streamParser.ts';
import { parseLenientJson, parsePartialJson, prunePartialItems, stripJsonComments, PARTIAL_MAX_DEPTH, PRUNE_MAX_VALUES } from './partialJson.ts';
import { collectInteractiveIds, normalizeNode, MAX_CHILDREN, MAX_FORM_FIELDS, MAX_LIST_ITEMS, MAX_TREE_NODES } from './validate.ts';
import { expectBounded } from '../testing/runBounded.test.ts';
import { assertLinear } from '../testing/scaling.test.ts';

type Rec = Record<string, unknown>;
const deepArrays = (n: number) => '['.repeat(n) + ']'.repeat(n);

test('#3 deep nesting in an unused property: streaming and complete parse never throw', () => {
  const body = '{"type":"text","text":"hi","x":' + deepArrays(5000) + '}';
  const p = createStreamParser();
  const segs = p.push('```hui\n' + body);
  const open = segs.find((s) => s.kind === 'hui');
  assert.ok(open && open.kind === 'hui');
  assert.equal((open.node as Rec | null)?.text, 'hi');
  const done = parseMessage('```hui\n' + body + '\n```\n');
  assert.equal(done.length, 1);
  assert.equal(done[0].kind === 'hui' && (done[0].node as Rec | null)?.text, 'hi');
  // prune itself is depth-bounded
  assert.doesNotThrow(() => prunePartialItems(parsePartialJson('{"a":' + deepArrays(20000), { markOpen: true })));
});

test('#5 huge legacy stack: id collection does not spread, children/tree are capped', () => {
  const kids = Array.from({ length: 150_000 }, () => ({ type: 'text', text: 'a' }));
  const segs = parseMessage('```hui\n' + JSON.stringify({ type: 'stack', children: kids }) + '\n```\n');
  assert.equal(segs.length, 1);
  const node = segs[0].kind === 'hui' ? (segs[0].node as unknown as Rec) : null;
  assert.ok(node);
  assert.equal((node.children as unknown[]).length, MAX_CHILDREN);
  // collectInteractiveIds on an un-normalised huge tree (no `push(...)` argument overflow)
  const raw = { type: 'stack', children: Array.from({ length: 200_000 }, (_, i) => ({ type: 'choice', id: 'c' + i })) };
  assert.equal(collectInteractiveIds(raw).length, 200_000);
});

test('#5 total node budget across nested containers', () => {
  const card = (k: number): Rec => ({ type: 'card', children: Array.from({ length: k }, () => ({ type: 'text', text: 'x' })) });
  const tree = { type: 'stack', children: Array.from({ length: 100 }, () => card(100)) };
  let count = 0;
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    count++;
    for (const c of ((n as Rec).children as unknown[] | undefined) ?? []) walk(c);
  };
  walk(normalizeNode(tree));
  assert.ok(count <= MAX_TREE_NODES, `${count} nodes`);
});

test('#5 legacy item lists are capped before mapping', () => {
  const many = Array.from({ length: 5000 }, (_, i) => 'v' + i);
  const list = normalizeNode({ type: 'list', items: many }) as unknown as Rec;
  assert.equal((list.items as unknown[]).length, MAX_LIST_ITEMS);
  const sug = normalizeNode({ type: 'suggestions', items: many }) as unknown as Rec;
  assert.equal((sug.items as unknown[]).length, MAX_LIST_ITEMS);
  const stats = normalizeNode({ type: 'stats', items: many.map((v) => ({ label: v, value: v })) }) as unknown as Rec;
  assert.equal((stats.items as unknown[]).length, MAX_LIST_ITEMS);
  const form = normalizeNode({ type: 'form', fields: many.map((v) => ({ name: v })) }) as unknown as Rec;
  assert.equal((form.fields as unknown[]).length, MAX_FORM_FIELDS);
});

test('#5 huge stack terminates quickly (time-bounded)', async () => {
  const kids = Array.from({ length: 150_000 }, () => ({ type: 'text', text: 'a' }));
  const segs = await expectBounded<unknown[]>(new URL('./streamParser.ts', import.meta.url).href, 'parseMessage', ['```hui\n' + JSON.stringify({ type: 'stack', children: kids }) + '\n```\n'], 15000);
  assert.equal(segs.length, 1);
});

test('#9 prototype-named item ids are remapped', () => {
  const plan = normalizeNode({ type: 'studyplan', weeks: [{ days: [{ tasks: [{ id: 'constructor', text: 'a' }, { id: 'toString', text: 'b' }, { id: 'ok', text: 'c' }] }] }] }) as unknown as Rec | null;
  const json = JSON.stringify(plan);
  assert.ok(!/"id":"(constructor|toString)"/.test(json), json);
  assert.ok(json.includes('"id":"ok"'), json);
  const vocab = normalizeNode({ type: 'vocab', items: [{ id: 'constructor', term: 'a', translation: 'b' }, { id: '__proto__', term: 'c', translation: 'd' }] }) as unknown as Rec | null;
  const ids = ((vocab?.items as Rec[] | undefined) ?? []).map((i) => i.id);
  assert.ok(ids.length === 2 && ids.every((id) => typeof id === 'string' && !(id in Object.prototype) && !String(id).startsWith('__')), String(ids));
});

test('#14 form field names: prototype names remapped, duplicates made unique', () => {
  const f = normalizeNode({ type: 'form', fields: [{ name: '__proto__', label: 'A' }, { name: 'x' }, { name: 'x' }, { name: 'toString' }] }) as unknown as Rec;
  const names = (f.fields as Rec[]).map((x) => x.name as string);
  assert.equal(new Set(names).size, names.length, String(names));
  assert.ok(names.every((nm) => !(nm in Object.prototype)), String(names));
  assert.equal((f.fields as Rec[])[0].label, 'A');
  assert.equal(names[1], 'x');
});

test('#18 comments never join tokens', () => {
  assert.equal(stripJsonComments('{"value":1/* note */2}'), '{"value":1 2}');
  assert.equal(parsePartialJson('{"value":1/* note */2}'), undefined);
  assert.notDeepEqual(parseLenientJson('{"value":1/* note */2}'), { value: 12 });
  assert.deepEqual(parsePartialJson('{"a":1, /* c */ "b":2}'), { a: 1, b: 2 });
  assert.deepEqual(parsePartialJson('{"a":tr/**/ue}'), undefined);
  assert.deepEqual(parsePartialJson('{"a":1 // c\n,"b":2}'), { a: 1, b: 2 });
});

test('Astra F16: prune visits a bounded number of values for a huge extraneous field (open fence)', () => {
  const big = { type: 'text', text: 'hi', junk: Array.from({ length: 1_000_000 }, (_, i) => i) };
  let visited = 0;
  const counting = new Proxy(big.junk, { get: (t, k, r) => (typeof k === 'string' && /^\d+$/.test(k) && visited++, Reflect.get(t, k, r)) });
  const pruned = prunePartialItems({ ...big, junk: counting }) as unknown as Rec;
  assert.equal(pruned.text, 'hi');
  assert.ok(visited <= PRUNE_MAX_VALUES + 2, `${visited} values visited`);
  // and the streaming path stays usable with the same payload unclosed
  const seg = createStreamParser().push('```hui\n' + JSON.stringify(big).slice(0, -1)).find((s) => s.kind === 'hui');
  assert.ok(seg && seg.kind === 'hui' && (seg.node as Rec | null)?.text === 'hi');
});

test('lenient repair of stray/missing closers stays linear and never throws on hostile input', () => {
  const shapes: Record<string, (n: number) => string> = {
    // many stray closers inside one object
    'stray ]': (n) => '{"a":[' + '1,'.repeat(n) + '1]' + ']'.repeat(n) + ',"b":1}',
    'stray }': (n) => '{"a":[' + Array(n).fill('{"x":1}}').join(',') + ']}',
    // only openers: every one is closed at EOF
    'missing closers': (n) => '['.repeat(Math.min(n, 4000)) + '{"a":1,'.repeat(1) + '"b":[1,2',
    // alternating kinds, never matching
    'alternating': (n) => '{[}]'.repeat(Math.max(1, n >> 2)),
    // many concatenated values, each with a stray closer
    'many values': (n) => '{"a":[1]]}\n'.repeat(Math.max(1, n >> 3)),
    // brackets inside strings must not count
    'strings': (n) => '{"a":"' + ']}'.repeat(n) + '"}x',
  };
  for (const [label, build] of Object.entries(shapes)) {
    assert.doesNotThrow(() => parseLenientJson(build(20_000)), label);
    if (label === 'missing closers') continue; // depth is capped by the shape, not by size
    assertLinear('parseLenientJson ' + label, build, (x) => void parseLenientJson(x), 20_000, { maxRatio: 10 });
  }
  // the result is still the plain value (not a mangled one)
  assert.deepEqual(parseLenientJson('{"a":[1]]}'), { a: [1] });
});

test('EOF repair of deep open nesting stays linear (4k → 16k levels) and depth is capped while parsing', () => {
  assert.equal(PARTIAL_MAX_DEPTH, 200);
  // the closing suffix is built once (no slice + re-concat per level); beyond the cap the scan stops early
  assertLinear('parsePartialJson open arrays', (n) => '['.repeat(n), (x) => void parsePartialJson(x), 4_000, { maxRatio: 10 });
  assertLinear('parsePartialJson open objects (markOpen)', (n) => '{"a":'.repeat(n) + '1', (x) => void parsePartialJson(x, { markOpen: true }), 4_000, { maxRatio: 10 });
  assertLinear('parsePartialJson trailing commas', (n) => '[' + '[1,],'.repeat(n), (x) => void parsePartialJson(x), 4_000, { maxRatio: 10 });
  // malicious depth: nothing usable instead of a stall
  assert.equal(parsePartialJson('['.repeat(16_000)), undefined);
  assert.equal(parsePartialJson('['.repeat(PARTIAL_MAX_DEPTH + 1)), undefined);
  // within the cap the repair is unchanged
  let v = parsePartialJson('['.repeat(PARTIAL_MAX_DEPTH)) as unknown;
  let depth = 0;
  while (Array.isArray(v)) {
    depth++;
    v = v[0];
  }
  assert.equal(depth, PARTIAL_MAX_DEPTH);
  assert.deepEqual(parsePartialJson('{"a":{"b":[1,', { markOpen: true }), { a: { b: [1], __huiPartial: true }, __huiPartial: true });
});

test('a mismatched closer that leaves a value unbalanced does not swallow the next well-formed value', () => {
  // `}` closes nothing (the array is open) → valueEnd = -1; the following object must survive
  assert.deepEqual(parseLenientJson('{"a":[1}\n{"b":2}'), [{ a: [1] }, { b: 2 }]);
  assert.deepEqual(parseLenientJson('[1,2}\n\n{"type":"text","text":"hi"}'), [[1, 2], { type: 'text', text: 'hi' }]);
  // a plain truncated tail is still repaired as before
  assert.deepEqual(parseLenientJson('{"a":[1,2'), { a: [1, 2] });
  // hostile: many unbalanced values stay linear
  assertLinear('parseLenientJson unbalanced values', (n) => '[1}'.repeat(n) + '/', (x) => void parseLenientJson(x), 20_000, { maxRatio: 10 });
});
