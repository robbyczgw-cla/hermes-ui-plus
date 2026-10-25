// The desktop app (Tauri) calls the bridge from its own origin: tauri://localhost (macOS, Linux) or
// http://tauri.localhost (Windows). With the configuration the setup wizard writes (no BRIDGE_CORS_ORIGINS) it must be
// able to pair and chat: preflight, pairing redeem, authenticated calls on every route family (src/cors.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.mjs';
import { parseArgs, prepareEnv, featureSummary } from '../src/cli.mjs';
import { DESKTOP_ORIGINS, corsHeaders, corsOriginsFromEnv, describeOrigins } from '../src/cors.mjs';
import { silentLogger } from '../src/log.mjs';

const FOREIGN = 'https://evil.example.com';

/** Mock Hermes: models, sessions and a streamed chat answer. */
async function mockHermes(t) {
  const seen = [];
  const upstream = http.createServer(async (req, res) => {
    for await (const _ of req) { /* consume */ }
    seen.push(`${req.method} ${req.url}`);
    if (req.url.startsWith('/v1/chat/completions')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hallo test"}}]}\n\n');
      return res.end('data: [DONE]\n\n');
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(req.url.startsWith('/v1/models') ? '{"object":"list","data":[{"id":"hermes-agent"}]}' : '{"ok":true}');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  return { url: `http://127.0.0.1:${upstream.address().port}`, seen };
}

/**
 * A bridge started like `hermes-ui-plus-bridge --env-file <wizard env file>`: the keys the setup wizard writes, the
 * token generated into the state dir by prepareEnv, nothing about CORS. `extra` lines are appended to the env file.
 */
async function wizardBridge(t, { extra = {}, hermes } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hui-desktop-cors-test-')));
  const envFile = join(root, 'bridge.env');
  const lines = { HERMES_BASE_URL: hermes.url, HERMES_API_KEY: 'test-upstream-key', BRIDGE_NAME: 'Hermes', BRIDGE_PORT: '0', BRIDGE_STATE_DIR: join(root, 'state'), ...extra };
  await writeFile(envFile, Object.entries(lines).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  const { env } = prepareEnv(parseArgs(['--env-file', envFile]), { HERMES_HOME: join(root, 'no-hermes-home') }, root);
  const ctx = createServer(env, { logger: silentLogger });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  t.after(async () => {
    ctx.server.closeAllConnections();
    await ctx.close();
    await rm(root, { recursive: true, force: true });
  });
  return { ctx, env, base: `http://127.0.0.1:${ctx.server.address().port}` };
}

const preflight = (base, path, origin, method = 'GET', headers = 'authorization, content-type') => fetch(base + path, {
  method: 'OPTIONS', headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': headers },
});

/** Route families that answer requests themselves (src/server.mjs); preflights for all of them end in the bridge handler. */
const ROUTES = [
  ['POST', '/bridge/pair/redeem'], ['POST', '/v1/chat/completions'], ['GET', '/v1/models'], ['GET', '/api/sessions'],
  ['POST', '/bridge/chat/stop'], ['GET', '/bridge/profiles'], ['POST', '/bridge/uploads'], ['GET', '/bridge/media?path=/x.png'],
  ['GET', '/bridge/img?u=https%3A%2F%2Fexample.com%2Fa.png'], ['GET', '/bridge/images/config'], ['GET', '/bridge/voice/config'],
  ['POST', '/bridge/stt'], ['POST', '/bridge/tts'], ['GET', '/bridge/meta/config'], ['GET', '/bridge/quick/config'],
  ['GET', '/bridge/library/config'], ['GET', '/bridge/bots'], ['GET', '/bridge/routines/capabilities'],
  ['GET', '/bridge/routines/rights'], ['GET', '/bridge/inbox/stream'], ['POST', '/bridge/push/register'], ['GET', '/bridge/devices'],
];

/** GET routes whose answer (also an error answer) the app must be able to read, with a valid device token. */
const READ_ROUTES = [
  '/v1/models', '/api/sessions', '/bridge/profiles', '/bridge/status', '/bridge/media?path=/nonexistent/x.png',
  '/bridge/img?u=https%3A%2F%2Fexample.invalid%2Fa.png', '/bridge/images/config', '/bridge/voice/config', '/bridge/meta/config',
  '/bridge/quick/config', '/bridge/library/config', '/bridge/bots', '/bridge/routines/capabilities', '/bridge/routines/rights',
  '/bridge/routines/inbox', '/bridge/push/config', '/bridge/devices',
];

async function pairAs(base, ctx, origin) {
  const { code } = ctx.pairing.issue('desktop test');
  const pre = await preflight(base, '/bridge/pair/redeem', origin, 'POST', 'content-type');
  assert.equal(pre.status, 204, `${origin}: redeem preflight`);
  assert.equal(pre.headers.get('access-control-allow-origin'), origin);
  const res = await fetch(`${base}/bridge/pair/redeem`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ code }),
  });
  assert.equal(res.status, 200, `${origin}: redeem`);
  assert.equal(res.headers.get('access-control-allow-origin'), origin);
  assert.equal(res.headers.get('access-control-allow-credentials'), null);
  const j = await res.json();
  assert.match(j.token, /\S{20,}/);
  return j.token;
}

test('default wizard config: the desktop app pairs, chats and reads every route family from both Tauri origins', async (t) => {
  const hermes = await mockHermes(t);
  const { ctx, env, base } = await wizardBridge(t, { hermes });
  assert.equal(env.BRIDGE_CORS_ORIGINS, undefined, 'the wizard writes no CORS setting');
  assert.ok(env.BRIDGE_TOKEN, 'token generated like on a real first start');
  for (const origin of DESKTOP_ORIGINS) {
    // every preflight is answered before the token check, for every route family
    for (const [method, path] of ROUTES) {
      const res = await preflight(base, path, origin, method);
      assert.equal(res.status, 204, `${origin} ${method} ${path}`);
      assert.equal(res.headers.get('access-control-allow-origin'), origin, `${origin} ${method} ${path}`);
      assert.match(res.headers.get('access-control-allow-methods'), new RegExp(method));
      assert.match(res.headers.get('access-control-allow-headers'), /authorization/);
      assert.equal(res.headers.get('access-control-allow-credentials'), null);
      await res.arrayBuffer();
    }
    const token = await pairAs(base, ctx, origin);
    const auth = { origin, authorization: `Bearer ${token}` };
    // one chat turn, streamed through the bridge
    const chat = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'user', content: 'Hallo' }] }),
    });
    assert.equal(chat.status, 200);
    assert.equal(chat.headers.get('access-control-allow-origin'), origin);
    assert.match(await chat.text(), /Hallo test/);
    for (const path of READ_ROUTES) {
      const ctl = new AbortController();
      const res = await fetch(base + path, { headers: auth, signal: ctl.signal });
      assert.notEqual(res.status, 401, `${origin} ${path}: device token accepted`);
      assert.equal(res.headers.get('access-control-allow-origin'), origin, `${origin} ${path} (${res.status})`);
      assert.equal(res.headers.get('access-control-allow-credentials'), null);
      ctl.abort();
    }
    // without a credential the origin alone gets nothing, but the app can read the 401
    const anon = await fetch(`${base}/v1/models`, { headers: { origin } });
    assert.equal(anon.status, 401);
    assert.equal(anon.headers.get('access-control-allow-origin'), origin);
    await anon.text();
  }
  assert.ok(hermes.seen.some((l) => l.startsWith('POST /v1/chat/completions')));
});

test('default config: a foreign origin gets no CORS headers, not even with a valid token', async (t) => {
  const hermes = await mockHermes(t);
  const { ctx, env, base } = await wizardBridge(t, { hermes });
  for (const [method, path] of ROUTES) {
    const res = await preflight(base, path, FOREIGN, method);
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), null, path);
    assert.equal(res.headers.get('access-control-allow-methods'), null, path);
    await res.arrayBuffer();
  }
  const { code } = ctx.pairing.issue('foreign test');
  const redeem = await fetch(`${base}/bridge/pair/redeem`, { method: 'POST', headers: { origin: FOREIGN, 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  assert.equal(redeem.headers.get('access-control-allow-origin'), null);
  await redeem.text();
  for (const path of READ_ROUTES) {
    const ctl = new AbortController();
    const res = await fetch(base + path, { headers: { origin: FOREIGN, authorization: `Bearer ${env.BRIDGE_TOKEN}` }, signal: ctl.signal });
    assert.equal(res.headers.get('access-control-allow-origin'), null, path);
    ctl.abort();
  }
  // a look-alike of the desktop origins is foreign too
  for (const origin of ['tauri://localhost.evil.example.com', 'https://tauri.localhost', 'http://tauri.localhost:8080', 'null']) {
    const res = await preflight(base, '/v1/models', origin);
    assert.equal(res.headers.get('access-control-allow-origin'), null, origin);
    await res.arrayBuffer();
  }
});

test('BRIDGE_DESKTOP_ORIGINS=off removes the desktop origins; BRIDGE_CORS_ORIGINS still works', async (t) => {
  const hermes = await mockHermes(t);
  const { base } = await wizardBridge(t, { hermes, extra: { BRIDGE_DESKTOP_ORIGINS: 'off', BRIDGE_CORS_ORIGINS: 'https://app.example.com' } });
  for (const origin of DESKTOP_ORIGINS) {
    const res = await preflight(base, '/bridge/pair/redeem', origin, 'POST');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    await res.arrayBuffer();
  }
  const ok = await preflight(base, '/v1/models', 'https://app.example.com');
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example.com');
  await ok.arrayBuffer();
});

test('open mode (no token) does not trust the desktop origins by default', async (t) => {
  const hermes = await mockHermes(t);
  const { base } = await wizardBridge(t, { hermes, extra: { BRIDGE_ALLOW_NO_AUTH: '1' } });
  for (const origin of DESKTOP_ORIGINS) {
    const post = await fetch(`${base}/api/sessions/test-session/fork`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(post.status, 403);
    assert.equal((await post.json()).error.code, 'origin_forbidden');
    const pre = await preflight(base, '/v1/models', origin);
    assert.equal(pre.headers.get('access-control-allow-origin'), null);
    await pre.arrayBuffer();
    const get = await fetch(`${base}/v1/models`, { headers: { origin } });
    assert.equal(get.headers.get('access-control-allow-origin'), null);
    await get.text();
  }
  assert.ok(!hermes.seen.some((l) => l.includes('/fork')));
});

test('open mode with the desktop origin listed in BRIDGE_CORS_ORIGINS lets it in', async (t) => {
  const hermes = await mockHermes(t);
  const { base } = await wizardBridge(t, { hermes, extra: { BRIDGE_ALLOW_NO_AUTH: '1', BRIDGE_CORS_ORIGINS: 'tauri://localhost' } });
  const post = await fetch(`${base}/api/sessions/test-session/fork`, { method: 'POST', headers: { origin: 'tauri://localhost', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(post.status, 200);
  assert.equal(post.headers.get('access-control-allow-origin'), 'tauri://localhost');
  await post.text();
  const other = await fetch(`${base}/api/sessions/test-session/fork`, { method: 'POST', headers: { origin: 'http://tauri.localhost', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(other.status, 403);
  await other.text();
});

test('corsOriginsFromEnv / corsHeaders / describeOrigins', () => {
  assert.deepEqual(corsOriginsFromEnv({}, { authenticated: true }), { origins: [...DESKTOP_ORIGINS], explicit: [], desktop: true });
  assert.deepEqual(corsOriginsFromEnv({}, { authenticated: false }), { origins: [], explicit: [], desktop: false });
  for (const v of ['off', 'OFF', '0', 'false', 'no']) assert.equal(corsOriginsFromEnv({ BRIDGE_DESKTOP_ORIGINS: v }, { authenticated: true }).desktop, false);
  assert.deepEqual(corsOriginsFromEnv({ BRIDGE_CORS_ORIGINS: ' tauri://localhost , https://a.example.com' }, { authenticated: true }).origins,
    ['tauri://localhost', 'https://a.example.com', 'http://tauri.localhost'], 'no duplicates');
  const origins = corsOriginsFromEnv({}, { authenticated: true }).origins;
  assert.deepEqual(corsHeaders(origins, { headers: { origin: 'tauri://localhost' } }), { 'access-control-allow-origin': 'tauri://localhost', vary: 'Origin' });
  assert.deepEqual(corsHeaders(origins, { headers: {} }), {});
  assert.deepEqual(corsHeaders(origins, { headers: { origin: FOREIGN } }), {});
  assert.deepEqual(corsHeaders(['*'], { headers: { origin: FOREIGN } }), { 'access-control-allow-origin': '*', vary: 'Origin' });
  assert.match(describeOrigins(corsOriginsFromEnv({}, { authenticated: true }), { authenticated: true }), /desktop app \(tauri:\/\/localhost, http:\/\/tauri\.localhost\)/);
  assert.match(describeOrigins(corsOriginsFromEnv({}, { authenticated: false }), { authenticated: false }), /same origin only; desktop app only via BRIDGE_CORS_ORIGINS/);
});

test('startup summary names the desktop origins', async (t) => {
  const hermes = await mockHermes(t);
  const { ctx, env } = await wizardBridge(t, { hermes });
  const line = featureSummary(ctx.config, env, {}).find(([k]) => k === 'origins');
  assert.ok(line);
  assert.match(line[1], /tauri:\/\/localhost/);
});
