import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createPushService } from '../src/index.mjs';
import { buildNotification, collapseKeyFor, createNotifier, inQuietHours, previewText } from '../src/notifier.mjs';
import { createRegistrationStore, parseSettings } from '../src/store.mjs';
import { generateVapidKeys } from '../src/webpush.mjs';

const FCM_TOKEN = 'f'.repeat(40) + ':APA91b' + 'x'.repeat(100);

function fakeSender(kind, results = []) {
  const calls = [];
  return {
    kind,
    calls,
    async send(target, n, env) {
      calls.push({ target, n, env });
      return results.shift() ?? { ok: true, status: 200 };
    },
  };
}

test('store: persists 0600 without content, upsert is idempotent per device+profile, cap evicts oldest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-store-'));
  const file = path.join(dir, 'push-registrations.json');
  let t = 1000;
  const s = createRegistrationStore({ file, maxPerUser: 3, now: () => t++ });
  const base = { user: 'alice', platform: 'fcm', preview: 'auto', locale: 'de', tz: 'Europe/Berlin', scope: {} };
  const a = s.upsert({ ...base, token: FCM_TOKEN, profileId: 'p1' });
  const a2 = s.upsert({ ...base, token: FCM_TOKEN, profileId: 'p1', preview: 'off' });
  assert.equal(a.id, a2.id);
  assert.equal(s.size, 1);
  s.upsert({ ...base, token: FCM_TOKEN, profileId: 'p2' });
  s.upsert({ ...base, token: FCM_TOKEN + 'b', profileId: 'p1' });
  s.upsert({ ...base, token: FCM_TOKEN + 'c', profileId: 'p1' });
  assert.equal(s.forUser('alice').length, 3);
  assert.equal(s.get(a.id), undefined, 'oldest evicted');
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  const reloaded = createRegistrationStore({ file });
  assert.equal(reloaded.size, 3);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /text|message|content/i);
  assert.equal(reloaded.remove({ user: 'other', platform: 'fcm', deviceKey: FCM_TOKEN }), 0, 'other users cannot remove');
  assert.equal(reloaded.dropDevice('fcm', FCM_TOKEN), 1);
});

test('settings validation', () => {
  assert.equal(parseSettings({ profileId: 'p-1', quiet: { from: '22:00', to: '07:00' }, tz: 'Europe/Berlin' }).ok, true);
  assert.equal(parseSettings({ profileId: '../x' }).ok, false);
  assert.equal(parseSettings({ profileId: 'p', quiet: { from: '25:00', to: '07:00' } }).ok, false);
  assert.equal(parseSettings({ profileId: 'p', tz: 'Mars/Base' }).ok, false);
  assert.equal(parseSettings({ profileId: 'p', preview: 'maybe' }).ok, false);
  assert.equal(parseSettings({ profileId: 'p', preview: false }).value.preview, 'off');
  assert.equal(parseSettings({ profileId: 'p', scope: { agents: ['kiwi', 'a b'] } }).ok, false);
});

test('preview text strips markdown, hui blocks and links; quiet hours wrap midnight in the user time zone', () => {
  assert.equal(previewText('**Hallo** [Welt](https://x)\n```hui\n{"type":"chart"}\n```\n- Punkt'), 'Hallo Welt Punkt');
  assert.ok(previewText('a '.repeat(200)).length <= 140);
  const q = { from: '22:00', to: '07:00' };
  // 2026-01-15 21:30 UTC = 22:30 Berlin
  assert.equal(inQuietHours(q, 'Europe/Berlin', Date.UTC(2026, 0, 15, 21, 30)), true);
  assert.equal(inQuietHours(q, 'UTC', Date.UTC(2026, 0, 15, 21, 30)), false);
  assert.equal(inQuietHours(q, 'Europe/Berlin', Date.UTC(2026, 0, 15, 6, 30)), false); // 07:30 Berlin
  assert.equal(inQuietHours({ from: '09:00', to: '17:00' }, 'UTC', Date.UTC(2026, 0, 15, 12)), true);
  assert.equal(inQuietHours(null, 'UTC'), false);
});

test('notification: preview auto/on/off vs. server default (privacy), quiet channel, opaque collapse key, locale', () => {
  const ev = { title: 'Pip', text: 'Geheime Einkaufsliste', data: { src: 'agent', agent: 'kiwi', sessionId: null }, threadKey: 'u|kiwi|t1', previewDefault: false };
  const reg = { profileId: 'p1', preview: 'auto', locale: 'de', tz: 'UTC', quiet: null };
  assert.equal(buildNotification(reg, ev).body, 'Neue Nachricht');
  assert.equal(buildNotification({ ...reg, preview: 'on' }, ev).body, 'Geheime Einkaufsliste');
  assert.equal(buildNotification({ ...reg, preview: 'off', locale: 'es' }, { ...ev, previewDefault: true }).body, 'Nuevo mensaje');
  const n = buildNotification({ ...reg, quiet: { from: '00:00', to: '23:59' } }, { ...ev, count: 3 });
  assert.equal(n.quiet, true);
  assert.equal(n.channelId, 'agent-messages-quiet');
  assert.equal(n.body, 'Neue Nachricht (+2 weitere)');
  assert.equal(n.collapseKey, collapseKeyFor('u|kiwi|t1'));
  assert.doesNotMatch(n.collapseKey, /kiwi|t1/);
  assert.deepEqual(n.data, { v: 1, kind: 'message', profileId: 'p1', src: 'agent', agent: 'kiwi' });
});

test('notification kind approval: localized fixed title, command only with previews on (not markdown-stripped), per-request data', () => {
  const ev = { title: 'Hermes', text: 'rm -rf ~/my_dir *.tmp `x`', threadKey: 'approval|r1', kind: 'approval', ttl: 300, data: { src: 'hermes', requestId: 'r1', runId: 'c1' }, previewDefault: false };
  const off = buildNotification({ profileId: 'p', locale: 'de', preview: 'auto' }, ev);
  assert.equal(off.title, 'Hermes wartet auf deine Freigabe');
  assert.equal(off.body, 'Ein Befehl wartet auf deine Entscheidung.');
  assert.doesNotMatch(JSON.stringify(off), /rm -rf|my_dir/);
  const on = buildNotification({ profileId: 'p', locale: 'es', preview: 'on' }, ev);
  assert.equal(on.title, 'Hermes espera tu aprobación');
  assert.equal(on.body, 'rm -rf ~/my_dir *.tmp `x`');
  assert.deepEqual([on.data.kind, on.data.requestId, on.data.runId, on.ttl], ['approval', 'r1', 'c1', 300]);
  assert.equal(buildNotification({ profileId: 'p', locale: 'en', preview: 'off' }, ev).title, 'Hermes is waiting for your approval');
  // a bot's request names the bot (Bots v2), the text rules stay the same
  assert.equal(buildNotification({ profileId: 'p', locale: 'de', preview: 'auto' }, { ...ev, botName: 'Scout' }).title, 'Scout wartet auf deine Freigabe');
  assert.equal(buildNotification({ profileId: 'p', locale: 'en', preview: 'on' }, { ...ev, botName: 'x'.repeat(60) }).title, `${'x'.repeat(40)} is waiting for your approval`);
  assert.equal(buildNotification({ profileId: 'p', locale: 'de' }, { title: 'T', text: 'hi', threadKey: 'x', data: {} }).data.kind, 'message');
});

test('notifier: scope match, dedupe, coalescing within the window, per-user rate limit, dead token dropped', async () => {
  const store = createRegistrationStore();
  const fcm = fakeSender('fcm');
  let now = 0;
  const notifier = createNotifier({ store, senders: { fcm }, now: () => now, coalesceMs: 1000, perUserPerHour: 3 });
  store.upsert({ user: 'u', platform: 'fcm', token: FCM_TOKEN, profileId: 'p1', preview: 'on', locale: 'en', tz: 'UTC', scope: { agents: ['agent-a'] } });
  store.upsert({ user: 'v', platform: 'fcm', token: FCM_TOKEN + 'v', profileId: 'p1', preview: 'on', locale: 'en', tz: 'UTC', scope: {} });
  const ev = (key, text) => ({ user: 'u', key, threadKey: 'u|agent-a|t', title: 'Agent A', text, data: { agent: 'agent-a' }, match: (r) => !r.scope.agents || r.scope.agents.includes('agent-a') });
  assert.equal((await notifier.notify(ev('m1', 'one'))).sent, 1);
  assert.equal((await notifier.notify(ev('m1', 'one'))).skipped, 'duplicate');
  assert.equal((await notifier.notify(ev('m2', 'two'))).skipped, 'coalesced');
  assert.equal((await notifier.notify(ev('m3', 'three'))).skipped, 'coalesced');
  now = 1000;
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(fcm.calls.length, 2);
  assert.equal(fcm.calls[1].n.body, 'three (+2 more)');
  assert.equal(fcm.calls[0].target, FCM_TOKEN, 'user v never gets user u events');
  // rate limit: 3 per hour
  now = 10_000;
  await notifier.notify({ ...ev('m4', 'x'), threadKey: 'a' });
  const limited = await notifier.notify({ ...ev('m5', 'x'), threadKey: 'b' });
  assert.equal(limited.skipped, 'rate limited');
  // gone -> device removed
  const store2 = createRegistrationStore();
  const fcm2 = fakeSender('fcm', [{ ok: false, status: 404, gone: true }]);
  const n2 = createNotifier({ store: store2, senders: { fcm: fcm2 } });
  store2.upsert({ user: 'u', platform: 'fcm', token: FCM_TOKEN, profileId: 'p1', preview: 'on', locale: 'en', tz: 'UTC', scope: {} });
  store2.upsert({ user: 'u', platform: 'fcm', token: FCM_TOKEN, profileId: 'p2', preview: 'on', locale: 'en', tz: 'UTC', scope: { agents: ['zzz'] } });
  await n2.notify({ user: 'u', key: 'k', threadKey: 't', title: 'x', text: 'y', data: {}, match: (r) => !r.scope.agents });
  assert.equal(store2.size, 0, 'every profile of the dead device is dropped');
  notifier.stop();
  n2.stop();
});

function serve(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('service routes: config, register/list/unregister/test per user, scope validation, inbox-first dispatch', async (t) => {
  const keys = generateVapidKeys();
  const fcm = fakeSender('fcm');
  const svc = createPushService({ webpush: { ...keys, subject: 'mailto:a@b.c' }, senders: { fcm } });
  const sendJson = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const routes = svc.routes({
    sendJson,
    validateScope: (user, scope) => (scope.agents?.some((a) => a !== 'agent-a') ? { ok: false, message: 'agent not available' } : { ok: true, value: scope }),
  });
  const server = await serve((req, res) => {
    const user = req.headers.authorization === 'Bearer A' ? 'alice' : req.headers.authorization === 'Bearer B' ? 'bob' : null;
    if (!user) return sendJson(res, 401, {});
    const p = req.url.split('?')[0];
    if (p === '/v1/inbox/stream') return svc.inbox.attach(user, req, res);
    if (routes.matches(p)) return routes.handle(req, res, user, p);
    sendJson(res, 404, {});
  });
  t.after(() => {
    svc.stop();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, p, body, tok = 'A') =>
    fetch(base + p, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() }));

  const cfg = await call('GET', '/bridge/push/config');
  assert.deepEqual(cfg.json.platforms, { webpush: { vapidPublicKey: keys.publicKey }, fcm: true, apns: false });
  assert.equal((await call('POST', '/bridge/push/register', { platform: 'apns', token: 'ab'.repeat(32), profileId: 'p1' })).status, 409);
  assert.equal((await call('POST', '/bridge/push/register', { platform: 'fcm', token: 'short', profileId: 'p1' })).status, 400);
  assert.equal((await call('POST', '/bridge/push/register', { platform: 'fcm', token: FCM_TOKEN, profileId: 'p1', scope: { agents: ['kiwi'] } })).status, 403);
  const reg = await call('POST', '/bridge/push/register', { platform: 'fcm', token: FCM_TOKEN, profileId: 'p1', scope: { agents: ['agent-a'] }, preview: 'off', locale: 'en', tz: 'Europe/Berlin' });
  assert.equal(reg.status, 200);
  assert.equal(reg.json.registration.device, `…${FCM_TOKEN.slice(-6)}`);
  assert.doesNotMatch(JSON.stringify(reg.json), new RegExp(FCM_TOKEN));
  assert.equal((await call('GET', '/bridge/push/registrations', null, 'B')).json.data.length, 0, 'other user sees nothing');
  assert.equal((await call('POST', '/bridge/push/unregister', { id: reg.json.registration.id }, 'B')).json.removed, 0);
  const tst = await call('POST', '/bridge/push/test', {});
  assert.deepEqual(tst.json.results.map((r) => r.ok), [true]);
  assert.equal(fcm.calls.at(-1).n.body, 'Test notification: push works.');

  // inbox-first: with a connected stream the event goes live, otherwise push
  const ev = { user: 'alice', key: 'm1', threadKey: 'x', title: 'Agent A', text: 'hi', data: {}, inbox: { id: 'm1', content: 'hi' } };
  const ctrl = new AbortController();
  const res = await fetch(base + '/v1/inbox/stream', { headers: { authorization: 'Bearer A' }, signal: ctrl.signal });
  const reader = res.body.getReader();
  let buf = '';
  const readUntil = async (re) => {
    while (!re.test(buf)) buf += new TextDecoder().decode((await reader.read()).value);
  };
  await readUntil(/hui\.ready/);
  const before = fcm.calls.length;
  assert.equal(await svc.dispatch(ev), 'inbox');
  await readUntil(/hui\.message/);
  assert.match(buf, /"content":"hi"/);
  assert.equal(fcm.calls.length, before);
  assert.equal(await svc.dispatch({ ...ev, user: 'bob', key: 'm2' }), 'none', 'bob has no stream and no registration');
  ctrl.abort();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(svc.inbox.connected('alice'), false);
  assert.equal(await svc.dispatch({ ...ev, key: 'm3', threadKey: 'y' }), 'push');
  assert.equal((await call('POST', '/bridge/push/unregister', { platform: 'fcm', token: FCM_TOKEN })).json.removed, 1);
});

test('GPT security H3: registrations are bound to the registering credential; revoked/unbound ones never deliver', async (t) => {
  const fcm = fakeSender('fcm');
  const svc = createPushService({ senders: { fcm }, notifier: { coalesceMs: 0 } });
  t.after(() => svc.stop());
  const revoked = new Set();
  svc.setCredentialCheck((user, cred) => typeof cred === 'string' && !revoked.has(cred));
  const sendJson = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  const routes = svc.routes({ sendJson });
  const server = await serve((req, res) => {
    const cred = req.headers.authorization === 'Bearer P' ? 'phone' : 'laptop';
    return routes.handle(req, res, 'alice', req.url, cred);
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const reg = (tok, token) =>
    fetch(`${base}/bridge/push/register`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'fcm', token, profileId: 'p1', preview: 'on' }) });
  assert.equal((await reg('P', FCM_TOKEN)).status, 200);
  assert.equal((await reg('L', FCM_TOKEN + 'L')).status, 200);
  assert.deepEqual(svc.store.forUser('alice').map((r) => r.credential).sort(), ['laptop', 'phone']);
  // legacy registration without a credential binding (stored before this fix)
  svc.store.upsert({ user: 'alice', platform: 'fcm', token: FCM_TOKEN + 'old', profileId: 'p1', preview: 'on', scope: {}, enabled: true });

  revoked.add('phone');
  const r = await svc.notifier.notify({ user: 'alice', key: 'k1', threadKey: 't1', title: 'Agent A', text: 'secret preview', data: {} });
  assert.equal(r.sent, 1);
  assert.deepEqual(fcm.calls.map((c) => c.target), [FCM_TOKEN + 'L'], 'only the still-valid credential receives it');
  assert.deepEqual(svc.store.forUser('alice').map((x) => x.credential), ['laptop'], 'revoked and unbound registrations are dropped');
  revoked.add('laptop');
  assert.deepEqual(await svc.notifier.test('alice'), []);
  assert.equal(fcm.calls.length, 1);
});

test('GPT security M5: push test notifications have their own small budget', async () => {
  const fcm = fakeSender('fcm');
  const store = createRegistrationStore();
  store.upsert({ user: 'alice', platform: 'fcm', token: FCM_TOKEN, profileId: 'p1', preview: 'on', scope: {}, enabled: true });
  const n = createNotifier({ store, senders: { fcm }, testsPerHour: 3 });
  for (let i = 0; i < 3; i++) assert.equal((await n.test('alice'))[0].ok, true);
  const limited = await n.test('alice');
  assert.equal(limited[0].ok, false);
  assert.match(limited[0].error, /rate limited/);
  assert.equal(fcm.calls.length, 3);
});
