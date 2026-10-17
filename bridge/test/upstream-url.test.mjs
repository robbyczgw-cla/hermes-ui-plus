// Upstream URLs keep the path of HERMES_BASE_URL (reverse-proxy sub-path, /p/<profile> prefixes) and can never
// leave it. Unit tests for paths.mjs `upstreamUrl` + a real bridge in front of a fake upstream with a base path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { upstreamUrl } from '../src/paths.mjs';
import { normalizeBaseUrl } from '../src/config.mjs';
import { preflight } from '../src/cli.mjs';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';

const TOKEN = 'bridge-token-upstream-url-test';

test('upstreamUrl: base without path', () => {
  assert.equal(upstreamUrl('http://192.0.2.1:8642', '/v1/models').href, 'http://192.0.2.1:8642/v1/models');
  assert.equal(upstreamUrl('http://192.0.2.1:8642/', '/v1/models?a=1&b=x%20y').href, 'http://192.0.2.1:8642/v1/models?a=1&b=x%20y');
  assert.equal(upstreamUrl('https://example.com', '/health').href, 'https://example.com/health');
});

test('upstreamUrl: base with a path keeps it (also after normalizeBaseUrl strips /v1)', () => {
  const base = normalizeBaseUrl('http://192.0.2.1:8642/p/work/v1/');
  assert.equal(base, 'http://192.0.2.1:8642/p/work');
  assert.equal(upstreamUrl(base, '/v1/chat/completions').href, 'http://192.0.2.1:8642/p/work/v1/chat/completions');
  assert.equal(upstreamUrl(base, '/api/sessions?limit=25').href, 'http://192.0.2.1:8642/p/work/api/sessions?limit=25');
  assert.equal(upstreamUrl('https://example.com/hermes/', '/health').href, 'https://example.com/hermes/health');
  // base search / hash are dropped, the request's query wins
  assert.equal(upstreamUrl('https://example.com/hermes?x=1#f', '/v1/models').href, 'https://example.com/hermes/v1/models');
});

test('upstreamUrl: request paths with a /p/<profile>/ prefix are appended as-is', () => {
  assert.equal(upstreamUrl('http://192.0.2.1:8642', '/p/bot/v1/models?x=1').href, 'http://192.0.2.1:8642/p/bot/v1/models?x=1');
  assert.equal(upstreamUrl('https://example.com/hermes', '/p/bot/api/sessions/abc').href, 'https://example.com/hermes/p/bot/api/sessions/abc');
});

test('upstreamUrl: the request can never escape the base path', () => {
  const bad = [
    '/../x', '/v1/../../x', '/./v1', '/v1/%2e%2e/x', '/v1/%2E./x', '/v1/.%2e', '//example.net/x', 'http://example.net/x',
    'v1/models', '', '/v1\\..\\x', '/v1#frag', '/v1/models?x#y', '/v1/\u0000',
  ];
  for (const t of bad) assert.throws(() => upstreamUrl('https://example.com/hermes', t), Error, JSON.stringify(t));
});

test('preflight uses the base path too', async () => {
  const seen = [];
  const fetch = async (url) => { seen.push(String(url)); return new Response('{"data":[]}', { status: 200 }); };
  await preflight({ upstream: { baseUrl: 'https://example.com/hermes', apiKey: '' } }, { fetch });
  assert.deepEqual(seen, ['https://example.com/hermes/health', 'https://example.com/hermes/v1/models', 'https://example.com/hermes/v1/skills']);
});

async function setup(basePath) {
  const seen = [];
  const upstream = http.createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    seen.push(`${req.method} ${req.url}`);
    if (req.url?.endsWith('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"choices":[{"message":{"role":"assistant","content":"ok"}}]}');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const { server, push } = createServer({
    HERMES_BASE_URL: `http://127.0.0.1:${upstream.address().port}${basePath}`, BRIDGE_TOKEN: TOKEN,
    BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'off',
  }, { logger: silentLogger, backend: null });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, method = 'GET', body) => fetch(base + p, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body });
  const close = () => { push.stop(); for (const s of [server, upstream]) { s.closeAllConnections(); s.close(); } };
  return { seen, call, base, close };
}

for (const [basePath, prefix] of [['', ''], ['/v1', ''], ['/p/work/v1', '/p/work'], ['/hermes/', '/hermes']]) {
  test(`bridge forwards below the base path (HERMES_BASE_URL path "${basePath}")`, async () => {
    const b = await setup(basePath);
    try {
      assert.equal((await b.call('/v1/models?x=1')).status, 200);
      assert.equal((await b.call('/api/sessions?limit=5')).status, 200);
      assert.equal((await b.call('/v1/runs/chatcmpl-1')).status, 200);
      assert.equal((await b.call('/v1/chat/completions', 'POST', JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }))).status, 200);
      assert.equal((await fetch(`${b.base}/health`)).status, 200);
      assert.deepEqual(b.seen, [
        `GET ${prefix}/v1/models?x=1`, `GET ${prefix}/api/sessions?limit=5`, `GET ${prefix}/v1/runs/chatcmpl-1`,
        `POST ${prefix}/v1/chat/completions`, `GET ${prefix}/health`,
      ]);
    } finally {
      b.close();
    }
  });
}
