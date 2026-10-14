/// <reference types="node" />
// createPartialJsonParser must return exactly what parsePartialJson returns, for every prefix of a growing text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createPartialJsonParser, parsePartialJson } from './partialJson.ts';

function rng(seed: number) {
  let s = seed;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32;
}

/** feeds every prefix of `text` (in steps of 1..maxStep chars) to one incremental parser, compares with the full parse */
function checkGrowing(text: string, r: () => number, maxStep: number, label: string) {
  for (const markOpen of [true, false]) {
    const inc = createPartialJsonParser({ markOpen });
    for (let i = 1; i <= text.length; i += 1 + Math.floor(r() * maxStep)) {
      const raw = text.slice(0, i);
      assert.deepStrictEqual(inc(raw), parsePartialJson(raw, { markOpen }), `${label} markOpen=${markOpen} prefix ${JSON.stringify(raw)}`);
    }
    assert.deepStrictEqual(inc(text), parsePartialJson(text, { markOpen }), `${label} full`);
  }
}

const TOKENS = [
  '{', '}', '[', ']', ',', ':', ' ', '\n', '\t', '"key"', '"val ue"', '"a\\"b"', '"\\u00e9"', '"\\u12"', '"x\\', '"http://example.com/a//b"',
  '1', '-2.5e3', '0.', '1e', '-', 'true', 'tru', 'nul', 'null', 'false', '/', '//c\n', '/*c*/', '/*', '\u0001', '"ctl\u0001"',
  '"\\\u0001"', '"\\u000\u0001"', 'junk', '"', '\\', '[]', '{}', '\u00a0', '"__huiPartial"', '"type"',
];

test('incremental partial JSON equals parsePartialJson on random token soups (every prefix)', () => {
  const r = rng(3);
  for (let k = 0; k < 1500; k++) {
    let text = r() < 0.7 ? (r() < 0.5 ? '{' : '[') : '';
    const n = 1 + Math.floor(r() * 30);
    for (let i = 0; i < n; i++) text += TOKENS[Math.floor(r() * TOKENS.length)];
    checkGrowing(text, r, 3, `soup ${k}`);
  }
});

function randomValue(r: () => number, depth: number): unknown {
  const x = r();
  if (depth > 4 || x < 0.3) {
    const y = r();
    if (y < 0.3) return Math.round((r() - 0.5) * 1e4) / 100;
    if (y < 0.4) return r() < 0.5;
    if (y < 0.45) return null;
    return ['Café', 'a "quoted" word', 'https://example.com/x?y=1', 'tab\there', 'line\nbreak', '', 'ü€😀', 'back\\slash'][Math.floor(r() * 8)];
  }
  if (x < 0.6) return Array.from({ length: Math.floor(r() * 5) }, () => randomValue(r, depth + 1));
  const o: Record<string, unknown> = {};
  for (let i = Math.floor(r() * 5); i > 0; i--) o[['type', 'title', 'items', 'rows', 'id', 'label', 'url', 'price'][Math.floor(r() * 8)] + (r() < 0.3 ? i : '')] = randomValue(r, depth + 1);
  return o;
}

test('incremental partial JSON equals parsePartialJson on streamed JSON documents (compact / pretty / prose after)', () => {
  const r = rng(9);
  for (let k = 0; k < 300; k++) {
    const v = { type: 'list', items: randomValue(r, 0) };
    const text = JSON.stringify(v, null, k % 3 === 0 ? undefined : k % 3) + (k % 5 === 0 ? '\n\nand some prose' : '');
    checkGrowing(text, r, 7, `doc ${k}`);
  }
});

test('incremental partial JSON: the hui blocks of the protocol fixtures, and unrelated / shrinking texts restart', () => {
  const dir = new URL('./fixtures/', import.meta.url);
  const r = rng(1);
  for (const f of readdirSync(dir)) {
    const md = readFileSync(new URL(f, dir), 'utf8');
    for (const m of md.matchAll(/```hui\n([\s\S]*?)\n```/g)) checkGrowing(m[1], r, 5, f);
  }
  const inc = createPartialJsonParser({ markOpen: true });
  for (const raw of ['{"a":[1,2', '{"a":[1,2,3', '{"b":', '  [1', 'x {"a":1', '{"a":1}', '{"a":1} junk', '{"a":1', '// c\n{"a":1', '{"a":/*x*/1']) {
    assert.deepStrictEqual(inc(raw), parsePartialJson(raw, { markOpen: true }), raw);
  }
});
