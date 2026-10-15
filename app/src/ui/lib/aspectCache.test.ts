/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASPECT_CACHE_MAX, ASPECT_KEY_MAX, clearAspects, knownAspect, rememberAspect } from './aspectCache.ts';

test('aspect cache: a decoded size is remembered per URL', () => {
  clearAspects();
  assert.equal(knownAspect('https://example.com/a.png'), undefined);
  assert.equal(rememberAspect('https://example.com/a.png', 1600, 900), 1600 / 900);
  assert.equal(knownAspect('https://example.com/a.png'), 1600 / 900);
  assert.equal(rememberAspect('https://example.com/a.png', 500, 1000), 0.5); // the newest size wins
  assert.equal(knownAspect('https://example.com/a.png'), 0.5);
  assert.equal(knownAspect(null), undefined);
});

test('aspect cache: unusable sizes and huge keys are not stored', () => {
  clearAspects();
  for (const [w, h] of [[0, 10], [10, 0], [-1, 5], [Number.NaN, 5], [Infinity, 5]]) assert.equal(rememberAspect('https://example.com/x.png', w, h), undefined);
  assert.equal(knownAspect('https://example.com/x.png'), undefined);
  const data = 'data:image/png;base64,' + 'A'.repeat(ASPECT_KEY_MAX);
  assert.equal(rememberAspect(data, 2, 1), 2); // the ratio is still returned to the caller
  assert.equal(knownAspect(data), undefined);
});

test('aspect cache: bounded, least recently used entries go first', () => {
  clearAspects();
  for (let i = 0; i < ASPECT_CACHE_MAX; i++) rememberAspect(`https://example.com/${i}.png`, i + 1, 1);
  assert.equal(knownAspect('https://example.com/0.png'), 1); // used → most recent
  rememberAspect('https://example.com/new.png', 3, 1);
  assert.equal(knownAspect('https://example.com/0.png'), 1);
  assert.equal(knownAspect('https://example.com/1.png'), undefined); // the oldest unused one was evicted
  assert.equal(knownAspect('https://example.com/new.png'), 3);
});

test('aspect cache guard: answer images and MEDIA images start at their remembered ratio', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const parts = read('../components/imageParts.tsx');
  assert.match(parts, /export function useNaturalAspect\(/);
  assert.match(parts, /knownAspect\(uri\) \?\? fallback/);
  assert.match(read('../../chat/Markdown.tsx'), /useNaturalAspect\(imgs\.length === 1 \? imgs\[0\]\.url : null\)/);
  assert.match(read('../../chat/HermesExtras.tsx'), /useNaturalAspect\(`media:\$\{file\.path\}`\)/);
});
