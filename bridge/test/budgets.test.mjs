// GPT security M5: request budgets (concurrent turns per credential and in total, health passthroughs, hook body deadline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';

const TOKEN = 'tok-budget-test-000001';

async function hangingUpstream() {
  const held = [];
  const up = http.createServer((req, res) => { req.resume(); held.push(res); }); // never answers
  up.listen(0, '127.0.0.1');
  await once(up, 'listening');
  return { url: `http://127.0.0.1:${up.address().port}`, close: () => { for (const r of held) r.destroy(); up.closeAllConnections(); up.close(); } };
}

async function bridge(env) {
  const ctx = createServer({ BRIDGE_TOKEN: TOKEN, BRIDGE_ROUTER: 'off', BRIDGE_BOOTSTRAP: 'off', ...env }, { logger: silentLogger, backend: null });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  return { ...ctx, base: `http://127.0.0.1:${ctx.server.address().port}`, close: () => { ctx.server.closeAllConnections(); ctx.server.close(); ctx.push.stop(); } };
}

test('concurrent chat turns are capped per credential', async () => {
  const up = await hangingUpstream();
  const b = await bridge({ HERMES_BASE_URL: up.url, BRIDGE_MAX_CONCURRENT_TURNS: '2' });
  const ctrl = new AbortController();
  const turn = (signal = ctrl.signal) => fetch(`${b.base}/v1/chat/completions`, { method: 'POST', signal, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'hermes', stream: true, messages: [{ role: 'user', content: 'hi' }] }) }).catch(() => null);
  try {
    void turn(); void turn();
    await new Promise((r) => setTimeout(r, 200));
    const third = await turn(AbortSignal.any([ctrl.signal, AbortSignal.timeout(2000)]));
    assert.equal(third?.status, 429);
  } finally {
    ctrl.abort();
    b.close();
    up.close();
  }
});

/** Upstream that holds every chat turn open until release(); records arrivals. */
async function heldUpstream() {
  const held = [];
  let arrivals = 0;
  const up = http.createServer((req, res) => {
    req.resume();
    arrivals++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n');
    held.push(res);
  });
  up.listen(0, '127.0.0.1');
  await once(up, 'listening');
  return {
    url: `http://127.0.0.1:${up.address().port}`,
    arrivals: () => arrivals,
    /** finish the oldest held turn */
    finish: () => { const r = held.shift(); r?.end('data: [DONE]\n\n'); },
    close: () => { for (const r of held) r.destroy(); up.closeAllConnections(); up.close(); },
  };
}

const chat = (base, signal) => fetch(`${base}/v1/chat/completions`, { method: 'POST', signal, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'hermes', stream: true, messages: [{ role: 'user', content: 'hi' }] }) });
const until = async (cond, ms = 2000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };

test('a client disconnect keeps the turn slot until the upstream turn really ends', async () => {
  const up = await heldUpstream();
  const b = await bridge({ HERMES_BASE_URL: up.url, BRIDGE_MAX_CONCURRENT_TURNS: '1' });
  try {
    const ctrl = new AbortController();
    const first = await chat(b.base, ctrl.signal);
    assert.equal(first.status, 200);
    await until(() => up.arrivals() === 1);
    ctrl.abort(); // phone goes away; the bridge keeps the Hermes run going (detached)
    await new Promise((r) => setTimeout(r, 150));
    const second = await chat(b.base, AbortSignal.timeout(2000));
    assert.equal(second.status, 429, 'detached run still counts');
    assert.equal(second.headers.get('retry-after'), '5');
    await second.text();
    assert.equal(up.arrivals(), 1);

    up.finish(); // Hermes finishes the detached turn → slot free
    await new Promise((r) => setTimeout(r, 150));
    const ctrl3 = new AbortController();
    const third = await chat(b.base, ctrl3.signal);
    assert.equal(third.status, 200);
    await until(() => up.arrivals() === 2);
    ctrl3.abort();
  } finally {
    b.close();
    up.close();
  }
});

test('global turn cap (BRIDGE_MAX_TURNS_TOTAL below the per-credential cap) → 429 with retry-after; slots come back when upstream turns end', async () => {
  const up = await heldUpstream();
  const b = await bridge({ HERMES_BASE_URL: up.url, BRIDGE_MAX_CONCURRENT_TURNS: '8', BRIDGE_MAX_TURNS_TOTAL: '2' });
  const ctrl = new AbortController();
  try {
    assert.equal((await chat(b.base, ctrl.signal)).status, 200);
    assert.equal((await chat(b.base, ctrl.signal)).status, 200);
    await until(() => up.arrivals() === 2);
    const third = await chat(b.base, AbortSignal.timeout(2000));
    assert.equal(third.status, 429);
    assert.equal(third.headers.get('retry-after'), '5');
    assert.match((await third.json()).error.message, /on this bridge/);
    up.finish();
    await new Promise((r) => setTimeout(r, 150));
    assert.equal((await chat(b.base, ctrl.signal)).status, 200);
    await until(() => up.arrivals() === 3);
  } finally {
    ctrl.abort();
    b.close();
    up.close();
  }
});

test('turns that never reach upstream or fail upstream release their slot', async () => {
  const b = await bridge({ HERMES_BASE_URL: 'http://127.0.0.1:9', BRIDGE_MAX_CONCURRENT_TURNS: '1', BRIDGE_MAX_TURNS_TOTAL: '1', BRIDGE_MAX_BODY_BYTES: '512' });
  try {
    for (let i = 0; i < 3; i++) {
      const r = await chat(b.base, AbortSignal.timeout(3000));
      assert.equal(r.status, 502, `turn ${i}`); // upstream unreachable, not 429
      await r.text();
    }
    const big = await fetch(`${b.base}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: 'x'.repeat(4000) }).catch(() => null);
    if (big) await big.text();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await chat(b.base, AbortSignal.timeout(3000))).status, 502);
  } finally {
    b.close();
  }
});

test('unauthenticated health passthroughs in flight are capped', async () => {
  const up = await hangingUpstream();
  const b = await bridge({ HERMES_BASE_URL: up.url, BRIDGE_MAX_HEALTH_INFLIGHT: '2' });
  const ctrl = new AbortController();
  try {
    for (let i = 0; i < 2; i++) void fetch(`${b.base}/health`, { signal: ctrl.signal }).catch(() => null);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal((await fetch(`${b.base}/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null))?.status, 503);
  } finally {
    ctrl.abort();
    b.close();
    up.close();
  }
});

test('an unfinished unauthenticated hook body is cut off after the read deadline', async () => {
  const b = await bridge({ HERMES_BASE_URL: 'http://127.0.0.1:9', BRIDGE_PUSH_HOOK_SECRET: 'fake-hook-secret-0000', BRIDGE_PUSH_HOOK_READ_MS: '150' });
  try {
    const sock = net.connect(Number(new URL(b.base).port), '127.0.0.1');
    await once(sock, 'connect');
    sock.write('POST /bridge/hermes-hook HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"a":');
    const t0 = Date.now();
    await Promise.race([once(sock, 'close'), new Promise((_, rej) => setTimeout(() => rej(new Error('socket still open')), 2000))]);
    assert.ok(Date.now() - t0 < 2000);
    sock.destroy();
  } finally {
    b.close();
  }
});
