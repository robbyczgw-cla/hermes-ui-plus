import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeNode } from '../../../../protocol/validate.ts';
import { BLOCK_MIN_BOX, BLOCK_MIN_COLUMN, blocksLayout, boxA11yLabel, boxColorKeys, defaultGrid, layoutScale, readBlocks, rowsOf } from './blocksModel.ts';
import { BLOCKS_HUI_SETUP_EN, BLOCKS_MAC_VM_DE, BLOCKS_PARTIAL, BLOCKS_RUNTIME_DE, BLOCKS_SAMPLES } from './samples.ts';

test('readBlocks: raw and alias input through the protocol validator, defaults filled in, garbage → no columns', () => {
  const m = readBlocks(BLOCKS_MAC_VM_DE);
  assert.equal(m.columns.length, 2);
  assert.deepEqual(m.columns.map((c) => c.title), ['OrbStack', 'VMPal / Parallels']);
  assert.deepEqual(m.columns[0].items[0], { label: 'Agent 1', sub: undefined, icon: 'container', style: 'soft', tone: 'neutral' });
  assert.deepEqual(m.columns[0].base, { label: '1 Linux-Kernel', sub: 'Gemeinsam genutzt', icon: 'terminal' });
  assert.deepEqual(m.columns[1].items.map((b) => [b.style, b.sub]), [['framed', 'Kernel 1'], ['framed', 'Kernel 2'], ['framed', 'Kernel 3'], ['framed', 'Kernel 4']]);
  assert.ok(m.caption?.startsWith('Vereinfachtes Architekturmodell'));
  const r = readBlocks(BLOCKS_RUNTIME_DE);
  assert.equal(r.basis, 'illustrative');
  assert.deepEqual(r.columns.map((c) => c.grid), [1, 3, 2], 'default grid for 1 and 2 boxes, explicit 3');
  assert.deepEqual(r.columns[2].items[0], { label: 'Gast-Linux', sub: 'eigener Kernel', icon: undefined, style: 'framed', tone: 'warn' });
  assert.deepEqual(r.columns[2].base, { label: 'Hypervisor', icon: 'vm' });
  for (const junk of [null, undefined, 'x', 3, [], { type: 'blocks', columns: [{}] }]) assert.deepEqual(readBlocks(junk).columns, []);
});

test('defaultGrid: 1 box → 1, 3 or 9 boxes → 3, else 2', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9, 12].map(defaultGrid), [1, 1, 2, 3, 2, 2, 2, 3, 2]);
});

test('layout: phone stacks the columns, tablet / desktop puts them side by side', () => {
  const cols = readBlocks(BLOCKS_MAC_VM_DE).columns;
  // phone (~360 dp screen → ~300 dp inside the card)
  const phone = blocksLayout(300, cols, 1);
  assert.equal(phone.sideBySide, false);
  assert.equal(phone.columnWidth, 300);
  assert.deepEqual(phone.perRow, [2, 2]);
  // tablet / desktop
  const wide = blocksLayout(640, cols, 1);
  assert.equal(wide.sideBySide, true);
  assert.equal(wide.columnWidth, (640 - 16) / 2);
  assert.deepEqual(wide.perRow, [2, 2]);
  // the side-by-side threshold scales with the font
  const edge = 2 * BLOCK_MIN_COLUMN + 16;
  assert.equal(blocksLayout(edge, cols, 1).sideBySide, true);
  assert.equal(blocksLayout(edge, cols, 1.3).sideBySide, false);
  // not measured yet → stacked, grid as given, flexible box width
  assert.deepEqual(blocksLayout(0, cols), { sideBySide: false, columnWidth: 0, perRow: [2, 2], boxWidth: [0, 0] });
  // one column never goes "side by side"
  assert.equal(blocksLayout(900, cols.slice(0, 1)).sideBySide, false);
});

test('layout: a 3-grid drops to 2 when boxes would be narrower than ~90 dp (more at a larger font scale)', () => {
  const three = [{ grid: 3 as const, items: Array.from({ length: 6 }, (_, i) => ({ label: `b${i}`, style: 'soft' as const, tone: 'neutral' as const })) }];
  // 3 × 90 + 2 × 8 = 286 dp fits three at scale 1
  assert.deepEqual(blocksLayout(286, three, 1).perRow, [3]);
  assert.deepEqual(blocksLayout(285, three, 1).perRow, [2]);
  // font scale 1.3: 3 boxes need 3 × 117 + 16 = 367 dp → a phone gets 2 per row
  assert.deepEqual(blocksLayout(300, three, 1.3).perRow, [2]);
  assert.ok(blocksLayout(300, three, 1.3).boxWidth[0] >= BLOCK_MIN_BOX * 1.3);
  // very narrow → one per row; never more per row than boxes
  assert.deepEqual(blocksLayout(150, three, 1).perRow, [1]);
  assert.deepEqual(blocksLayout(600, [{ grid: 3, items: three[0].items.slice(0, 2) }]).perRow, [2]);
  // every box keeps the minimum width wherever it is laid out
  for (const w of [240, 300, 360, 412, 600, 720]) {
    for (const s of [1, 1.15, 1.3]) {
      const l = blocksLayout(w, readBlocks(BLOCKS_RUNTIME_DE).columns, s);
      l.perRow.forEach((k, i) => {
        if (k > 1) assert.ok(l.boxWidth[i] >= BLOCK_MIN_BOX * s - 1, `w=${w} s=${s} col=${i}`);
      });
    }
  }
});

test('layoutScale: app font size × OS font scale, clamped to 1..1.6', () => {
  assert.equal(layoutScale(1, 1), 1);
  assert.equal(layoutScale(0.9, 1), 1);
  assert.equal(layoutScale(1.25, 1.04), 1.3);
  assert.equal(layoutScale(1.25, 2), 1.6);
  assert.equal(layoutScale(NaN, 0), 1);
});

test('rowsOf: rows of n, last row shorter', () => {
  assert.deepEqual(rowsOf([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(rowsOf([1, 2], 3), [[1, 2]]);
  assert.deepEqual(rowsOf([], 2), []);
  assert.deepEqual(rowsOf([1, 2], 0), [[1], [2]]);
});

test('accessibility label per box and base: "Agent 1, Kernel 1"', () => {
  const m = readBlocks(BLOCKS_MAC_VM_DE);
  assert.equal(boxA11yLabel(m.columns[1].items[0]), 'Agent 1, Kernel 1');
  assert.equal(boxA11yLabel(m.columns[0].items[0]), 'Agent 1');
  assert.equal(boxA11yLabel(m.columns[0].base!), '1 Linux-Kernel, Gemeinsam genutzt');
});

test('box colors: soft fills (stronger grey in dark themes), framed outlines, tone tints', () => {
  assert.deepEqual(boxColorKeys('soft', 'neutral', false), { bg: 'surfaceAlt', border: null, icon: 'muted' });
  assert.deepEqual(boxColorKeys('soft', 'neutral', true), { bg: 'surfacePressed', border: null, icon: 'muted' });
  assert.deepEqual(boxColorKeys('soft', 'good', true), { bg: 'successSoft', border: null, icon: 'success' });
  assert.deepEqual(boxColorKeys('framed', 'neutral', false), { bg: null, border: 'borderStrong', icon: 'muted' });
  assert.deepEqual(boxColorKeys('framed', 'warn', false), { bg: null, border: 'warning', icon: 'warning' });
  assert.deepEqual(boxColorKeys('framed', 'bad', true), { bg: null, border: 'danger', icon: 'danger' });
});

test('gallery: blocks section is mounted and its samples (de + en, aliases, streaming) are valid', () => {
  const section = readFileSync(new URL('./GallerySectionE1.tsx', import.meta.url), 'utf8');
  assert.match(section, /samples=\{BLOCKS_SAMPLES\}/);
  for (const s of [BLOCKS_MAC_VM_DE, BLOCKS_HUI_SETUP_EN, BLOCKS_RUNTIME_DE, BLOCKS_PARTIAL]) assert.ok(BLOCKS_SAMPLES.some((x) => x.node === s));
  assert.ok(BLOCKS_SAMPLES.some((x) => x.streaming));
  for (const s of [BLOCKS_MAC_VM_DE, BLOCKS_HUI_SETUP_EN, BLOCKS_RUNTIME_DE]) {
    const out = normalizeNode(s) as unknown as { type: string; columns: { items: unknown[] }[]; caption?: string };
    assert.equal(out.type, 'blocks');
    assert.ok(out.columns.length >= 1 && out.columns.length <= 3, s.id);
    for (const c of out.columns) assert.ok(c.items.length >= 1 && c.items.length <= 12, s.id);
    assert.ok(out.caption, `${s.id}: caption`);
  }
  // the English setup example: three apps, then bridge + agent on "Your server"
  const setup = readBlocks(BLOCKS_HUI_SETUP_EN);
  assert.deepEqual(setup.columns[0].items.map((b) => b.label), ['Phone app', 'Web app', 'Mac app']);
  assert.deepEqual(setup.columns[1].items.map((b) => b.label), ['UI-Bridge', 'Hermes Agent']);
  assert.equal(setup.columns[1].base?.label, 'Your server');
});

test('the renderer is registered, display-only and only uses theme tokens (no raw colors)', () => {
  const reg = readFileSync(new URL('../registryE1.ts', import.meta.url), 'utf8');
  assert.match(reg, /blocks: Blocks/);
  const src = readFileSync(new URL('./Blocks.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'raw color');
  assert.doesNotMatch(src, /useSend|useNodeState/, 'display-only');
  assert.match(src, /accessibilityLabel=\{boxA11yLabel\(box\)\}/);
  assert.match(src, /accessibilityLabel=\{boxA11yLabel\(base\)\}/);
});
