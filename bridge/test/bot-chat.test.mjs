// POST /api/sessions through the bridge: ONLY a bot's "Bot Chat" thread (docs/BOTS-SERVER.md), adopt before create,
// also under /p/<bot>/. And GET /bridge/profiles with Hermes Desktop's bot metadata. Real bridge, fake Hermes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import { botMetaFromProfileYaml, createProfiles } from '../src/profiles.mjs';

const TOKEN = 'bridge-token';
const UP_KEY = 'upstream-secret';
let upstream; let ctx; let base; let home;
/** @type {any[]} */ let seen = [];
/** per profile ('' = default): sessions Hermes has */
let store = {};
let listStatus = 200;

const row = (id, title, over = {}) => ({ id, source: 'api_server', title, started_at: 1000, last_active: 2000, message_count: 2, hidden: false, ...over });

before(async () => {
  upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization, ct: req.headers['content-type'] });
    const m = /^(?:\/p\/([a-z0-9_-]+))?(\/.*)$/.exec(req.url);
    const profile = m[1] ?? '';
    const u = new URL(m[2], 'http://x');
    const json = (o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/api/sessions' && req.method === 'GET') {
      if (listStatus !== 200) return json({ error: { message: 'no' } }, listStatus);
      const title = u.searchParams.get('title');
      const hidden = u.searchParams.get('include_hidden') === '1';
      // Hermes' title filter is a prefix / fuzzy match on some versions: the bridge must check the exact title itself
      const rows = (store[profile] ?? []).filter((r) => (!title || r.title.startsWith(title)) && (hidden || !r.hidden));
      return json({ object: 'list', sessions: rows });
    }
    if (u.pathname === '/api/sessions' && req.method === 'POST') {
      const b = JSON.parse(body);
      const s = row(`api_${Object.values(store).flat().length + 1}_new`, b.title, { message_count: 0 });
      (store[profile] ??= []).push(s);
      return json({ object: 'hermes.session', session: s }, 201);
    }
    return json({ error: { message: 'nope' } }, 404);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-botchat-'));
  for (const n of ['writer', 'scout', 'secret']) fs.mkdirSync(path.join(home, 'profiles', n), { recursive: true });
  fs.writeFileSync(path.join(home, 'profiles', 'writer', 'profile.yaml'), "description: fallback text\nui_meta:\n  hermes-bots:\n    title: Quill\n    description: Writes slogans: short ones\n    color: '#3366CC'\n    pinned: true\n");
  fs.writeFileSync(path.join(home, 'profiles', 'scout', 'profile.yaml'), 'description: Preise im Blick\n');
  fs.writeFileSync(path.join(home, 'profiles', 'secret', 'profile.yaml'), 'ui_meta:\n  hermes-bots:\n    hidden: true\n');
  ctx = createServer({
    HERMES_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`, HERMES_API_KEY: UP_KEY, BRIDGE_TOKEN: TOKEN,
    BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'off', BRIDGE_STATE_DIR: path.join(home, 'state'), HERMES_HOME: home,
  }, { logger: silentLogger });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  base = `http://127.0.0.1:${ctx.server.address().port}`;
});
after(() => { ctx.push?.stop?.(); for (const s of [ctx.server, upstream]) { s.close(); s.closeAllConnections(); } });

function call(p, { method = 'GET', body, auth = `Bearer ${TOKEN}` } = {}) {
  return new Promise((resolve, reject) => {
    const h = { 'content-type': 'application/json' };
    if (auth) h.authorization = auth;
    const req = http.request({ host: '127.0.0.1', port: Number(new URL(base).port), path: p, method, headers: h, agent: false }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => {
        const text = Buffer.concat(c).toString();
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('anything but exactly {title:"Bot Chat"} is refused before Hermes', async () => {
  seen = [];
  for (const body of ['{}', '{"title":"Hallo"}', '{"title":"bot chat"}', '{"title":"Bot Chat","hidden":true}', '{"title":"Bot Chat","model":"x"}', '["Bot Chat"]', 'not json', '']) {
    const r = await call('/api/sessions', { method: 'POST', body });
    assert.ok(r.status === 403 || r.status === 400, `${body} → ${r.status}`);
    if (r.status === 403) assert.equal(r.json.error.code, 'bot_chat_only');
  }
  const big = await call('/api/sessions', { method: 'POST', body: JSON.stringify({ title: 'Bot Chat', pad: 'x'.repeat(2000) }) }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);
  assert.equal(seen.length, 0, 'nothing reached Hermes');
  assert.equal((await call('/api/sessions', { method: 'POST', body: '{"title":"Bot Chat"}', auth: null })).status, 401);
  assert.equal(seen.length, 0);
});

test('no Bot Chat yet: created with exactly {"title":"Bot Chat"} (lookup includes hidden sessions first)', async () => {
  store = { '': [row('hui-1', 'Bot Chats im Vergleich')] }; // prefix match on Hermes' side, not the exact title
  seen = [];
  const r = await call('/api/sessions', { method: 'POST', body: '{"title":"Bot Chat"}' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.adopted, false);
  assert.equal(r.json.session.title, 'Bot Chat');
  assert.equal(seen.length, 2);
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].url, '/api/sessions?title=Bot%20Chat&include_hidden=1&limit=20');
  assert.equal(seen[1].method, 'POST');
  assert.equal(seen[1].url, '/api/sessions');
  assert.equal(seen[1].body, '{"title":"Bot Chat"}');
  assert.equal(seen[1].auth, `Bearer ${UP_KEY}`, 'the upstream key, never the client token');
  // asked again (second device): the same session, nothing created
  seen = [];
  const again = await call('/api/sessions', { method: 'POST', body: '{"title":"Bot Chat"}' });
  assert.equal(again.status, 200);
  assert.equal(again.json.adopted, true);
  assert.equal(again.json.session.id, r.json.session.id);
  assert.equal(seen.length, 1);
});

test('a hidden Bot Chat of Hermes Desktop is adopted under /p/<bot>/', async () => {
  store = { writer: [row('desk_1', 'Bot Chat', { hidden: true, last_active: 5000 })] };
  seen = [];
  const r = await call('/p/writer/api/sessions', { method: 'POST', body: '{"title":"Bot Chat"}' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.session.id, 'desk_1');
  assert.equal(r.json.adopted, true);
  assert.equal(seen[0].url, '/p/writer/api/sessions?title=Bot%20Chat&include_hidden=1&limit=20');
  assert.equal(seen.length, 1);
});

test('a bot without its key (401) or an unknown profile: Hermes\' answer, nothing created', async () => {
  listStatus = 401;
  seen = [];
  const r = await call('/p/scout/api/sessions', { method: 'POST', body: '{"title":"Bot Chat"}' });
  assert.equal(r.status, 401);
  assert.equal(seen.length, 1);
  listStatus = 200;
  seen = [];
  assert.equal((await call('/p/nobody/api/sessions', { method: 'POST', body: '{"title":"Bot Chat"}' })).status, 404);
  assert.equal(seen.length, 0, 'unknown profile never reaches Hermes');
});

test('GET /bridge/profiles: Desktop title as label, description, colour, pinned; hidden bots not listed', async () => {
  const r = await call('/bridge/profiles');
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.json.data.map((b) => [b.name, b]));
  assert.deepEqual(Object.keys(by), ['default', 'scout', 'writer']);
  assert.deepEqual(by.writer, { name: 'writer', default: false, label: 'Quill', description: 'Writes slogans: short ones', color: '#3366cc', pinned: true });
  assert.deepEqual(by.scout, { name: 'scout', default: false, description: 'Preise im Blick' });
  // still reachable (Desktop hides it from its sidebar, Hermes serves it)
  assert.equal(ctx.profiles?.allowed?.('secret') ?? createProfiles({ HERMES_HOME: home }).allowed('secret'), true);
});

test('profile.yaml metadata parser: clipped plain text, bad colours dropped, BRIDGE_PROFILES label wins', () => {
  assert.deepEqual(botMetaFromProfileYaml('ui_meta:\n  hermes-bots:\n    title: "' + 'T'.repeat(80) + '"\n    color: red\n'), { title: 'T'.repeat(40) });
  assert.deepEqual(botMetaFromProfileYaml('nonsense: [\n'), {});
  const p = createProfiles({ HERMES_HOME: home, BRIDGE_PROFILES: 'writer=Schreiber' });
  assert.equal(p.list().find((b) => b.name === 'writer').label, 'Schreiber');
});
