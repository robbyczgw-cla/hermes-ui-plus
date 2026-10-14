import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRequest, candidateCount, filterCandidates, parseProviderResponse } from './providers.ts';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));

test('serper request: POST, key in header only, SafeSearch on, locale', () => {
  const r = buildRequest('serper', 'Eiffelturm', 'en', 20, 'SECRET');
  assert.equal(r.url, 'https://google.serper.dev/images');
  assert.equal(r.init.method, 'POST');
  assert.equal(r.init.headers['X-API-KEY'], 'SECRET');
  assert.deepEqual(JSON.parse(r.init.body!), { q: 'Eiffelturm', gl: 'us', hl: 'en', num: 20, safe: 'active' });
  assert.ok(!r.url.includes('SECRET'));
});

test('brave request: GET, token header, strict safesearch, locale', () => {
  const r = buildRequest('brave', 'Eiffel Turm', 'de', 12, 'SECRET');
  const u = new URL(r.url);
  assert.equal(u.origin + u.pathname, 'https://api.search.brave.com/res/v1/images/search');
  assert.equal(r.init.method, 'GET');
  assert.equal(r.init.headers['X-Subscription-Token'], 'SECRET');
  assert.equal(u.searchParams.get('q'), 'Eiffel Turm');
  assert.equal(u.searchParams.get('safesearch'), 'strict');
  assert.equal(u.searchParams.get('country'), 'DE');
  assert.equal(u.searchParams.get('search_lang'), 'de');
  assert.ok(!r.url.includes('SECRET'));
  assert.equal(buildRequest('brave', 'x', 'zh-yue', 5, 'k').url.includes('search_lang=zh'), true);
});

test('serper fixture: https only, no svg/gif, min size, dedupe, max 2 per domain, unknown size kept', () => {
  const cands = parseProviderResponse('serper', fx('serper-images-de.json'));
  assert.equal(cands.length, 11);
  const out = filterCandidates(cands, 'serper', 10);
  assert.deepEqual(out.map((r) => r.title), ['Eiffelturm bei Nacht', 'A', 'B', 'unknown size']);
  assert.equal(out[0].sourceDomain, 'reisemagazin.example');
  assert.equal(out[0].thumbnailUrl, 'https://encrypted-tbn0.gstatic.com/images?q=tbn:1');
  assert.equal(out[3].sourcePage, '');
  assert.equal(out[3].thumbnailUrl, out[3].url); // no thumbnail → full image
  assert.ok(out.every((r) => r.provider === 'serper' && r.url.startsWith('https://')));
  assert.equal(filterCandidates(cands, 'serper', 2).length, 2);
});

test('brave fixture: properties.url as image, thumbnail/placeholder fallback, filters', () => {
  const cands = parseProviderResponse('brave', fx('brave-images-de.json'));
  const out = filterCandidates(cands, 'brave', 8);
  assert.deepEqual(out.map((r) => r.url), ['https://img.paris.example/eiffel.jpg', 'https://img.b.example/x.jpg']);
  assert.equal(out[0].thumbnailUrl, 'https://imgs.search.brave.com/abc');
  assert.equal(out[0].width, 2000);
  assert.equal(out[1].thumbnailUrl, 'https://imgs.search.brave.com/ph2');
  assert.equal(out[0].sourceDomain, 'paris.example');
});

test('junk responses never throw', () => {
  for (const j of [null, 5, 'x', [], {}, { images: 3 }, { results: [null, 1, 'a'] }]) {
    assert.deepEqual(filterCandidates(parseProviderResponse('serper', j), 's', 5), []);
    assert.deepEqual(filterCandidates(parseProviderResponse('brave', j), 'b', 5), []);
  }
});

test('candidateCount matches the bridge (4x, 10..40)', () => {
  assert.deepEqual([1, 3, 5, 8, 20].map(candidateCount), [10, 12, 20, 32, 40]);
});
