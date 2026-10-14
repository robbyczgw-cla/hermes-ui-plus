// Push + live inbox for Hermes: real bridge in front of a fake Hermes (sessions API, jobs, chat stream).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import { DEFAULT_CLIENT_SOURCES, isSilence, loadPushConfig } from '../src/push-hermes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = 'bridge-token';
const HOOK_SECRET = 'hook-secret-0123456789';
const FCM_TOKEN = 'f'.repeat(40) + ':APA91b' + 'x'.repeat(100);
const nowSec = () => Date.now() / 1000;

/** fake Hermes data */
const sessions = new Map(); // id -> {session, messages}
const jobs = [
  { id: 'aaa111', name: 'Morning Briefing', deliver: 'telegram:-100:2' },
  { id: 'bbb222', name: 'Shared Memory Sync', deliver: 'local' },
];
function addSession(id, source, extra = {}) {
  const t = nowSec() - 60;
  sessions.set(id, { session: { id, source, title: extra.title ?? null, started_at: t, last_active: t, ended_at: extra.ended ? t : null }, messages: [] });
}
let msgId = 1;
function addMessage(id, role, content, o = {}) {
  const s = sessions.get(id);
  const ts = o.ts ?? nowSec() - 30;
  s.messages.push({ id: msgId++, session_id: id, role, content, timestamp: ts, finish_reason: o.finish ?? 'stop', display_kind: o.display_kind ?? null });
  s.session.last_active = Math.max(s.session.last_active, ts);
}

let upstream; let bridge; let base; let ctx; let fcm; let stateDir;
before(async () => {
  upstream = http.createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    const url = new URL(req.url, 'http://x');
    const json = (b) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (url.pathname === '/api/sessions') {
      const src = url.searchParams.get('source');
      return json({ object: 'list', data: [...sessions.values()].map((s) => s.session).filter((s) => !src || s.source === src) });
    }
    const m = /^\/api\/sessions\/([^/]+)\/messages$/.exec(url.pathname);
    if (m) return json({ object: 'list', data: [...(sessions.get(decodeURIComponent(m[1]))?.messages ?? [])].reverse() });
    if (url.pathname === '/api/jobs') return json({ jobs });
    if (url.pathname === '/v1/chat/completions') {
      // a bridge-streamed turn: the assistant row is written while the stream runs
      const sid = req.headers['x-hermes-session-id'];
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-hermes-session-id': sid });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n`);
      if (sid === 'hui-drop') {
        // a long turn: the app's connection drops before Hermes is done
        setTimeout(() => {
          addMessage(sid, 'user', 'Lange Frage', { ts: nowSec() });
          addMessage(sid, 'assistant', 'Antwort nach Abbruch', { ts: nowSec() });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Antwort nach Abbruch' }, finish_reason: 'stop' }] })}\n\n`);
          res.end('data: [DONE]\n\n');
        }, 150);
        return;
      }
      addMessage(sid, 'user', 'Frage', { ts: nowSec() });
      addMessage(sid, 'assistant', 'Antwort im Stream', { ts: nowSec() });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Antwort im Stream' }, finish_reason: 'stop' }] })}\n\n`);
      return res.end('data: [DONE]\n\n');
    }
    res.writeHead(404); res.end();
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-push-'));
  const calls = [];
  fcm = { kind: 'fcm', calls, send: async (token, n) => (calls.push({ token, n }), { ok: true, status: 200 }) };
  ctx = createServer({
    HERMES_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`, HERMES_API_KEY: 'k', BRIDGE_TOKEN: TOKEN,
    BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'off', BRIDGE_STATE_DIR: stateDir, BRIDGE_PUSH_SETTLE_MS: '0',
    BRIDGE_PUSH_COALESCE_MS: '0', BRIDGE_PUSH_SOURCES: 'cron,api_server', // cron is opt-in on the operator side
    BRIDGE_PUSH_HOOK_SECRET: HOOK_SECRET, BRIDGE_PUSH_PREVIEW: '1', // previews are opt-in (M3)
  }, { logger: silentLogger, pushSenders: { fcm } });
  bridge = ctx.server;
  bridge.listen(0, '127.0.0.1');
  await once(bridge, 'listening');
  base = `http://127.0.0.1:${bridge.address().port}`;
});
after(() => { ctx.push.stop(); for (const s of [bridge, upstream]) { s.close(); s.closeAllConnections(); } });

const call = (p, { method = 'GET', body, auth = `Bearer ${TOKEN}`, headers = {} } = {}) =>
  fetch(base + p, { method, headers: { ...(auth ? { authorization: auth } : {}), 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });

test('vendored push module is identical to the canonical push/src (run scripts/sync-push.sh)', () => {
  const canon = path.resolve(here, '../../push/src');
  if (!fs.existsSync(canon)) return;
  for (const f of fs.readdirSync(canon).filter((x) => x.endsWith('.mjs'))) {
    const vendored = fs.readFileSync(path.resolve(here, '../src/push', f), 'utf8').split('\n').slice(1).join('\n');
    assert.equal(vendored, fs.readFileSync(path.join(canon, f), 'utf8'), `src/push/${f} is stale`);
  }
});

test('silence markers', () => {
  for (const t of ['[SILENT]', '[SILENT] nothing new', 'Nichts Neues.\nSILENT', 'NO_REPLY', '']) assert.equal(isSilence(t), true, t);
  for (const t of ['Silent retry succeeded', 'Hier dein Briefing']) assert.equal(isSilence(t), false, t);
});

test('push routes need the bridge token; register with source scope', async () => {
  assert.equal((await call('/bridge/push/config', { auth: null })).status, 401);
  assert.equal((await call('/bridge/inbox/stream', { auth: 'Bearer nope' })).status, 401);
  const cfg = await (await call('/bridge/push/config')).json();
  assert.deepEqual(cfg.platforms, { webpush: null, fcm: true, apns: false });
  assert.equal((await call('/bridge/push/register', { method: 'POST', body: { platform: 'fcm', token: FCM_TOKEN, profileId: 'p-h', scope: { sources: ['bogus'] } } })).status, 403);
  const r = await call('/bridge/push/register', { method: 'POST', body: { platform: 'fcm', token: FCM_TOKEN, profileId: 'p-h', scope: { sources: ['cron', 'api_server'] }, locale: 'de' } });
  assert.equal(r.status, 200);
});

test('baseline, then cron results (delivered jobs only, no silence) and unsolicited app-session messages are pushed', async () => {
  addSession('cron_aaa111_20261010_080000', 'cron', { ended: true });
  addMessage('cron_aaa111_20261010_080000', 'assistant', 'Altes Briefing');
  addSession('hui-old', 'api_server');
  addMessage('hui-old', 'assistant', 'alt');
  await ctx.push.pollNow(); // baseline
  assert.equal(fcm.calls.length, 0, 'nothing that existed before is notified');

  addSession('cron_aaa111_20261011_080000', 'cron', { ended: true });
  addMessage('cron_aaa111_20261011_080000', 'assistant', 'tool step', { finish: 'tool_calls' });
  addMessage('cron_aaa111_20261011_080000', 'assistant', '**Guten Morgen!** Heute 18 °C.');
  addSession('cron_bbb222_20261011_080000', 'cron', { ended: true });
  addMessage('cron_bbb222_20261011_080000', 'assistant', 'internal sync done');
  addSession('cron_aaa111_20261011_090000', 'cron', { ended: true });
  addMessage('cron_aaa111_20261011_090000', 'assistant', '[SILENT] nothing new');
  // wake turn on an app session (background task finished)
  addMessage('hui-old', 'user', '[background process finished]', { ts: nowSec() - 5 });
  addMessage('hui-old', 'assistant', 'Dein Export ist fertig.', { ts: nowSec() - 4 });
  // a non-app API session is ignored (prefix filter)
  addSession('api-ef8beb15', 'api_server');
  await ctx.push.pollNow();
  addMessage('api-ef8beb15', 'assistant', 'other client', { ts: nowSec() - 3 });
  await ctx.push.pollNow();

  const bodies = fcm.calls.map((c) => [c.n.title, c.n.body, c.n.data.sessionId, c.n.data.source]);
  assert.deepEqual(bodies.sort(), [
    ['Hermes · Morning Briefing', 'Guten Morgen! Heute 18 °C.', 'cron_aaa111_20261011_080000', 'cron'],
    ['Hermes', 'Dein Export ist fertig.', 'hui-old', 'api_server'],
  ].sort());
  assert.equal(fcm.calls[0].n.data.profileId, 'p-h');
  // second poll: no repeats
  await ctx.push.pollNow();
  assert.equal(fcm.calls.length, 2);
  const stateText = fs.readFileSync(path.join(stateDir, 'push-hermes.json'), 'utf8') + fs.readFileSync(path.join(stateDir, 'push-registrations.json'), 'utf8');
  assert.doesNotMatch(stateText, /Export|Morgen|Briefing/);
});

test('turns streamed through the bridge are never notified', async () => {
  addSession('hui-live', 'api_server');
  await ctx.push.pollNow(); // first sight = baseline
  const r = await call('/v1/chat/completions', { method: 'POST', headers: { 'x-hermes-session-id': 'hui-live' }, body: { stream: true, messages: [{ role: 'user', content: 'Frage' }] } });
  assert.match(await r.text(), /Antwort im Stream/);
  await new Promise((res) => setTimeout(res, 20));
  const before = fcm.calls.length;
  await ctx.push.pollNow();
  assert.equal(fcm.calls.length, before);
});

test('with the app connected the message goes to the inbox stream instead of push', async () => {
  const ac = new AbortController();
  const stream = await fetch(base + '/bridge/inbox/stream?sources=api_server', { headers: { authorization: `Bearer ${TOKEN}` }, signal: ac.signal });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  const reader = stream.body.getReader();
  let buf = '';
  const until = async (re) => { while (!re.test(buf)) buf += new TextDecoder().decode((await reader.read()).value); };
  await until(/hui\.ready/);
  const before = fcm.calls.length;
  addMessage('hui-old', 'assistant', 'Noch ein Ergebnis', { ts: nowSec() - 1 });
  await ctx.push.pollNow();
  await until(/hui\.message/);
  const data = JSON.parse(/event: hui\.message\ndata: (.+)/.exec(buf)[1]);
  assert.equal(data.sessionId, 'hui-old');
  assert.equal(data.content, 'Noch ein Ergebnis');
  assert.equal(data.source, 'api_server');
  assert.equal(fcm.calls.length, before);
  // a cron result does not match this stream's source filter -> push
  addSession('cron_aaa111_20261011_100000', 'cron', { ended: true });
  addMessage('cron_aaa111_20261011_100000', 'assistant', 'Mittags-Update');
  await ctx.push.pollNow();
  assert.equal(fcm.calls.length, before + 1);
  ac.abort();
});

test('Hermes outbound webhook: HMAC required', async () => {
  const body = JSON.stringify({ hook_event_name: 'post_llm_call', session_id: 'hui-old' });
  assert.equal((await call('/bridge/hermes-hook', { method: 'POST', auth: null, body, headers: { 'x-hermes-signature-256': 'sha256=00' } })).status, 401);
  const sig = 'sha256=' + crypto.createHmac('sha256', HOOK_SECRET).update(body).digest('hex');
  assert.equal((await call('/bridge/hermes-hook', { method: 'POST', auth: null, body, headers: { 'x-hermes-signature-256': sig } })).status, 204);
});

test('M3: message previews are off unless BRIDGE_PUSH_PREVIEW=1', () => {
  assert.equal(loadPushConfig({}).preview, false);
  assert.equal(loadPushConfig({ BRIDGE_PUSH_PREVIEW: '1' }).preview, true);
  assert.equal(loadPushConfig({ BRIDGE_PUSH_PREVIEW: 'off' }).preview, false);
});

test('L4: unauthenticated hook bodies over 1 MB are refused before buffering', async () => {
  const big = 'x'.repeat(1024 * 1024 + 10);
  const sig = 'sha256=' + crypto.createHmac('sha256', HOOK_SECRET).update(big).digest('hex');
  const r = await call('/bridge/hermes-hook', { method: 'POST', auth: null, body: big, headers: { 'x-hermes-signature-256': sig } }).catch((e) => ({ status: 'reset' }));
  assert.ok(r.status === 413 || r.status === 'reset', String(r.status));
});

test('a turn whose app connection dropped keeps running and its answer is delivered (not treated as streamed)', async () => {
  addSession('hui-drop', 'api_server');
  await ctx.push.pollNow(); // first sight = baseline
  const ac = new AbortController();
  const r = await fetch(base + '/v1/chat/completions', {
    method: 'POST',
    signal: ac.signal,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-hermes-session-id': 'hui-drop' },
    body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'Lange Frage' }] }),
  });
  await r.body.getReader().read(); // first bytes in, then the network goes away
  ac.abort();
  await new Promise((res) => setTimeout(res, 400)); // Hermes finishes server-side
  assert.equal(sessions.get('hui-drop').messages.at(-1).content, 'Antwort nach Abbruch', 'upstream run was not aborted');
  const before = fcm.calls.length;
  await ctx.push.pollNow();
  assert.equal(fcm.calls.length, before + 1);
  assert.equal(fcm.calls.at(-1).n.body, 'Antwort nach Abbruch');
  assert.equal(fcm.calls.at(-1).n.data.sessionId, 'hui-drop');
});

test('safe default: the bridge only polls app sessions unless BRIDGE_PUSH_SOURCES adds cron', () => {
  assert.deepEqual(loadPushConfig({}).sources, ['api_server']);
  assert.deepEqual(loadPushConfig({ BRIDGE_PUSH_SOURCES: '' }).sources, ['api_server']);
  assert.equal(loadPushConfig({}).sessionPrefix, 'hui-');
  assert.deepEqual(loadPushConfig({ BRIDGE_PUSH_SOURCES: 'cron,api_server' }).sources, ['cron', 'api_server']);
  assert.deepEqual(DEFAULT_CLIENT_SOURCES, ['api_server']);
});

test('clients that do not ask for sources get app sessions only: no cron in the stream, no cron push for an unscoped device', async () => {
  const OTHER = 'g'.repeat(40) + ':APA91b' + 'y'.repeat(100);
  const reg = await call('/bridge/push/register', { method: 'POST', body: { platform: 'fcm', token: OTHER, profileId: 'p-n', locale: 'de' } });
  assert.equal(reg.status, 200);
  const ac = new AbortController();
  const stream = await fetch(base + '/bridge/inbox/stream', { headers: { authorization: `Bearer ${TOKEN}` }, signal: ac.signal });
  const reader = stream.body.getReader();
  let buf = '';
  const until = async (re) => { while (!re.test(buf)) buf += new TextDecoder().decode((await reader.read()).value); };
  await until(/hui\.ready\ndata: .+\n/);
  assert.deepEqual(JSON.parse(/event: hui\.ready\ndata: (.+)/.exec(buf)[1]).sources, ['api_server']);
  const before = fcm.calls.length;
  addSession('cron_aaa111_20261011_143000', 'cron', { ended: true });
  addMessage('cron_aaa111_20261011_143000', 'assistant', 'Nachmittags-Bericht');
  await ctx.push.pollNow();
  // the cron report went to push for the device that opted in (scope cron), never to the unscoped one
  const cronPushes = fcm.calls.slice(before);
  assert.equal(cronPushes.length, 1);
  assert.equal(cronPushes[0].token, FCM_TOKEN);
  // an app-session message reaches the stream; the cron report never did
  addMessage('hui-old', 'assistant', 'App-Ergebnis', { ts: nowSec() - 1 });
  await ctx.push.pollNow();
  await until(/App-Ergebnis/);
  assert.doesNotMatch(buf, /Nachmittags-Bericht|cron_/);
  ac.abort();
});

test('Astra F13: startServices starts the push watcher for both entrypoints; stop ends inbox streams', async () => {
  const { startServices } = await import('../src/server.mjs');
  const bin = fs.readFileSync(new URL('../bin/hermes-ui-bridge.mjs', import.meta.url), 'utf8');
  assert.match(bin, /startServices\(ctx\)/, 'the installed CLI uses the shared lifecycle');
  const ctx = createServer({ HERMES_BASE_URL: 'http://127.0.0.1:9', BRIDGE_TOKEN: 'tok-lifecycle-test-0001', BRIDGE_ROUTER: 'off', BRIDGE_BOOTSTRAP: 'off' }, { logger: silentLogger });
  let started = 0;
  const realStart = ctx.push.start.bind(ctx.push);
  ctx.push.start = () => (started++, realStart());
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  const stop = startServices(ctx);
  assert.equal(started, 1);
  const ctrl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${ctx.server.address().port}/bridge/inbox/stream`, { headers: { authorization: 'Bearer tok-lifecycle-test-0001' }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  await reader.read(); // hui.ready
  stop();
  let done = false;
  for (let i = 0; i < 20 && !done; i++) done = (await reader.read()).done;
  assert.ok(done, 'stop() ends open inbox streams');
  await new Promise((r) => ctx.server.close(r));
});

// Review (low): push senders never follow redirects (payload + VAPID JWT / bearer token would go to an unchecked host).
test('push: Web Push and FCM fetch with redirect: manual; a 3xx is a failure, not followed', async () => {
  const { createWebPushSender, generateVapidKeys } = await import('../src/push/webpush.mjs');
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/123', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  const inits = [];
  const redirecting = async (_url, init) => (inits.push(init), new Response(null, { status: 307, headers: { location: 'https://attacker.example/x' } }));
  const wp = createWebPushSender({ ...generateVapidKeys(), subject: 'mailto:a@b.c', fetch: redirecting });
  const r = await wp.send(sub, { title: 't' });
  assert.equal(r.ok, false);
  assert.equal(r.gone, undefined);
  assert.match(r.error, /redirect 307/);
  assert.equal(inits[0].redirect, 'manual');
  // a real fetch with redirect: 'manual' never contacts the Location target
  let hits = 0;
  const target = http.createServer((q, s) => { hits++; s.end(); });
  const redir = http.createServer((q, s) => { q.resume(); s.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/` }); s.end(); });
  for (const s of [target, redir]) { s.listen(0, '127.0.0.1'); await once(s, 'listening'); }
  try {
    const res = await fetch(`http://127.0.0.1:${redir.address().port}/`, { method: 'POST', body: 'x', redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(hits, 0);
  } finally {
    target.close(); redir.close();
  }
  const { createFcmSender } = await import('../src/push/fcm.mjs');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = { type: 'service_account', project_id: 'demo-test', client_email: 'push@hermes-ui-test.iam.example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' };
  const fcmInits = [];
  const fcm = createFcmSender({ serviceAccount: sa, fetch: async (_u, init) => (fcmInits.push(init), new Response(null, { status: 302, headers: { location: 'https://attacker.example/' } })) });
  assert.equal((await fcm.send('tok', { title: 'a', body: 'b' })).ok, false);
  assert.ok(fcmInits.length >= 1 && fcmInits.every((i) => i.redirect === 'manual'));
});
