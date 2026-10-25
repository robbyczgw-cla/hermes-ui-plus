// /v1 pass-through is an explicit method + path allow-list (docs/BRIDGE.md, "Narrow pass-through"): only what the app
// calls reaches Hermes. Unknown → 404, wrong method → 405 + Allow, nothing upstream in either case.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';

const TOKEN = 'bridge-token-v1-allowlist-test';
const UP_KEY = 'upstream-secret-test';
let upstream; let ctx; let port;
/** @type {string[]} */ let seen = [];

before(async () => {
  upstream = http.createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    seen.push(`${req.method} ${req.url} ${req.headers.authorization}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  ctx = createServer({
    HERMES_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`, HERMES_API_KEY: UP_KEY, BRIDGE_TOKEN: TOKEN,
    BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'off',
  }, { logger: silentLogger, backend: null });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  port = ctx.server.address().port;
});
after(() => { ctx.push.stop(); for (const s of [ctx.server, upstream]) { s.closeAllConnections(); s.close(); } });

/** raw request-target (no client-side URL normalisation) */
function call(path, { method = 'GET', auth = `Bearer ${TOKEN}`, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) };
    const req = http.request({ host: '127.0.0.1', port, path, method, headers, agent: false }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(c).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('allowed: exactly the endpoints the app calls, forwarded with the upstream key', async () => {
  const cases = [
    ['GET', '/v1/models'], ['GET', '/v1/models?limit=5'], ['GET', '/v1/capabilities'], ['GET', '/v1/skills'],
    ['GET', '/v1/runs/chatcmpl-abc123'], ['POST', '/v1/runs/chatcmpl-abc123/approval'],
    ['POST', '/v1/runs/chatcmpl-abc123/stop'], ['POST', '/v1/runs/chatcmpl-abc123/resolve-unknown'],
  ];
  for (const [method, path] of cases) {
    seen = [];
    const r = await call(path, { method, body: method === 'POST' ? '{"choice":"once"}' : undefined });
    assert.equal(r.status, 200, `${method} ${path}`);
    // an approval answer the bridge never saw a request for: one run status lookup for a v0.22.3+ generation first
    const lookup = path.endsWith('/approval') ? [`GET ${path.replace(/\/approval$/, '')} Bearer ${UP_KEY}`] : [];
    assert.deepEqual(seen, [...lookup, `${method} ${path} Bearer ${UP_KEY}`]);
  }
});

test('refused with 404: everything the app does not use (never forwarded)', async () => {
  seen = [];
  const cases = [
    ['POST', '/v1/runs'], ['GET', '/v1/runs'], ['GET', '/v1/runs/chatcmpl-1/events'], ['POST', '/v1/runs/chatcmpl-1/stops'],
    ['POST', '/v1/runs/chatcmpl-1/steer'], ['POST', '/v1/responses'], ['GET', '/v1/responses/resp_1'], ['DELETE', '/v1/responses/resp_1'],
    ['GET', '/v1/toolsets'], ['GET', '/v1/artifacts'], ['GET', '/v1/artifacts/a1'], ['POST', '/v1/artifacts'], ['GET', '/v1/attachments/x'],
    ['POST', '/v1/files'], ['GET', '/v1/models/hermes-agent'], ['GET', '/v1/skills/x'], ['POST', '/v1/completions'], ['GET', '/v1/x'],
    ['GET', '/v1/'], ['GET', '/v1'], ['GET', '/health/detailed'], ['POST', '/v1/browser/open'],
    // run ids: plain [A-Za-z0-9._:-]{1,128}, no `..`, no %-escapes
    ['GET', '/v1/runs/a..b'], ['POST', '/v1/runs/a%3Ab/approval'], ['GET', `/v1/runs/${'a'.repeat(129)}`],
    ['GET', '/v1/models%20'],
  ];
  for (const [method, path] of cases) {
    const r = await call(path, { method }).catch((e) => ({ status: `err ${e.code}` }));
    assert.ok(r.status === 404 || r.status === 400, `${method} ${path}: ${r.status}`);
  }
  assert.deepEqual(seen, []);
});

test('wrong method on an allowed path → 405 with Allow, nothing upstream', async () => {
  seen = [];
  const cases = [
    ['POST', '/v1/models', 'GET'], ['DELETE', '/v1/models', 'GET'], ['PUT', '/v1/capabilities', 'GET'], ['POST', '/v1/skills', 'GET'],
    ['POST', '/v1/runs/chatcmpl-1', 'GET'], ['DELETE', '/v1/runs/chatcmpl-1', 'GET'], ['GET', '/v1/runs/chatcmpl-1/approval', 'POST'],
    ['GET', '/v1/runs/chatcmpl-1/stop', 'POST'], ['GET', '/v1/runs/chatcmpl-1/resolve-unknown', 'POST'],
    ['GET', '/v1/chat/completions', 'POST'], ['PUT', '/v1/chat/completions', 'POST'], ['POST', '/v1/health', 'GET'],
  ];
  for (const [method, path, allow] of cases) {
    const r = await call(path, { method });
    assert.equal(r.status, 405, `${method} ${path}`);
    assert.equal(r.headers.allow, allow, `${method} ${path}`);
  }
  assert.deepEqual(seen, []);
});

test('allowed /v1 paths still need the bridge token', async () => {
  seen = [];
  for (const p of ['/v1/models', '/v1/skills', '/v1/runs/chatcmpl-1']) assert.equal((await call(p, { auth: null })).status, 401);
  assert.equal((await call('/v1/runs/chatcmpl-1/approval', { method: 'POST', auth: 'Bearer wrong' })).status, 401);
  assert.deepEqual(seen, []);
});
