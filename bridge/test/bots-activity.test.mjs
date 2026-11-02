// GET /bridge/bots/activity: running chat turns the bridge streams (tool steps from `hermes.tool.progress`, also while
// detached) and running routines (Hermes job list, rights per credential, cached), against a FAKE Hermes upstream.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import { createBotsActivity, parseToolProgress, runningJobs, STEPS_MAX } from '../src/bots-activity.mjs';

const TOKEN = 'bridge-test-token-000000000000';
const UP_KEY = 'upstream_test_key_000000000000';
const closers = [];
const dirs = [];
after(() => { for (const c of closers) c(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hui-activity-')); dirs.push(d); return d; };
const progress = (o) => `event: hermes.tool.progress\ndata: ${JSON.stringify(o)}\n\n`;
const tick = () => new Promise((r) => setTimeout(r, 30));
/** Polls until `get()` is truthy (a loaded machine takes far longer than any fixed wait), returns it. */
async function until(get, what) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const v = await get();
    if (v) return v;
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    await tick();
  }
}

test('pure: tool progress parse (tolerant like the app) and running jobs', () => {
  assert.deepEqual(parseToolProgress(JSON.stringify({ tool: 'terminal', toolCallId: 't1', status: 'running', label: ' ls\n-la ', emoji: 'x' })),
    { callId: 't1', name: 'terminal', label: 'ls -la', finished: false });
  assert.deepEqual(parseToolProgress(JSON.stringify({ name: 'web_search', tool_call_id: 't2', status: 'completed' })), { callId: 't2', name: 'web_search', finished: true });
  assert.equal(parseToolProgress(JSON.stringify({ id: 't3', status: 'FAILED' })).finished, true);
  assert.equal(parseToolProgress(JSON.stringify({ tool: 'x' })), null, 'no call id: like the app, nothing');
  assert.equal(parseToolProgress('not json'), null);
  assert.equal(parseToolProgress(JSON.stringify({ tool: 'x', id: 'a', label: 'y'.repeat(500) })).label.length, 120);

  const jobs = runningJobs({ jobs: [
    { id: 'aaaaaaaaaaaa', name: 'Morning\nbrief', state: 'scheduled', latest_execution: { status: 'running', claimed_at: '2026-10-21T07:00:00+02:00', started_at: '2026-10-21T07:00:02+02:00' } },
    { id: 'bbbbbbbbbbbb', name: 'Claimed', latest_execution: { status: 'claimed', claimed_at: '2026-10-21T07:00:00Z' } },
    { id: 'cccccccccccc', name: 'Done', latest_execution: { status: 'succeeded' } },
    { id: 'dddddddddddd', name: 'Legacy', state: 'running' },
    { id: '../bad', latest_execution: { status: 'running' } },
    'junk',
  ] });
  assert.deepEqual(jobs, [
    { jobId: 'aaaaaaaaaaaa', name: 'Morning brief', since: Date.parse('2026-10-21T05:00:02Z') },
    { jobId: 'bbbbbbbbbbbb', name: 'Claimed', since: Date.parse('2026-10-21T07:00:00Z') },
    { jobId: 'dddddddddddd', name: 'Legacy' },
  ]);
  assert.deepEqual(runningJobs(null), []);
});

test('turns: steps per call id, at most 12 (newest last), running until completed or the turn ends; no session = not listed', async () => {
  let t = 1000;
  const a = createBotsActivity({ upstream: { baseUrl: 'http://127.0.0.1:9' }, token: TOKEN }, { now: () => t });
  const turn = a.begin(null, 'hui-s1');
  const frames = Buffer.from(progress({ tool: 'terminal', toolCallId: 'c1', status: 'running', label: 'ls' }) + progress({ tool: 'web_search', toolCallId: 'c2', status: 'running' }));
  turn.push(frames.subarray(0, 37)); // split inside a frame
  turn.push(frames.subarray(37));
  turn.push(Buffer.from(progress({ tool: 'terminal', toolCallId: 'c1', status: 'completed' }) + progress({ tool: 'x', toolCallId: 'never-started', status: 'completed' })));
  const nameless = a.begin('writer'); // no session header yet
  let s = await a.snapshot({ kind: 'admin' });
  assert.deepEqual(s.data, [{ bot: 'default', turns: [{ sessionId: 'hui-s1', since: 1000, steps: [{ name: 'terminal', label: 'ls', state: 'done' }, { name: 'web_search', state: 'running' }] }], routines: [] }]);
  nameless.session('hui-w1');
  t = 2000;
  for (let i = 0; i < 20; i++) turn.push(Buffer.from(progress({ tool: `t${i}`, toolCallId: `n${i}`, status: 'running' })));
  s = await a.snapshot({ kind: 'admin' });
  assert.deepEqual(s.data.map((d) => d.bot), ['default', 'writer']);
  const steps = s.data[0].turns[0].steps;
  assert.equal(steps.length, STEPS_MAX);
  assert.equal(steps.at(-1).name, 't19', 'newest last');
  assert.deepEqual(s.data[1].turns, [{ sessionId: 'hui-w1', since: 1000, steps: [] }]);
  turn.end();
  turn.end(); // idempotent
  nameless.end();
  s = await a.snapshot({ kind: 'admin' });
  assert.deepEqual([s.data, s.turns, s.routines.known, s.routines.reason], [[], { known: true }, false, 'routines_off']);
  assert.equal(a.running(), 0);
});

/** Fake Hermes: chat turns stay open until `release(session)`; job lists per prefix. */
async function fakeHermes(o = {}) {
  const open = new Map();
  const jobsSeen = [];
  const s = http.createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    const url = req.url;
    if (/\/v1\/chat\/completions$/.test(url)) {
      const sid = String(req.headers['x-hermes-session-id'] ?? '');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-hermes-session-id': sid || 'hui-assigned' });
      res.write(progress({ tool: 'terminal', toolCallId: `${sid}-1`, status: 'running', label: 'make test' }));
      open.set(sid || 'hui-assigned', res);
      return;
    }
    const m = /^(\/p\/[a-z0-9_-]+)?\/api\/jobs\?include_disabled=true$/.exec(url);
    if (m) {
      const bot = m[1] ? m[1].slice(3) : 'default';
      jobsSeen.push(bot);
      if (req.headers.authorization !== `Bearer ${UP_KEY}`) { res.writeHead(401); return res.end('{}'); }
      const j = o.jobs?.[bot];
      if (j === undefined) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"error":"boom"}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(j));
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{}');
  });
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  closers.push(() => { s.close(); s.closeAllConnections(); });
  return {
    url: `http://127.0.0.1:${s.address().port}`,
    jobsSeen,
    isOpen: (sid) => open.has(sid),
    write: (sid, text) => open.get(sid).write(text),
    release: (sid) => { const r = open.get(sid); open.delete(sid); r.end('data: [DONE]\n\n'); },
  };
}

async function bridge(up, env = {}) {
  const ctx = createServer({
    HERMES_BASE_URL: up.url, HERMES_API_KEY: UP_KEY, BRIDGE_TOKEN: TOKEN, BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'off',
    BRIDGE_PROFILES: 'writer,scout', BRIDGE_STATE_DIR: tmp(), BRIDGE_PUSH: 'off', ...env,
  }, { logger: silentLogger });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  closers.push(() => { ctx.server.close(); ctx.server.closeAllConnections(); });
  const base = `http://127.0.0.1:${ctx.server.address().port}`;
  const activity = async (auth = TOKEN, method = 'GET') => {
    const r = await fetch(`${base}/bridge/bots/activity`, { method, headers: auth ? { authorization: `Bearer ${auth}` } : {} });
    return { status: r.status, data: await r.json(), headers: r.headers };
  };
  /** starts a streamed chat turn; returns an AbortController for the client side */
  const chat = (prefix, sid) => {
    const ac = new AbortController();
    const done = fetch(`${base}${prefix}/v1/chat/completions`, {
      method: 'POST', signal: ac.signal,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(sid ? { 'x-hermes-session-id': sid } : {}) },
      body: JSON.stringify({ model: 'hermes', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    }).then(async (r) => { for await (const _ of r.body) { /* read */ } }).catch(() => {});
    return { ac, done };
  };
  const pair = () => {
    const d = ctx.devices.issue('Phone');
    return { id: d.id, token: ctx.devices.redeem(d.code).token };
  };
  return { ctx, activity, chat, pair };
}

test('GET /bridge/bots/activity: turns of every device incl. detached ones, routines where readable, cached', async () => {
  const running = { id: 'aaaaaaaaaaaa', name: 'Brief', latest_execution: { status: 'running', started_at: '2026-10-21T06:00:00Z' } };
  const up = await fakeHermes({ jobs: { default: { jobs: [running, { id: 'bbbbbbbbbbbb', name: 'Idle', latest_execution: { status: 'succeeded' } }] } } });
  const b = await bridge(up, { BRIDGE_ROUTINES_BOTS: 'default,writer' });
  assert.equal((await b.activity(null)).status, 401);
  assert.deepEqual([(await b.activity(TOKEN, 'POST')).status], [405]);

  let r = await b.activity();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.data.object, 'bots.activity');
  assert.ok(Number.isFinite(r.data.at));
  assert.deepEqual(r.data.turns, { known: true });
  // writer's job list fails: honest "not known", the default bot's running routine still listed
  assert.deepEqual(r.data.routines, { known: false, reason: 'failed', bots: ['default'] });
  assert.deepEqual(r.data.data, [{ bot: 'default', turns: [], routines: [{ jobId: 'aaaaaaaaaaaa', name: 'Brief', since: Date.parse('2026-10-21T06:00:00Z') }] }]);

  const one = b.chat('', 'hui-a');
  const two = b.chat('/p/writer', 'hui-b');
  await until(() => up.isOpen('hui-a') && up.isOpen('hui-b'), 'both turns upstream');
  up.write('hui-a', progress({ tool: 'terminal', toolCallId: 'hui-a-1', status: 'completed' }) + progress({ tool: 'web_search', toolCallId: 'hui-a-2', status: 'running', label: 'prices' }));
  r = await until(async () => {
    const a = await b.activity();
    const steps = (bot) => a.data.data.find((d) => d.bot === bot)?.turns[0]?.steps ?? [];
    return steps('default').length === 2 && steps('default')[0].state === 'done' && steps('writer').length === 1 ? a : null;
  }, 'the tool steps of both turns');
  assert.deepEqual(r.data.data.map((d) => [d.bot, d.turns.map((t) => t.sessionId)]), [['default', ['hui-a']], ['writer', ['hui-b']]]);
  assert.deepEqual(r.data.data[0].turns[0].steps, [{ name: 'terminal', label: 'make test', state: 'done' }, { name: 'web_search', label: 'prices', state: 'running' }]);
  assert.deepEqual(r.data.data[1].turns[0].steps, [{ name: 'terminal', label: 'make test', state: 'running' }]);
  assert.ok(Number.isFinite(r.data.data[0].turns[0].since));
  assert.deepEqual(up.jobsSeen.sort(), ['default', 'writer'], 'job lists cached (15 s): read once');

  // a device sees the same turns (any credential); the phone going away keeps the run (detached) and its entry
  const phone = b.pair();
  one.ac.abort();
  await tick();
  r = await b.activity(phone.token);
  assert.deepEqual(r.data.data.map((d) => d.bot), ['default', 'writer']);
  up.release('hui-a');
  up.release('hui-b');
  await one.done; await two.done;
  await until(() => b.ctx.activity.running() === 0, 'the turns to end');
  r = await b.activity();
  assert.deepEqual(r.data.data.map((d) => [d.bot, d.turns.length]), [['default', 0]], 'ended turns are gone, the routine stays');
  assert.equal(b.ctx.activity.running(), 0);
});

test('activity: routines off (server or for the credential) -> routines_off; turns still known', async () => {
  const up = await fakeHermes({ jobs: { default: { jobs: [] } } });
  let b = await bridge(up, { BRIDGE_ROUTINES: 'off', BRIDGE_ROUTINES_BOTS: 'default' });
  let r = await b.activity();
  assert.deepEqual([r.data.turns, r.data.routines], [{ known: true }, { known: false, reason: 'routines_off', bots: [] }]);
  b = await bridge(up, {}); // no bot enabled by the owner
  r = await b.activity();
  assert.deepEqual(r.data.routines, { known: false, reason: 'routines_off', bots: [] });
  assert.deepEqual(up.jobsSeen, [], 'no job list read without a right');
  b = await bridge(up, { BRIDGE_ROUTINES_BOTS: 'default' });
  const phone = b.pair();
  b.ctx.devices.setRoutines({ devices: { [phone.id]: { default: 'none' } } });
  r = await b.activity(phone.token);
  assert.deepEqual(r.data.routines, { known: false, reason: 'routines_off', bots: [] });
  r = await b.activity();
  assert.deepEqual(r.data.routines, { known: true, bots: ['default'] });
});
