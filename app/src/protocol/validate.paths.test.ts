/// <reference types="node" />
// `paths` node: aliases, limits, tones, icons, ids, streaming (docs: hermes-skill/hermes-ui/references/paths.md)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PATH_NODES, MAX_PATHS_ITEMS, canonicalType, normalizeNode as n, normalizePathIcon, normalizePathTone } from './validate.ts';
import { createStreamParser, parseMessage, TYPED_FENCE_TYPES } from './streamParser.ts';
import { guessNodeType, huiStreamView } from './streamPlaceholder.ts';
import { HUI_PATH_ICONS, INTERACTIVE_NODE_TYPES, ROUTE_FORMATS, isKnownNodeType, type Segment } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = any;
type Hui = Extract<Segment, { kind: 'hui' }>;

const FULL = {
  type: 'paths',
  id: 'dateien',
  title: 'Wo liegen die Dateien?',
  basis: 'estimate',
  source: 'Erfahrungswerte',
  select: true,
  items: [
    { id: 'nativ', title: 'Nativ', badge: { text: 'Ausgangsbasis', tone: 'neutral' }, path: [{ label: 'macOS', icon: 'laptop' }, { label: 'APFS', icon: 'disk', detail: 'Snapshots' }], note: 'Schnell.' },
    { id: 'vm', title: 'VM-Disk', badge: { text: 'Vermeiden', tone: 'bad' }, path: [{ label: 'macOS' }, { label: 'VM', icon: 'vm' }, { label: 'ext4' }] },
  ],
};

test('registry: paths is a known, interactive type with a route format, a typed fence and no prefix clash', () => {
  assert.ok(isKnownNodeType('paths'));
  assert.ok(INTERACTIVE_NODE_TYPES.has('paths'));
  assert.ok((ROUTE_FORMATS as readonly string[]).includes('paths'));
  assert.ok(TYPED_FENCE_TYPES.has('paths'));
  assert.equal(guessNodeType('pat'), 'paths');
  assert.equal(guessNodeType('paths'), 'paths');
});

test('spec shape passes through unchanged (normalized)', () => {
  const out = n(FULL) as A;
  assert.equal(out.type, 'paths');
  assert.equal(out.id, 'dateien');
  assert.equal(out.title, 'Wo liegen die Dateien?');
  assert.equal(out.basis, 'estimate');
  assert.equal(out.source, 'Erfahrungswerte');
  assert.equal(out.select, true);
  assert.deepEqual(out.items[0], { id: 'nativ', title: 'Nativ', badge: { text: 'Ausgangsbasis', tone: 'neutral' }, path: [{ label: 'macOS', icon: 'laptop' }, { label: 'APFS', icon: 'disk', detail: 'Snapshots' }], note: 'Schnell.' });
  assert.deepEqual(out.items[1].path, [{ label: 'macOS' }, { label: 'VM', icon: 'vm' }, { label: 'ext4' }]);
});

test('aliases: rows/options for items, steps/nodes/chain for path, strings, title/label/name', () => {
  const rows = n({ type: 'paths', rows: [{ label: 'A', steps: ['x', 'y'] }, { name: 'B', nodes: [{ name: 'n1' }, { title: 't2' }, { text: 't3' }] }, { title: 'C', chain: ['c1'] }] }) as A;
  assert.deepEqual(rows.items.map((i: A) => i.title), ['A', 'B', 'C']);
  assert.deepEqual(rows.items[0].path, [{ label: 'x' }, { label: 'y' }]);
  assert.deepEqual(rows.items[1].path, [{ label: 'n1' }, { label: 't2' }, { label: 't3' }]);
  assert.deepEqual(rows.items[2].path, [{ label: 'c1' }]);
  const opts = n({ type: 'paths', options: [{ title: 'O', flow: ['a'] }] }) as A;
  assert.equal(opts.items[0].title, 'O');
  // one "A → B → C" string (also -> / =>)
  const str = n({ type: 'paths', items: [{ title: 'S', path: 'macOS → APFS -> SSD => Backup' }] }) as A;
  assert.deepEqual(str.items[0].path.map((p: A) => p.label), ['macOS', 'APFS', 'SSD', 'Backup']);
  // description → note, untyped root {"paths":[…]} and type variants
  assert.equal((n({ type: 'paths', items: [{ title: 'D', path: [], description: 'Notiz' }] }) as A).items[0].note, 'Notiz');
  assert.equal((n({ paths: [{ title: 'x', path: ['a'] }] }) as A).type, 'paths');
  for (const t of ['path', 'Paths', 'path-list', 'pathComparison']) assert.equal(canonicalType(t), 'paths', t);
  // selectable as alias for select
  assert.equal((n({ type: 'paths', selectable: true, items: [] }) as A).select, true);
});

test('badge: plain string → neutral, tone synonyms, item-level tone, unknown tone → neutral', () => {
  const out = n({
    type: 'paths',
    items: [
      { title: 'a', badge: 'Ausgangsbasis' },
      { title: 'b', badge: 'Interessant', tone: 'recommended' },
      { title: 'c', badge: { text: 'Vermeiden', tone: 'avoid' } },
      { title: 'd', badge: { label: 'Vorsicht', tone: 'caution' } },
      { title: 'e', badge: { text: 'x', tone: 'sparkly' } },
      { title: 'f', badge: { tone: 'good' } },
      { title: 'g', verdict: 'OK', tone: 'positive' },
    ],
  }) as A;
  assert.deepEqual(out.items.slice(0, 5).map((i: A) => i.badge), [
    { text: 'Ausgangsbasis', tone: 'neutral' },
    { text: 'Interessant', tone: 'good' },
    { text: 'Vermeiden', tone: 'bad' },
    { text: 'Vorsicht', tone: 'warn' },
    { text: 'x', tone: 'neutral' },
  ]);
  assert.equal(out.items[5].badge, undefined, 'badge without text is dropped');
  // MAX_PATHS_ITEMS = 6 → the 7th row is cut
  assert.equal(out.items.length, MAX_PATHS_ITEMS);
  for (const [w, tone] of [['good', 'good'], ['positive', 'good'], ['OK', 'good'], ['Recommended', 'good'], ['bad', 'bad'], ['Avoid', 'bad'], ['negative', 'bad'], ['warn', 'warn'], ['warning', 'warn'], ['caution', 'warn'], ['neutral', 'neutral'], ['', 'neutral'], ['constructor', 'neutral']] as const) {
    assert.equal(normalizePathTone(w), tone, w);
  }
  assert.equal(normalizePathTone(3), 'neutral');
});

test('limits: ≤ 6 rows, ≤ 6 nodes, capped text, rows without title dropped, junk ignored', () => {
  const many = n({ type: 'paths', items: Array.from({ length: 9 }, (_, i) => ({ title: `r${i}`, path: Array.from({ length: 9 }, (_, j) => `n${j}`) })) }) as A;
  assert.equal(many.items.length, MAX_PATHS_ITEMS);
  assert.equal(many.items[0].path.length, MAX_PATH_NODES);
  const junk = n({ type: 'paths', items: [null, 'str', 3, { path: ['x'] }, { title: '  ' }, { title: 'ok', path: [null, {}, { icon: 'disk' }, '', 'y'] }] }) as A;
  assert.equal(junk.items.length, 1);
  assert.deepEqual(junk.items[0].path, [{ label: 'y' }]);
  const long = n({ type: 'paths', items: [{ title: 'T'.repeat(300), path: ['L'.repeat(200)], note: 'N\nzwei'.repeat(100), badge: 'B'.repeat(99) }] }) as A;
  assert.equal(long.items[0].title.length, 120);
  assert.equal(long.items[0].path[0].label.length, 60);
  assert.equal(long.items[0].badge.text.length, 40);
  assert.ok(!long.items[0].note.includes('\n') && long.items[0].note.length <= 200, 'note is one line');
  assert.equal((n({ type: 'paths', items: 'nope' }) as A).items.length, 0);
});

test('icons: fixed set, synonyms and emoji mapped, unknown dropped (no crash)', () => {
  for (const i of HUI_PATH_ICONS) assert.equal(normalizePathIcon(i), i);
  assert.equal(normalizePathIcon('macOS'), 'laptop');
  assert.equal(normalizePathIcon('Virtual-Machine'), 'vm');
  assert.equal(normalizePathIcon('docker'), 'container');
  assert.equal(normalizePathIcon('📁'), 'folder');
  assert.equal(normalizePathIcon('shared_folder'), 'folder');
  for (const bad of ['rocket', '', 'constructor', '__proto__', 'toString', 42, null]) assert.equal(normalizePathIcon(bad), undefined, String(bad));
  const out = n({ type: 'paths', items: [{ title: 't', path: [{ label: 'a', icon: 'rocket' }, { label: 'b', icon: 'DB' }] }] }) as A;
  assert.deepEqual(out.items[0].path, [{ label: 'a' }, { label: 'b', icon: 'database' }]);
});

test('ids: node id fallback, unique row ids (explicit or p<index>)', () => {
  assert.equal((n({ type: 'paths', items: [] }, { path: 'seg-2' }) as A).id, 'paths-seg-2');
  const out = n({ type: 'paths', items: [{ id: 'a', title: 'x' }, { id: 'a', title: 'y' }, { title: 'z' }, { id: 'constructor', title: 'w' }] }) as A;
  assert.deepEqual(out.items.map((i: A) => i.id), ['a', 'p1', 'p2', 'p3']);
});

test('streaming: rows appear complete one by one, the node never falls back to a skeleton', () => {
  const text = 'Drei Wege:\n\n```hui\n' + JSON.stringify(FULL) + '\n```\n';
  const final = parseMessage(text).find((s): s is Hui => s.kind === 'hui')!;
  assert.ok(final.node && !final.error);
  for (const step of [1, 5, 17]) {
    const p = createStreamParser();
    let shown = false;
    let maxRows = 0;
    for (let i = 0; i < text.length; i += step) {
      for (const seg of p.push(text.slice(i, i + step))) {
        if (seg.kind !== 'hui') continue;
        const v = huiStreamView(seg as Hui, 'paths');
        if (!seg.complete) assert.ok(v.kind === 'node' || v.kind === 'skeleton');
        if (v.kind === 'skeleton') {
          assert.equal(v.shape, 'paths');
          assert.ok(!shown, 'node fell back to a skeleton');
        }
        if (v.kind === 'node') {
          shown = true;
          const items = ((v.node as A).items ?? []) as A[];
          assert.ok(items.length >= maxRows, 'rows never disappear');
          maxRows = items.length;
          items.forEach((it, k) => assert.deepEqual(it, (final.node as A).items[k], 'a streamed row is complete'));
        }
      }
    }
    assert.deepEqual(p.end(), parseMessage(text));
  }
});

test('typed ```paths fence without "type" renders as a paths node', () => {
  const { type: _t, ...body } = FULL;
  const segs = parseMessage('Text\n\n```paths\n' + JSON.stringify(body) + '\n```\n');
  const hui = segs.find((s): s is Hui => s.kind === 'hui');
  assert.ok(hui?.node);
  assert.equal((hui.node as A).type, 'paths');
  assert.equal((hui.node as A).items.length, 2);
});
