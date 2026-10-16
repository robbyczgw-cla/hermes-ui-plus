import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';

async function fixture(t, extra = {}) {
  const seen = [];
  const upstream = http.createServer(async (req, res) => {
    for await (const _ of req) { /* consume local test data */ }
    seen.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const ctx = createServer({
    HERMES_BASE_URL: `http://127.0.0.1:${upstream.address().port}`,
    HERMES_HOME: '/nonexistent-hermes-home-test',
    HERMES_API_KEY: 'test-upstream-key', BRIDGE_ALLOW_NO_AUTH: '1',
    BRIDGE_ROUTER: 'off', BRIDGE_BOOTSTRAP: 'off', BRIDGE_PROFILES: 'writer', ...extra,
  }, { logger: silentLogger });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  t.after(() => {
    ctx.push.stop();
    ctx.server.closeAllConnections(); ctx.server.close();
    upstream.closeAllConnections(); upstream.close();
  });
  const base = `http://127.0.0.1:${ctx.server.address().port}`;
  return { ctx, base, seen };
}

test('open local development mode refuses cross-origin simple state changes before dispatch', async (t) => {
  const { base, seen } = await fixture(t);
  for (const path of ['/v1/chat/completions', '/p/writer/v1/chat/completions', '/api/sessions/test-session/fork', '/bridge/chat/stop', '/bridge/uploads', '/bridge/devices']) {
    for (const origin of ['https://evil.example.com', 'null']) {
      const res = await fetch(base + path, {
        method: 'POST', headers: { origin, 'content-type': 'text/plain' },
        body: '{"sessionId":"test-session","messages":[{"role":"user","content":"test"}]}',
      });
      assert.equal(res.status, 403, `${path}: ${origin}`);
      assert.equal((await res.json()).error.code, 'origin_forbidden');
    }
  }
  for (const method of ['PATCH', 'DELETE']) {
    const res = await fetch(base + '/api/sessions/test-session', {
      method, headers: { origin: 'https://evil.example.com', 'content-type': 'text/plain' }, body: '{}',
    });
    assert.equal(res.status, 403);
    await res.text();
  }
  const metadata = await fetch(base + '/bridge/chat/stop', {
    method: 'POST', headers: { 'sec-fetch-site': 'cross-site' }, body: '{}',
  });
  assert.equal(metadata.status, 403);
  await metadata.text();
  assert.deepEqual(seen, []);
});

test('open mode accepts the configured public origin behind TLS termination and an explicit CORS wildcard', async (t) => {
  for (const extra of [{ BRIDGE_PUBLIC_URL: 'https://bridge.example.com' }, { BRIDGE_CORS_ORIGINS: '*' }]) {
    const { base } = await fixture(t, extra);
    const res = await fetch(base + '/bridge/chat/stop', {
      method: 'POST', headers: { origin: 'https://bridge.example.com' }, body: '{"sessionId":"test-session"}',
    });
    assert.equal(res.status, 200);
    await res.text();
  }
});

test('open mode keeps native callers, same-origin web clients and explicit CORS origins working', async (t) => {
  const { base, seen } = await fixture(t, { BRIDGE_CORS_ORIGINS: 'https://app.example.com' });
  for (const origin of [undefined, base, 'https://app.example.com']) {
    const res = await fetch(base + '/api/sessions/test-session/fork', {
      method: 'POST', headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(res.status, 200);
    await res.text();
  }
  assert.equal(seen.length, 3);
});

test('Bearer auth prevents simple CSRF; CORS grants response access only to configured origins', async (t) => {
  const { base, seen } = await fixture(t, { BRIDGE_TOKEN: 'test-origin-admin-token', BRIDGE_CORS_ORIGINS: 'https://app.example.com' });
  for (const origin of ['https://evil.example.com', 'null', 'https://app.example.com']) {
    const res = await fetch(base + '/api/sessions/test-session/fork', {
      method: 'POST', headers: { origin, 'content-type': 'text/plain' }, body: '{}',
    });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('access-control-allow-origin'), origin === 'https://app.example.com' ? origin : null);
    await res.text();
  }
  assert.deepEqual(seen, []);
});
