// Routines result inbox (slice 2): reconciler against a fake Hermes (job list + cron sessions per profile), store,
// retention, /bridge/routines/* endpoints, push + live hints, push-hermes interplay. Local fake servers only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import {
  applyRetention, cutUtf8, entryId, finalAssistantText, mapStatus, parseInboxState, summaryOf, INBOX_FILE,
} from '../src/routines-inbox.mjs';
import { buildNotification, CHANNEL_DEFAULT, CHANNEL_QUIET } from '../src/push/notifier.mjs';

const TOKEN = 'test-token-0000000000000000';
const DAY = 86_400_000;
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const jobId = (n) => n.toString(16).padStart(12, 'a');
const fcmToken = (n) => `fake${n}`.padEnd(40, 'x') + ':APA91b' + 'f'.repeat(60);
const tick = () => new Promise((r) => setImmediate(r));

// ---------- fake Hermes ----------
/** @type {Record<string, {jobs: any[], sessions: any[], messages: Record<string, any[]>}>} */
let H = {};
/** @type {RegExp[]} */ let failing = [];
/** @type {string[]} */ let calls = [];
const botData = (name = '') => (H[name] ??= { jobs: [], sessions: [], messages: {} });
let msgSeq = 1;
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);

function addJob(bot, id, over = {}) {
  const j = { id, name: `Job ${id.slice(-3)}`, enabled: true, state: 'scheduled', last_run_at: null, last_status: null, last_error: null, ...over };
  botData(bot).jobs.push(j);
  return j;
}
/** Simulate a finished run: last_run_at/last_status on the job + a cron session with the final answer. */
function run(bot, job, { text = 'Result text', status = 'ok', at = new Date(), session = true, error = null } = {}) {
  job.last_run_at = at.toISOString();
  job.last_status = status;
  job.last_error = error;
  if (!session) return null;
  const sid = `cron_${job.id}_${stamp(at)}`;
  const t = at.getTime() / 1000;
  botData(bot).sessions.push({ id: sid, source: 'cron', started_at: t - 40, last_active: t });
  botData(bot).messages[sid] = [
    { id: msgSeq++, role: 'user', content: 'prompt', timestamp: t - 39 },
    { id: msgSeq++, role: 'assistant', content: 'tool step', finish_reason: 'tool_calls', timestamp: t - 20 },
    ...(text === null ? [] : [{ id: msgSeq++, role: 'assistant', content: text, finish_reason: 'stop', timestamp: t - 2 }]),
  ];
  return sid;
}

let upstream;
const open = [];
before(async () => {
  upstream = http.createServer((req, res) => {
    req.resume();
    calls.push(req.url);
    const json = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (failing.some((re) => re.test(req.url))) return json(500, { error: 'boom' });
    if (req.headers.authorization !== 'Bearer upstream-test-key') return json(401, { error: 'key' });
    const u = new URL(req.url, 'http://x');
    const m = /^\/p\/([a-z0-9_-]+)(\/.*)$/.exec(u.pathname);
    const d = botData(m ? m[1] : '');
    const p = m ? m[2] : u.pathname;
    if (p === '/api/jobs') return json(200, { jobs: d.jobs });
    if (p === '/api/sessions') return json(200, { object: 'list', data: d.sessions.filter((s) => s.source === u.searchParams.get('source')).slice(-Number(u.searchParams.get('limit') ?? 50)).reverse() });
    const mm = /^\/api\/sessions\/([^/]+)\/messages$/.exec(p);
    if (mm) return json(200, { object: 'list', data: [...(d.messages[decodeURIComponent(mm[1])] ?? [])].reverse() });
    return json(404, { error: 'nope' });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
});
after(() => {
  for (const c of open) { c.ctx.push.stop(); c.ctx.routines.stop(); c.ctx.server.close(); c.ctx.server.closeAllConnections(); }
  upstream.close(); upstream.closeAllConnections();
});

/** Fresh fake data + a bridge with a state dir, routines on for default + writer, FCM fake. */
async function bridge(env = {}, { stateDir = tmp('routines-inbox-'), reset = true } = {}) {
  if (reset) { H = {}; failing = []; calls = []; }
  const sent = [];
  const fcm = { send: async (token, n) => (sent.push({ token, n }), { ok: true, status: 200 }) };
  const ctx = createServer({
    HERMES_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`, HERMES_API_KEY: 'upstream-test-key', BRIDGE_TOKEN: TOKEN,
    BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'off', BRIDGE_PROFILES: 'writer,reader', BRIDGE_ROUTINES_BOTS: 'default,writer',
    BRIDGE_STATE_DIR: stateDir, BRIDGE_PUSH_COALESCE_MS: '0', BRIDGE_PUSH_SETTLE_MS: '0',
    HERMES_HOME: path.join(os.tmpdir(), 'routines-no-hermes-home'), ...env,
  }, { logger: silentLogger, pushSenders: { fcm } });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  const c = { ctx, sent, stateDir, base: `http://127.0.0.1:${ctx.server.address().port}` };
  open.push(c);
  c.call = async (p, { method = 'GET', body, auth = TOKEN } = {}) => {
    const r = await fetch(c.base + p, { method, headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = undefined; }
    return { status: r.status, data, text };
  };
  c.pair = (label) => {
    const d = ctx.devices.issue(label);
    return { id: d.id, token: ctx.devices.redeem(d.code).token };
  };
  c.register = async (n, { auth = TOKEN, sources = ['routines'], locale = 'en', ...rest } = {}) => {
    const r = await c.call('/bridge/push/register', { method: 'POST', auth, body: { platform: 'fcm', token: fcmToken(n), profileId: `p-${n}`, scope: { sources }, locale, ...rest } });
    assert.equal(r.status, 200, r.text);
  };
  c.poll = async () => { await ctx.routines.pollNow(); await tick(); };
  c.items = () => ctx.routines.state().items;
  return c;
}

// ---------- pure helpers ----------

test('helpers: entry id, UTF-8 cut, final text, status mapping, summary', () => {
  const a = entryId('default', 'aaaaaaaaaaaa', '2026-10-01T07:00:00+00:00');
  assert.match(a, /^ri_[0-9a-f]{20}$/);
  assert.equal(a, entryId('default', 'aaaaaaaaaaaa', '2026-10-01T07:00:00+00:00'));
  assert.notEqual(a, entryId('writer', 'aaaaaaaaaaaa', '2026-10-01T07:00:00+00:00'));
  const cut = cutUtf8('ä'.repeat(10), 5);
  assert.deepEqual(cut, { text: 'ää', truncated: true });
  assert.deepEqual(cutUtf8('😀😀', 6), { text: '😀', truncated: true });
  assert.deepEqual(cutUtf8('abc', 5), { text: 'abc', truncated: false });
  assert.equal(finalAssistantText([
    { role: 'assistant', content: 'old', timestamp: 1 }, { role: 'assistant', content: 'hidden', display_kind: 'hidden', timestamp: 4 },
    { role: 'assistant', content: 'tool', finish_reason: 'tool_calls', timestamp: 3 }, { role: 'assistant', content: [{ type: 'text', text: 'final' }], timestamp: 2 },
    { role: 'user', content: 'later', timestamp: 5 }, { role: 'assistant', content: '  ', timestamp: 6 },
  ]), 'final');
  assert.equal(finalAssistantText(null), '');
  assert.deepEqual(mapStatus('ok', 'hi'), { status: 'ok' });
  assert.deepEqual(mapStatus('ok', '[SILENT] nothing'), { status: 'silent' });
  assert.deepEqual(mapStatus('ok', ''), { status: 'ok' });
  assert.deepEqual(mapStatus('error', 'x'), { status: 'failed' });
  assert.deepEqual(mapStatus('blocked_config', ''), { status: 'blocked' });
  assert.deepEqual(mapStatus('delivery_failed', 'x'), { status: 'ok', deliveryFailed: true });
  assert.deepEqual(mapStatus(null, 'x'), { status: 'ok' });
  assert.deepEqual(mapStatus('weird', ''), { status: 'failed' });
  assert.equal(summaryOf('# Morning\n**Sunny**, 18 °C. [Details](https://example.com)'), 'Morning Sunny, 18 °C. Details');
  assert.equal(summaryOf('```hui\n{"type":"products","products":[{"name":"x","title":"Best offer"}]}\n```'), 'Best offer');
  assert.equal(summaryOf('```hui\n{"type":"stats","summary":"Prices fell"}\n```'), 'Prices fell');
  assert.equal(summaryOf('```hui\nnot json\n```'), '');
  assert.ok(summaryOf('word '.repeat(100)).length <= 240);
});

test('retention: age, then oldest read first, then oldest; size cap', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  const it = (id, daysAgo, read, text = '') => ({ id, finishedAt: new Date(now - daysAgo * DAY).toISOString(), readAt: read ? 1 : null, createdAt: 0, text });
  const items = [it('a', 40, true), it('b', 5, false), it('c', 4, true), it('d', 3, false), it('e', 2, true)];
  assert.deepEqual(applyRetention(items, { nowMs: now, days: 30, maxItems: 10 }).map((x) => x.id), ['b', 'c', 'd', 'e']);
  assert.deepEqual(applyRetention(items, { nowMs: now, days: 30, maxItems: 3 }).map((x) => x.id), ['b', 'd', 'e']);
  assert.deepEqual(applyRetention(items, { nowMs: now, days: 30, maxItems: 1 }).map((x) => x.id), ['d']);
  const big = [it('x', 3, false, 'x'.repeat(3000)), it('y', 2, false, 'y'.repeat(3000)), it('z', 1, true, 'z'.repeat(3000))];
  assert.deepEqual(applyRetention(big, { nowMs: now, days: 30, maxItems: 10, maxBytes: 7000 }).map((x) => x.id), ['x', 'y']);
  assert.deepEqual(applyRetention(big, { nowMs: now, days: 30, maxItems: 10, maxBytes: 4000 }).map((x) => x.id), ['y']);
  // stored state is validated on load
  const s = parseInboxState({ v: 1, bots: { default: { baselineAt: 5, jobs: { aaaaaaaaaaaa: 'x', bad: 'y' } }, 'Bad!': { baselineAt: 1 } }, items: [{ id: 'nope' }, { id: 'ri_' + '0'.repeat(20), hermesProfile: 'default', jobId: 'aaaaaaaaaaaa', finishedAt: '2026-10-01T00:00:00Z', status: 'ok', extra: 1 }] });
  assert.deepEqual(Object.keys(s.bots), ['default']);
  assert.deepEqual(s.bots.default.jobs, { aaaaaaaaaaaa: 'x' });
  assert.equal(s.items.length, 1);
  assert.equal('extra' in s.items[0], false);
});

// ---------- reconciler ----------

test('baseline backfill (read, no push), then a new run → unread entry + push only to routines registrations with read', async () => {
  const c = await bridge();
  const A = addJob('', jobId(1), { name: 'Morning briefing' });
  const B = addJob('', jobId(2));
  const C = addJob('', jobId(3));
  run('', A, { text: '**Good morning.** 18 °C.', at: new Date(Date.now() - 3600_000) });
  run('', B, { text: 'too old', at: new Date(Date.now() - 40 * DAY) });
  const admin = 1; const phone = c.pair('Phone'); const blocked = c.pair('Blocked'); const cronOnly = 4;
  await c.call('/bridge/routines/rights', { method: 'PUT', body: { devices: { [blocked.id]: { default: 'none' } } } });
  await c.register(admin, { locale: 'de' });
  await c.register(2, { auth: phone.token, locale: 'es' });
  await c.register(3, { auth: blocked.token });
  await c.register(cronOnly, { sources: ['cron'] });
  await c.poll();
  assert.equal(c.items().length, 1, 'backfill: newest run within the retention window only');
  const back = c.items()[0];
  assert.equal(back.id, entryId('default', A.id, A.last_run_at));
  assert.equal(back.status, 'ok');
  assert.notEqual(back.readAt, null, 'backfill is read');
  assert.equal(back.text, '**Good morning.** 18 °C.');
  assert.equal(back.summary, 'Good morning. 18 °C.');
  assert.match(back.sessionId, new RegExp(`^cron_${A.id}_`));
  assert.equal(c.sent.length, 0, 'no push for the baseline');
  const st = JSON.parse(fs.readFileSync(path.join(c.stateDir, INBOX_FILE), 'utf8'));
  assert.deepEqual(Object.keys(st.bots.default.jobs).sort(), [A.id, B.id, C.id]);
  assert.equal(st.bots.default.jobs[C.id], '');
  assert.equal(fs.statSync(path.join(c.stateDir, INBOX_FILE)).mode & 0o777, 0o600);

  run('', C, { text: 'Price check: ```hui\n{"type":"products"}\n```' });
  await c.poll();
  assert.equal(c.items().length, 2);
  const e = c.items().find((x) => x.jobId === C.id);
  assert.equal(e.readAt, null);
  assert.equal(e.hasRich, true);
  const tokens = c.sent.map((s) => s.token).sort();
  assert.deepEqual(tokens, [fcmToken(1), fcmToken(2)].sort(), 'admin + read device; not the none device, not cron-only');
  const de = c.sent.find((s) => s.token === fcmToken(1)).n;
  assert.deepEqual([de.title, de.body], ['Ergebnis einer Routine', 'Ein neues Ergebnis liegt im Posteingang.'], 'previews off by default');
  assert.deepEqual(de.data, { v: 1, kind: 'routine', profileId: 'p-1', src: 'hermes', jobId: C.id, itemId: e.id });
  assert.equal(c.sent.find((s) => s.token === fcmToken(2)).n.title, 'Resultado de una rutina');
  // the store has the content, the push registrations / logs do not
  assert.doesNotMatch(fs.readFileSync(path.join(c.stateDir, 'push-registrations.json'), 'utf8'), /Price|morning/);

  // duplicate poll: nothing new; restart on the same state dir: nothing new either
  await c.poll();
  assert.equal(c.items().length, 2);
  assert.equal(c.sent.length, 2);
  const again = await bridge({}, { stateDir: c.stateDir, reset: false });
  await again.register(9);
  await again.poll();
  assert.equal(again.items().length, 2);
  assert.equal(again.sent.length, 0);
});

test('silent run: stored read, never pushed; failed run without session: error, no text; blocked / delivery failed', async () => {
  const c = await bridge({ BRIDGE_PUSH_PREVIEW: '1' });
  const S = addJob('', jobId(1), { name: 'Watch' });
  const F = addJob('', jobId(2), { name: 'Status watch' });
  const D = addJob('', jobId(3), { name: 'Digest' });
  const K = addJob('', jobId(4), { name: 'Blocked one' });
  await c.register(1);
  await c.poll(); // baseline (nothing ran yet)
  run('', S, { text: 'Nothing new.\n[SILENT]' });
  run('', F, { status: 'error', session: false, error: 'Site https://example.com unreachable\nretry later' });
  run('', D, { status: 'delivery_failed', text: 'Digest done' });
  K.last_run_at = new Date().toISOString(); K.last_status = 'blocked_config'; K.last_error = 'toolset missing';
  await c.poll();
  const by = (id) => c.items().find((x) => x.jobId === id);
  assert.equal(by(S.id).status, 'silent');
  assert.notEqual(by(S.id).readAt, null);
  assert.deepEqual([by(F.id).status, by(F.id).text, by(F.id).sessionId, by(F.id).error], ['failed', '', null, 'Site https://example.com unreachable retry later']);
  assert.equal(by(F.id).runAt, by(F.id).finishedAt);
  assert.deepEqual([by(D.id).status, by(D.id).deliveryFailed], ['ok', true]);
  assert.deepEqual([by(K.id).status, by(K.id).error], ['blocked', 'toolset missing']);
  const pushed = c.sent.map((s) => s.n.data.jobId).sort();
  assert.deepEqual(pushed, [F.id, D.id, K.id].sort(), 'silent never pushed');
  const failed = c.sent.find((s) => s.n.data.jobId === F.id).n;
  assert.deepEqual([failed.title, failed.body], ['Status watch', 'A routine failed.'], 'preview on: routine title; no summary → generic failed body');
  assert.deepEqual([c.sent.find((s) => s.n.data.jobId === D.id).n.body], ['Digest done']);
});

test('running execution: not yet; the session is matched by job id and start time; unreferenced older sessions are skipped', async () => {
  const c = await bridge();
  const A = addJob('', jobId(1));
  await c.poll();
  run('', A, { text: 'first' });
  A.latest_execution = { status: 'running' };
  await c.poll();
  assert.equal(c.items().length, 0, 'a claimed / running execution waits');
  A.latest_execution = { status: 'completed' };
  await c.poll();
  assert.equal(c.items()[0].text, 'first');
  // next run; a session that started after last_run_at + 120 s belongs to a later run and is not used
  const at = new Date(Date.now() + 60_000);
  run('', A, { text: 'second', at });
  const later = new Date(at.getTime() + 600_000);
  botData('').sessions.push({ id: `cron_${A.id}_${stamp(later)}`, source: 'cron', started_at: later.getTime() / 1000, last_active: later.getTime() / 1000 });
  botData('').messages[`cron_${A.id}_${stamp(later)}`] = [{ id: msgSeq++, role: 'assistant', content: 'from the future', timestamp: later.getTime() / 1000 }];
  await c.poll();
  assert.deepEqual(c.items().map((x) => x.text).sort(), ['first', 'second']);
});

test('a run without its own session never inherits an older one; an unchanged poll does not rewrite the file', async () => {
  const c = await bridge();
  const A = addJob('', jobId(7));
  const t0 = Date.now() - 3 * 3600_000;
  // two runs before the bridge saw the bot: only the newest is backfilled, the older session stays unreferenced
  run('', A, { text: 'old run', at: new Date(t0) });
  run('', A, { text: 'newest before baseline', at: new Date(t0 + 3600_000) });
  await c.poll();
  assert.deepEqual(c.items().map((x) => x.text), ['newest before baseline']);
  // a failed run that left no session: error only, not the old run's text
  run('', A, { status: 'error', error: 'model unreachable', session: false, at: new Date(t0 + 2 * 3600_000) });
  await c.poll();
  const failed = c.items().find((x) => x.status === 'failed');
  assert.ok(failed);
  assert.equal(failed.text, '');
  assert.equal(failed.sessionId, null);
  assert.equal(failed.error, 'model unreachable');
  const file = path.join(c.stateDir, INBOX_FILE);
  const ino = fs.statSync(file).ino;
  await c.poll();
  await c.poll();
  assert.equal(fs.statSync(file).ino, ino, 'nothing changed: no atomic rewrite');
});

test('profile isolation: the same job id on two bots gives two entries, read under each prefix; push carries hermesProfile', async () => {
  const c = await bridge();
  const id = jobId(7);
  const d = addJob('', id, { name: 'Default job' });
  const w = addJob('writer', id, { name: 'Writer job' });
  addJob('reader', jobId(8)); // reader is served but not enabled: never polled
  await c.register(1);
  await c.poll();
  const at = new Date();
  run('', d, { text: 'default answer', at });
  run('writer', w, { text: 'writer answer', at });
  calls = [];
  await c.poll();
  assert.equal(c.items().length, 2);
  const de = c.items().find((x) => x.hermesProfile === 'default');
  const wr = c.items().find((x) => x.hermesProfile === 'writer');
  assert.notEqual(de.id, wr.id);
  assert.deepEqual([de.text, wr.text, wr.title], ['default answer', 'writer answer', 'Writer job']);
  assert.ok(calls.some((u) => u.startsWith('/p/writer/api/sessions/cron_')));
  assert.ok(!calls.some((u) => u.startsWith('/p/reader/')), 'not enabled: not polled');
  assert.equal(c.sent.find((s) => s.n.data.itemId === wr.id).n.data.hermesProfile, 'writer');
  assert.equal('hermesProfile' in c.sent.find((s) => s.n.data.itemId === de.id).n.data, false);
  // the item belongs to one bot only
  assert.equal((await c.call(`/bridge/routines/inbox/${wr.id}?hermesProfile=default`)).data.error.code, 'item_not_found');
  assert.equal((await c.call(`/bridge/routines/inbox/${wr.id}?hermesProfile=writer`)).data.item.text, 'writer answer');
});

test('per-bot cap: 20 runs per poll, the rest on the next poll; a new job is unread only when newer than the baseline', async () => {
  const c = await bridge();
  const jobs = Array.from({ length: 25 }, (_, i) => addJob('', jobId(i + 1)));
  await c.poll();
  jobs.forEach((j, i) => run('', j, { text: `r${i}`, at: new Date(Date.now() - (25 - i) * 1000) }));
  await c.poll();
  assert.equal(c.items().length, 20);
  await c.poll();
  assert.equal(c.items().length, 25);
  assert.ok(c.items().every((x) => x.readAt === null));
  // jobs that appear after the baseline: an old last run comes in read, a fresh one unread
  const old = addJob('', jobId(100), { last_run_at: new Date(Date.now() - DAY).toISOString(), last_status: 'ok' });
  const fresh = addJob('', jobId(101));
  run('', fresh, { text: 'new job ran' });
  await c.poll();
  assert.notEqual(c.items().find((x) => x.jobId === old.id).readAt, null);
  assert.equal(c.items().find((x) => x.jobId === fresh.id).readAt, null);
  // a job that disappeared loses its checkpoint, its entries stay
  botData('').jobs = botData('').jobs.filter((j) => j.id !== old.id);
  await c.poll();
  const st = JSON.parse(fs.readFileSync(path.join(c.stateDir, INBOX_FILE), 'utf8'));
  assert.equal(old.id in st.bots.default.jobs, false);
  assert.ok(c.items().some((x) => x.jobId === old.id));
});

test('retention: days and max entries apply on commit; upstream failures keep the checkpoint', async () => {
  const c = await bridge({ BRIDGE_ROUTINES_INBOX_DAYS: '2', BRIDGE_ROUTINES_INBOX_MAX: '3' });
  const A = addJob('', jobId(1));
  const old = addJob('', jobId(2), { last_run_at: new Date(Date.now() - 3 * DAY).toISOString(), last_status: 'ok' });
  await c.poll();
  assert.equal(c.items().length, 0, 'older than the window: not even backfilled');
  for (let i = 0; i < 5; i++) {
    run('', A, { text: `run ${i}`, at: new Date(Date.now() + i * 60_000) }); // runs of one job never overlap
    await c.poll();
  }
  assert.deepEqual(c.items().map((x) => x.text), ['run 2', 'run 3', 'run 4'], 'max entries: the oldest go');
  assert.ok(old);
  // sessions API down: no entry, checkpoint unchanged, retried next poll
  run('', A, { text: 'run 5', at: new Date(Date.now() + 5 * 60_000) });
  const cp = JSON.parse(fs.readFileSync(path.join(c.stateDir, INBOX_FILE), 'utf8')).bots.default.jobs[A.id];
  failing = [/\/api\/sessions\?/];
  await c.poll();
  assert.equal(c.items().at(-1).text, 'run 4');
  assert.equal(JSON.parse(fs.readFileSync(path.join(c.stateDir, INBOX_FILE), 'utf8')).bots.default.jobs[A.id], cp);
  failing = [/\/messages/];
  await c.poll();
  assert.equal(c.items().at(-1).text, 'run 4');
  failing = [/\/api\/jobs/];
  await c.poll();
  assert.equal(c.items().at(-1).text, 'run 4');
  failing = [];
  await c.poll();
  assert.equal(c.items().at(-1).text, 'run 5');
});

test('memory only without a state dir; a disabled bot keeps its entries but they are not served', async () => {
  H = {}; failing = [];
  const c = await bridge({ BRIDGE_STATE_DIR: '', BRIDGE_ROUTINES_BOTS: 'default' }, { stateDir: '', reset: false });
  const A = addJob('', jobId(1));
  await c.poll();
  run('', A, { text: 'kept in memory' });
  await c.poll();
  assert.equal(c.items().length, 1);
  const caps = await c.call('/bridge/routines/capabilities?hermesProfile=default');
  assert.deepEqual([caps.data.inbox.durable, caps.data.reasons], [false, ['inbox_memory_only']]);
  // state dir bridge: disable writer via the registry → 404 routines_off, entries stay
  const d = await bridge({ BRIDGE_ROUTINES_BOTS: 'default' });
  await d.call('/bridge/routines/rights', { method: 'PUT', body: { bots: { writer: true } } });
  const w = addJob('writer', jobId(2));
  await d.poll();
  run('writer', w, { text: 'writer result' });
  await d.poll();
  assert.equal((await d.call('/bridge/routines/inbox?hermesProfile=writer')).data.items.length, 1);
  await d.call('/bridge/routines/rights', { method: 'PUT', body: { bots: { writer: false } } });
  await d.poll();
  const r = await d.call('/bridge/routines/inbox?hermesProfile=writer');
  assert.deepEqual([r.status, r.data.error.code], [404, 'routines_off']);
  assert.equal(d.items().filter((x) => x.hermesProfile === 'writer').length, 1, 'entries stay');
  assert.equal('writer' in d.ctx.routines.state().bots, false, 'checkpoints go: re-enabling starts with a baseline');
});

// ---------- endpoints ----------

test('inbox endpoints: filter, cursor, limit, detail, mark read, read-all, validation, rights', async () => {
  const c = await bridge();
  const jobs = Array.from({ length: 5 }, (_, i) => addJob('', jobId(i + 1), { name: `Routine ${i}` }));
  await c.poll();
  jobs.forEach((j, i) => run('', j, { text: `Answer ${i}`, at: new Date(Date.now() + i * 1000) }));
  await c.poll();
  const L = '/bridge/routines/inbox?hermesProfile=default';
  let r = await c.call(`${L}&limit=2`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.items.map((x) => x.title), ['Routine 4', 'Routine 3']);
  assert.equal(r.data.unreadCount, 5);
  assert.equal(r.data.nextCursor, r.data.items[1].id);
  const first = r.data.items[0];
  assert.equal('text' in first, false);
  assert.equal('readAt' in first, false);
  assert.equal(first.read, false);
  r = await c.call(`${L}&limit=2&before=${r.data.nextCursor}`);
  assert.deepEqual(r.data.items.map((x) => x.title), ['Routine 2', 'Routine 1']);
  r = await c.call(`${L}&limit=2&before=${r.data.nextCursor}`);
  assert.deepEqual([r.data.items.map((x) => x.title), r.data.nextCursor], [['Routine 0'], null]);
  r = await c.call(`/bridge/routines/inbox/${first.id}?hermesProfile=default`);
  assert.deepEqual([r.data.item.text, r.data.item.truncated, r.data.item.read], ['Answer 4', false, false]);
  r = await c.call(`/bridge/routines/inbox/${first.id}`, { method: 'PATCH', body: { hermesProfile: 'default', read: true } });
  assert.deepEqual([r.status, r.data.item.read, r.data.unreadCount], [200, true, 4]);
  r = await c.call(`${L}&filter=unread`);
  assert.equal(r.data.items.length, 4);
  r = await c.call(`/bridge/routines/inbox/${first.id}`, { method: 'PATCH', body: { hermesProfile: 'default', read: false } });
  assert.equal(r.data.unreadCount, 5);
  // read state is persisted (owner-wide)
  assert.equal(JSON.parse(fs.readFileSync(path.join(c.stateDir, INBOX_FILE), 'utf8')).items.filter((x) => x.readAt === null).length, 5);
  r = await c.call('/bridge/routines/inbox/read-all', { method: 'POST', body: { hermesProfile: 'default' } });
  assert.deepEqual(r.data, { updated: 5, unreadCount: 0 });
  assert.equal((await c.call(`${L}&filter=unread`)).data.items.length, 0);
  // validation
  for (const [p, code, status] of [
    ['/bridge/routines/inbox', 'missing_profile', 400], ['/bridge/routines/inbox?hermesProfile=ghost', 'unknown_profile', 404],
    ['/bridge/routines/inbox?hermesProfile=Bad!', 'unknown_profile', 404], [`${L}&filter=new`, 'invalid_filter', 400],
    [`${L}&limit=0`, 'invalid_limit', 400], [`${L}&limit=101`, 'invalid_limit', 400], [`${L}&limit=x`, 'invalid_limit', 400],
    [`${L}&before=ri_${'0'.repeat(20)}`, 'invalid_cursor', 400], [`/bridge/routines/inbox/ri_${'0'.repeat(20)}?hermesProfile=default`, 'item_not_found', 404],
    ['/bridge/routines/nope', 'not_found', 404], ['/bridge/routines/inbox/xyz', 'not_found', 404],
    ['/bridge/routines/inbox?hermesProfile=reader', 'routines_off', 404],
  ]) {
    r = await c.call(p);
    assert.deepEqual([r.status, r.data?.error?.code], [status, code], p);
  }
  for (const [body, code, status] of [
    [{ hermesProfile: 'default', read: true, x: 1 }, 'unsupported_field', 400], [{ hermesProfile: 'default', read: 'yes' }, 'invalid_request', 400],
    ['nope', 'invalid_json', 400], [JSON.stringify({ hermesProfile: 'default', read: true, pad: 'x'.repeat(1100) }), 'payload_too_large', 413],
  ]) {
    r = await c.call(`/bridge/routines/inbox/${first.id}`, { method: 'PATCH', body });
    assert.deepEqual([r.status, r.data.error.code], [status, code], JSON.stringify(body).slice(0, 60));
  }
  assert.equal((await c.call('/bridge/routines/inbox/read-all', { method: 'POST', body: { hermesProfile: 'default', all: true } })).data.error.code, 'unsupported_field');
  assert.equal((await c.call(L, { method: 'POST', body: {} })).status, 405);
  assert.equal((await c.call(L, { auth: null })).status, 401);
  assert.equal((await c.call(L, { auth: 'wrong-test-token-000000' })).status, 401);
  // devices: read by default (may mark read), none → 403 everywhere except capabilities
  const phone = c.pair('Phone');
  assert.equal((await c.call(L, { auth: phone.token })).status, 200);
  assert.equal((await c.call(`/bridge/routines/inbox/${first.id}`, { method: 'PATCH', auth: phone.token, body: { hermesProfile: 'default', read: false } })).status, 200);
  await c.call('/bridge/routines/rights', { method: 'PUT', body: { devices: { [phone.id]: { default: 'none' } } } });
  for (const [p, method, body] of [[L, 'GET'], [`/bridge/routines/inbox/${first.id}?hermesProfile=default`, 'GET'],
    [`/bridge/routines/inbox/${first.id}`, 'PATCH', { hermesProfile: 'default', read: true }], ['/bridge/routines/inbox/read-all', 'POST', { hermesProfile: 'default' }]]) {
    r = await c.call(p, { method, body, auth: phone.token });
    assert.deepEqual([r.status, r.data.error.code], [403, 'routines_forbidden'], `${method} ${p}`);
  }
});

test('capabilities: always 200 for an authenticated caller, rights + reasons per credential and bot', async () => {
  const c = await bridge({ BRIDGE_ROUTINES: 'read' });
  const phone = c.pair('Phone');
  const blocked = c.pair('Blocked');
  await c.call('/bridge/routines/rights', { method: 'PUT', body: { devices: { [blocked.id]: { default: 'none' } } } });
  const caps = async (bot, auth = TOKEN) => (await c.call(`/bridge/routines/capabilities?hermesProfile=${bot}`, { auth })).data;
  const a = await caps('default');
  assert.deepEqual(a, {
    version: 1, hermesProfile: 'default', available: true, rights: 'read', mode: 'read',
    inbox: { available: true, durable: true, retentionDays: 30, maxItems: 300 }, push: { available: true },
    features: { crud: false, preservePausedRun: false, runLedger: false, timezone: false }, reasons: ['read_only_server'],
  });
  assert.deepEqual([(await caps('default', phone.token)).rights, (await caps('default', phone.token)).reasons], ['read', ['read_only_server', 'read_only_device']]);
  const n = await caps('default', blocked.token);
  assert.deepEqual([n.available, n.rights, n.reasons, n.push.available], [false, 'none', ['device_forbidden'], false]);
  assert.deepEqual([(await caps('reader')).available, (await caps('reader')).reasons], [false, ['bot_not_enabled']]);
  const off = await bridge({ BRIDGE_ROUTINES: 'off' });
  const o = (await off.call('/bridge/routines/capabilities?hermesProfile=default')).data;
  assert.deepEqual([o.available, o.mode, o.reasons], [false, 'off', ['routines_off']]);
  assert.equal((await c.call('/bridge/routines/capabilities?hermesProfile=ghost')).status, 404);
  assert.equal((await c.call('/bridge/routines/capabilities?hermesProfile=default', { auth: null })).status, 401);
});

// ---------- push + live inbox ----------

test('push config lists sources incl. routines; scope validation accepts routines and still refuses unknown ones', async () => {
  const c = await bridge();
  const cfg = (await c.call('/bridge/push/config')).data;
  assert.deepEqual(cfg.sources, ['api_server', 'cron', 'telegram', 'cli', 'routines']);
  assert.equal((await c.call('/bridge/push/register', { method: 'POST', body: { platform: 'fcm', token: fcmToken(1), profileId: 'p', scope: { sources: ['routines', 'cron'] } } })).status, 200);
  assert.equal((await c.call('/bridge/push/register', { method: 'POST', body: { platform: 'fcm', token: fcmToken(2), profileId: 'p', scope: { sources: ['routinez'] } } })).status, 403);
});

test('live hint hui.routine (no content) only on streams with sources=routines and read; push still goes to every device', async () => {
  const c = await bridge();
  const A = addJob('', jobId(1));
  await c.register(1);
  await c.poll();
  const blocked = c.pair('Blocked');
  await c.call('/bridge/routines/rights', { method: 'PUT', body: { devices: { [blocked.id]: { default: 'none' } } } });
  const streams = [];
  const openStream = async (q, auth = TOKEN) => {
    const ac = new AbortController();
    const res = await fetch(`${c.base}/bridge/inbox/stream${q}`, { headers: { authorization: `Bearer ${auth}` }, signal: ac.signal });
    const reader = res.body.getReader();
    const s = { buf: '', ac, reader };
    s.pump = (async () => { for (;;) { const { value, done } = await reader.read().catch(() => ({ done: true })); if (done) break; s.buf += new TextDecoder().decode(value); } })();
    streams.push(s);
    while (!/hui\.ready/.test(s.buf)) await new Promise((r) => setTimeout(r, 5));
    return s;
  };
  const withRoutines = await openStream('?sources=api_server,routines');
  const plain = await openStream('?sources=api_server,cron');
  const forbidden = await openStream('?sources=routines', blocked.token);
  run('', A, { text: 'Secret result text' });
  await c.poll();
  await new Promise((r) => setTimeout(r, 50));
  const m = /event: hui\.routine\ndata: (.+)/.exec(withRoutines.buf);
  assert.ok(m, 'routines stream got the hint');
  const ev = JSON.parse(m[1]);
  assert.deepEqual(Object.keys(ev).sort(), ['hermesProfile', 'id', 'jobId', 'source', 'status']);
  assert.deepEqual([ev.source, ev.jobId, ev.status, ev.hermesProfile], ['routines', A.id, 'ok', 'default']);
  assert.doesNotMatch(withRoutines.buf, /Secret/);
  assert.doesNotMatch(plain.buf, /hui\.routine/);
  assert.doesNotMatch(forbidden.buf, /hui\.routine/);
  assert.equal(c.sent.length, 1, 'a live stream does not suppress the push (not dispatch)');
  for (const s of streams) s.ac.abort();
});

test('push-hermes: cron sessions of a covered bot are not pushed again to routines registrations; cron-only ones keep them', async () => {
  const c = await bridge({ BRIDGE_PUSH_SOURCES: 'cron,api_server', BRIDGE_PUSH_CRON: 'all', BRIDGE_PUSH_PREVIEW: '1' });
  const A = addJob('', jobId(1), { name: 'Briefing' });
  const R = addJob('reader', jobId(2), { name: 'Reader job' }); // reader: served, not covered by the inbox
  await c.register(1, { sources: ['cron', 'routines'] });
  await c.register(2, { sources: ['cron'] });
  await c.ctx.push.pollNow(); // watcher baseline
  await c.poll(); // inbox baseline
  run('', A, { text: 'Briefing text' });
  run('reader', R, { text: 'Reader text' });
  await c.ctx.push.pollNow();
  await tick();
  const legacy = c.sent.filter((s) => s.n.data.kind === 'message').map((s) => [s.token, s.n.data.sessionId.slice(0, 17)]).sort();
  assert.deepEqual(legacy, [[fcmToken(2), `cron_${A.id}`], [fcmToken(1), `cron_${R.id}`], [fcmToken(2), `cron_${R.id}`]].sort(),
    'default is covered: only the cron-only registration; reader is not covered: both');
  await c.poll();
  const routine = c.sent.filter((s) => s.n.data.kind === 'routine');
  assert.deepEqual(routine.map((s) => s.token), [fcmToken(1)]);
  assert.equal(routine[0].n.body, 'Briefing text');
});

test('notifier: routine kind, preview off / on, failed body, quiet hours channel, locales', () => {
  const ev = { kind: 'routine', status: 'ok', title: 'Morning briefing', text: '**Sunny** today', threadKey: 'routine|default|aaaaaaaaaaaa', data: { src: 'hermes', jobId: 'aaaaaaaaaaaa', itemId: 'ri_x' }, previewDefault: false };
  const reg = (o = {}) => ({ profileId: 'p1', locale: 'en', ...o });
  let n = buildNotification(reg(), ev);
  assert.deepEqual([n.title, n.body, n.data.kind, n.channelId], ['Routine result', 'A new result is in your inbox.', 'routine', CHANNEL_DEFAULT]);
  assert.deepEqual(n.data, { v: 1, kind: 'routine', profileId: 'p1', src: 'hermes', jobId: 'aaaaaaaaaaaa', itemId: 'ri_x' });
  n = buildNotification(reg({ preview: 'on' }), ev);
  assert.deepEqual([n.title, n.body], ['Morning briefing', 'Sunny today']);
  n = buildNotification(reg(), { ...ev, previewDefault: true, title: '', text: '' });
  assert.deepEqual([n.title, n.body], ['Routine result', 'A new result is in your inbox.']);
  n = buildNotification(reg(), { ...ev, previewDefault: true, title: 'x'.repeat(100), count: 3 });
  assert.equal(n.title.length, 80);
  assert.equal(n.body, 'Sunny today', 'no "+n more" for routines');
  for (const [locale, title, body, failed] of [
    ['de', 'Ergebnis einer Routine', 'Ein neues Ergebnis liegt im Posteingang.', 'Eine Routine ist fehlgeschlagen.'],
    ['en', 'Routine result', 'A new result is in your inbox.', 'A routine failed.'],
    ['es', 'Resultado de una rutina', 'Hay un resultado nuevo en tu bandeja.', 'Una rutina ha fallado.'],
  ]) {
    n = buildNotification(reg({ locale }), ev);
    assert.deepEqual([n.title, n.body], [title, body], locale);
    assert.equal(buildNotification(reg({ locale }), { ...ev, status: 'failed' }).body, failed);
    assert.equal(buildNotification(reg({ locale }), { ...ev, status: 'blocked' }).body, failed);
  }
  const now = Date.parse('2026-10-16T23:30:00Z');
  n = buildNotification(reg({ quiet: { from: '22:00', to: '07:00' }, tz: 'UTC' }), ev, now);
  assert.deepEqual([n.quiet, n.channelId], [true, CHANNEL_QUIET]);
  n = buildNotification(reg({ quiet: { from: '22:00', to: '07:00' }, tz: 'Pacific/Honolulu' }), ev, now);
  assert.equal(n.quiet, false, 'registration time zone');
  // other kinds unchanged
  assert.equal(buildNotification(reg(), { title: 'Hermes', text: 'hi', threadKey: 't', data: {}, count: 2 }).body, 'hi (+1 more)');
});
