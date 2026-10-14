/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createImageResolver, ImageResolveError, type ResolverOptions } from './resolver.ts';
import type { FetchLike, KeyValueStorage } from './types.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const json = (body: string, status = 200, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  text: async () => body,
});

/** Serves recorded fixtures by request shape; logs every URL. */
function fixtureFetch(log: string[]): FetchLike {
  return async (url) => {
    log.push(url);
    const u = new URL(url);
    const p = u.searchParams;
    assert.equal(p.get('origin'), '*');
    if (u.host === 'commons.wikimedia.org') {
      const q = p.get('gsrsearch') ?? '';
      if (/iphone 17/i.test(q)) return json(fx('commons-search-iphone17.json'));
      if (/pixel 10/i.test(q)) return json(fx('commons-search-pixel10.json'));
      return json('{"batchcomplete":true}');
    }
    if (p.get('prop') === 'imageinfo') return json(fx('wiki-imageinfo-de.json'));
    if (p.get('generator') === 'search') {
      const q = p.get('gsrsearch') ?? '';
      if (u.host === 'de.wikipedia.org' && q === 'iPhone 17') return json(fx('wiki-search-de-iphone17.json'));
      if (u.host === 'de.wikipedia.org' && q === 'Pixel 10') return json(fx('wiki-search-de-pixel10.json'));
      return json('{"batchcomplete":true}');
    }
    if (p.get('titles')) return json(fx(u.host === 'en.wikipedia.org' ? 'wiki-titles-en.json' : 'wiki-titles-de.json'));
    return json('{}', 404);
  };
}

const mk = (o: Partial<ResolverOptions> & { fetch: FetchLike }) => createImageResolver({ batchWindowMs: 5, storage: null, ...o });

test('Rome trip: 6 well-named queries → 2 batched requests, photos + attribution', async () => {
  const log: string[] = [];
  const r = mk({ fetch: fixtureFetch(log), headers: { 'Api-User-Agent': 'HermesUI/0.1 (personal app)' } });
  const qs = ['Kolosseum', 'Trevi-Brunnen', 'Pantheon (Rom)', 'Petersdom', 'Hund', 'Tiramisu'];
  const res = await Promise.all(qs.map((q) => r.resolve(q)));
  assert.equal(log.length, 2, log.join('\n'));
  assert.match(decodeURIComponent(log[0]), /titles=Kolosseum\|Trevi-Brunnen\|Pantheon \(Rom\)\|Petersdom\|Hund\|Tiramisu/);
  for (const [i, img] of res.entries()) {
    assert.ok(img, qs[i]);
    assert.match(img!.url, /^https:\/\/[a-z.]*wikimedia\.org\//);
    // small originals are served unscaled (no /thumb/ path) → thumbUrl = url
    assert.ok(/\/330px-/.test(img!.thumbUrl) || img!.thumbUrl === img!.url, img!.thumbUrl);
    assert.ok(img!.width > 0 && img!.height > 0);
    assert.ok(img!.attribution.license, `${qs[i]} license`);
    assert.match(img!.attribution.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  }
  assert.equal(res[0]!.title, 'Kolosseum');
  assert.equal(res[0]!.attribution.author, 'FeaturedPics');
  assert.equal(res[4]!.title, 'Haushund'); // redirect followed
});

test('fallback chain for products: dewiki SVG → search → enwiki → Commons photo', async () => {
  const log: string[] = [];
  const r = mk({ fetch: fixtureFetch(log) });
  const [ip, px] = await Promise.all([r.resolve('iPhone 17'), r.resolve('Pixel 10')]);
  assert.equal(ip?.attribution.provider, 'commons');
  assert.match(ip!.title, /iPhone 17/);
  assert.equal(ip!.attribution.license, 'CC0');
  assert.match(px!.title, /Pixel 10/);
  const hosts = log.map((u) => new URL(u).host + ':' + (new URL(u).searchParams.get('generator') ?? 'titles'));
  assert.deepEqual(hosts, [
    'de.wikipedia.org:titles', // A (both queries in one request)
    'de.wikipedia.org:search', // B
    'de.wikipedia.org:search',
    'en.wikipedia.org:titles', // C (batched)
    'commons.wikimedia.org:search', // D
    'commons.wikimedia.org:search',
  ]);
});

test('miss is cached as null; dedup of concurrent identical queries; cache hits need no request', async () => {
  const log: string[] = [];
  const r = mk({ fetch: fixtureFetch(log) });
  const [a, b] = await Promise.all([r.resolve('Galaxy S25 Ultra Phantom'), r.resolve('galaxy s25 ultra phantom')]);
  assert.equal(a, null);
  assert.equal(b, null);
  const n = log.length;
  assert.equal(r.peek('Galaxy S25 Ultra Phantom'), null);
  assert.equal(await r.resolve('Galaxy S25 Ultra Phantom'), null);
  const k1 = await r.resolve('Kolosseum');
  const k2 = await r.resolve('  Kolosseum ');
  assert.equal(k1, k2);
  assert.equal(log.length, n + 2);
  assert.equal(r.peek('Unbekannt'), undefined);
  assert.ok(r.stats().cacheHits >= 2);
});

test('hostile lang never reaches the hostname; empty query → null without requests', async () => {
  const log: string[] = [];
  const r = mk({ fetch: fixtureFetch(log) });
  await r.resolve('Kolosseum', 'evil.com/x?');
  assert.ok(log.every((u) => /^https:\/\/(de|en)\.wikipedia\.org\/|^https:\/\/commons\.wikimedia\.org\//.test(u)), log.join('\n'));
  const n = log.length;
  assert.equal(await r.resolve('   '), null);
  assert.equal(log.length, n);
});

test('429 → rejects (not cached) and pauses all requests for Retry-After', async () => {
  let t = 0;
  let calls = 0;
  const r = mk({
    now: () => t,
    fetch: async () => {
      calls++;
      return json(fx('ratelimit-response.txt'), 429, { 'retry-after': '20' });
    },
  });
  await assert.rejects(r.resolve('Kolosseum'), (e: unknown) => e instanceof ImageResolveError && e.kind === 'rate-limited');
  assert.equal(calls, 1);
  assert.equal(r.peek('Kolosseum'), undefined); // transient → not cached
  await assert.rejects(r.resolve('Petersdom'), (e: unknown) => e instanceof ImageResolveError && e.kind === 'rate-limited');
  assert.equal(calls, 1); // paused: no request sent
  t = 21_000;
  await assert.rejects(r.resolve('Petersdom'));
  assert.equal(calls, 2);
});

test('non-JSON 200 body and timeouts reject cleanly', async () => {
  const r1 = mk({ fetch: async () => json('<html>oops</html>') });
  await assert.rejects(r1.resolve('X'), (e: unknown) => e instanceof ImageResolveError && e.kind === 'parse');
  const r2 = mk({ timeoutMs: 30, fetch: () => new Promise(() => {}) });
  await assert.rejects(r2.resolve('X'), (e: unknown) => e instanceof ImageResolveError && e.kind === 'timeout');
});

test('imageinfo failure is non-fatal: image kept without author/license', async () => {
  const log: string[] = [];
  const base = fixtureFetch(log);
  const r = mk({
    fetch: async (url, init) => (new URL(url).searchParams.get('prop') === 'imageinfo' ? json('{}', 500) : base(url, init)),
  });
  const img = await r.resolve('Kolosseum');
  assert.ok(img);
  assert.equal(img!.attribution.license, undefined);
  assert.equal(img!.attribution.sourceUrl, 'https://de.wikipedia.org/wiki/File:Colosseo_2020.jpg');
});

test('concurrency limit: never more than 3 requests in flight', async () => {
  let active = 0;
  let peak = 0;
  const r = mk({
    concurrency: 3,
    fetch: async (url) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((res) => setTimeout(res, 5));
      active--;
      return json(new URL(url).searchParams.get('generator') ? '{"batchcomplete":true}' : '{"query":{"pages":[]}}');
    },
  });
  const res = await Promise.all(Array.from({ length: 10 }, (_, i) => r.resolve(`Unbekanntes Ding ${i}`)));
  assert.ok(res.every((x) => x === null));
  assert.ok(peak <= 3 && peak >= 2, `peak ${peak}`);
});

test('persistence: cache written to storage and hydrated by a fresh resolver (validated)', async () => {
  const mem = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: async (k) => mem.get(k) ?? null,
    setItem: async (k, v) => void mem.set(k, v),
  };
  const log: string[] = [];
  const r1 = mk({ fetch: fixtureFetch(log), storage, saveDelayMs: 1 });
  const img = await r1.resolve('Kolosseum');
  await new Promise((res) => setTimeout(res, 20));
  const saved = JSON.parse(mem.get('hermesui.images.v1')!);
  assert.equal(saved.v, 1);
  // tamper: a non-Wikimedia URL in storage must be ignored on load
  saved.entries.push(['de|evil', { ...img, url: 'https://evil.example/x.jpg' }, Date.now() + 1e9]);
  mem.set('hermesui.images.v1', JSON.stringify(saved));
  const n = log.length;
  const r2 = mk({ fetch: fixtureFetch(log), storage });
  assert.deepEqual(await r2.resolve('Kolosseum'), img);
  assert.equal(log.length, n); // served from persisted cache
  assert.equal(r2.peek('evil'), undefined);
  // corrupt storage → starts empty, no throw
  mem.set('hermesui.images.v1', '{not json');
  const r3 = mk({ fetch: fixtureFetch(log), storage });
  assert.ok(await r3.resolve('Kolosseum'));
});

test('warm(): persisted hits AND known misses answer peek() synchronously (restored cards collapse before first paint)', async () => {
  const mem = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: async (k) => mem.get(k) ?? null,
    setItem: async (k, v) => void mem.set(k, v),
  };
  const log: string[] = [];
  const r1 = mk({ fetch: fixtureFetch(log), storage, saveDelayMs: 1 });
  const img = await r1.resolve('Kolosseum');
  assert.equal(await r1.resolve('Unbekanntes Ding 1'), null);
  await new Promise((res) => setTimeout(res, 20));
  const r2 = mk({ fetch: fixtureFetch(log), storage });
  assert.equal(r2.peek('Kolosseum'), undefined); // not hydrated yet
  await r2.warm();
  assert.deepEqual(r2.peek('Kolosseum'), img);
  assert.equal(r2.peek('Unbekanntes Ding 1'), null); // known miss
  assert.equal(r2.peek('Noch nie gesucht'), undefined);
});
