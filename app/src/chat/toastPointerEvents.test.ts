// Toasts are overlays: their full-screen layout container must never take touches/clicks outside the visible toast
// (web: after the quick-answer hand-off the "Toast" overlay swallowed every click on the composer). React Native
// accepts `pointerEvents` as a prop or a style, but react-native-web only polyfills 'box-none'/'box-only' for the
// prop (or StyleSheet.create): an inline-style 'box-none' is written out as invalid CSS and the overlay stays clickable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('..', import.meta.url).pathname;
const require = createRequire(import.meta.url);

function* tsx(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* tsx(p);
    else if (name.endsWith('.tsx')) yield p;
  }
}

test('react-native-web: an inline-style pointerEvents "box-none" becomes invalid CSS (why the prop is required)', () => {
  const mod = require('react-native-web/dist/cjs/exports/StyleSheet');
  const resolve = (mod.default ?? mod) as (styles: unknown[]) => [string, Record<string, unknown> | null];
  const [, inline] = resolve([{ position: 'absolute', pointerEvents: 'box-none' }]);
  assert.equal(inline?.pointerEvents, 'box-none', 'kept verbatim: browsers ignore it and fall back to "auto"');
});

test('no pointerEvents inside a style object (use the prop)', () => {
  const hits: string[] = [];
  for (const file of tsx(SRC)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (/(^|[{,\s])pointerEvents\s*:/.test(line)) hits.push(`${relative(SRC, file)}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(hits, []);
});

test('every toast overlay container passes touches through (pointerEvents="box-none" prop)', () => {
  const toasts = ['chat/Toast.tsx', 'conversations/BulkDeleteToast.tsx'];
  for (const rel of toasts) {
    const src = readFileSync(join(SRC, rel), 'utf8');
    const overlay = src.split('\n').find((l) => /<View\b[^>]*StyleSheet\.absoluteFill/.test(l));
    assert.ok(overlay, `${rel}: full-screen container found`);
    assert.match(overlay, /pointerEvents="box-none"/, `${rel}: ${overlay.trim()}`);
  }
  // no toast component was added without being covered here
  const found = [...tsx(SRC)].map((f) => relative(SRC, f)).filter((f) => /Toast\.tsx$/.test(f));
  assert.deepEqual(found.sort(), [...toasts].sort());
});
