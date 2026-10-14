import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { filterCandidates, loadImagesConfig, PROVIDERS } from '../src/images.mjs';
import { silentLogger } from '../src/log.mjs';

const TOKEN = 't';
const good = (n, extra = {}) => ({ url: `https://img.example/${n}.jpg`, thumbnailUrl: `https://t.example/${n}.jpg`, width: 800, height: 600, title: `T${n}`, sourcePage: `https://site${n}.example/p`, sourceDomain: `site${n}.example`, ...extra });

async function start(env, imageProviders, fetchFn) {
  const { server } = createServer({ HERMES_BASE_URL: 'http://127.0.0.1:1', BRIDGE_TOKEN: TOKEN, ...env }, { logger: silentLogger, imageProviders, fetch: fetchFn });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, auth = true) => fetch(base + path, { headers: auth ? { authorization: `Bearer ${TOKEN}` } : {} });
  return { server, get };
}

test('filterCandidates: https, svg/gif, tiny, dupes, per-domain cap', () => {
  const items = [
    good(1), good(1), good(2, { url: 'http://x.example/a.jpg' }), good(3, { url: 'https://x.example/a.svg' }),
    good(4, { url: 'https://x.example/a.GIF?x=1' }), good(5, { width: 200 }), good(6, { width: 0, height: 0 }),
    good(7, { sourcePage: 'https://site1.example/q', url: 'https://img.example/7.jpg' }),
    good(8, { sourcePage: 'https://www.site1.example/r', url: 'https://img.example/8.jpg' }),
  ];
  const out = filterCandidates(items, 'serper', 8);
  assert.deepEqual(out.map((r) => r.url), ['https://img.example/1.jpg', 'https://img.example/6.jpg', 'https://img.example/7.jpg']);
  assert.equal(out[0].provider, 'serper');
  assert.equal(out[2].sourceDomain, 'site1.example');
});

test('auth, validation, config, fallback chain, cache', async () => {
  let serperCalls = 0, braveCalls = 0;
  const providers = {
    serper: async () => { serperCalls++; throw new Error('boom'); },
    brave: async () => { braveCalls++; return [good(1), good(2)]; },
  };
  const { server, get } = await start({ SERPER_API_KEY: 's', BRAVE_API_KEY: 'b' }, providers);
  try {
    assert.equal((await get('/bridge/images?q=a', false)).status, 401);
    assert.equal((await get('/bridge/images')).status, 400);
    const cfg = await (await get('/bridge/images/config')).json();
    assert.deepEqual(cfg.providers, ['serper', 'brave']);
    assert.equal(cfg.available, true);
    const r = await get('/bridge/images?q=Tiramisu&n=1');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.results.length, 1);
    assert.equal(j.results[0].provider, 'brave');
    await get('/bridge/images?q=tiramisu&n=1');
    assert.equal(serperCalls, 1);
    assert.equal(braveCalls, 1);
  } finally { server.close(); }
});

test('no keys -> 503 and config unavailable; all fail -> 502; empty -> []', async () => {
  const a = await start({}, undefined);
  try {
    assert.equal((await (await a.get('/bridge/images/config')).json()).available, false);
    assert.equal((await a.get('/bridge/images?q=x')).status, 503);
  } finally { a.server.close(); }
  const b = await start({ SERPER_API_KEY: 's', BRIDGE_IMAGE_PROVIDERS: 'serper' }, { serper: async () => { throw new Error('x'); } });
  try { assert.equal((await b.get('/bridge/images?q=x')).status, 502); } finally { b.server.close(); }
  const c = await start({ SERPER_API_KEY: 's', BRIDGE_IMAGE_PROVIDERS: 'serper' }, { serper: async () => [] });
  try { assert.deepEqual(await (await c.get('/bridge/images?q=x')).json(), { results: [] }); } finally { c.server.close(); }
});

test('rate limit', async () => {
  const { server, get } = await start({ SERPER_API_KEY: 's', BRIDGE_IMAGE_RATE_LIMIT: '2' }, { serper: async () => [good(1)] });
  try {
    assert.equal((await get('/bridge/images?q=a')).status, 200);
    assert.equal((await get('/bridge/images?q=b')).status, 200);
    assert.equal((await get('/bridge/images?q=c')).status, 429);
    assert.equal((await get('/bridge/images?q=a')).status, 200); // cached
  } finally { server.close(); }
});

test('provider adapters build official requests and parse responses', async () => {
  const calls = [];
  const fakeFetch = async (u, init) => {
    calls.push({ u: String(u), init });
    const body = String(u).includes('serper')
      ? { images: [{ title: 'S', imageUrl: 'https://a.example/i.jpg', imageWidth: 900, imageHeight: 700, thumbnailUrl: 'https://t.example/i.jpg', source: 'A', domain: 'a.example', link: 'https://a.example/p' }] }
      : { results: [{ title: 'B', url: 'https://b.example/p', source: 'b.example', thumbnail: { src: 'https://imgs.search.brave.com/x' }, properties: { url: 'https://b.example/i.jpg', width: 1000, height: 800 } }] };
    return { ok: true, json: async () => body };
  };
  const s = await PROVIDERS.serper('q', 'de', 10, 'KEY', undefined, fakeFetch);
  assert.equal(calls[0].init.headers['X-API-KEY'], 'KEY');
  assert.equal(JSON.parse(calls[0].init.body).safe, 'active');
  assert.equal(s[0].sourcePage, 'https://a.example/p');
  const b = await PROVIDERS.brave('q', 'de', 10, 'BK', undefined, fakeFetch);
  assert.equal(calls[1].init.headers['X-Subscription-Token'], 'BK');
  assert.match(calls[1].u, /safesearch=strict/);
  assert.equal(b[0].url, 'https://b.example/i.jpg');
  assert.equal(b[0].sourceDomain, 'b.example');
  assert.equal(loadImagesConfig({}).order.join(), 'serper,brave');
});
