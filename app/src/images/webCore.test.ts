import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributionText } from './attribution.ts';
import { bridgeConnFromProfiles } from './webProfiles.ts';
import { combineImageSources, createWebImageSearch, parseWebResults, pickWebResult, type WebSearchHints } from './webCore.ts';
import type { ResolvedImage } from './types.ts';

const R = (u: string, extra: object = {}) => ({ url: `https://${u}/a.jpg`, thumbnailUrl: `https://t.${u}/a.jpg`, width: 1200, height: 800, title: 'T', sourcePage: `https://${u}/page`, sourceDomain: u, provider: 'serper', ...extra });
const img = (u: string): ResolvedImage => ({ url: u, thumbUrl: u, width: 1, height: 1, title: '', attribution: { sourceUrl: u, provider: 'wikipedia' } });

function mk(body: unknown, status = 200, log: string[] = []) {
  let now = 0;
  const s = createWebImageSearch({
    fetch: async (url, init) => {
      log.push(`${url}|${init?.headers?.Authorization ?? ''}`);
      return { ok: status < 300, status, json: async () => body };
    },
    now: () => now,
  });
  return { s, tick: (ms: number) => (now += ms) };
}

test('parseWebResults drops http, svg/gif, junk; pickWebResult prefers sane size', () => {
  const out = parseWebResults({ results: [R('a.example', { url: 'http://a.example/x.jpg' }), R('b.example', { url: 'https://b.example/x.svg' }), 5, R('c.example', { width: 100, height: 100 }), R('d.example')] });
  assert.equal(out.length, 2);
  assert.equal(pickWebResult(out)?.sourceDomain, 'd.example');
  assert.deepEqual(parseWebResults(null), []);
});

test('resolve: request shape, attribution "Bild: domain", cache, miss cache', async () => {
  const log: string[] = [];
  const { s } = mk({ results: [R('example.com')] }, 200, log);
  assert.equal(s.enabled(), false); // no bridge yet
  s.setConn({ baseUrl: 'https://hermes-host.example.ts.net/v1', apiKey: 'tok' });
  assert.equal(s.enabled(), true);
  assert.equal(s.peek('Octopath Traveler 2', 'de'), undefined);
  const a = await s.resolve('Octopath Traveler 2', 'de');
  assert.equal(log[0], 'https://hermes-host.example.ts.net/bridge/images?q=Octopath%20Traveler%202&n=5&lang=de|Bearer tok');
  assert.equal(a?.attribution.provider, 'web');
  assert.equal(attributionText(a!.attribution), 'Bild: example.com');
  assert.equal(a!.attribution.sourceUrl, 'https://example.com/page');
  await s.resolve('octopath traveler 2', 'de');
  assert.equal(log.length, 1);
  assert.ok(s.peek('Octopath Traveler 2', 'de'));
});

test('pref off / no conn -> null without request; 404 disables for 10 min; errors reject uncached', async () => {
  const log: string[] = [];
  const off = mk({ results: [R('x.com')] }, 200, log);
  off.s.setConn({ baseUrl: 'https://b', apiKey: 'k' });
  off.s.setPref(false);
  assert.equal(await off.s.resolve('x'), null);
  assert.equal(log.length, 0);
  const nf = mk({}, 404);
  nf.s.setConn({ baseUrl: 'https://b', apiKey: 'k' });
  assert.equal(await nf.s.resolve('x'), null);
  assert.equal(nf.s.enabled(), false);
  nf.tick(11 * 60_000);
  assert.equal(nf.s.enabled(), true);
  const err = mk({}, 500);
  err.s.setConn({ baseUrl: 'https://b', apiKey: 'k' });
  await assert.rejects(err.s.resolve('x'));
  assert.equal(err.s.peek('x'), undefined);
});

test('combine: wikimedia first, web fallback; preferWeb reverses; web errors fall back quietly', async () => {
  const web = mk({ results: [R('shop.example')] });
  web.s.setConn({ baseUrl: 'https://b', apiKey: 'k' });
  const wikiHit = { peek: () => img('https://w/hit.jpg'), resolve: async () => img('https://w/hit.jpg') };
  const wikiMiss = { peek: () => null, resolve: async () => null };
  const c1 = combineImageSources(wikiHit, web.s);
  assert.equal((await c1.resolve('Hund', 'de', false))?.url, 'https://w/hit.jpg');
  assert.equal((await c1.resolve('Hund', 'de', true))?.attribution.provider, 'web');
  const c2 = combineImageSources(wikiMiss, web.s);
  assert.equal((await c2.resolve('Octopath', 'de', false))?.attribution.provider, 'web');
  assert.equal(c2.peek('never-seen', 'de', false), undefined); // unknown until web answered
  const bad = mk({}, 500);
  bad.s.setConn({ baseUrl: 'https://b', apiKey: 'k' });
  assert.equal(await combineImageSources(wikiHit, bad.s).resolve('x', 'de', true).then((r) => r?.url), 'https://w/hit.jpg');
  assert.equal(await combineImageSources(wikiMiss, bad.s).resolve('x', 'de', false), null);
  web.s.setPref(false);
  assert.equal(c2.peek('zzz', 'de', false), null);
});

test("combine 'only' (products, source:'web'): never asks Wikimedia, even when web finds nothing or is off", async () => {
  const wikiCalls: string[] = [];
  const wikiHit = { peek: () => img('https://w/hit.jpg'), resolve: async (q: string) => (wikiCalls.push(q), img('https://w/hit.jpg')) };
  const web = mk({ results: [R('shop.example')] });
  web.s.setConn({ baseUrl: 'https://b', apiKey: 'k' });
  const c = combineImageSources(wikiHit, web.s);
  assert.equal((await c.resolve('Cube Touring', 'de', 'only'))?.attribution.provider, 'web');

  // web search finds nothing → no photo (not the Wikipedia pick)
  const empty = mk({ results: [] });
  empty.s.setConn({ baseUrl: 'https://b', apiKey: 'k' });
  const c2 = combineImageSources(wikiHit, empty.s);
  assert.equal(await c2.resolve('Ampler Nova', 'de', 'only'), null);

  // web errors → still no Wikipedia
  const bad = mk({}, 500);
  bad.s.setConn({ baseUrl: 'https://b', apiKey: 'k' });
  assert.equal(await combineImageSources(wikiHit, bad.s).resolve('x', 'de', 'only'), null);

  // no web search configured → known miss (calm fallback) and no Wikimedia request
  const off = mk({});
  const c3 = combineImageSources(wikiHit, off.s);
  assert.equal(c3.peek('Cube Touring', 'de', 'only'), null);
  assert.equal(await c3.resolve('Cube Touring', 'de', 'only'), null);
  assert.deepEqual(wikiCalls, []);
  // the non-web policy is unchanged (places etc.: Wikimedia answers)
  assert.equal((await c3.resolve('Kolosseum', 'de', false))?.url, 'https://w/hit.jpg');
});

test('bridgeConnFromProfiles: active bridge wins, else first bridge profile even if active is Claude', () => {
  const ps = [
    { id: 'c', kind: 'claude', baseUrl: 'https://api.anthropic.com', apiKey: 'sk' },
    { id: 'h', kind: 'hermes', bridge: true, baseUrl: 'https://hermes-host.example.ts.net', apiKey: 'tok' },
    { id: 'h2', kind: 'hermes', baseUrl: 'http://direct:8642', apiKey: 'x' },
  ];
  assert.deepEqual(bridgeConnFromProfiles(ps, 'c'), { baseUrl: 'https://hermes-host.example.ts.net', apiKey: 'tok' });
  assert.equal(bridgeConnFromProfiles([ps[0], ps[2]], 'c'), null);
});

function mkProbe(routes: Record<string, { status: number; body?: unknown } | 'throw'>, log: string[] = [], hints?: WebSearchHints) {
  return createWebImageSearch({
    hints,
    fetch: async (url) => {
      log.push(url);
      const r = routes[new URL(url).pathname];
      if (!r || r === 'throw') throw new Error('network');
      return { ok: r.status < 300, status: r.status, json: async () => r.body };
    },
  });
}
const CONN = { baseUrl: 'https://bridge.example.com/v1', apiKey: 'tok' };

test('probe: bridge without an image provider switches the search off, no search request is made', async () => {
  const log: string[] = [];
  const s = mkProbe({ '/bridge/images/config': { status: 200, body: { available: false, providers: [] } }, '/bridge/images': { status: 200, body: { results: [R('a.example')] } } }, log);
  s.setConn(CONN);
  const p = s.probe();
  assert.equal(await s.resolve('Galaxy 12 GB'), null); // waits for the probe, then skips the search
  await p;
  assert.equal(s.enabled(), false);
  assert.deepEqual(log, ['https://bridge.example.com/bridge/images/config']);
});

test('probe: provider available keeps search on and runs the search afterwards', async () => {
  const log: string[] = [];
  const s = mkProbe({ '/bridge/images/config': { status: 200, body: { available: true } }, '/bridge/images': { status: 200, body: { results: [R('a.example')] } } }, log);
  s.setConn(CONN);
  void s.probe();
  assert.ok(await s.resolve('thing'));
  assert.equal(s.enabled(), true);
  assert.equal(log.length, 2);
});

test('probe: 404 (older bridge) disables; network error does not and is retried; one probe per connection', async () => {
  const old = mkProbe({ '/bridge/images/config': { status: 404 } });
  old.setConn(CONN);
  await old.probe();
  assert.equal(old.enabled(), false);

  const log: string[] = [];
  const flaky = mkProbe({ '/bridge/images/config': 'throw' }, log);
  flaky.setConn(CONN);
  await flaky.probe();
  assert.equal(flaky.enabled(), true);
  await flaky.probe();
  assert.equal(log.length, 2); // retried

  const once: string[] = [];
  const ok = mkProbe({ '/bridge/images/config': { status: 200, body: { available: true } } }, once);
  ok.setConn(CONN);
  await Promise.all([ok.probe(), ok.probe()]);
  await ok.probe();
  assert.equal(once.length, 1);
});

test('probe: a new connection is probed again and re-enables', async () => {
  const routes: Record<string, { status: number; body?: unknown }> = { '/bridge/images/config': { status: 200, body: { available: false } } };
  const s = mkProbe(routes);
  s.setConn(CONN);
  await s.probe();
  assert.equal(s.enabled(), false);
  routes['/bridge/images/config'] = { status: 200, body: { available: true } };
  s.setConn({ ...CONN, apiKey: 'tok2' });
  assert.equal(s.enabled(), true);
  await s.probe();
  assert.equal(s.enabled(), true);
});

test('probe: proxy advertised in the same config answer, independent of the search provider', async () => {
  const s = mkProbe({ '/bridge/images/config': { status: 200, body: { available: false, providers: [], proxy: { available: true, path: '/bridge/img', maxBytes: 8388608 } } } });
  assert.equal(s.proxyConn(), null);
  s.setConn(CONN);
  assert.equal(s.proxyConn(), null); // unknown until the bridge answered
  let bumps = 0;
  s.subscribe(() => bumps++);
  await s.probe();
  assert.equal(s.enabled(), false); // no search provider (public default) …
  assert.deepEqual(s.proxyConn(), CONN); // … but the proxy is there
  assert.ok(bumps > 0);
  s.setConn({ ...CONN, apiKey: 'tok2' });
  assert.equal(s.proxyConn(), null); // a new connection must be asked again
});

test('probe: no proxy for older bridges, proxy off, unknown shapes, 401/404', async () => {
  for (const body of [{ available: true }, { available: false, proxy: { available: false } }, { proxy: true }, { proxy: { available: 'yes' } }, null]) {
    const s = mkProbe({ '/bridge/images/config': { status: 200, body } });
    s.setConn(CONN);
    await s.probe();
    assert.equal(s.proxyConn(), null, JSON.stringify(body));
  }
  for (const status of [401, 404, 503]) {
    const s = mkProbe({ '/bridge/images/config': { status, body: { proxy: { available: true } } } });
    s.setConn(CONN);
    await s.probe();
    assert.equal(s.proxyConn(), null, String(status));
  }
});

test('combine: web preferred but unavailable (bridge without image search) → straight to the keyless source, web never called', async () => {
  let webCalls = 0;
  const web = {
    enabled: () => false,
    peek: () => (webCalls++, undefined),
    resolve: async () => (webCalls++, img('https://web.example/x.jpg')),
  };
  const wiki = { peek: () => null, resolve: async () => null };
  const c = combineImageSources(wiki, web);
  assert.equal(c.peek('8 GB', undefined, true), null); // known miss → the card collapses without waiting
  assert.equal(await c.resolve('8 GB', undefined, true), null);
  assert.equal(webCalls, 0);
});

// restored chats: a bridge known (last probe) to have no image provider must not show a shimmer that collapses ~1 s
// later when the probe answers again – products without a photo collapse before the first paint
function memHints(init: Record<string, boolean> = {}) {
  const m = new Map(Object.entries(init));
  return { get: (b: string) => m.get(b), set: (b: string, v: boolean) => void m.set(b, v), m };
}

test('probe hint: last answer "no provider" switches the search off right at setConn, before the probe answers', async () => {
  const hints = memHints({ 'https://bridge.example.com/v1': false });
  const log: string[] = [];
  const s = mkProbe({ '/bridge/images/config': { status: 200, body: { available: false } } }, log, hints);
  s.setConn(CONN);
  assert.equal(s.enabled(), false); // known before the first paint
  const combined = combineImageSources({ peek: () => undefined, resolve: async () => null }, s);
  assert.equal(combined.peek('Galaxy 12 GB', undefined, 'only'), null); // → slot collapses synchronously
  await s.probe();
  assert.equal(s.enabled(), false);
  assert.equal(log.length, 1); // still probed (the hint is only a first guess)
});

test('probe hint: a fresh "available" answer overrides a stale hint and is remembered', async () => {
  const hints = memHints({ 'https://bridge.example.com/v1': false });
  const s = mkProbe({ '/bridge/images/config': { status: 200, body: { available: true } } }, [], hints);
  let bumps = 0;
  s.subscribe(() => bumps++);
  s.setConn(CONN);
  assert.equal(s.enabled(), false);
  await s.probe();
  assert.equal(s.enabled(), true);
  assert.ok(bumps >= 2);
  assert.equal(hints.m.get('https://bridge.example.com/v1'), true);
});

test('probe hint: probe answers are stored per bridge; unknown bridges stay optimistic; late hints apply until the probe answers', async () => {
  const hints = memHints();
  const s = mkProbe({ '/bridge/images/config': { status: 200, body: { available: false } } }, [], hints);
  s.setConn(CONN);
  assert.equal(s.enabled(), true); // no hint: unchanged behaviour (shimmer while the probe runs)
  await s.probe();
  assert.equal(hints.m.get('https://bridge.example.com/v1'), false);
  // 404 / 401 also count as "no search"
  const h2 = memHints();
  const old = mkProbe({ '/bridge/images/config': { status: 404 } }, [], h2);
  old.setConn(CONN);
  await old.probe();
  assert.equal(h2.m.get('https://bridge.example.com/v1'), false);
  // the hint store finished loading after setConn (AsyncStorage): applyHints() picks it up
  const h3 = memHints();
  const late = mkProbe({ '/bridge/images/config': 'throw' }, [], h3);
  late.setConn(CONN);
  assert.equal(late.enabled(), true);
  h3.m.set('https://bridge.example.com/v1', false);
  late.applyHints();
  assert.equal(late.enabled(), false);
  // a network error keeps the hint (no shimmer → collapse while offline)
  await late.probe();
  assert.equal(late.enabled(), false);
});
