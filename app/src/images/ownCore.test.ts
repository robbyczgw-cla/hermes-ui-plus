import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOwnImageSearch } from './ownCore.ts';
import { chainWebSources, combineImageSources } from './webCore.ts';
import type { ResolvedImage } from './types.ts';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const img = (u: string): ResolvedImage => ({ url: u, thumbUrl: u, width: 1, height: 1, title: '', attribution: { sourceUrl: u, provider: 'wikipedia' } });

function mk(handler: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => { status?: number; body?: unknown; throws?: boolean }, rateLimit?: number) {
  let now = 1000;
  const calls: string[] = [];
  const s = createOwnImageSearch({
    fetch: async (url, init) => {
      calls.push(url);
      const r = handler(url, init);
      if (r.throws) throw new TypeError('Failed to fetch');
      const status = r.status ?? 200;
      return { ok: status < 300, status, json: async () => r.body };
    },
    now: () => now,
    rateLimit,
  });
  return { s, calls, tick: (ms: number) => (now += ms) };
}

test('resolve: serper, filtered pick, attribution, cache hit without second call', async () => {
  const { s, calls } = mk(() => ({ body: fx('serper-images-de.json') }));
  assert.equal(s.enabled(), false);
  s.setConfig({ provider: 'serper', key: ' K ' });
  assert.equal(s.config()?.key, 'K');
  assert.equal(s.peek('Eiffelturm', 'de'), undefined);
  const a = await s.resolve('Eiffelturm', 'de');
  assert.equal(a?.url, 'https://upload.example.org/eiffel1.jpg');
  assert.equal(a?.attribution.provider, 'web');
  assert.equal((await s.resolve('eiffelturm', 'de'))?.url, a?.url);
  assert.equal(calls.length, 1);
  assert.equal(s.peek('Eiffelturm', 'de')?.url, a?.url);
});

test('error cool-down: bad key does not hammer; new key resets', async () => {
  const { s, calls, tick } = mk(() => ({ status: 403 }));
  s.setConfig({ provider: 'brave', key: 'bad' });
  assert.equal(await s.resolve('a', 'de'), null);
  assert.equal(s.enabled(), false);
  assert.equal(await s.resolve('b', 'de'), null);
  assert.equal(calls.length, 1);
  tick(11 * 60_000);
  assert.equal(s.enabled(), true);
  s.setConfig({ provider: 'brave', key: 'bad2' });
  await s.resolve('c', 'de');
  assert.equal(calls.length, 2);
});

test('rate limit: over budget calls are skipped, not sent', async () => {
  const { s, calls, tick } = mk(() => ({ body: { images: [] } }), 2);
  s.setConfig({ provider: 'serper', key: 'k' });
  for (const q of ['a', 'b', 'c']) await s.resolve(q, 'de');
  assert.equal(calls.length, 2);
  tick(61_000);
  await s.resolve('c', 'de');
  assert.equal(calls.length, 3);
});

test('test(): outcomes', async () => {
  const cases: [Parameters<typeof mk>[0], string, number?][] = [
    [() => ({ body: fx('brave-images-de.json') }), 'ok'],
    [() => ({ body: { results: [] } }), 'empty'],
    [() => ({ status: 401 }), 'auth', 401],
    [() => ({ status: 429 }), 'rate', 429],
    [() => ({ status: 500 }), 'http', 500],
    [() => ({ throws: true }), 'network'],
  ];
  for (const [h, kind, status] of cases) {
    const { s } = mk(h);
    const r = await s.test({ provider: 'brave', key: 'k' });
    assert.equal(r.kind, kind);
    assert.equal(r.status, status);
  }
});

test('chain + combine: bridge → own → wikimedia order', async () => {
  const { s } = mk(() => ({ body: fx('serper-images-de.json') }));
  s.setConfig({ provider: 'serper', key: 'k' });
  const off = { enabled: () => false, peek: () => null, resolve: async () => null };
  const wikiMiss = { peek: () => null, resolve: async () => null };
  const wikiHit = { peek: () => img('https://w/hit.jpg'), resolve: async () => img('https://w/hit.jpg') };
  const ownOnly = chainWebSources(() => [off, s]);
  assert.equal((await combineImageSources(wikiMiss, ownOnly).resolve('x', 'de', false))?.attribution.provider, 'web');
  assert.equal((await combineImageSources(wikiHit, ownOnly).resolve('x', 'de', true))?.attribution.provider, 'web');
  assert.equal((await combineImageSources(wikiHit, ownOnly).resolve('x', 'de', false))?.url, 'https://w/hit.jpg');
  const none = chainWebSources(() => []);
  assert.equal(none.enabled(), false);
  assert.equal(await combineImageSources(wikiMiss, none).resolve('x', 'de', true), null);
  const erroring = { enabled: () => true, peek: () => undefined, resolve: async (): Promise<ResolvedImage | null> => { throw new Error('x'); } };
  assert.equal((await chainWebSources(() => [erroring, s]).resolve('y', 'de'))?.attribution.provider, 'web');
});
