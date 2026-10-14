import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once, EventEmitter } from 'node:events';
import { createServer, installShutdownHandlers } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';

for (const sessionId of ['hui-test-detached', undefined]) {
  test(`graceful shutdown drains a detached turn (${sessionId ? 'session' : 'no session header'})`, { timeout: 3000 }, async (t) => {
    let finish;
    let upstreamAborted = false;
    const upstream = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Working"}}]}\n\n');
      res.on('close', () => { upstreamAborted = !res.writableFinished; });
      finish = () => res.end('data: [DONE]\n\n');
    });
    t.after(() => { upstream.close(); upstream.closeAllConnections(); });
    upstream.listen(0, 'localhost');
    await once(upstream, 'listening');
    const ctx = createServer({
      HERMES_BASE_URL: `http://localhost:${upstream.address().port}/v1`,
      BRIDGE_TOKEN: 'dummy-test-token', BRIDGE_ROUTER: 'off', BRIDGE_BOOTSTRAP: 'off',
    }, { logger: silentLogger });
    t.after(() => { ctx.server.close(); ctx.server.closeAllConnections(); });
    ctx.server.listen(0, 'localhost');
    await once(ctx.server, 'listening');
    await new Promise((resolve, reject) => {
      const req = http.request(`http://localhost:${ctx.server.address().port}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer dummy-test-token', 'content-type': 'application/json',
          ...(sessionId ? { 'x-hermes-session-id': sessionId } : {}),
        },
      }, (res) => res.once('data', () => { req.destroy(); resolve(); }));
      req.on('error', reject);
      req.end(JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'test' }] }));
    });
    let closed = false;
    const closing = ctx.close().then(() => { closed = true; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(ctx.server.listening, false, 'stop accepting new turns');
    assert.equal(closed, false, 'do not exit while the detached upstream turn runs');
    assert.equal(upstreamAborted, false);
    finish();
    await closing;
    assert.equal(closed, true);
    assert.equal(upstreamAborted, false);
  });
}

async function lifetimeFixture(t, env, respond) {
  const upstream = http.createServer((req, res) => { req.resume(); respond(req, res); });
  upstream.listen(0, 'localhost');
  await once(upstream, 'listening');
  const warnings = [];
  const ctx = createServer({
    HERMES_BASE_URL: `http://localhost:${upstream.address().port}`,
    BRIDGE_TOKEN: 'dummy-test-token', BRIDGE_ROUTER: 'off', BRIDGE_BOOTSTRAP: 'off',
    BRIDGE_MAX_CONCURRENT_TURNS: '1', ...env,
  }, { logger: { ...silentLogger, warn: (message, fields) => warnings.push({ message, fields }) } });
  ctx.server.listen(0, 'localhost');
  await once(ctx.server, 'listening');
  t.after(() => {
    ctx.server.closeAllConnections(); ctx.server.close();
    upstream.closeAllConnections(); upstream.close();
  });
  const chat = () => fetch(`http://localhost:${ctx.server.address().port}/v1/chat/completions`, {
    method: 'POST', headers: { authorization: 'Bearer dummy-test-token' },
    body: JSON.stringify({ stream: true, messages: [] }),
  });
  return { ctx, chat, warnings };
}
const within = (p, ms = 2000) => Promise.race([p, new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error('deadline did not bound lifetime')), ms);
  timer.unref();
})]);

test('chat header deadline aborts an upstream that accepts but never responds, releasing its slot', async (t) => {
  let calls = 0;
  const f = await lifetimeFixture(t, { BRIDGE_CHAT_HEADER_TIMEOUT_MS: '100' }, (_q, r) => { if (++calls > 1) r.end('{}'); });
  assert.equal((await within(f.chat())).status, 504);
  assert.equal((await f.chat()).status, 200);
});

test('SSE clears the header deadline but the absolute turn ceiling ends it and frees the slot', async (t) => {
  let calls = 0;
  const f = await lifetimeFixture(t, { BRIDGE_CHAT_HEADER_TIMEOUT_MS: '100', BRIDGE_TURN_MAX_MS: '600' }, (_q, r) => {
    if (++calls > 1) return r.end('{}');
    r.writeHead(200, { 'content-type': 'text/event-stream' }); r.write('data: test\n\n');
  });
  const response = await f.chat();
  let ended = false;
  const body = response.text().catch(() => {}).then(() => { ended = true; });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(ended, false, 'header deadline must not become an SSE inactivity timeout');
  await within(body);
  assert.equal((await f.chat()).status, 200);
});

for (const detached of [false, true]) {
  test(`shutdown drain deadline closes a stuck ${detached ? 'detached' : 'attached'} turn`, async (t) => {
    const f = await lifetimeFixture(t, { BRIDGE_DRAIN_MS: '40' }, (_q, r) => {
      r.writeHead(200, { 'content-type': 'text/event-stream' }); r.write('data: test\n\n');
    });
    const response = await f.chat();
    if (detached) await response.body.cancel();
    else void response.text().catch(() => {});
    await within(f.ctx.close());
    assert.ok(f.warnings.some((w) => w.message === 'shutdown_drain_expired' && w.fields.turns.length === 1));
  });
}

for (const first of ['SIGTERM', 'SIGINT']) {
  test(`a second signal forces exit during ${first} drain`, () => {
    const signals = new EventEmitter();
    const exits = [];
    let stopped = 0;
    const remove = installShutdownHandlers({ close: () => new Promise(() => {}) }, () => { stopped++; }, { signals, exit: (code) => exits.push(code) });
    signals.emit(first);
    assert.deepEqual(exits, []);
    signals.emit(first === 'SIGTERM' ? 'SIGINT' : 'SIGTERM');
    assert.deepEqual(exits, [1]);
    assert.equal(stopped, 1);
    remove();
  });
}

test('turn ceiling also bounds a request body that never finishes', async (t) => {
  let calls = 0;
  const f = await lifetimeFixture(t, { BRIDGE_TURN_MAX_MS: '80' }, (_q, r) => { calls++; r.end('{}'); });
  const req = http.request({ hostname: 'localhost', port: f.ctx.server.address().port, path: '/v1/chat/completions', method: 'POST', headers: { authorization: 'Bearer dummy-test-token', 'content-length': '100' } });
  const ended = new Promise((resolve) => req.once('error', resolve));
  req.write('{');
  t.after(() => req.destroy());
  await within(ended);
  assert.equal(calls, 0);
  assert.equal((await f.chat()).status, 200, 'slot was released');
});

test('generated systemd unit leaves time for the default shutdown drain', async () => {
  const { systemdUnit } = await import('../src/setup/service.mjs');
  const { loadConfig } = await import('../src/config.mjs');
  const config = loadConfig({ HERMES_BASE_URL: 'http://localhost:9', BRIDGE_TOKEN: 'test-token' });
  const unit = systemdUnit({ argv: ['node', '/opt/bridge/server.mjs'], envFile: '/etc/bridge.env' });
  const timeoutSeconds = Number(unit.match(/^TimeoutStopSec=(\d+)$/m)?.[1]);
  assert.ok(timeoutSeconds * 1000 > config.drainMs);
  assert.equal(config.limits.turnMaxMs, 2 * 3600_000);
  assert.equal(config.limits.chatHeaderTimeoutMs, 60_000);
});

test('detached turns hit the ceiling and return their budget slot', async (t) => {
  let calls = 0;
  const f = await lifetimeFixture(t, { BRIDGE_TURN_MAX_MS: '250' }, (_q, r) => {
    if (++calls > 1) return r.end('{}');
    r.writeHead(200, { 'content-type': 'text/event-stream' }); r.write('data: test\n\n');
  });
  const response = await f.chat();
  await response.body.cancel();
  assert.equal((await f.chat()).status, 429);
  await new Promise((r) => setTimeout(r, 350));
  assert.equal((await f.chat()).status, 200);
});

test('chat header deadline includes a stalled TLS handshake', async (t) => {
  const net = await import('node:net');
  const sockets = new Set();
  const upstream = net.createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  upstream.listen(0, 'localhost');
  await once(upstream, 'listening');
  const ctx = createServer({ HERMES_BASE_URL: `https://localhost:${upstream.address().port}`, BRIDGE_TOKEN: 'dummy-test-token', BRIDGE_ROUTER: 'off', BRIDGE_BOOTSTRAP: 'off', BRIDGE_CHAT_HEADER_TIMEOUT_MS: '100' }, { logger: silentLogger });
  ctx.server.listen(0, 'localhost');
  await once(ctx.server, 'listening');
  t.after(() => { ctx.server.closeAllConnections(); ctx.server.close(); for (const socket of sockets) socket.destroy(); upstream.close(); });
  const response = await within(fetch(`http://localhost:${ctx.server.address().port}/v1/chat/completions`, {
    method: 'POST', headers: { authorization: 'Bearer dummy-test-token' }, body: '{}',
  }));
  assert.equal(response.status, 504);
});
