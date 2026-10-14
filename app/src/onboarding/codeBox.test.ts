/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codeBoxLines, skillInstallCommand } from './model.ts';

// E2E round 5, N4: "cp -r hermes-skill/hermes-ui ~/.hermes/skills/" was cut at the right edge of a 1080 px phone
// (horizontal ScrollView without indicator → no hint that there is more). Short shell commands wrap instead.
const UI = readFileSync(fileURLToPath(new URL('./ui.tsx', import.meta.url)), 'utf8');
const codeBoxSrc = UI.slice(UI.indexOf('export function CodeBox'), UI.indexOf('\n}\n', UI.indexOf('export function CodeBox')));

test('CodeBox: code lines wrap (no hidden horizontal scroll), copy keeps the original text', () => {
  assert.ok(codeBoxSrc.length > 0, 'CodeBox found');
  assert.doesNotMatch(codeBoxSrc, /<ScrollView[^>]*horizontal/, 'no horizontal scroller that cuts lines off');
  assert.match(codeBoxSrc, /codeBoxLines\(code\)/, 'renders one wrapping text per command line');
  assert.match(codeBoxSrc, /Clipboard\.setStringAsync\(code\)/, 'copy button copies the unchanged command');
});

test('codeBoxLines: one entry per command line, trailing blank lines dropped', () => {
  assert.deepEqual(codeBoxLines(skillInstallCommand(null)), ['mkdir -p ~/.hermes/skills', 'cp -r hermes-skill/hermes-ui ~/.hermes/skills/']);
  assert.deepEqual(codeBoxLines('a\r\nb\n\n'), ['a', 'b']);
  assert.deepEqual(codeBoxLines('npx x setup'), ['npx x setup']);
  assert.deepEqual(codeBoxLines('a\n\nb'), ['a', '', 'b'], 'blank lines inside a script stay');
});
