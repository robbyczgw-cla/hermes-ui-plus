/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard (E2E round 13 O4): `outlineStyle: 'none'` is a web-only style. On Android React Native logs
 * `ReactNativeJNI: Could not parse OutlineStyle:none` for every input that carries it, so it may only appear behind
 * `Platform.OS === 'web'` or through `noOutline` (webStyle.ts).
 */
const SRC = fileURLToPath(new URL('../../', import.meta.url));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

test('outlineStyle none only on web', () => {
  const bad: string[] = [];
  for (const file of sourceFiles(SRC)) {
    if (file.endsWith(join('ui', 'lib', 'webStyle.ts'))) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/outlineStyle\s*:\s*['"]none['"]/.test(line) && !/Platform\.OS\s*===\s*['"]web['"]/.test(line)) bad.push(`${file.slice(SRC.length)}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, [], 'use noOutline (ui/lib/webStyle.ts) or a Platform.OS === "web" guard');
});
