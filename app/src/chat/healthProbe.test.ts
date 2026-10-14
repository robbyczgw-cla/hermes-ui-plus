import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeHealth } from './healthProbe.ts';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const urls = ['https://example.com/health', 'https://example.com/v1/health'];

test('a slow working health response after the old five-second budget is online', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const probe = probeHealth(async () => {
    await new Promise((r) => setTimeout(r, 6500));
    return { ok: true, status: 200 };
  }, urls, 'dummy');
  t.mock.timers.tick(6500); await flush();
  assert.deepEqual(await probe, { type: 'ok' });
});

test('a stalled probe has a hard deadline even when abort is ignored', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let result: unknown;
  let signal: AbortSignal | undefined;
  void probeHealth(async (_url, init) => { signal = init.signal; return new Promise(() => {}); }, urls, 'dummy').then((r) => { result = r; });
  t.mock.timers.tick(20000); await flush();
  assert.deepEqual(result, { type: 'fail' });
  assert.equal(signal?.aborted, true);
});

test('fallback health path works; denied is preserved if the fallback stalls', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.deepEqual(await probeHealth(async (url) => ({ ok: url === urls[1], status: url === urls[1] ? 200 : 404 }), urls, 'dummy'), { type: 'ok' });
  const probe = probeHealth(async (url) => url === urls[0] ? { ok: false, status: 401 } : new Promise(() => {}), urls, 'dummy');
  await flush(); t.mock.timers.tick(20000); await flush();
  assert.deepEqual(await probe, { type: 'denied' });
});

test('budget is a parameter (short first probe)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let result: unknown;
  void probeHealth(async () => new Promise(() => {}), urls, 'dummy', { timeoutMs: 8000 }).then((r) => { result = r; });
  t.mock.timers.tick(7999); await flush();
  assert.equal(result, undefined);
  t.mock.timers.tick(1); await flush();
  assert.deepEqual(result, { type: 'fail' });
});

test('an aborted probe (cleanup / profile change / offline event) reports nothing and aborts the request', async () => {
  const ctrl = new AbortController();
  let signal: AbortSignal | undefined;
  const probe = probeHealth(async (_url, init) => { signal = init.signal; return new Promise(() => {}); }, urls, 'dummy', { signal: ctrl.signal });
  await flush();
  ctrl.abort();
  assert.equal(await probe, null);
  assert.equal(signal?.aborted, true);
  const pre = new AbortController();
  pre.abort();
  let calls = 0;
  assert.equal(await probeHealth(async () => (calls++, { ok: true, status: 200 }), urls, 'dummy', { signal: pre.signal }), null);
  assert.equal(calls, 0);
});
