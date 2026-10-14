import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePairLink, type PairData } from './pairLink.ts';
import { pairRedeemUrl, parseRedeemBody, redeemErrorFor, redeemPairCode, type RedeemFetch } from './pairRedeem.ts';

const pairOf = (link: string): PairData => {
  const r = parsePairLink(link, { flavor: 'personal' });
  assert.ok(r.ok);
  return r.pair;
};
const CODE = 'pc_test_000000000000';
const TOKEN = 'nca_user_test_token_0000000000';

test('redeem URL: server root (base path kept, /v1 dropped)', () => {
  assert.equal(pairRedeemUrl(pairOf('hermesui://pair?u=https%3A%2F%2Fb.example.org%2Fv1&c=' + CODE).url), 'https://b.example.org/bridge/pair/redeem');
  assert.equal(pairRedeemUrl(pairOf('hermesui://pair?u=https%3A%2F%2Fb.example.org%3A8790%2Fhermes%2Fv1&c=' + CODE).url), 'https://b.example.org:8790/hermes/bridge/pair/redeem');
  assert.equal(pairRedeemUrl(pairOf('hermesui://pair?u=b.example.org&c=' + CODE).url), 'https://b.example.org/bridge/pair/redeem');
  const same = parsePairLink('https://b.example.org/#pair?u=%2Fv1&c=' + CODE, { flavor: 'personal', origin: 'https://b.example.org' });
  assert.ok(same.ok);
  assert.equal(pairRedeemUrl(same.pair.url), 'https://b.example.org/bridge/pair/redeem');
});

test('successful redeem: POST {code} once, token taken over, code dropped', async () => {
  const calls: { url: string; init: Parameters<RedeemFetch>[1] }[] = [];
  const fetchImpl: RedeemFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ token: TOKEN, deviceId: 'dev_test', name: 'Phone' }) };
  };
  const pair = pairOf(`hermesui://pair?u=https%3A%2F%2Fb.example.org%2Fv1&c=${CODE}&n=Hermes`);
  const r = await redeemPairCode(pair, { fetchImpl });
  assert.ok(r.ok);
  assert.equal(r.pair.token, TOKEN);
  assert.equal(r.pair.code, '');
  assert.equal(r.pair.name, 'Hermes');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://b.example.org/bridge/pair/redeem');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { code: CODE });
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test('legacy pair without code: no request, unchanged', async () => {
  let called = false;
  const pair = pairOf('hermesui://pair?u=b.example.org&t=legacy_test_token');
  const r = await redeemPairCode(pair, {
    fetchImpl: async () => {
      called = true;
      throw new Error('unexpected');
    },
  });
  assert.ok(r.ok);
  assert.equal(r.pair, pair);
  assert.equal(called, false);
});

test('errors: 404/410 expired, 429 rate-limited, network, bad body; the code never appears in the result', async () => {
  const pair = pairOf(`hermesui://pair?u=b.example.org&c=${CODE}`);
  const withStatus = (status: number, body = '{}'): RedeemFetch => async () => ({ ok: status < 300, status, text: async () => body });
  for (const [status, error] of [[404, 'expired'], [410, 'expired'], [429, 'rate-limited'], [500, 'failed'], [401, 'failed']] as const) {
    const r = await redeemPairCode(pair, { fetchImpl: withStatus(status) });
    assert.deepEqual(r, { ok: false, error, status });
    assert.doesNotMatch(JSON.stringify(r), new RegExp(CODE));
  }
  const net = await redeemPairCode(pair, { fetchImpl: async () => Promise.reject(new TypeError(`Network request failed ${CODE}`)) });
  assert.deepEqual(net, { ok: false, error: 'network' });
  for (const body of ['', 'not json', '[]', '{"token":""}', '{"token":"a b"}', `{"token":"${'x'.repeat(2000)}"}`]) {
    const r = await redeemPairCode(pair, { fetchImpl: withStatus(200, body) });
    assert.deepEqual(r, { ok: false, error: 'failed', status: 200 }, body);
  }
  assert.equal(redeemErrorFor(410), 'expired');
  assert.equal(parseRedeemBody(JSON.stringify({ token: TOKEN }))?.token, TOKEN);
});

test('timeout / abort → network error', async () => {
  const pair = pairOf(`hermesui://pair?u=b.example.org&c=${CODE}`);
  const hang: RedeemFetch = (_u, init) =>
    new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
  assert.deepEqual(await redeemPairCode(pair, { fetchImpl: hang, timeoutMs: 10 }), { ok: false, error: 'network' });
  const ctrl = new AbortController();
  const p = redeemPairCode(pair, { fetchImpl: hang, signal: ctrl.signal });
  ctrl.abort();
  assert.deepEqual(await p, { ok: false, error: 'network' });
});
