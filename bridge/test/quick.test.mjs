// /bridge/quick: proxy to a FAKE hermes-ui-plus plugin; fake Hermes upstream for /api/model/options and chat.
// Hard rule (ADR 0001): chat keeps working when the plugin is absent or crashing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.mjs';
import { createRateLimiter } from '../src/quick.mjs';
import { silentLogger } from '../src/log.mjs';

const TOKEN = 'bridge-test-token';
const PLUGIN_SECRET = 'plugin_test_secret_' + 'x'.repeat(40);
const dir = mkdtempSync(join(tmpdir(), 'hui-quick-test-'));
const secretFile = join(dir, 'secret');
writeFileSync(secretFile, PLUGIN_SECRET + '\n', { mode: 0o600 });
after(() => rmSync(dir, { recursive: true, force: true }));

const listen = async (handler) => {
  const s = http.createServer(handler);
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  return { s, url: `http://127.0.0.1:${s.address().port}`, close: () => { s.close(); s.closeAllConnections(); } };
};
const readJson = async (req) => { const c = []; for await (const x of req) c.push(x); return c.length ? JSON.parse(Buffer.concat(c).toString()) : null; };

/** Fake plugin. mode: 'ok' | 'stream-slow' | 'crash' | 'disabled' | 'scope' (0.1.1 self-test failed) | 'bad-reason' |
 *  'scope-late' (config fine, then a call trips the self-test and answers 404 feature_off + reason) */
async function fakePlugin(mode = 'ok') {
  const seen = [];
  const state = { aborted: false };
  const p = await listen(async (req, res) => {
    const auth = req.headers.authorization;
    const body = req.method === 'POST' ? await readJson(req) : null;
    seen.push({ url: req.url, auth, body });
    if (auth !== `Bearer ${PLUGIN_SECRET}`) { res.writeHead(401); return res.end('{}'); }
    if (mode === 'crash') return req.socket.destroy();
    if (req.url === '/quick/config') {
      res.writeHead(200, { 'content-type': 'application/json' });
      const off = mode === 'scope' || (mode === 'scope-late' && state.tripped) ? { enabled: false, available: false, reason: 'profile_scope_unavailable' }
        : mode === 'bad-reason' ? { enabled: false, available: false, reason: 'Not <a> reason' } : { enabled: mode !== 'disabled' };
      return res.end(JSON.stringify({ ...off, aux_task: 'hui_quick', last_route: { provider: 'p1', model: 'm-fast' }, allow_model_override: true, streaming: true, limits: { max_tokens: 1024 } }));
    }
    if (mode === 'scope' || mode === 'scope-late') {
      state.tripped = true;
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'quick answers are unavailable on this Hermes', type: 'invalid_request_error', code: 'feature_off', reason: 'profile_scope_unavailable' } }));
    }
    if (body?.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      res.write('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n');
      if (mode === 'stream-slow') {
        res.on('close', () => { state.aborted = true; });
        const t = setInterval(() => res.write('data: {"choices":[{"index":0,"delta":{"content":"x"}}]}\n\n'), 20);
        res.on('close', () => clearInterval(t));
        return;
      }
      res.write('data: {"choices":[{"index":0,"delta":{"content":"Hallo"}}]}\n\n');
      res.write('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}\n\n');
      return res.end('data: [DONE]\n\n');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'Hallo' }, finish_reason: 'stop' }] }));
  });
  return { ...p, seen, state };
}

/** Fake Hermes: model catalog + a plain chat completion. */
async function fakeHermes() {
  const seen = [];
  const h = await listen(async (req, res) => {
    seen.push(req.url);
    if (req.url.startsWith('/api/model/options')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ providers: [{ slug: 'opencode-go', models: ['fast-1', 'slow-2'] }, { slug: 'kilocode', models: ['k-1'] }] }));
    }
    await readJson(req);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'agent says hi' }, finish_reason: 'stop' }] }));
  });
  return { ...h, seen };
}

async function startBridge(env) {
  const { server } = createServer({ BRIDGE_TOKEN: TOKEN, BRIDGE_DEVICE_TOKENS: 'off', BRIDGE_BOOTSTRAP: 'off', ROUTER_BACKEND: 'heuristic', ...env }, { logger: silentLogger });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, init = {}) => fetch(base + path, { ...init, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  return { server, base, call, close: () => { server.close(); server.closeAllConnections(); } };
}

const Q = { messages: [{ role: 'user', content: 'SENTINEL_QUESTION 3 Meilen in km?' }] };
const post = (b) => ({ method: 'POST', body: JSON.stringify(b) });

test('streams through the plugin with the shared secret; config reports the plugin', async (t) => {
  const plugin = await fakePlugin(); const hermes = await fakeHermes();
  const b = await startBridge({ HERMES_BASE_URL: hermes.url, BRIDGE_HERMES_PLUGIN_URL: plugin.url, BRIDGE_HERMES_PLUGIN_SECRET_FILE: secretFile });
  t.after(() => { b.close(); plugin.close(); hermes.close(); });
  const cfg = await (await b.call('/bridge/quick/config')).json();
  assert.equal(cfg.available, true);
  assert.equal(cfg.model, 'm-fast');
  assert.equal(cfg.limits.perDeviceMinute, 20);
  const r = await b.call('/bridge/quick', post({ ...Q, stream: true }));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  const text = await r.text();
  assert.match(text, /Hallo/);
  assert.match(text, /\[DONE\]/);
  const last = plugin.seen.at(-1);
  assert.equal(last.url, '/quick/v1/chat/completions');
  assert.equal(last.auth, `Bearer ${PLUGIN_SECRET}`);
  const r2 = await b.call('/bridge/quick/v1/chat/completions', post(Q));
  assert.equal((await r2.json()).choices[0].message.content, 'Hallo');
  assert.equal((await b.call('/bridge/quick', post(Q), { headers: {} })).status, 200);
  const noAuth = await fetch(b.base + '/bridge/quick', { method: 'POST', body: JSON.stringify(Q) });
  assert.equal(noAuth.status, 401);
});

test('model overrides are validated against Hermes /api/model/options', async (t) => {
  const plugin = await fakePlugin(); const hermes = await fakeHermes();
  const b = await startBridge({ HERMES_BASE_URL: hermes.url, BRIDGE_HERMES_PLUGIN_URL: plugin.url, BRIDGE_HERMES_PLUGIN_SECRET_FILE: secretFile });
  t.after(() => { b.close(); plugin.close(); hermes.close(); });
  assert.equal((await b.call('/bridge/quick', post({ ...Q, provider: 'opencode-go', model: 'fast-1' }))).status, 200);
  assert.deepEqual([plugin.seen.at(-1).body.provider, plugin.seen.at(-1).body.model], ['opencode-go', 'fast-1']);
  assert.equal((await b.call('/bridge/quick', post({ ...Q, model: 'k-1' }))).status, 200); // provider inferred
  assert.equal(plugin.seen.at(-1).body.provider, 'kilocode');
  const bad = await b.call('/bridge/quick', post({ ...Q, provider: 'opencode-go', model: 'nope' }));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'unknown_model');
  assert.equal((await b.call('/bridge/quick', post({ ...Q, provider: 'evil' }))).status, 400);
  await b.call('/bridge/quick', post({ ...Q, model: 'hermes-agent' })); // default alias: no override
  assert.equal(plugin.seen.at(-1).body.model, undefined);
  assert.equal(hermes.seen.filter((u) => u.startsWith('/api/model/options')).length, 1); // cached
});

test('per-device rate limit (minute)', async (t) => {
  const plugin = await fakePlugin(); const hermes = await fakeHermes();
  const b = await startBridge({ HERMES_BASE_URL: hermes.url, BRIDGE_HERMES_PLUGIN_URL: plugin.url, BRIDGE_HERMES_PLUGIN_SECRET_FILE: secretFile, BRIDGE_QUICK_RATE: '2' });
  t.after(() => { b.close(); plugin.close(); hermes.close(); });
  assert.equal((await b.call('/bridge/quick', post(Q))).status, 200);
  assert.equal((await b.call('/bridge/quick', post(Q))).status, 200);
  const r = await b.call('/bridge/quick', post(Q));
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
});

test('rate limiter: minute and day windows per key', () => {
  let t = 0;
  const rl = createRateLimiter({ perMinute: 2, perDay: 3, now: () => t });
  assert.ok(rl.take('a').ok); assert.ok(rl.take('a').ok);
  assert.equal(rl.take('a').ok, false);
  assert.ok(rl.take('b').ok);
  t = 61_000; assert.ok(rl.take('a').ok);
  t = 122_000; const d = rl.take('a'); assert.equal(d.ok, false); assert.ok(d.retryAfter > 3600);
  t = 86_400_000; assert.ok(rl.take('a').ok);
});

test('client disconnect aborts the plugin request', async (t) => {
  const plugin = await fakePlugin('stream-slow'); const hermes = await fakeHermes();
  const b = await startBridge({ HERMES_BASE_URL: hermes.url, BRIDGE_HERMES_PLUGIN_URL: plugin.url, BRIDGE_HERMES_PLUGIN_SECRET_FILE: secretFile });
  t.after(() => { b.close(); plugin.close(); hermes.close(); });
  const ctl = new AbortController();
  const r = await b.call('/bridge/quick', { ...post({ ...Q, stream: true }), signal: ctl.signal });
  const reader = r.body.getReader();
  await reader.read();
  ctl.abort();
  for (let i = 0; i < 100 && !plugin.state.aborted; i++) await new Promise((res) => setTimeout(res, 20));
  assert.equal(plugin.state.aborted, true);
});

const plugged = (h, p) => ({ HERMES_BASE_URL: h.url, BRIDGE_HERMES_PLUGIN_URL: p.url, BRIDGE_HERMES_PLUGIN_SECRET_FILE: secretFile });
for (const [name, env, mode, reason] of [
  ['plugin absent (nothing listening)', (h) => ({ HERMES_BASE_URL: h.url, BRIDGE_HERMES_PLUGIN_URL: 'http://127.0.0.1:9', BRIDGE_HERMES_PLUGIN_SECRET_FILE: secretFile }), 'ok', 'plugin_unreachable'],
  ['plugin not configured (no secret file)', (h) => ({ HERMES_BASE_URL: h.url }), 'ok', 'plugin_not_configured'],
  ['quick switched off in the bridge', (h, p) => ({ ...plugged(h, p), BRIDGE_QUICK: 'off' }), 'ok', 'bridge_off'],
  ['plugin crashing (drops connections)', plugged, 'crash', 'plugin_unreachable'],
  ['plugin reports quick disabled (any plugin version)', plugged, 'disabled', 'plugin_disabled'],
  // plugin >= 0.1.1: its self-test cannot get credentials for the aux task (multiplexing Hermes, scope helpers gone)
  ['plugin self-test failed (profile scope)', plugged, 'scope', 'profile_scope_unavailable'],
  ['plugin reason in an unexpected shape is not passed on', plugged, 'bad-reason', 'plugin_disabled'],
]) {
  test(`feature_off and chat still works: ${name}`, async (t) => {
    const plugin = await fakePlugin(mode);
    const hermes = await fakeHermes();
    const b = await startBridge(env(hermes, plugin));
    t.after(() => { b.close(); plugin.close(); hermes.close(); });
    assert.deepEqual(await (await b.call('/bridge/quick/config')).json(), { available: false, reason });
    const q = await b.call('/bridge/quick', post({ ...Q, stream: true }));
    assert.equal(q.status, 404);
    const err = (await q.json()).error;
    assert.equal(err.code, 'feature_off');
    assert.equal(err.reason, reason);
    assert.equal(plugin.seen.filter((x) => x.url !== '/quick/config').length, 0, 'no call reaches the plugin');
    const chat = await b.call('/v1/chat/completions', post({ model: 'hermes-agent', messages: [{ role: 'user', content: 'hi' }] }));
    assert.equal(chat.status, 200);
    assert.equal((await chat.json()).choices[0].message.content, 'agent says hi');
  });
}

test('plugin self-test trips during a call: its 404 feature_off + reason passes through, config follows', async (t) => {
  const plugin = await fakePlugin('scope-late'); const hermes = await fakeHermes();
  const b = await startBridge(plugged(hermes, plugin));
  t.after(() => { b.close(); plugin.close(); hermes.close(); });
  assert.equal((await (await b.call('/bridge/quick/config')).json()).available, true);
  const q = await b.call('/bridge/quick', post({ ...Q, stream: true }));
  assert.equal(q.status, 404);
  assert.deepEqual((await q.json()).error, { message: 'quick answers are unavailable on this Hermes', type: 'invalid_request_error', code: 'feature_off', reason: 'profile_scope_unavailable' });
  // re-probed at once (not after the 30 s probe TTL): the app's next config check hides ⚡
  assert.deepEqual(await (await b.call('/bridge/quick/config')).json(), { available: false, reason: 'profile_scope_unavailable' });
});

test('plugin dies after the probe: request answers feature_off, chat unaffected', async (t) => {
  const plugin = await fakePlugin(); const hermes = await fakeHermes();
  const b = await startBridge({ HERMES_BASE_URL: hermes.url, BRIDGE_HERMES_PLUGIN_URL: plugin.url, BRIDGE_HERMES_PLUGIN_SECRET_FILE: secretFile });
  t.after(() => { b.close(); hermes.close(); });
  assert.equal((await (await b.call('/bridge/quick/config')).json()).available, true);
  plugin.close();
  const q = await b.call('/bridge/quick', post(Q));
  assert.equal(q.status, 404);
  assert.equal((await q.json()).error.code, 'feature_off');
  assert.equal((await b.call('/v1/chat/completions', post({ messages: [{ role: 'user', content: 'hi' }] }))).status, 200);
});

test('body limit and no content in logs', async (t) => {
  const plugin = await fakePlugin(); const hermes = await fakeHermes();
  const lines = [];
  const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map((l) => [l, (msg, meta) => lines.push(`${msg} ${JSON.stringify(meta ?? {})}`)]));
  const { server } = createServer({ BRIDGE_TOKEN: TOKEN, BRIDGE_DEVICE_TOKENS: 'off', BRIDGE_BOOTSTRAP: 'off', ROUTER_BACKEND: 'heuristic', HERMES_BASE_URL: hermes.url, BRIDGE_HERMES_PLUGIN_URL: plugin.url, BRIDGE_HERMES_PLUGIN_SECRET_FILE: secretFile }, { logger });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); plugin.close(); hermes.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const h = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
  const big = await fetch(base + '/bridge/quick', { method: 'POST', headers: h, body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(70_000) }] }) });
  assert.equal(big.status, 413);
  await (await fetch(base + '/bridge/quick', { method: 'POST', headers: h, body: JSON.stringify({ ...Q, stream: true }) })).text();
  const all = lines.join('\n');
  assert.match(all, /quick/);
  assert.doesNotMatch(all, /SENTINEL/);
  assert.ok(!all.includes(PLUGIN_SECRET));
});
