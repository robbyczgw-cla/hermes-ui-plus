// Hermes profiles ("bots"): `/p/<profile>/…` allow-list + normalisation, GET /bridge/profiles, and the profile on
// approvals / push / inbox events. Real bridge in front of a fake Hermes that multiplexes profiles like the gateway.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import { createApprovalWatcher } from '../src/approvals.mjs';
import { createProfiles, isProfileName, modelFromConfig, parseProfilesSetting, profilePrefix, splitProfilePath } from '../src/profiles.mjs';
import { isApiPath } from '../src/static.mjs';

const TOKEN = 'bridge-token';
const UP_KEY = 'upstream-secret';
const FCM_TOKEN = 'f'.repeat(40) + ':APA91b' + 'x'.repeat(100);
const nowSec = () => Date.now() / 1000;

// ------------------------------------------------------------------ pure helpers

test('profile names follow Hermes rules (lowercase, digits, - and _)', () => {
  for (const n of ['writer', 'work-bot', 'a', 'bot_2', '9lives']) assert.equal(isProfileName(n), true, n);
  for (const n of ['', 'Writer', '-x', '_x', '.', '..', 'a.b', 'a/b', 'a%2f', 'a b', 'ä', 'x'.repeat(65), null, undefined]) assert.equal(isProfileName(n), false, String(n));
});

test('splitProfilePath: prefix + rest, refuses odd shapes', () => {
  assert.deepEqual(splitProfilePath('/v1/models'), { profile: null, path: '/v1/models' });
  assert.deepEqual(splitProfilePath('/p/writer/v1/models'), { profile: 'writer', path: '/v1/models' });
  assert.deepEqual(splitProfilePath('/p/writer/api/sessions/s1'), { profile: 'writer', path: '/api/sessions/s1' });
  for (const p of ['/p/', '/p/writer', '/p/writer/', '/p/Writer/v1/models', '/p/../v1/models', '/p/g.k/v1/models', '/p/writer/p/x/v1/models']) {
    assert.ok('error' in splitProfilePath(p), p);
  }
  // `/px/...` and `/pp` are not the prefix
  assert.deepEqual(splitProfilePath('/px/v1'), { profile: null, path: '/px/v1' });
  assert.equal(profilePrefix('writer'), '/p/writer');
  assert.equal(profilePrefix(null), '');
  assert.equal(profilePrefix('default'), '');
  assert.equal(profilePrefix('../x'), '');
});

test('BRIDGE_PROFILES parsing', () => {
  assert.deepEqual(parseProfilesSetting(undefined), { mode: 'default', names: [], labels: {} });
  assert.equal(parseProfilesSetting('off').mode, 'off');
  assert.equal(parseProfilesSetting('AUTO').mode, 'auto');
  assert.deepEqual(parseProfilesSetting('writer, work=Work Bot,writer,default=Main'), { mode: 'list', names: ['writer', 'work'], labels: { work: 'Work Bot', default: 'Main' } });
  assert.throws(() => parseProfilesSetting('Writer'), /invalid profile name/);
  assert.throws(() => parseProfilesSetting('a/../b'), /invalid profile name/);
});

test('model from config.yaml: only the model id, nothing else', () => {
  assert.equal(modelFromConfig('model:\n  default: anthropic/claude-sonnet-5-5\n  provider: openrouter\n  api_key: sk-test-secret\n'), 'anthropic/claude-sonnet-5-5');
  assert.equal(modelFromConfig('model: writer-4.5\n'), 'writer-4.5');
  assert.equal(modelFromConfig('platforms:\n  api_server:\n    key: secret\n'), undefined);
  assert.equal(modelFromConfig('model: two words\n'), undefined);
});

/** fake fs for a Hermes home with two profiles (+ junk entries that are not profiles) */
function fakeHome() {
  const home = '/srv/hermes-home';
  const files = new Map([
    [`${home}/config.yaml`, 'model:\n  default: hermes-default-model\n  api_key: sk-test-secret-default\n'],
    [`${home}/profiles/writer/config.yaml`, 'model:\n  default: writer-4.5\nproviders:\n  example:\n    api_key: test-secret-provider\n'],
    [`${home}/profiles/.env`, 'API_SERVER_KEY=dummy'],
  ]);
  const dirs = new Set([home, `${home}/profiles`, `${home}/profiles/writer`, `${home}/profiles/work`, `${home}/profiles/Upper`, `${home}/profiles/x.y`]);
  const fsx = {
    existsSync: (p) => files.has(p) || dirs.has(p),
    statSync: (p) => {
      if (dirs.has(p)) return { isDirectory: () => true, size: 0 };
      if (files.has(p)) return { isDirectory: () => false, size: files.get(p).length };
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    readdirSync: (p) => [...dirs, ...files.keys()].filter((x) => x.startsWith(`${p}/`) && !x.slice(p.length + 1).includes('/')).map((x) => x.slice(p.length + 1)),
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error('ENOENT');
      return files.get(p);
    },
  };
  return { home, fs: fsx, dirs };
}

test('auto: profiles from HERMES_HOME/profiles, models from their config.yaml, never secrets', () => {
  const h = fakeHome();
  let t = 0;
  const p = createProfiles({ HERMES_HOME: h.home }, { fs: h.fs, home: h.home, now: () => t });
  assert.equal(p.mode, 'auto');
  assert.deepEqual(p.names(), ['work', 'writer']); // Upper / x.y are no valid Hermes names
  assert.equal(p.allowed('writer'), true);
  assert.equal(p.allowed('nope'), false);
  assert.equal(p.allowed('Upper'), false);
  const list = p.list();
  assert.deepEqual(list, [
    { name: 'default', default: true, model: 'hermes-default-model' },
    { name: 'work', default: false },
    { name: 'writer', default: false, model: 'writer-4.5' },
  ]);
  assert.doesNotMatch(JSON.stringify(list), /secret|dummy|api_key/);
  // a new profile shows up after the scan TTL
  h.dirs.add(`${h.home}/profiles/new-bot`);
  assert.equal(p.allowed('new-bot'), false);
  t += 31_000;
  assert.equal(p.allowed('new-bot'), true);
});

test('default mode: auto with a readable Hermes home, else any valid name (Hermes decides)', () => {
  const h = fakeHome();
  assert.equal(createProfiles({}, { fs: h.fs, home: h.home }).mode, 'auto');
  const any = createProfiles({}, { fs: h.fs, home: '/nowhere' });
  assert.equal(any.mode, 'any');
  assert.equal(any.allowed('whatever'), true);
  assert.equal(any.allowed('Bad'), false);
  assert.deepEqual(any.list(), [{ name: 'default', default: true }]);
  const off = createProfiles({ BRIDGE_PROFILES: 'off' }, { fs: h.fs, home: h.home });
  assert.equal(off.allowed('writer'), false);
  assert.deepEqual(off.list(), [{ name: 'default', default: true }]);
  const list = createProfiles({ BRIDGE_PROFILES: 'work=Arbeit' }, { fs: h.fs, home: h.home });
  assert.equal(list.allowed('writer'), false, 'explicit list wins over the directory');
  assert.deepEqual(list.list()[1], { name: 'work', default: false, label: 'Arbeit' });
});

test('static web app never serves /p/ paths', () => {
  assert.equal(isApiPath('/p/writer/v1/models'), true);
  assert.equal(isApiPath('/p'), true);
  assert.equal(isApiPath('/pricing'), false);
});

test('approval watcher: the profile travels with request, resolution and answer matching', () => {
  const requests = [];
  const resolved = [];
  const w = createApprovalWatcher({ onRequest: (e) => requests.push(e), onResolved: (e) => resolved.push(e), timeoutMs: 60_000 });
  const obs = w.observe({ sessionId: () => 'hui-1', profile: 'writer' });
  obs.push(Buffer.from(`event: approval.request\ndata: ${JSON.stringify({ run_id: 'run1', request_id: 'req1', command: 'ls' })}\n\n`));
  assert.equal(requests[0].hermesProfile, 'writer');
  // the same run id answered on the DEFAULT profile is another run
  assert.equal(w.answered('run1', {}, null), false);
  assert.equal(w.answered('run1', {}, 'writer'), true);
  assert.equal(resolved[0].hermesProfile, 'writer');
  const plain = w.observe({ sessionId: () => 'hui-2' });
  plain.push(Buffer.from(`event: approval.request\ndata: ${JSON.stringify({ run_id: 'run2', request_id: 'req2', command: 'ls' })}\n\n`));
  assert.equal('hermesProfile' in requests[1], false, 'default profile: no field');
  w.stop();
});

// ------------------------------------------------------------------ bridge in front of a multiplexing fake Hermes

/** per profile ('' = default): sessions */
const data = new Map([['', new Map()], ['writer', new Map()]]);
function addSession(profile, id, source = 'api_server') {
  const t = nowSec() - 60;
  data.get(profile).set(id, { session: { id, source, title: null, started_at: t, last_active: t, ended_at: t }, messages: [] });
}
let msgId = 1;
function addMessage(profile, id, role, content) {
  const s = data.get(profile).get(id);
  const ts = nowSec() - 30;
  s.messages.push({ id: msgId++, session_id: id, role, content, timestamp: ts, finish_reason: 'stop' });
  s.session.last_active = Math.max(s.session.last_active, ts);
}

let upstream; let ctx; let base; let fcm; let stateDir;
/** @type {any[]} */ let seen = [];
before(async () => {
  upstream = http.createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    const url = new URL(req.url, 'http://x');
    // gateway.multiplex_profiles: /p/<name>/<path> → that profile; unknown profile → 404
    const m = /^\/p\/([^/]+)(\/.*)$/.exec(url.pathname);
    const profile = m ? m[1] : '';
    const p = m ? m[2] : url.pathname;
    const store = data.get(profile);
    const json = (b, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (!store) return json({ error: { message: 'unknown profile' } }, 404);
    if (p === '/api/sessions') return json({ object: 'list', data: [...store.values()].map((s) => s.session).filter((s) => s.source === url.searchParams.get('source')) });
    const mm = /^\/api\/sessions\/([^/]+)\/messages$/.exec(p);
    if (mm) return json({ object: 'list', data: [...(store.get(mm[1])?.messages ?? [])].reverse() });
    if (p === '/api/jobs') return json({ jobs: [] });
    if (p === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-hermes-session-id': req.headers['x-hermes-session-id'] });
      res.write(`event: approval.request\ndata: ${JSON.stringify({ run_id: `run-${profile || 'default'}`, request_id: `req-${profile || 'default'}-${msgId++}`, command: 'rm -rf build/' })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `Antwort von ${profile || 'default'}` }, finish_reason: 'stop' }] })}\n\n`);
      return setTimeout(() => res.end('data: [DONE]\n\n'), 30);
    }
    if (p.startsWith('/v1/') || p.startsWith('/api/') || p === '/health') return json({ ok: true, profile });
    return json({ error: { message: 'nope' } }, 404);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-profiles-'));
  fcm = { kind: 'fcm', calls: [], send: async (token, n) => (fcm.calls.push({ token, n }), { ok: true, status: 200 }) };
  ctx = createServer({
    HERMES_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`, HERMES_API_KEY: UP_KEY, BRIDGE_TOKEN: TOKEN,
    BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'off', BRIDGE_STATE_DIR: stateDir, BRIDGE_PUSH_SETTLE_MS: '0', BRIDGE_PUSH_COALESCE_MS: '0',
    BRIDGE_PUSH_PREVIEW: '1', BRIDGE_PROFILES: 'writer=Writer,gone', HERMES_HOME: path.join(stateDir, 'no-hermes-home'),
  }, { logger: silentLogger, pushSenders: { fcm } });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  base = `http://127.0.0.1:${ctx.server.address().port}`;
});
after(() => { ctx.push.stop(); for (const s of [ctx.server, upstream]) { s.close(); s.closeAllConnections(); } });

/** raw request-target (no client-side URL normalisation of `..` / `%2e`) */
function call(p, { method = 'GET', headers = {}, body, auth = `Bearer ${TOKEN}` } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (auth) h.authorization = auth;
    const req = http.request({ host: '127.0.0.1', port: Number(new URL(base).port), path: p, method, headers: h, agent: false }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(c).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('allow-listed paths under /p/<profile>/ are forwarded WITH the prefix and the upstream key', async () => {
  const cases = [
    ['GET', '/p/writer/api/sessions'], ['GET', '/p/writer/api/sessions/hui-1'], ['PATCH', '/p/writer/api/sessions/hui-1'],
    ['DELETE', '/p/writer/api/sessions/hui-1'], ['GET', '/p/writer/api/sessions/hui-1/messages?order=latest'], ['POST', '/p/writer/api/sessions/hui-1/fork'],
    ['GET', '/p/writer/api/model/options'], ['GET', '/p/writer/v1/models'], ['GET', '/p/writer/v1/capabilities'], ['GET', '/p/writer/v1/skills'], ['GET', '/p/writer/v1/runs/run1'],
    ['POST', '/p/writer/v1/runs/run1/approval'], ['GET', '/p/writer/health'],
  ];
  for (const [method, p] of cases) {
    seen = [];
    const r = await call(p, { method, body: method === 'GET' || method === 'DELETE' ? undefined : '{}', headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, 200, `${method} ${p}: ${r.text}`);
    assert.equal(seen.length, 1, p);
    assert.equal(seen[0].url, p, 'forwarded verbatim incl. /p/<profile>');
    assert.equal(seen[0].auth, `Bearer ${UP_KEY}`);
  }
});

test('/p/ paths outside the allow-list, unknown profiles and bridge routes → 404, never upstream', async () => {
  seen = [];
  for (const [method, p] of [
    ['POST', '/p/writer/api/jobs'], ['GET', '/p/writer/api/cron'], ['POST', '/p/writer/v1/skills'], ['POST', '/p/writer/api/sessions/s1/chat'], ['GET', '/p/writer/bridge/status'],
    ['GET', '/p/writer/bridge/profiles'], ['POST', '/p/writer/bridge/chat/stop'], ['GET', '/p/writer'], ['GET', '/p/writer/'], ['GET', '/p/nope/v1/models'],
    ['GET', '/p/Writer/v1/models'], ['GET', '/p/writer/p/writer/v1/models'], ['GET', '/p/default-not-listed/api/sessions'],
  ]) {
    const r = await call(p, { method });
    assert.ok(r.status === 404 || r.status === 405, `${method} ${p} → ${r.status}`);
  }
  // POST /p/<bot>/api/sessions exists only for the "Bot Chat" thread (test/bot-chat.test.mjs): no body → 403, nothing upstream
  assert.equal((await call('/p/writer/api/sessions', { method: 'POST' })).status, 403);
  // same method rules as unprefixed (PUT on a session)
  assert.equal((await call('/p/writer/api/sessions/s1', { method: 'PUT' })).status, 405);
  assert.equal(seen.length, 0);
});

test('normalisation attacks on the prefix are refused before routing', async () => {
  seen = [];
  for (const p of [
    '/p/../v1/models', '/p/writer/../../api/jobs', '/p/x%2F../v1/models', '/p/x%2f..%2fapi/jobs', '/p/%2e%2e/v1/models', '/p/writer/%2e%2e/api/jobs',
    '/p/writer//v1/models', '/p/writer/v1/../api/jobs', '/p/gr%6fk/v1/models', '/p/writer%00/v1/models', '/p/writer\\..\\api/jobs', '/p/./writer/v1/models',
  ]) {
    const r = await call(p);
    assert.ok([400, 404].includes(r.status), `${p} → ${r.status}`);
  }
  assert.equal(seen.length, 0, 'nothing reached Hermes');
});

test('unknown profile needs the token first (profile names are not public)', async () => {
  assert.equal((await call('/p/nope/v1/models', { auth: null })).status, 401);
  assert.equal((await call('/p/writer/health', { auth: null })).status, 401);
  assert.equal((await call('/p/nope/v1/models')).status, 404);
});

test('GET /bridge/profiles lists default + profiles (token required)', async () => {
  assert.equal((await call('/bridge/profiles', { auth: null })).status, 401);
  const r = await call('/bridge/profiles');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.text);
  assert.equal(j.mode, 'list');
  assert.deepEqual(j.data, [{ name: 'default', default: true }, { name: 'writer', default: false, label: 'Writer' }, { name: 'gone', default: false }]);
});

test('approval on a profile chat: inbox event + push carry hermesProfile; the answer under /p/ resolves it', async () => {
  const ac = new AbortController();
  const stream = await fetch(`${base}/bridge/inbox/stream`, { headers: { authorization: `Bearer ${TOKEN}` }, signal: ac.signal });
  const reader = stream.body.getReader();
  let buf = '';
  const until = async (re) => { while (!re.test(buf)) buf += new TextDecoder().decode((await reader.read()).value); };
  await until(/hui\.ready/);
  const r = await fetch(`${base}/p/writer/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-hermes-session-id': 'hui-g1' },
    body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'aufräumen' }] }),
  });
  assert.match(await r.text(), /Antwort von writer/);
  await until(/hui\.approval\n/);
  const ev = JSON.parse(/event: hui\.approval\ndata: (.+)/.exec(buf)[1]);
  assert.equal(ev.hermesProfile, 'writer');
  assert.equal(ev.sessionId, 'hui-g1');
  await until(/hui\.approval_resolved/);
  assert.equal(JSON.parse(/event: hui\.approval_resolved\ndata: (.+)/.exec(buf)[1]).hermesProfile, 'writer');
  ac.abort();
});

test('push watcher polls every profile; messages carry hermesProfile, state is per profile', async () => {
  const reg = await fetch(`${base}/bridge/push/register`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'fcm', token: FCM_TOKEN, profileId: 'p-h', scope: { sources: ['api_server'] }, locale: 'de' }),
  });
  assert.equal(reg.status, 200);
  // the SAME session id on two profiles = two different sessions
  addSession('', 'hui-same');
  addSession('writer', 'hui-same');
  await ctx.push.pollNow(); // baseline (incl. the unknown profile `gone`: Hermes 404 → skipped, no crash)
  const before = fcm.calls.length;
  addMessage('writer', 'hui-same', 'assistant', 'Neues vom Writer-Bot');
  await ctx.push.pollNow();
  assert.equal(fcm.calls.length, before + 1);
  const n = fcm.calls.at(-1).n;
  assert.equal(n.body, 'Neues vom Writer-Bot');
  assert.equal(n.data.sessionId, 'hui-same');
  assert.equal(n.data.hermesProfile, 'writer');
  addMessage('', 'hui-same', 'assistant', 'Neues vom Standard-Bot');
  await ctx.push.pollNow();
  assert.equal(fcm.calls.length, before + 2);
  assert.equal(fcm.calls.at(-1).n.data.hermesProfile, undefined);
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'push-hermes.json'), 'utf8'));
  assert.ok(state.sessions['hui-same'] && state.sessions['writer/hui-same']);
  assert.ok(state.profiles.includes('writer'));
  assert.ok(!state.profiles.includes('gone'));
});

test('a profile seen for the first time is baselined (no flood of old messages)', async () => {
  data.set('gone', new Map());
  addSession('gone', 'hui-old');
  addMessage('gone', 'hui-old', 'assistant', 'alte Nachricht');
  const before = fcm.calls.length;
  await ctx.push.pollNow();
  assert.equal(fcm.calls.length, before);
  addMessage('gone', 'hui-old', 'assistant', 'neue Nachricht');
  await ctx.push.pollNow();
  assert.equal(fcm.calls.length, before + 1);
  assert.equal(fcm.calls.at(-1).n.data.hermesProfile, 'gone');
});

test('profiles on top of the narrow pass-through and resume: /health/detailed refused, Idempotency-Key per profile', async () => {
  seen = [];
  // /health/detailed is not forwarded unprefixed, so not under a profile either; /v1/health is (with the token)
  assert.equal((await call('/p/writer/health/detailed')).status, 404);
  assert.equal(seen.length, 0);
  assert.equal((await call('/p/writer/v1/health')).status, 200);
  assert.equal(seen.at(-1).url, '/p/writer/v1/health');
  // the same Idempotency-Key on two profiles = two turns (a key never re-attaches to another profile's stream)
  seen = [];
  const body = JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] });
  const headers = { 'content-type': 'application/json', 'idempotency-key': 'idem-profiles-test-1', 'x-hermes-session-id': 'hui-same' };
  const a = await call('/v1/chat/completions', { method: 'POST', headers, body });
  const b = await call('/p/writer/v1/chat/completions', { method: 'POST', headers, body });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.match(a.text, /Antwort von default/);
  assert.match(b.text, /Antwort von writer/);
  assert.deepEqual(seen.map((s) => s.url), ['/v1/chat/completions', '/p/writer/v1/chat/completions']);
  // and the same key on the same profile re-attaches (no second upstream turn)
  const c = await call('/p/writer/v1/chat/completions', { method: 'POST', headers, body });
  assert.equal(c.status, 200);
  assert.match(c.text, /Antwort von writer/);
  assert.equal(seen.length, 2);
});
