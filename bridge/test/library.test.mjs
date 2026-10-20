// /bridge/library/*: projection of a FAKE hermes-ui-plus plugin (skills list, SKILL.md, memory).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';

const TOKEN = 'bridge-test-token';
const PLUGIN_SECRET = 'plugin_test_secret_' + 'x'.repeat(40);
const dir = mkdtempSync(join(tmpdir(), 'hui-library-test-'));
const secretFile = join(dir, 'secret');
writeFileSync(secretFile, PLUGIN_SECRET + '\n', { mode: 0o600 });
after(() => rmSync(dir, { recursive: true, force: true }));

const listen = async (handler) => {
  const s = http.createServer(handler);
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  return { s, url: `http://127.0.0.1:${s.address().port}`, close: () => { s.close(); s.closeAllConnections(); } };
};

/** Fake plugin; `o` overrides: profile, config, skills, content, memory (bodies), hang (path prefix that never answers), html */
async function fakePlugin(o = {}) {
  const seen = [];
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const p = await listen((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    if (req.headers.authorization !== `Bearer ${PLUGIN_SECRET}`) { res.writeHead(401); return res.end('{}'); }
    const path = req.url.split('?')[0];
    if (o.hang && path.startsWith(o.hang)) return;
    if (o.html) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>'); }
    if (path === '/library/config') {
      return json(res, 200, o.config ?? { version: '0.2.0', profile: o.profile ?? 'default', skills: { available: true }, memory: { available: true } });
    }
    if (path === '/library/skills') return json(res, 200, o.skills ?? { object: 'list', profile: 'default', data: [{ name: 'a', description: 'd', category: null, enabled: true, source: 'bundled' }] });
    if (path === '/library/skills/content') {
      const name = new URL(req.url, 'http://x').searchParams.get('name');
      if (o.content) return json(res, 200, o.content);
      if (name !== 'a') return json(res, 404, { error: { message: 'secret internal text /home/someone', code: 'not_found' } });
      return json(res, 200, { name, content: '# A', truncated: false });
    }
    if (path === '/library/memory') {
      if (o.memory === 'off') return json(res, 404, { error: { message: 'Free <text>', code: 'feature_off', reason: 'memory_not_exposed' } });
      return json(res, 200, o.memory ?? { profile: 'default', provider: null, stores: [] });
    }
    res.writeHead(404); res.end('{}');
  });
  return { ...p, seen };
}

async function startBridge(env) {
  const { server } = createServer({ BRIDGE_TOKEN: TOKEN, BRIDGE_DEVICE_TOKENS: 'off', BRIDGE_BOOTSTRAP: 'off', ROUTER_BACKEND: 'heuristic', BRIDGE_PROFILES: 'writer', HERMES_BASE_URL: 'http://127.0.0.1:9', ...env }, { logger: silentLogger });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, init = {}) => fetch(base + path, { ...init, headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) } });
  return { server, base, call, close: () => { server.close(); server.closeAllConnections(); } };
}
const withPlugin = async (t, o = {}, env = {}) => {
  const plugin = await fakePlugin(o);
  const b = await startBridge({ BRIDGE_HERMES_PLUGIN_URL: plugin.url, BRIDGE_HERMES_PLUGIN_SECRET_FILE: secretFile, ...env });
  t.after(() => { b.close(); plugin.close(); });
  return { plugin, b };
};

test('config + data routes: auth, headers, secret to the plugin', async (t) => {
  const { plugin, b } = await withPlugin(t);
  assert.equal((await fetch(b.base + '/bridge/library/config')).status, 401);
  assert.equal((await fetch(b.base + '/bridge/library/skills', { headers: { authorization: 'Bearer nope' } })).status, 401);
  const r = await b.call('/bridge/library/config');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-hermes-ui-bridge'), '1');
  assert.deepEqual(await r.json(), { skills: { available: true }, memory: { available: true }, bot: 'default' });
  const s = await (await b.call('/bridge/library/skills')).json();
  assert.equal(s.data[0].name, 'a');
  assert.equal(plugin.seen.at(-1).auth, `Bearer ${PLUGIN_SECRET}`);
  assert.deepEqual(await (await b.call('/bridge/library/skills/content?name=a')).json(), { name: 'a', content: '# A', truncated: false });
  assert.deepEqual(await (await b.call('/bridge/library/memory')).json(), { provider: null, stores: [] });
  assert.equal(plugin.seen.filter((x) => x.url === '/library/config').length, 1); // probe cached
});

test('405 for non-GET, after auth', async (t) => {
  const { b } = await withPlugin(t);
  for (const p of ['config', 'skills', 'skills/content?name=a', 'memory']) {
    const r = await b.call('/bridge/library/' + p, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, 405, p);
    assert.equal(r.headers.get('allow'), 'GET');
  }
  assert.equal((await fetch(b.base + '/bridge/library/skills', { method: 'POST' })).status, 401);
});

test('BRIDGE_LIBRARY=off -> bridge_off; BRIDGE_QUICK=off does not disable it', async (t) => {
  const off = await withPlugin(t, {}, { BRIDGE_LIBRARY: 'off' });
  assert.deepEqual(await (await off.b.call('/bridge/library/config')).json(), { skills: { available: false, reason: 'bridge_off' }, memory: { available: false, reason: 'bridge_off' }, bot: 'default' });
  const r = await off.b.call('/bridge/library/skills');
  assert.equal(r.status, 404);
  const e = (await r.json()).error;
  assert.deepEqual([e.code, e.reason, e.type], ['feature_off', 'bridge_off', 'invalid_request_error']);
  assert.equal(off.plugin.seen.length, 0);
  const q = await withPlugin(t, {}, { BRIDGE_QUICK: 'off' });
  assert.equal((await q.b.call('/bridge/library/skills')).status, 200);
});

test('plugin not configured / unreachable', async (t) => {
  const plugin = await fakePlugin();
  const none = await startBridge({ BRIDGE_HERMES_PLUGIN_URL: plugin.url });
  const dead = await startBridge({ BRIDGE_HERMES_PLUGIN_URL: 'http://127.0.0.1:1', BRIDGE_HERMES_PLUGIN_SECRET_FILE: secretFile });
  t.after(() => { none.close(); dead.close(); plugin.close(); });
  assert.equal((await (await none.call('/bridge/library/config')).json()).skills.reason, 'plugin_not_configured');
  assert.equal((await (await none.call('/bridge/library/memory')).json()).error.reason, 'plugin_not_configured');
  assert.equal(plugin.seen.length, 0);
  assert.equal((await (await dead.call('/bridge/library/config')).json()).memory.reason, 'plugin_unreachable');
  assert.equal((await (await dead.call('/bridge/library/skills')).json()).error.reason, 'plugin_unreachable');
  const html = await withPlugin(t, { html: true });
  assert.equal((await (await html.b.call('/bridge/library/skills')).json()).error.reason, 'plugin_unreachable');
});

test('bots: other_bot, unknown bot, invalid bot, allowed bot served by the plugin profile', async (t) => {
  const { b } = await withPlugin(t);
  const c = await (await b.call('/bridge/library/config?bot=writer')).json();
  assert.deepEqual(c, { skills: { available: false, reason: 'other_bot' }, memory: { available: false, reason: 'other_bot' }, bot: 'writer' });
  const r = await b.call('/bridge/library/skills?bot=writer');
  assert.equal(r.status, 404);
  assert.deepEqual([(await r.json()).error.code], ['feature_off']);
  for (const bot of ['nope', 'Writer', '../x', 'a%2fb']) {
    const u = await b.call('/bridge/library/skills?bot=' + bot);
    assert.equal(u.status, 404, bot);
    assert.equal((await u.json()).error.code, 'unknown_profile');
  }
  const w = await withPlugin(t, { profile: 'writer' });
  assert.equal((await w.b.call('/bridge/library/skills?bot=writer')).status, 200);
  assert.equal((await (await w.b.call('/bridge/library/skills')).json()).error.reason, 'other_bot'); // default is not the plugin's bot
});

test('plugin reasons pass through only in the safe shape', async (t) => {
  const a = await withPlugin(t, { config: { profile: 'default', skills: { available: false, reason: 'disabled_by_config' }, memory: { available: false, reason: 'Free <text> /home/x' } } });
  const c = await (await a.b.call('/bridge/library/config')).json();
  assert.equal(c.skills.reason, 'disabled_by_config');
  assert.equal(c.memory.reason, 'unavailable');
  assert.equal((await (await a.b.call('/bridge/library/skills')).json()).error.reason, 'disabled_by_config');
  const m = await withPlugin(t, { memory: 'off' });
  const r = await m.b.call('/bridge/library/memory');
  assert.equal(r.status, 404);
  const e = (await r.json()).error;
  assert.deepEqual([e.code, e.reason], ['feature_off', 'memory_not_exposed']);
  assert.ok(!JSON.stringify(e).includes('Free'));
});

test('projection: unknown fields stripped, strings and rows capped', async (t) => {
  const many = Array.from({ length: 2100 }, (_, i) => ({ name: `s${i}`, description: 'x', enabled: true, source: 'hub' }));
  many[0] = { name: 'n'.repeat(300), description: 'd'.repeat(2000), category: 'c'.repeat(300), enabled: 'yes', source: 'weird', path: '/home/x', extra: 1 };
  many[1] = { description: 'no name' };
  const { b } = await withPlugin(t, {
    skills: { object: 'list', profile: 'default', secret: 'z', data: many },
    memory: { profile: 'default', provider: 'p'.repeat(100), token: 'z', stores: [
      { target: 'memory', enabled: true, entries: ['e'.repeat(5000), 7, 'ok', ...Array(250).fill('y')], chars: 12.7, limit: -1, updated_at: '2026-01-02T03:04:05+01:00', path: '/x' },
      { target: 'user', enabled: 'maybe', entries: 'nope', chars: 'a', limit: 1375, updated_at: 'garbage' },
      { target: 'other', entries: [] }, { target: 'memory', entries: [] },
    ] },
    content: { name: 'a', content: 'c'.repeat(300 * 1024), truncated: false, path: '/x' },
  });
  const s = await (await b.call('/bridge/library/skills')).json();
  assert.deepEqual(Object.keys(s), ['object', 'data']);
  assert.equal(s.data.length, 2000);
  assert.deepEqual(s.data[0], { name: 'n'.repeat(200), description: 'd'.repeat(1000), category: 'c'.repeat(100), source: 'local' });
  assert.equal(s.data[1].name, 's2');
  assert.deepEqual(Object.keys(s.data[1]), ['name', 'description', 'category', 'enabled', 'source']);
  assert.equal(s.data[1].category, null);
  const m = await (await b.call('/bridge/library/memory')).json();
  assert.equal(m.provider.length, 64);
  assert.deepEqual(Object.keys(m), ['provider', 'stores']);
  assert.equal(m.stores.length, 2);
  assert.deepEqual(Object.keys(m.stores[0]), ['target', 'enabled', 'entries', 'chars', 'limit', 'updated_at']);
  assert.equal(m.stores[0].entries.length, 200);
  assert.equal(m.stores[0].entries[0].length, 4000);
  assert.equal(m.stores[0].entries[1], 'ok');
  assert.deepEqual([m.stores[0].chars, m.stores[0].limit, m.stores[0].updated_at], [12, 0, '2026-01-02T02:04:05.000Z']);
  assert.deepEqual(m.stores[1], { target: 'user', enabled: false, entries: [], chars: 0, limit: 1375, updated_at: null });
  const c = await (await b.call('/bridge/library/skills/content?name=a')).json();
  assert.deepEqual(Object.keys(c), ['name', 'content', 'truncated']);
  assert.equal(c.content.length, 256 * 1024);
  assert.equal(c.truncated, true);
});

test('content: name validation, upstream 404 -> skill_not_found, no upstream text', async (t) => {
  const { plugin, b } = await withPlugin(t);
  await b.call('/bridge/library/config');
  const n = plugin.seen.length;
  for (const q of ['', '?name=', '?name=' + 'a'.repeat(201), '?name=a%00b', '?name=a%0Ab', '?name=a%7F']) {
    const r = await b.call('/bridge/library/skills/content' + q);
    assert.equal(r.status, 400, q);
    assert.equal((await r.json()).error.code, 'invalid_name');
  }
  assert.equal(plugin.seen.length, n);
  const r = await b.call('/bridge/library/skills/content?name=' + encodeURIComponent('../x y'));
  assert.equal(r.status, 404);
  const text = await r.text();
  assert.equal(JSON.parse(text).error.code, 'skill_not_found');
  assert.ok(!text.includes('/home/someone'));
  assert.equal(plugin.seen.at(-1).url, '/library/skills/content?name=..%2Fx%20y');
  assert.equal((await b.call('/bridge/library/skills/content?name=' + 'a'.repeat(200))).status, 404);
});

test('upstream errors: 502 on garbage / oversize, 504 on timeout', async (t) => {
  const big = await withPlugin(t, { skills: { data: [{ name: 'a', description: 'x'.repeat(1100 * 1024) }] } });
  const r = await big.b.call('/bridge/library/skills');
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error.code, 'upstream_error');
  const bigContent = await withPlugin(t, { content: { name: 'a', content: 'x'.repeat(600 * 1024) } });
  assert.equal((await bigContent.b.call('/bridge/library/skills/content?name=a')).status, 502);
  const slow = await withPlugin(t, { hang: '/library/skills' }, { BRIDGE_LIBRARY_TIMEOUT_MS: '200' });
  const t0 = Date.now();
  const s = await slow.b.call('/bridge/library/skills');
  assert.equal(s.status, 504);
  assert.equal((await s.json()).error.code, 'timeout');
  assert.ok(Date.now() - t0 < 3000);
  const slowProbe = await withPlugin(t, { hang: '/library/config' }, { BRIDGE_LIBRARY_PROBE_TIMEOUT_MS: '150' });
  assert.equal((await (await slowProbe.b.call('/bridge/library/config')).json()).skills.reason, 'plugin_unreachable');
});

test('OPTIONS preflight stays with the bridge CORS handler; a plugin row without `enabled` stays unknown', async () => {
  const { createLibrary, projectSkills } = await import('../src/library.mjs');
  const lib = createLibrary({ token: TOKEN }, { env: {} });
  assert.equal(lib.matches({ method: 'OPTIONS', url: '/bridge/library/skills' }), false);
  assert.equal(lib.matches({ method: 'GET', url: '/bridge/library/skills?bot=default' }), true);
  assert.equal(lib.matches({ method: 'GET', url: '/bridge/library/other' }), false);
  assert.deepEqual(projectSkills({ data: [{ name: 'a' }] }).data[0], { name: 'a', description: '', category: null, source: 'local' });
});
