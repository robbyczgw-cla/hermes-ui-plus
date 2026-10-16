// Text must use `accentText`, not `accent` (a custom accent is only held to 3:1 as fill / icon / border).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** `color` keys that are not text: chart legend swatches, Leaflet polylines, theme math */
const ALLOW = new Set(['ui/components/ChartV3.tsx', 'ui/components/modules/b/mapTemplate.ts', 'ui/themes.ts']);
// HText `color="accent"` is mapped to accentText by resolveColor; a raw `color:` style key is not
const TEXT_ACCENT = /(?<![A-Za-z])color:[^\n]*\.accent\b(?!Text|Soft)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

test('no text colour uses the plain accent (use accentText)', () => {
  const bad: string[] = [];
  for (const f of walk(SRC)) {
    const rel = path.relative(SRC, f).split(path.sep).join('/');
    if (ALLOW.has(rel)) continue;
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (TEXT_ACCENT.test(l)) bad.push(`${rel}:${i + 1} ${l.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(bad, []);
  assert.ok(TEXT_ACCENT.test('x { color: t.colors.accent }'));
  assert.ok(!TEXT_ACCENT.test('x { color: t.colors.accentText }'));
});
