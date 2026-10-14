import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelIds, probeConnection, type FetchLike } from './probe.ts';
import { normalizeServerUrl, type NormalizedUrl } from './url.ts';

function u(s: string): NormalizedUrl {
  const r = normalizeServerUrl(s);
  assert.ok(r.ok);
  return r;
}

type Route = { status: number; body?: unknown; headers?: Record<string, string> } | Error;
function fakeFetch(routes: Record<string, Route>, calls: { url: string; auth?: string }[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, auth: init.headers?.Authorization });
    const r = routes[url] ?? { status: 404, body: 'not found' };
    if (r instanceof Error) throw r;
    const h = Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (n: string) => h[n.toLowerCase()] ?? null },
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? null)),
    };
  };
}

const HEALTH = { status: 200, body: { status: 'ok', platform: 'hermes-agent', version: '0.21.4' } };
const MODELS = { status: 200, body: { object: 'list', data: [{ id: 'hermes-agent' }, { id: 'kimi-k2' }, { nope: 1 }] } };

test('direct Hermes: ok, no bridge, key only sent to /models', async () => {
  const calls: { url: string; auth?: string }[] = [];
  const r = await probeConnection(
    { url: u('http://10.0.0.5:8645'), apiKey: ' secret ' },
    { platform: 'android', fetchImpl: fakeFetch({ 'http://10.0.0.5:8645/health': HEALTH, 'http://10.0.0.5:8645/v1/models': MODELS }, calls) },
  );
  assert.equal(r.ok, true);
  assert.equal(r.bridge, false);
  assert.equal(r.hermes, true);
  assert.equal(r.version, '0.21.4');
  assert.deepEqual(r.models, ['hermes-agent', 'kimi-k2']);
  assert.equal(calls[0].auth, undefined);
  assert.equal(calls[1].auth, 'Bearer secret');
});

test('bridge detected via X-Hermes-UI-Bridge header', async () => {
  const r = await probeConnection(
    { url: u('https://bridge.example.org:8790'), apiKey: 'tok' },
    {
      platform: 'ios',
      fetchImpl: fakeFetch({
        'https://bridge.example.org:8790/health': { ...HEALTH, headers: { 'X-Hermes-UI-Bridge': '1' } },
        'https://bridge.example.org:8790/v1/models': MODELS,
      }),
    },
  );
  assert.ok(r.ok && r.bridge);
});

test('health 404 at root falls back to /v1/health; reverse-proxy prefix kept', async () => {
  const calls: { url: string }[] = [];
  const r = await probeConnection(
    { url: u('https://h.example.org/hermes'), apiKey: '' },
    { platform: 'ios', fetchImpl: fakeFetch({ 'https://h.example.org/hermes/v1/health': HEALTH, 'https://h.example.org/hermes/v1/models': MODELS }, calls) },
  );
  assert.ok(r.ok && r.hermes);
  assert.deepEqual(calls.map((c) => c.url), ['https://h.example.org/hermes/health', 'https://h.example.org/hermes/v1/health', 'https://h.example.org/hermes/v1/models', 'https://h.example.org/hermes/api/model/options']);
});

test('401 with and without key', async () => {
  const routes = { 'https://h.example.org/health': HEALTH, 'https://h.example.org/v1/models': { status: 401, body: { error: 'x' } } };
  const a = await probeConnection({ url: u('h.example.org'), apiKey: 'wrong' }, { platform: 'ios', fetchImpl: fakeFetch(routes) });
  assert.equal(a.error?.kind, 'unauthorized');
  assert.equal(a.hermes, true);
  const b = await probeConnection({ url: u('h.example.org'), apiKey: '' }, { platform: 'ios', fetchImpl: fakeFetch(routes) });
  assert.equal(b.error?.kind, 'keyMissing');
});

test('network failure on health stops early with classified error', async () => {
  const calls: { url: string }[] = [];
  const r = await probeConnection(
    { url: u('https://192.168.1.2:8645'), apiKey: 'k' },
    { platform: 'android', fetchImpl: fakeFetch({ 'https://192.168.1.2:8645/health': new TypeError('Network request failed') }, calls) },
  );
  assert.equal(r.ok, false);
  assert.equal(r.error?.kind, 'network');
  assert.equal(r.error?.suspect, 'tls');
  assert.equal(calls.length, 1);
});

test('HTML page instead of API → notHermes', async () => {
  const r = await probeConnection(
    { url: u('https://router.example.org'), apiKey: '' },
    { platform: 'ios', fetchImpl: fakeFetch({ 'https://router.example.org/health': { status: 200, body: '<html>login</html>' }, 'https://router.example.org/v1/models': { status: 200, body: '<html>login</html>' } }) },
  );
  assert.equal(r.error?.kind, 'notHermes');
  assert.equal(r.hermes, false);
});

test('404 on models → notFound with path', async () => {
  const r = await probeConnection({ url: u('https://h.example.org'), apiKey: 'k' }, { platform: 'ios', fetchImpl: fakeFetch({}) });
  assert.equal(r.error?.kind, 'notFound');
  assert.equal(r.error?.path, '/v1/models');
});

test('timeout aborts the request', async () => {
  const hang: FetchLike = (_url, init) =>
    new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const r = await probeConnection({ url: u('https://h.example.org'), apiKey: '' }, { platform: 'ios', fetchImpl: hang, timeoutMs: 20 });
  assert.equal(r.error?.kind, 'timeout');
});

test('external abort signal', async () => {
  const ctrl = new AbortController();
  const hang: FetchLike = (_url, init) =>
    new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const p = probeConnection({ url: u('https://h.example.org'), apiKey: '' }, { platform: 'ios', fetchImpl: hang, signal: ctrl.signal, timeoutMs: 10_000 });
  ctrl.abort();
  assert.equal((await p).ok, false);
});

test('parseModelIds', () => {
  assert.deepEqual(parseModelIds({ data: [{ id: 'a' }, { id: 5 }, null, { id: '' }] }), ['a']);
  assert.equal(parseModelIds({ models: [] }), null);
  assert.equal(parseModelIds([]), null);
  assert.equal(parseModelIds(null), null);
});

test('provider catalog summary is reported when GET /api/model/options answers; absent otherwise', async () => {
  const OPTIONS = {
    status: 200,
    body: {
      providers: [
        { slug: 'a', name: 'A', models: ['m1', 'm2', 'm3'], authenticated: true },
        { slug: 'b', name: 'B', models: ['m1'], authenticated: true },
        { slug: 'c', name: 'C', models: ['z'], authenticated: false },
      ],
    },
  };
  const base = { 'http://10.0.0.5:8645/health': HEALTH, 'http://10.0.0.5:8645/v1/models': MODELS };
  const withCat = await probeConnection({ url: u('http://10.0.0.5:8645'), apiKey: 'k' }, { platform: 'android', fetchImpl: fakeFetch({ ...base, 'http://10.0.0.5:8645/api/model/options': OPTIONS }) });
  assert.deepEqual(withCat.catalog, { models: 4, providers: 2 });
  assert.deepEqual(withCat.models, ['hermes-agent', 'kimi-k2']);
  const without = await probeConnection({ url: u('http://10.0.0.5:8645'), apiKey: 'k' }, { platform: 'android', fetchImpl: fakeFetch(base) });
  assert.equal(without.ok, true);
  assert.equal(without.catalog, undefined);
});
