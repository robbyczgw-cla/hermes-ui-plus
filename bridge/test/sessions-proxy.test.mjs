// Hermes sessions / model-options allow-list pass-through: real bridge in front of a fake upstream.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';

const TOKEN = 'bridge-token';
const UP_KEY = 'upstream-secret';
let upstream; let bridge; let base;
/** @type {any[]} */ let seen = [];
let reply = (req, res) => { res.writeHead(200, { 'content-type': 'application/json', connection: 'keep-alive', 'keep-alive': 'timeout=5' }); res.end('{"ok":true}'); };

before(async () => {
  upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    reply(req, res);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  ({ server: bridge } = createServer({
    HERMES_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`, HERMES_API_KEY: UP_KEY, BRIDGE_TOKEN: TOKEN,
    BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'heuristic',
  }, { logger: silentLogger }));
  bridge.listen(0, '127.0.0.1');
  await once(bridge, 'listening');
  base = `http://127.0.0.1:${bridge.address().port}`;
});
after(() => { for (const s of [bridge, upstream]) { s.close(); s.closeAllConnections(); } });

function call(path, { method = 'GET', headers = {}, body, auth = `Bearer ${TOKEN}` } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (auth) h.authorization = auth;
    // `path` option, not a URL string: a URL would normalize `..` / `%2e%2e` on the client side before sending
    const req = http.request({ host: '127.0.0.1', port: Number(new URL(base).port), path, method, headers: h, agent: false }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(c).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('allowed routes are forwarded with the upstream key, never the client token', async () => {
  const cases = [
    ['GET', '/api/sessions'], ['GET', '/api/sessions/abc-123'], ['PATCH', '/api/sessions/abc-123'],
    ['DELETE', '/api/sessions/abc-123'], ['GET', '/api/sessions/abc-123/messages'], ['GET', '/api/model/options'],
    ['GET', '/v1/capabilities'],
  ];
  for (const [method, path] of cases) {
    seen = [];
    const r = await call(path, { method, body: method === 'PATCH' ? '{"title":"x"}' : undefined, headers: method === 'PATCH' ? { 'content-type': 'application/json' } : {} });
    assert.equal(r.status, 200, `${method} ${path}`);
    assert.equal(r.text, '{"ok":true}');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, method);
    assert.equal(seen[0].url, path);
    assert.equal(seen[0].headers.authorization, `Bearer ${UP_KEY}`);
    assert.equal(r.headers['x-hermes-ui-bridge'], '1');
    assert.equal(r.headers['keep-alive'], undefined, 'hop-by-hop stripped');
  }
});

test('PATCH body is forwarded intact', async () => {
  seen = [];
  await call('/api/sessions/s1', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"title":"Grüße"}' });
  assert.equal(seen[0].body, '{"title":"Grüße"}');
  assert.equal(seen[0].headers['content-type'], 'application/json');
});

test('POST /api/sessions/{id}/fork is allowed and forwards its body (app /branch)', async () => {
  seen = [];
  const r = await call('/api/sessions/s1/fork', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"title":"Zweig"}' });
  assert.equal(r.headers['x-hermes-ui-bridge'], '1');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/api/sessions/s1/fork');
  assert.equal(seen[0].body, '{"title":"Zweig"}');
  seen = [];
  const bad = await call('/api/sessions/s1/fork', { method: 'GET' });
  assert.equal(bad.status, 405);
  assert.equal(seen.length, 0);
});

test('POST /api/sessions/{id}/model (Hermes v0.22 session model lock) is allowed, POST only, body capped at 8 KB', async () => {
  seen = [];
  const r = await call('/api/sessions/s1/model', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"model":"alias-main"}' });
  assert.equal(r.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/api/sessions/s1/model');
  assert.equal(seen[0].body, '{"model":"alias-main"}');
  assert.equal(seen[0].headers.authorization, `Bearer ${UP_KEY}`);
  seen = [];
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    const bad = await call('/api/sessions/s1/model', { method, body: method === 'GET' ? undefined : '{}' });
    assert.equal(bad.status, 405, method);
    assert.equal(bad.headers.allow, 'POST');
  }
  const big = await call('/api/sessions/s1/model', { method: 'POST', body: `{"model":"${'x'.repeat(8 * 1024)}"}`, headers: { 'content-type': 'application/json' } }).catch((e) => ({ status: `err ${e.code}` }));
  assert.ok(big.status === 413 || /ECONNRESET|EPIPE/.test(String(big.status)), String(big.status));
  for (const p of ['/api/sessions/s1/model/x', '/api/sessions/a..b/model', '/api/sessions/%41/model']) {
    const r2 = await call(p, { method: 'POST', body: '{}' }).catch((e) => ({ status: `err ${e.code}` }));
    assert.ok(r2.status === 404 || r2.status === 400, `${p}: ${r2.status}`);
  }
  assert.equal(seen.length, 0);
});

test('query strings are forwarded verbatim', async () => {
  seen = [];
  await call('/api/sessions?limit=20&offset=40&q=a%20b&source=x&x=1&x=2');
  await call('/api/sessions/s1/messages?after=5&limit=100');
  assert.equal(seen[0].url, '/api/sessions?limit=20&offset=40&q=a%20b&source=x&x=1&x=2');
  assert.equal(seen[1].url, '/api/sessions/s1/messages?after=5&limit=100');
});

test('auth: missing or wrong bridge token -> 401, nothing reaches upstream', async () => {
  seen = [];
  assert.equal((await call('/api/sessions', { auth: null })).status, 401);
  assert.equal((await call('/api/sessions', { auth: `Bearer ${UP_KEY}` })).status, 401);
  assert.equal((await call('/api/sessions/x', { method: 'DELETE', auth: 'Bearer nope' })).status, 401);
  assert.equal(seen.length, 0);
});

test('denied paths -> 404 without touching upstream', async () => {
  seen = [];
  const paths = [
    '/api', '/api/', '/api/other', '/api/sessions/', '/api/sessions/a/b', '/api/sessions/a/messages/x', '/api/sessions/a/export',
    '/api/model', '/api/model/options/x', '/api/config', '/api/sessions//messages',
    '/api/sessions/..', '/api/sessions/a..b', '/api/sessions/..%2Fx', '/api/sessions/%2e%2e', '/api/sessions/a%2Fb', '/api/sessions/a%00',
    '/api/sessions/a%20b', '/api/sessions/' + 'a'.repeat(129), '/api/sessions/%41', '/api/sessions/a;b', '/api/sessions/a\\b',
  ];
  for (const p of paths) {
    const r = await call(p, { method: 'DELETE' }).catch((e) => ({ status: `err ${e.code}` }));
    assert.ok(r.status === 404 || r.status === 400, `${p}: ${r.status}`); // 400 = rejected by the path check (M1)
  }
  assert.equal(seen.length, 0);
});

// Security review M1: `/v1/*` used to be passed through with the raw URL, which the upstream request resolved,
// so `/v1/../api/jobs` reached Hermes as `/api/jobs` and skipped the `/api` allow-list.
test('M1: dot segments / encoded traversal never reach upstream, whatever the prefix', async () => {
  seen = [];
  const paths = [
    '/v1/../api/jobs', '/v1/%2e%2e/api/jobs', '/v1/%2E%2E/api/jobs', '/v1/.%2e/api/jobs', '/v1/%2e./api/jobs',
    '/v1/./../api/jobs', '/v1/..', '/v1/models/..', '/v1/../health/detailed', '/v1/..%2fapi/jobs', '/v1/%2f%2fapi',
    '/v1/..\\api/jobs', '/v1/%5c..%5capi', '/v1//api/jobs', '/v1/%252e%252e/api/jobs', '/v1/models%00', '/./v1/models',
    '/bridge/../api/jobs', '/api/sessions/../../api/jobs', '/v1/models/./x',
  ];
  for (const method of ['GET', 'DELETE', 'POST']) {
    for (const p of paths) {
      const r = await call(p, { method }).catch((e) => ({ status: `err ${e.code}` }));
      assert.ok(r.status === 400 || r.status === 404, `${method} ${p}: ${r.status}`);
    }
  }
  assert.deepEqual(seen.map((x) => `${x.method} ${x.url}`), []);
  // the normal paths still work
  assert.equal((await call('/v1/models')).status, 200);
  assert.equal(seen.at(-1).url, '/v1/models');
});

test('M1: rejected before auth too (unauthenticated probes learn nothing)', async () => {
  seen = [];
  assert.equal((await call('/v1/../api/jobs', { auth: null })).status, 400);
  assert.equal((await call('/v1/%2e%2e/health/detailed', { auth: null })).status, 400);
  assert.equal(seen.length, 0);
});

test('id validation: allowed charset and max length pass', async () => {
  for (const id of ['20261010_abc-DEF.1:2', 'a'.repeat(128)]) {
    assert.equal((await call(`/api/sessions/${id}`)).status, 200, id);
  }
});

test('method restrictions -> 405 with Allow, nothing upstream', async () => {
  seen = [];
  const cases = [
    // POST /api/sessions: only the bot's "Bot Chat" (test/bot-chat.test.mjs); '{}' is refused there with 403
    ['PUT', '/api/sessions', 'GET'], ['DELETE', '/api/sessions', 'GET'],
    ['POST', '/api/sessions/a', 'GET, PATCH, DELETE'], ['PUT', '/api/sessions/a', 'GET, PATCH, DELETE'],
    ['PATCH', '/api/sessions/a/messages', 'GET'], ['DELETE', '/api/sessions/a/messages', 'GET'],
    ['POST', '/api/model/options', 'GET'], ['PATCH', '/api/model/options', 'GET'],
  ];
  for (const [method, path, allow] of cases) {
    const r = await call(path, { method, body: method === 'GET' ? undefined : '{}' });
    assert.equal(r.status, 405, `${method} ${path}`);
    assert.equal(r.headers.allow, allow);
  }
  assert.equal(seen.length, 0);
});

test('PATCH body over 64 KB -> 413, at the limit passes', async () => {
  seen = [];
  const big = await call('/api/sessions/a', { method: 'PATCH', body: 'x'.repeat(64 * 1024 + 1), headers: { 'content-type': 'application/json' } }).catch((e) => ({ status: `err ${e.code}` }));
  assert.ok(big.status === 413 || /ECONNRESET|EPIPE/.test(String(big.status)), String(big.status));
  assert.equal(seen.length, 0);
  const ok = await call('/api/sessions/a', { method: 'PATCH', body: 'x'.repeat(64 * 1024), headers: { 'content-type': 'application/json' } });
  assert.equal(ok.status, 200);
});

test('upstream status and JSON body pass through (404, 409, 500)', async () => {
  for (const status of [404, 409, 500]) {
    reply = (req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: `e${status}` } })); };
    const r = await call('/api/sessions/zz');
    assert.equal(r.status, status);
    assert.equal(JSON.parse(r.text).error.code, `e${status}`);
  }
  reply = (req, res) => { res.writeHead(204); res.end(); };
  assert.equal((await call('/api/sessions/zz', { method: 'DELETE' })).status, 204);
});

test('upstream down -> 502', async () => {
  const { server } = createServer({ HERMES_BASE_URL: 'http://127.0.0.1:1/v1', BRIDGE_TOKEN: TOKEN, BRIDGE_ROUTER: 'heuristic', BRIDGE_BOOTSTRAP: 'off' }, { logger: silentLogger });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const res = await new Promise((resolve) => http.get(`http://127.0.0.1:${server.address().port}/api/sessions`, { headers: { authorization: `Bearer ${TOKEN}` }, agent: false }, (x) => { x.resume(); resolve(x.statusCode); }));
    assert.equal(res, 502);
  } finally { server.close(); server.closeAllConnections(); }
});
