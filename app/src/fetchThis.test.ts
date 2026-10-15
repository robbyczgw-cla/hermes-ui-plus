// A fetch stored on an object and called as `o.fetch(...)` gets `o` as its `this`. On web (and so in the desktop apps,
// which embed the web build) that fetch is the browser's own, which throws "Illegal invocation" unless `this` is the
// window; callers usually swallow the error, so the feature silently stays off (⚡ quick answers did). Injected fetches
// must be called as plain functions (`const doFetch = o.fetch; doFetch(...)`), and the app wiring passes arrow wrappers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('.', import.meta.url).pathname;
// not an HTTP fetch: a page loader callback (conversations/hermesSync.ts passes an arrow)
const EXEMPT = new Set(['conversations/sessionPaging.ts']);

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield p;
  }
}

test('no fetch is called as a method (`x.fetch(...)`, `x?.fetch(...)`)', () => {
  const hits: string[] = [];
  for (const file of sources(SRC)) {
    const rel = relative(SRC, file);
    if (EXEMPT.has(rel)) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (/[\w$)\]]\??\.fetch\s*\(/.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(hits, []);
});

test('no bare expo/fetch is handed to an options object (`fetch: expoFetch`)', () => {
  const hits: string[] = [];
  for (const file of sources(SRC)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/(^|[{,])\s*fetch\s*:\s*(expoFetch|globalThis\.fetch|window\.fetch|fetch)\b(?!\s*\()/.test(line)) hits.push(`${relative(SRC, file)}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(hits, []);
});
