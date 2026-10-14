/// <reference types="node" />
// `blocks` node: aliases, limits, styles, tones, icons, streaming (docs: hermes-skill/hermes-ui/references/blocks.md)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BLOCK_COLUMNS, MAX_BLOCK_ITEMS, canonicalType, coerceRoot, normalizeBlockStyle, normalizeNode as n } from './validate.ts';
import { createStreamParser, parseMessage, TYPED_FENCE_TYPES } from './streamParser.ts';
import { guessNodeType, huiStreamView } from './streamPlaceholder.ts';
import { INTERACTIVE_NODE_TYPES, ROUTE_FORMATS, isKnownNodeType, type Segment } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = any;
type Hui = Extract<Segment, { kind: 'hui' }>;

const FULL = {
  type: 'blocks',
  id: 'vm',
  title: 'Agenten auf dem Mac',
  basis: 'illustrative',
  source: 'Herstellerangaben',
  columns: [
    { title: 'OrbStack', grid: 2, items: [{ label: 'Agent 1', icon: 'container' }, { label: 'Agent 2', icon: 'container' }], base: { label: '1 Linux-Kernel', sub: 'Gemeinsam genutzt', icon: 'terminal' } },
    { title: 'Parallels', grid: 2, items: [{ label: 'Agent 1', sub: 'Kernel 1', icon: 'vm', style: 'framed' }, { label: 'Agent 2', sub: 'Kernel 2', icon: 'vm', style: 'framed', tone: 'warn' }] },
  ],
  caption: 'Vereinfachtes Architekturmodell',
};

test('registry: blocks is a known, display-only type with a route format, a typed fence and a unique prefix', () => {
  assert.ok(isKnownNodeType('blocks'));
  assert.ok(!INTERACTIVE_NODE_TYPES.has('blocks' as never), 'display-only: no persisted state, no reply');
  assert.ok((ROUTE_FORMATS as readonly string[]).includes('blocks'));
  assert.ok(TYPED_FENCE_TYPES.has('blocks'));
  assert.equal(guessNodeType('blo'), 'blocks');
  assert.equal(guessNodeType('blocks'), 'blocks');
  assert.equal(guessNodeType('b'), undefined, 'b is ambiguous (buttons, blocks …)');
});

test('spec shape passes through unchanged (normalized)', () => {
  const out = n(FULL) as A;
  assert.deepEqual(out, FULL);
});

test('aliases: cols/groups/sides, boxes/nodes/children, shared/layer/foundation, strings, subtitle/detail, framed:true', () => {
  const a = n({
    type: 'blocks',
    cols: [
      { title: 'A', boxes: ['x', 2, { name: 'y', subtitle: 's1', framed: true }], shared: 'Kernel' },
      { label: 'B', nodes: [{ title: 'n1', detail: 'd1', outlined: true }], layer: { name: 'L', detail: 'ld' } },
      { heading: 'C', children: [{ text: 't1', style: 'Outline' }, { label: 't2', style: 'filled' }], foundation: { label: 'F', icon: 'Docker' } },
    ],
  }) as A;
  assert.deepEqual(a.columns.map((c: A) => c.title), ['A', 'B', 'C']);
  assert.deepEqual(a.columns[0].items, [{ label: 'x' }, { label: '2' }, { label: 'y', sub: 's1', style: 'framed' }]);
  assert.deepEqual(a.columns[0].base, { label: 'Kernel' });
  assert.deepEqual(a.columns[1].items, [{ label: 'n1', sub: 'd1', style: 'framed' }]);
  assert.deepEqual(a.columns[1].base, { label: 'L', sub: 'ld' });
  assert.deepEqual(a.columns[2].items, [{ label: 't1', style: 'framed' }, { label: 't2', style: 'soft' }]);
  assert.deepEqual(a.columns[2].base, { label: 'F', icon: 'container' });
  for (const k of ['groups', 'sides']) assert.equal((n({ type: 'blocks', [k]: [{ items: ['a'] }] }) as A).columns.length, 1, k);
  // a column written as a bare array, boxes at the root (one column), caption aliases
  assert.deepEqual((n({ type: 'blocks', columns: [['a', 'b']] }) as A).columns[0].items, [{ label: 'a' }, { label: 'b' }]);
  const root = n({ type: 'blocks', boxes: ['a', 'b'], shared: 'base', footnote: 'vereinfacht' }) as A;
  assert.deepEqual(root.columns, [{ items: [{ label: 'a' }, { label: 'b' }], base: { label: 'base' } }]);
  assert.equal(root.caption, 'vereinfacht');
  // type variants
  for (const t of ['blocks', 'Blocks', 'blockDiagram', 'building_blocks', 'architecture', 'architecture-diagram', 'hui:blocks']) assert.equal(canonicalType(t), 'blocks', t);
  // `block` is a wrapper key, never the blocks type
  assert.equal(canonicalType('block'), 'block');
  assert.deepEqual(coerceRoot({ block: { type: 'text', text: 'x' } }), { type: 'text', text: 'x' });
  // {"blocks":[typed nodes]} stays a document envelope
  assert.deepEqual(coerceRoot({ blocks: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), { type: 'stack', children: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] });
});

test('style, tone and grid: synonyms, defaults left to the renderer, clamping', () => {
  for (const [s, want] of [['soft', 'soft'], ['framed', 'framed'], ['outlined', 'framed'], ['Bordered', 'framed'], ['solid', 'soft'], ['sparkly', undefined]] as const) {
    assert.equal(normalizeBlockStyle({ style: s }), want, s);
  }
  assert.equal(normalizeBlockStyle({ framed: true }), 'framed');
  assert.equal(normalizeBlockStyle({ framed: false }), 'soft');
  assert.equal(normalizeBlockStyle({}), undefined);
  const out = n({ type: 'blocks', columns: [{ grid: 7, items: [{ label: 'a', tone: 'recommended' }, { label: 'b', tone: 'avoid' }, { label: 'c', tone: 'nope' }, { label: 'd' }] }, { grid: '1', items: ['x'] }, { grid: 0.2, items: ['y'] }] }) as A;
  assert.deepEqual(out.columns[0].items.map((i: A) => i.tone), ['good', 'bad', 'neutral', undefined]);
  assert.deepEqual(out.columns.map((c: A) => c.grid), [3, 1, 1]);
  assert.equal((n({ type: 'blocks', columns: [{ grid: 'abc', items: ['x'] }] }) as A).columns[0].grid, undefined);
});

test('limits: ≤ 3 columns, ≤ 12 boxes, capped text, empty columns and junk dropped', () => {
  const many = n({ type: 'blocks', columns: Array.from({ length: 5 }, (_, i) => ({ title: `c${i}`, items: Array.from({ length: 20 }, (_, j) => `b${j}`) })) }) as A;
  assert.equal(many.columns.length, MAX_BLOCK_COLUMNS);
  assert.equal(many.columns[0].items.length, MAX_BLOCK_ITEMS);
  const junk = n({ type: 'blocks', columns: [null, 'str', 3, {}, { items: [] }, { items: [null, {}, { icon: 'vm' }, '', '  ', 'ok'] }, { base: 'nur Basis' }] }) as A;
  assert.equal(junk.columns.length, 2);
  assert.deepEqual(junk.columns[0].items, [{ label: 'ok' }]);
  assert.deepEqual(junk.columns[1], { items: [], base: { label: 'nur Basis' } });
  const long = n({ type: 'blocks', title: 'T'.repeat(300), columns: [{ title: 'C'.repeat(200), items: [{ label: 'L'.repeat(200), sub: 'S\nzwei'.repeat(50) }] }], caption: 'K'.repeat(400) }) as A;
  assert.equal(long.title.length, 200);
  assert.equal(long.columns[0].title.length, 80);
  assert.equal(long.columns[0].items[0].label.length, 60);
  assert.ok(long.columns[0].items[0].sub.length <= 80 && !long.columns[0].items[0].sub.includes('\n'));
  assert.equal(long.caption.length, 200);
  assert.deepEqual((n({ type: 'blocks', columns: 'nope' }) as A).columns, []);
  // unknown icons are dropped without an error
  assert.deepEqual((n({ type: 'blocks', columns: [{ items: [{ label: 'a', icon: 'rocket' }, { label: 'b', icon: 'DB' }] }] }) as A).columns[0].items, [{ label: 'a' }, { label: 'b', icon: 'database' }]);
});

test('streaming: columns appear complete one by one, the node never falls back to a skeleton', () => {
  const text = 'Zwei Varianten:\n\n```hui\n' + JSON.stringify(FULL) + '\n```\n';
  const final = parseMessage(text).find((s): s is Hui => s.kind === 'hui')!;
  assert.ok(final.node && !final.error);
  for (const step of [1, 7, 23]) {
    const p = createStreamParser();
    let shown = false;
    let maxCols = 0;
    let partialOne = false;
    for (let i = 0; i < text.length; i += step) {
      for (const seg of p.push(text.slice(i, i + step))) {
        if (seg.kind !== 'hui') continue;
        const v = huiStreamView(seg as Hui, 'blocks');
        if (v.kind === 'skeleton') {
          assert.equal(v.shape, 'blocks');
          assert.ok(!shown, 'node fell back to a skeleton');
        }
        if (v.kind === 'node') {
          shown = true;
          const cols = ((v.node as A).columns ?? []) as A[];
          assert.ok(cols.length >= maxCols, 'columns never disappear');
          maxCols = cols.length;
          if (!seg.complete && cols.length === 1) partialOne = true;
          cols.forEach((c, k) => assert.deepEqual(c, (final.node as A).columns[k], 'a streamed column is complete'));
        }
      }
    }
    assert.ok(partialOne, 'the first column shows while the second still streams');
    assert.deepEqual(p.end(), parseMessage(text));
  }
});

test('typed ```blocks fence without "type" renders as a blocks node', () => {
  const { type: _t, ...body } = FULL;
  const segs = parseMessage('Text\n\n```blocks\n' + JSON.stringify(body) + '\n```\n');
  const hui = segs.find((s): s is Hui => s.kind === 'hui');
  assert.ok(hui?.node);
  assert.equal((hui.node as A).type, 'blocks');
  assert.equal((hui.node as A).columns.length, 2);
});
