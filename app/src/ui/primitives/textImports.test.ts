/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * React Native has no app-wide default font, so a <Text> / <TextInput> straight from 'react-native' renders in the
 * platform font (Roboto, SF, the browser's stack) instead of Atkinson Hyperlegible Next. Import them from
 * ui/primitives/Text. Exceptions style their font themselves.
 */
const SRC = fileURLToPath(new URL('../../', import.meta.url));
const ALLOWED = new Set(['ui/primitives/Text.tsx', 'ui/components/CountUpValue.tsx']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'node_modules' ? [] : files(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

test('Text / TextInput come from ui/primitives/Text (the app font), not from react-native', () => {
  const bad: string[] = [];
  for (const f of files(SRC)) {
    const rel = relative(SRC, f).split('\\').join('/');
    if (ALLOWED.has(rel)) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(/import\s*\{([^}]*)\}\s*from\s*'react-native';/g)) {
      const names = m[1].split(',').map((n) => n.trim());
      if (names.includes('Text') || names.includes('TextInput')) bad.push(rel);
    }
  }
  assert.deepEqual(bad, []);
});
