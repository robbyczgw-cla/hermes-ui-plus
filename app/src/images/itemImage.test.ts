import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { addressCity, directImage, createSearchQueue, peekItemImage, placeImageQuery, planItemImage, productImageQuery, resolveItemImage } from './itemImage.ts';
import { imageLoadDecision, isTrustedImageUrl, markTrustedImageUrl, proxiedImagesAutoLoad, resetImageTrustForTests, setUnknownImagePolicy, unlockImageUrl } from './trust.ts';
import { bridgeConnFromProfiles } from './webProfiles.ts';
import { chainWebSources, combineImageSources, createWebImageSearch } from './webCore.ts';
import type { ResolvedImage } from './types.ts';

const img = (u: string, provider: 'wikipedia' | 'web' = 'web'): ResolvedImage => ({ url: u, thumbUrl: u, width: 800, height: 600, title: '', attribution: { sourceUrl: u, provider } });
const SHOP = 'https://media.aliteq.com/products/xm5.jpg';
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => resetImageTrustForTests());

test('query derivation: products brand + name, places name + city + category', () => {
  assert.equal(productImageQuery({ brand: 'Sony', name: 'WH-1000XM5' }), 'Sony WH-1000XM5');
  assert.equal(productImageQuery({ brand: 'Sony', name: 'Sony WH-1000XM5' }), 'Sony WH-1000XM5');
  assert.equal(productImageQuery({ name: '  Steam   Deck OLED ' }), 'Steam Deck OLED');
  assert.equal(productImageQuery({ brand: 'Valve', name: '' }), 'Valve');
  assert.equal(productImageQuery({}), undefined);

  assert.equal(addressCity('Via dei Fori Imperiali 1, 00184 Roma RM, Italien'), 'Roma');
  assert.equal(addressCity('1 Main St, Springfield, IL 62701'), 'Springfield');
  assert.equal(addressCity('Kärntner Str. 38, 1010 Wien'), 'Wien');
  assert.equal(addressCity('221B Baker St, London NW1 6XE, UK'), 'London');
  assert.equal(addressCity('Hauptstraße 5'), '');
  assert.equal(addressCity(undefined), '');

  assert.equal(placeImageQuery({ name: 'Café Sacher', address: 'Philharmoniker Str. 4, 1010 Wien', category: 'Café' }), 'Café Sacher Wien');
  assert.equal(placeImageQuery({ name: 'Trattoria Da Enzo', address: 'Via dei Vascellari 29, 00153 Roma RM, Italien', category: 'Restaurant' }), 'Trattoria Da Enzo Roma Restaurant');
  assert.equal(placeImageQuery({ name: 'Wien Museum', address: 'Karlsplatz 8, 1040 Wien' }), 'Wien Museum');
  assert.equal(placeImageQuery({ address: 'x' }), undefined);
});

test('plan: trusted image first; untrusted image → queries, kept only as tap-to-load', () => {
  const wiki = 'https://upload.wikimedia.org/a.jpg';
  assert.deepEqual(planItemImage({ image: wiki, imageQuery: 'Q', autoQuery: 'A' }, imageLoadDecision), { direct: wiki, queries: [] });
  assert.deepEqual(planItemImage({ image: SHOP, imageQuery: 'Sony WH-1000XM5', autoQuery: 'sony  wh-1000xm5' }, imageLoadDecision), {
    queries: [{ query: 'Sony WH-1000XM5', step: 'query' }], // auto query deduplicated (case/space-insensitive)
    askUrl: SHOP,
  });
  assert.deepEqual(planItemImage({ image: SHOP, autoQuery: 'Sony WH-1000XM5' }, imageLoadDecision).queries, [{ query: 'Sony WH-1000XM5', step: 'auto' }]);
  // Settings → Bilder laden: never → no searches, only the fallbacks
  assert.deepEqual(planItemImage({ image: SHOP, imageQuery: 'Q' }, imageLoadDecision, { searchAllowed: false }), { queries: [], askUrl: SHOP });
  assert.deepEqual(planItemImage({ image: 'not a url', imageQuery: 'Q' }, imageLoadDecision), { queries: [{ query: 'Q', step: 'query' }] });
});

test('"Immer laden" (and a session unlock) makes any model URL step 1', () => {
  setUnknownImagePolicy('always');
  assert.deepEqual(planItemImage({ image: SHOP, imageQuery: 'Q' }, imageLoadDecision), { direct: SHOP, queries: [] });
  setUnknownImagePolicy('bridge');
  assert.equal(planItemImage({ image: SHOP, imageQuery: 'Q' }, imageLoadDecision).direct, undefined);
  unlockImageUrl(SHOP);
  assert.equal(planItemImage({ image: SHOP, imageQuery: 'Q' }, imageLoadDecision).direct, SHOP);
});

test('bridge image proxy: answer URL goes through the proxy first (any host), failure falls back to the queries', async () => {
  const proxy = (u: string) => `https://bridge.example.com/bridge/img?u=${encodeURIComponent(u)}`;
  const plan = planItemImage({ image: SHOP, imageQuery: 'Sony WH-1000XM5', autoQuery: 'Sony WH-1000XM5 Kopfhörer' }, imageLoadDecision, { proxy });
  assert.deepEqual(plan, { direct: proxy(SHOP), directSource: SHOP, queries: [] });
  const r = await resolveItemImage(plan, async () => img('https://unused.example/x.jpg'), false);
  assert.equal(r.kind, 'image');
  if (r.kind === 'image') {
    assert.equal(r.step, 'direct');
    assert.equal(r.image.url, proxy(SHOP));
    assert.equal(r.image.attribution.sourceUrl, SHOP); // credit points at the original, not the bridge
  }
  assert.deepEqual(peekItemImage(plan, () => undefined, false), r); // synchronous: counts as a photo at once
  // proxy refuses (null) → today's policy: untrusted URL stays tap-to-load, queries run
  assert.deepEqual(planItemImage({ image: SHOP, imageQuery: 'Q' }, imageLoadDecision, { proxy: () => null }), { queries: [{ query: 'Q', step: 'query' }], askUrl: SHOP });
  // the card dropped the failed answer URL → plain query chain (imageQuery → Wikipedia/web → calm fallback)
  assert.deepEqual(planItemImage({ imageQuery: 'Q', autoQuery: 'A' }, imageLoadDecision, { proxy }), { queries: [{ query: 'Q', step: 'query' }, { query: 'A', step: 'auto' }] });
  // no proxy option (images switched off): unchanged behaviour
  assert.deepEqual(planItemImage({ image: SHOP }, imageLoadDecision, { searchAllowed: false }), { queries: [], askUrl: SHOP });
});

test('"Erst nach Tippen": proxied answer images wait for a tap too; after the tap they still go through the bridge', () => {
  const proxy = (u: string) => `https://bridge.example.com/bridge/img?u=${encodeURIComponent(u)}`;
  // default ("Über Bridge automatisch"): proxied images load at once
  assert.equal(proxiedImagesAutoLoad(), true);
  setUnknownImagePolicy('tap');
  assert.equal(proxiedImagesAutoLoad(), false);
  const opts = { proxy, proxyAuto: proxiedImagesAutoLoad() };
  assert.deepEqual(planItemImage({ image: SHOP, imageQuery: 'Q' }, imageLoadDecision, opts), { queries: [{ query: 'Q', step: 'query' }], askUrl: SHOP });
  // the tap unlocks the answer URL → loads through the proxy (the site still never sees the phone)
  unlockImageUrl(SHOP);
  assert.deepEqual(planItemImage({ image: SHOP, imageQuery: 'Q' }, imageLoadDecision, opts), { direct: proxy(SHOP), directSource: SHOP, queries: [] });
  // "Immer laden": proxied where possible
  setUnknownImagePolicy('always');
  assert.equal(proxiedImagesAutoLoad(), true);
  assert.equal(planItemImage({ image: 'https://other.example.org/p.jpg' }, imageLoadDecision, { proxy, proxyAuto: true }).direct, proxy('https://other.example.org/p.jpg'));
});

test('resolver order: imageQuery → auto query → tap-to-load (detail only) → icon; errors fall through', async () => {
  const calls: string[] = [];
  const results: Record<string, ResolvedImage | null | Error> = {};
  const search = async (q: string) => {
    calls.push(q);
    const r = results[q];
    if (r instanceof Error) throw r;
    return r ?? null;
  };
  const plan = planItemImage({ image: SHOP, imageQuery: 'Sony WH-1000XM5 Kopfhörer', autoQuery: 'Sony WH-1000XM5' }, imageLoadDecision);

  results['Sony WH-1000XM5 Kopfhörer'] = img('https://cdn.search/q.jpg');
  let r = await resolveItemImage(plan, search, false);
  assert.equal(r.kind === 'image' && r.step, 'query');
  assert.deepEqual(calls, ['Sony WH-1000XM5 Kopfhörer']);

  calls.length = 0;
  results['Sony WH-1000XM5 Kopfhörer'] = new Error('timeout');
  results['Sony WH-1000XM5'] = img('https://cdn.search/auto.jpg');
  r = await resolveItemImage(plan, search, false);
  assert.equal(r.kind === 'image' && r.step, 'auto');
  assert.equal(r.kind === 'image' && r.image.url, 'https://cdn.search/auto.jpg');
  assert.deepEqual(calls, ['Sony WH-1000XM5 Kopfhörer', 'Sony WH-1000XM5']);

  results['Sony WH-1000XM5'] = null;
  assert.deepEqual(await resolveItemImage(plan, search, true), { kind: 'ask', url: SHOP }); // detail sheet
  assert.deepEqual(await resolveItemImage(plan, search, false), { kind: 'icon' }); // compact rows / cards
  assert.deepEqual(await resolveItemImage(planItemImage({}, imageLoadDecision), search, true), { kind: 'icon' });

  // direct: no search at all
  calls.length = 0;
  setUnknownImagePolicy('always');
  r = await resolveItemImage(planItemImage({ image: SHOP, imageQuery: 'x' }, imageLoadDecision), search, false);
  assert.equal(r.kind === 'image' && r.step, 'direct');
  assert.deepEqual(calls, []);
});

test('peek: cache answers synchronously; unknown query → undefined (search needed)', () => {
  const plan = planItemImage({ image: SHOP, imageQuery: 'A', autoQuery: 'B' }, imageLoadDecision);
  assert.equal(peekItemImage(plan, () => undefined, false), undefined);
  assert.equal(peekItemImage(plan, (q) => (q === 'A' ? null : undefined), false), undefined);
  const hit = peekItemImage(plan, (q) => (q === 'A' ? null : img('https://x.example/b.jpg')), false);
  assert.equal(hit?.kind === 'image' && hit.step, 'auto');
  assert.deepEqual(peekItemImage(plan, () => null, true), { kind: 'ask', url: SHOP });
});

test('search queue: max 3 concurrent, identical queries deduplicated', async () => {
  const q = createSearchQueue(3);
  let running = 0;
  let peak = 0;
  const started: string[] = [];
  const gates = new Map<string, () => void>();
  const task = (k: string) => () =>
    new Promise<string>((res) => {
      running++;
      peak = Math.max(peak, running);
      started.push(k);
      gates.set(k, () => {
        running--;
        res(k);
      });
    });
  const keys = Array.from({ length: 10 }, (_, i) => `q${i}`);
  const ps = keys.map((k) => q.run(k, task(k)));
  const dup = q.run('Q0', task('dup')); // same query (case-insensitive) while running → shared
  await flush();
  assert.deepEqual(started, ['q0', 'q1', 'q2']);
  assert.deepEqual(q.stats(), { active: 3, queued: 7 });
  for (const k of keys) {
    while (!gates.has(k)) await flush();
    gates.get(k)!();
  }
  assert.deepEqual(await Promise.all(ps), keys);
  assert.equal(await dup, 'q0');
  assert.equal(peak, 3);
  assert.equal(started.includes('dup'), false);
  assert.deepEqual(q.stats(), { active: 0, queued: 0 });
});

test('Hermes bridge profile: auto query goes through the bridge web image search (trusted result)', async () => {
  const log: string[] = [];
  const web = createWebImageSearch({
    fetch: async (url, init) => {
      log.push(`${url}|${init?.headers?.Authorization ?? ''}`);
      return { ok: true, status: 200, json: async () => ({ results: [{ url: 'https://images.example/xm5.jpg', thumbnailUrl: 'https://images.example/xm5-t.jpg', width: 1200, height: 900, title: 'XM5', sourcePage: 'https://shop.example/xm5', sourceDomain: 'shop.example' }] }) };
    },
  });
  const conn = bridgeConnFromProfiles([{ id: 'h', kind: 'hermes', bridge: true, baseUrl: 'https://hermes-host.example/v1', apiKey: 'tok' }], 'h');
  assert.ok(conn);
  web.setConn(conn);
  const wikiCalls: string[] = [];
  const wiki = { peek: () => undefined, resolve: async (q: string) => (wikiCalls.push(q), null) };
  const combined = combineImageSources(wiki, chainWebSources(() => [web]));
  const queue = createSearchQueue(3);
  // same wiring as useItemImage: preferWeb, results marked trusted
  const search = (q: string) =>
    queue.run(q, () =>
      combined.resolve(q, undefined, true).then((r) => {
        if (r) markTrustedImageUrl(r.url, r.thumbUrl);
        return r;
      }),
    );

  const plan = planItemImage({ image: SHOP, autoQuery: productImageQuery({ brand: 'Sony', name: 'WH-1000XM5' }) }, imageLoadDecision);
  const [a, b] = await Promise.all([resolveItemImage(plan, search, false), resolveItemImage(plan, search, false)]);
  assert.equal(a.kind === 'image' && a.image.url, 'https://images.example/xm5.jpg');
  assert.deepEqual(a, b);
  assert.deepEqual(log, ['https://hermes-host.example/bridge/images?q=Sony%20WH-1000XM5&n=5&lang=de|Bearer tok']); // one request for both
  assert.deepEqual(wikiCalls, []);
  assert.equal(isTrustedImageUrl('https://images.example/xm5.jpg'), true);
  assert.equal(imageLoadDecision(SHOP), 'ask');

  // no bridge profile (and no own key): Wikimedia answers
  web.setConn(null);
  const r = await resolveItemImage(planItemImage({ autoQuery: 'Kolosseum Roma' }, imageLoadDecision), search, false);
  assert.equal(r.kind, 'icon');
  assert.deepEqual(wikiCalls, ['Kolosseum Roma']);
});

test("products (webOnly): no web image search -> icon, Wikipedia is never asked; places keep the Wikipedia fallback", async () => {
  const wikiCalls: string[] = [];
  const wiki = { peek: () => undefined, resolve: async (q: string) => (wikiCalls.push(q), directImage("https://upload.wikimedia.org/horse-carriage.jpg")) };
  const noWeb = chainWebSources(() => []);
  const combined = combineImageSources(wiki, noWeb);
  const plan = planItemImage({ autoQuery: productImageQuery({ brand: 'Cube', name: 'Touring' }) }, imageLoadDecision);
  const product = await resolveItemImage(plan, (q) => combined.resolve(q, undefined, 'only'), false);
  assert.equal(product.kind, 'icon');
  assert.deepEqual(wikiCalls, []);
  assert.equal(peekItemImage(plan, (q) => combined.peek(q, undefined, 'only'), false)?.kind, 'icon');
  // places: web first, then Wikipedia
  const place = await resolveItemImage(planItemImage({ autoQuery: 'Kolosseum Roma' }, imageLoadDecision), (q) => combined.resolve(q, undefined, true), false);
  assert.equal(place.kind, 'image');
  assert.deepEqual(wikiCalls, ['Kolosseum Roma']);
});
