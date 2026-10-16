/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Older answers mount their action row in a deferred render (MessageItem.tsx, docs/PERF.md): about half of an answer's
 * mount time while a long chat scrolls. Source guard (no React renderer in node:test): the deferral keys on `isLast`
 * (the newest answer shows its row at once) and the placeholder keeps the row's height, so nothing shifts.
 */
const src = readFileSync(new URL('./MessageItem.tsx', import.meta.url), 'utf8');

test('action row: deferred for older answers only (initial value = isLast)', () => {
  assert.match(src, /const rowReady = useDeferredValue\(true, isLast\);/);
  assert.match(src, /&& !rowReady \? \(\s*<View style=\{styles\.actionsRow\}>\s*<View style=\{styles\.rowPlaceholder\} \/>/);
});

test('action row: the placeholder is exactly one icon button high (padding + icon + padding)', () => {
  const pad = Number(/iconBtn: \{ padding: (\d+)/.exec(src)?.[1]);
  const icons = [...src.matchAll(/<Icon name=\{(?:icon|copied \? 'check' : 'copy')\} size=\{(\d+)\}/g)].map((m) => Number(m[1]));
  const height = Number(/rowPlaceholder: \{ height: (\d+) \}/.exec(src)?.[1]);
  assert.ok(pad > 0 && icons.length >= 2 && height > 0, 'styles / icon sizes found');
  for (const size of icons) assert.equal(height, 2 * pad + size, `placeholder ${height} vs button ${2 * pad + size}`);
});
