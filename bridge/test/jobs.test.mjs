// Routines (Hermes cron jobs): allow-list, guarded run, projection, error mapping. Real bridge in front of a fake upstream.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import { deliverKind, projectJob } from '../src/jobs.mjs';
import { loadConfig } from '../src/config.mjs';

const TOKEN = 'bridge-token-test';
const UP_KEY = 'upstream-secret-test';
const ID = 'aaaaaaaaaaaa';
const CHAT = '-100000000000';

/** A job record with every field Hermes v0.22 sends, including the ones that must never leave the bridge. */
function fullJob(over = {}) {
  return {
    id: ID, name: 'Morning digest', prompt: 'Summarize the news', skills: ['news', 7, 'x'.repeat(150)], skill: 'news',
    model: 'test-model', provider: 'test-provider', base_url: 'http://192.0.2.1:9999/v1', script: '/fake/script.sh',
    no_agent: false, monitor_script: 'fake-monitor', monitor_url: 'https://example.com/monitor', monitor_state: { x: 1 },
    context_from: 'fake-context', schedule: { kind: 'cron', expr: '0 7 * * *', display: '0 7 * * *', secret: 'nope' },
    schedule_display: 'every day 07:00', repeat: { times: null, completed: 3 }, enabled: true, state: 'scheduled',
    paused_at: null, paused_reason: null, created_at: '2026-01-01T00:00:00Z', next_run_at: '2026-01-02T07:00:00Z',
    last_run_at: '2026-01-01T07:00:00Z', last_status: 'ok', last_error: null, last_delivery_error: null,
    last_delivery_unverified: true, last_failure: { at: 'x', detail: 'y' }, failure_streak: 0,
    deliver: `telegram:${CHAT}:7,local,bot-chat:writer,telegram:${CHAT}`, origin: { platform: 'telegram', chat_id: CHAT, user_id: 'fake-user' },
    enabled_toolsets: ['web'], workdir: '/fake/workdir', manual_run_at: null, manual_run_prompt: 'fake one-run prompt',
    latest_execution: { id: 'exec-fake', job_id: ID, source: 'scheduler', process_id: 'proc-fake', pid: 4242, status: 'completed', claimed_at: 'c', started_at: 's', finished_at: 'f', error: 'fake error' },
    ...over,
  };
}

let upstream;
/** @type {any[]} */ let seen = [];
/** @type {Map<string, any>} */ const jobs = new Map();
/** per-test override: return true when it answered */
let override = (/** @type {any} */ _req, /** @type {any} */ _res, /** @type {any} */ _body) => false;
const bridges = [];

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

before(async () => {
  upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, headers: req.headers, body });
    if (override(req, res, body)) return;
    const u = new URL(req.url, 'http://x');
    const p = u.pathname.replace(/^\/p\/[a-z0-9_-]+/, '');
    if (p === '/api/jobs' && req.method === 'GET') return json(res, 200, { jobs: [...jobs.values()] });
    const m = /^\/api\/jobs\/([a-f0-9]{12})(?:\/(pause|resume|run))?$/.exec(p);
    if (!m) return json(res, 404, { error: 'nope' });
    const job = jobs.get(m[1]);
    if (!job) return json(res, 404, { error: 'Job not found' });
    if (!m[2]) return json(res, 200, { job });
    if (m[2] === 'pause') Object.assign(job, { enabled: false, state: 'paused' });
    else Object.assign(job, { enabled: true, state: 'scheduled' });
    return json(res, 200, { job });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  call = await startBridge();
});
after(() => {
  for (const s of [...bridges, upstream]) { s.close(); s.closeAllConnections(); }
});

async function startBridge(env = {}) {
  const { server } = createServer({
    HERMES_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`, HERMES_API_KEY: UP_KEY, BRIDGE_TOKEN: TOKEN,
    BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'off', BRIDGE_PROFILES: 'writer', BRIDGE_ROUTINES_BOTS: '*', // slice 2: bots are opt-in
    HERMES_HOME: path.join(os.tmpdir(), 'jobs-test-no-hermes-home'), ...env,
  }, { logger: silentLogger });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  bridges.push(server);
  const port = server.address().port;
  /** raw request-target (no client-side URL normalisation) */
  return (p, { method = 'GET', headers = {}, body, auth = `Bearer ${TOKEN}` } = {}) => new Promise((resolve, reject) => {
    const h = { ...headers };
    if (auth) h.authorization = auth;
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: h, agent: false }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => {
        const text = Buffer.concat(c).toString();
        let data; try { data = JSON.parse(text); } catch { data = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, text, data });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

let call;
const reset = (...list) => {
  seen = [];
  override = () => false;
  jobs.clear();
  for (const j of list) jobs.set(j.id, j);
};

test('BRIDGE_ROUTINES: control by default, read / off, anything else throws', () => {
  const env = { HERMES_BASE_URL: 'http://127.0.0.1:1/v1', BRIDGE_TOKEN: TOKEN, BRIDGE_BOOTSTRAP: 'off' };
  assert.equal(loadConfig(env).routines, 'control');
  assert.equal(loadConfig({ ...env, BRIDGE_ROUTINES: 'READ' }).routines, 'read');
  assert.equal(loadConfig({ ...env, BRIDGE_ROUTINES: 'off' }).routines, 'off');
  assert.throws(() => loadConfig({ ...env, BRIDGE_ROUTINES: 'write' }), /BRIDGE_ROUTINES/);
});

test('GET list: include_disabled=true with the upstream key (client query ignored), projected jobs + mode', async () => {
  reset(fullJob());
  const r = await call('/api/jobs?include_disabled=false&x=1');
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-hermes-ui-bridge'], '1');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/api/jobs?include_disabled=true');
  assert.equal(seen[0].auth, `Bearer ${UP_KEY}`);
  assert.equal(seen[0].headers['x-hermes-session-id'], undefined);
  assert.deepEqual(r.data.hui, { routines: 'control', rights: 'manage' });
  assert.equal(r.data.jobs.length, 1);
  assert.equal(r.data.jobs[0].id, ID);
});

test('projection keeps the app fields and drops chat ids, scripts, workdir, base_url, run prompt, pid', async () => {
  reset(fullJob());
  const r = await call(`/api/jobs/${ID}`);
  assert.equal(r.status, 200);
  assert.equal(seen[0].url, `/api/jobs/${ID}`);
  const j = r.data.job;
  assert.deepEqual(Object.keys(r.data).sort(), ['hui', 'job']);
  for (const k of ['base_url', 'script', 'monitor_script', 'monitor_url', 'monitor_state', 'context_from', 'workdir', 'origin',
    'deliver', 'manual_run_prompt', 'manual_run_at', 'skill', 'last_failure', 'enabled_toolsets', 'last_delivery_unverified']) {
    assert.equal(k in j, false, k);
  }
  assert.equal(j.deliver_kind, 'telegram,local,bot-chat');
  assert.equal(j.origin_platform, 'telegram');
  assert.deepEqual(j.latest_execution, { status: 'completed', source: 'scheduler', claimed_at: 'c', started_at: 's', finished_at: 'f' });
  assert.deepEqual(j.schedule, { kind: 'cron', expr: '0 7 * * *', display: '0 7 * * *' });
  assert.deepEqual(j.repeat, { times: null, completed: 3 });
  assert.deepEqual(j.skills, ['news', 'x'.repeat(100)]);
  assert.equal(j.enabled, true);
  assert.equal(j.no_agent, false);
  assert.equal(j.failure_streak, 0);
  assert.equal('last_error' in j, false, 'null strings dropped');
  for (const bad of [CHAT, 'fake-user', '192.0.2.1', '/fake/', 'fake one-run prompt', '4242', 'proc-fake', 'fake error', 'fake-monitor']) {
    assert.equal(r.text.includes(bad), false, bad);
  }
});

test('projectJob caps strings and drops mistyped fields', () => {
  const j = projectJob({ id: ID, name: 'n'.repeat(300), prompt: 'p'.repeat(6000), enabled: 'yes', failure_streak: '3', last_error: 'e'.repeat(600), paused_reason: 'r'.repeat(400), skills: 'news', origin: { platform: 5 } });
  assert.equal(j.name.length, 200);
  assert.equal(j.prompt.length, 5000);
  assert.equal(j.last_error.length, 500);
  assert.equal(j.paused_reason.length, 300);
  for (const k of ['enabled', 'failure_streak', 'skills', 'origin_platform']) assert.equal(k in j, false, k);
  assert.equal(projectJob(null), null);
  assert.equal(deliverKind('origin'), 'origin');
  assert.equal(deliverKind(`telegram:${CHAT}:7, telegram , discord:${CHAT}`), 'telegram,discord');
  assert.equal(deliverKind('user@example.com'), undefined);
  assert.equal(deliverKind(42), undefined);
});

test('profile prefix is forwarded; unknown profile → 404 without an upstream call', async () => {
  reset(fullJob());
  const r = await call('/p/writer/api/jobs');
  assert.equal(r.status, 200);
  assert.equal(seen.at(-1).url, '/p/writer/api/jobs?include_disabled=true');
  const g = await call(`/p/writer/api/jobs/${ID}`);
  assert.equal(g.status, 200);
  assert.equal(seen.at(-1).url, `/p/writer/api/jobs/${ID}`);
  seen = [];
  const u = await call('/p/nope/api/jobs');
  assert.equal(u.status, 404);
  assert.equal(u.data.error.code, 'unknown_profile');
  assert.equal(seen.length, 0);
});

test('allow-list: create / PATCH / DELETE / unknown subpaths / bad ids / %-escapes never reach Hermes', async () => {
  reset(fullJob());
  for (const [method, p, status] of [
    ['POST', '/api/jobs', 405], ['PATCH', `/api/jobs/${ID}`, 405], ['DELETE', `/api/jobs/${ID}`, 405], ['PUT', `/api/jobs/${ID}`, 405],
    ['GET', `/api/jobs/${ID}/pause`, 405], ['GET', `/api/jobs/${ID}/run`, 405], ['DELETE', '/api/jobs', 405],
    ['POST', `/api/jobs/${ID}/delete`, 404], ['GET', `/api/jobs/${ID}/output`, 404], ['POST', `/api/jobs/${ID}/run/x`, 404],
    ['GET', '/api/jobs/AAAAAAAAAAAA', 404], ['GET', '/api/jobs/aaaaaaaaaaa', 404], ['GET', '/api/jobs/aaaaaaaaaaaaa', 404],
    ['GET', '/api/jobs/gggggggggggg', 404], ['POST', '/api/jobs/aaaaaaaaaaa%61/run', 404], ['GET', '/api/jobs/%61aaaaaaaaaaa', 404],
    ['GET', '/api/jobs/', 404], ['POST', '/p/writer/api/jobs', 405], ['PATCH', `/p/writer/api/jobs/${ID}`, 405],
  ]) {
    const r = await call(p, { method, body: method === 'GET' || method === 'DELETE' ? undefined : '{"name":"x","prompt":"y","schedule":"every 1m"}', headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, status, `${method} ${p}`);
    if (status === 405) assert.ok(r.headers.allow, `${method} ${p} Allow`);
  }
  assert.equal(seen.length, 0);
  assert.equal((await call('/api/jobs', { method: 'POST' })).headers.allow, 'GET');
  assert.equal((await call(`/api/jobs/${ID}/pause`, { method: 'GET' })).headers.allow, 'POST');
});

test('auth is required before anything reaches Hermes', async () => {
  reset(fullJob());
  for (const [method, p] of [['GET', '/api/jobs'], ['GET', `/api/jobs/${ID}`], ['POST', `/api/jobs/${ID}/run`], ['GET', '/p/writer/api/jobs']]) {
    const r = await call(p, { method, auth: null });
    assert.equal(r.status, 401, `${method} ${p}`);
    assert.equal((await call(p, { method, auth: 'Bearer wrong-token-test' })).status, 401);
  }
  assert.equal(seen.length, 0);
});

test('pause / resume: upstream always gets {} with the upstream key', async () => {
  reset(fullJob({ id: '0123456789ab' }));
  for (const [action, body, state] of [['pause', undefined, 'paused'], ['resume', '{}', 'scheduled'], ['pause', '', 'paused']]) {
    seen = [];
    const r = await call(`/api/jobs/0123456789ab/${action}`, { method: 'POST', body, headers: body === undefined ? {} : { 'content-type': 'application/json' } });
    assert.equal(r.status, 200, action);
    assert.equal(r.data.job.state, state);
    assert.deepEqual(r.data.hui, { routines: 'control', rights: 'manage' });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].url, `/api/jobs/0123456789ab/${action}`);
    assert.equal(seen[0].body, '{}');
    assert.equal(seen[0].auth, `Bearer ${UP_KEY}`);
    assert.equal(r.text.includes(CHAT), false);
  }
});

test('unsupported_field: prompt override, unknown fields, non-JSON, resume_paused on pause → 400, never upstream', async () => {
  reset(fullJob());
  for (const [p, body] of [
    [`/api/jobs/${ID}/run`, '{"prompt":"do something else"}'], [`/api/jobs/${ID}/run`, '{"resume_paused":true,"prompt":"x"}'],
    [`/api/jobs/${ID}/run`, '{"resume_paused":"yes"}'], [`/api/jobs/${ID}/run`, 'not json'], [`/api/jobs/${ID}/run`, '[]'],
    [`/api/jobs/${ID}/run`, 'null'], [`/api/jobs/${ID}/pause`, '{"resume_paused":true}'], [`/api/jobs/${ID}/resume`, '{"reason":"x"}'],
  ]) {
    const r = await call(p, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, 400, `${p} ${body}`);
    assert.equal(r.data.error.code, 'unsupported_field');
  }
  assert.equal(seen.length, 0);
});

test('body cap: > 1 KiB declared or streamed → 413, never upstream', async () => {
  reset(fullJob());
  const big = JSON.stringify({ resume_paused: true, pad: 'x'.repeat(2000) });
  const r = await call(`/api/jobs/${ID}/run`, { method: 'POST', body: big, headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 413);
  assert.equal(r.data.error.code, 'payload_too_large');
  const chunked = await new Promise((resolve, reject) => {
    const port = Number(bridges[0].address().port);
    const req = http.request({ host: '127.0.0.1', port, path: `/api/jobs/${ID}/pause`, method: 'POST', agent: false, headers: { authorization: `Bearer ${TOKEN}`, 'transfer-encoding': 'chunked' } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.write('{"a":"');
    req.write('x'.repeat(1500));
    req.end('"}');
  });
  assert.equal(chunked, 413);
  assert.equal(seen.length, 0);
});

test('run guard: GET first, then POST {} upstream; paused needs resume_paused; terminal / unknown refused', async () => {
  reset(
    fullJob({ id: '111111111111' }),
    fullJob({ id: '222222222222', enabled: false, state: 'paused' }),
    fullJob({ id: '333333333333', state: 'completed' }),
    fullJob({ id: '444444444444', state: 'error' }),
    fullJob({ id: '555555555555', enabled: false, state: 'scheduled' }),
  );
  let r = await call('/api/jobs/111111111111/run', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.deepEqual(seen.map((s) => `${s.method} ${s.url} ${s.body}`), ['GET /api/jobs/111111111111 ', 'POST /api/jobs/111111111111/run {}']);
  assert.equal(r.data.job.id, '111111111111');

  for (const id of ['222222222222', '555555555555']) {
    seen = [];
    r = await call(`/api/jobs/${id}/run`, { method: 'POST', body: '{"resume_paused":false}' });
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, 'job_paused');
    assert.match(r.data.error.message, /resume/);
    assert.deepEqual(seen.map((s) => s.method), ['GET']);
  }
  seen = [];
  r = await call('/api/jobs/222222222222/run', { method: 'POST', body: '{"resume_paused":true}' });
  assert.equal(r.status, 200);
  assert.deepEqual(seen.map((s) => `${s.method} ${s.body}`), ['GET ', 'POST {}']);

  for (const id of ['333333333333', '444444444444']) {
    seen = [];
    r = await call(`/api/jobs/${id}/run`, { method: 'POST' });
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, 'job_terminal');
    assert.equal(seen.length, 1);
  }
  seen = [];
  r = await call('/api/jobs/bbbbbbbbbbbb/run', { method: 'POST' });
  assert.equal(r.status, 404);
  assert.equal(r.data.error.code, 'job_not_found');
  assert.deepEqual(seen.map((s) => s.method), ['GET']);
});

test('run guard and run go through the profile prefix', async () => {
  reset(fullJob({ id: 'cccccccccccc' }));
  const r = await call('/p/writer/api/jobs/cccccccccccc/run', { method: 'POST', body: '{}' });
  assert.equal(r.status, 200);
  assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), ['GET /p/writer/api/jobs/cccccccccccc', 'POST /p/writer/api/jobs/cccccccccccc/run']);
});

test('run cooldown: a second run within 30 s → 429 run_cooldown + Retry-After, per profile', async () => {
  reset(fullJob({ id: 'dddddddddddd' }));
  assert.equal((await call('/api/jobs/dddddddddddd/run', { method: 'POST' })).status, 200);
  seen = [];
  const r = await call('/api/jobs/dddddddddddd/run', { method: 'POST' });
  assert.equal(r.status, 429);
  assert.equal(r.data.error.code, 'run_cooldown');
  const ra = Number(r.headers['retry-after']);
  assert.ok(ra >= 1 && ra <= 30, String(ra));
  assert.equal(seen.length, 0);
  // pause is no run: not blocked; another profile's job with the same id is independent
  assert.equal((await call('/api/jobs/dddddddddddd/pause', { method: 'POST' })).status, 200);
  assert.equal((await call('/p/writer/api/jobs/dddddddddddd/resume', { method: 'POST' })).status, 200);
  assert.equal((await call('/p/writer/api/jobs/dddddddddddd/run', { method: 'POST' })).status, 200);
});

test('a failed run does not start the cooldown', async () => {
  reset(fullJob({ id: 'eeeeeeeeeeee' }));
  override = (req, res) => {
    if (req.method !== 'POST') return false;
    json(res, 500, { error: 'Job is in a terminal state' });
    return true;
  };
  const r = await call('/api/jobs/eeeeeeeeeeee/run', { method: 'POST' });
  assert.equal(r.status, 502);
  assert.equal(r.data.error.code, 'upstream_error');
  assert.equal(r.data.error.message, 'Job is in a terminal state');
  override = () => false;
  assert.equal((await call('/api/jobs/eeeeeeeeeeee/run', { method: 'POST' })).status, 200);
});

test('job_busy: one in-flight mutation per (profile, job)', async () => {
  reset(fullJob({ id: 'ffffffffffff' }));
  /** @type {(() => void) | null} */
  let releaseFirst = null;
  let arrived;
  const firstArrived = new Promise((resolve) => { arrived = resolve; });
  override = (req, res) => {
    if (req.method !== 'POST') return false;
    releaseFirst = () => json(res, 200, { job: jobs.get('ffffffffffff') });
    arrived();
    return true;
  };
  const first = call('/api/jobs/ffffffffffff/pause', { method: 'POST' });
  await firstArrived;
  const second = await call('/api/jobs/ffffffffffff/resume', { method: 'POST' });
  assert.equal(second.status, 409);
  assert.equal(second.data.error.code, 'job_busy');
  // other profile / other job are not blocked
  override = () => false;
  assert.equal((await call('/p/writer/api/jobs/ffffffffffff/pause', { method: 'POST' })).status, 200);
  releaseFirst();
  assert.equal((await first).status, 200);
  assert.equal((await call('/api/jobs/ffffffffffff/resume', { method: 'POST' })).status, 200, 'lock released');
});

test('error mapping: 404 list, 501, 400/409, 401/403, 5xx, non-JSON, unreachable', async () => {
  reset(fullJob());
  const answer = (status, body, raw) => {
    override = (req, res) => {
      if (raw !== undefined) { res.writeHead(status, { 'content-type': 'text/plain' }); res.end(raw); } else json(res, status, body);
      return true;
    };
  };
  const cases = [
    [404, { error: 'Not Found' }, undefined, '/api/jobs', 'GET', 404, 'routines_unsupported'],
    [404, { error: 'Job not found' }, undefined, `/api/jobs/${ID}`, 'GET', 404, 'job_not_found'],
    [404, { error: 'Job not found' }, undefined, `/api/jobs/${ID}/pause`, 'POST', 404, 'job_not_found'],
    [501, { error: 'Cron module not available' }, undefined, '/api/jobs', 'GET', 501, 'routines_unsupported'],
    [400, { error: 'Invalid job ID format' }, undefined, `/api/jobs/${ID}`, 'GET', 400, 'upstream_rejected'],
    [409, { error: 'x'.repeat(400) }, undefined, `/api/jobs/${ID}/resume`, 'POST', 409, 'upstream_rejected'],
    [401, { error: 'Invalid API key' }, undefined, '/api/jobs', 'GET', 502, 'upstream_auth'],
    [403, { error: 'Forbidden' }, undefined, `/api/jobs/${ID}/pause`, 'POST', 502, 'upstream_auth'],
    [500, { error: 'Cannot resume a completed job' }, undefined, `/api/jobs/${ID}/resume`, 'POST', 502, 'upstream_error'],
    [200, null, '<html>ok</html>', '/api/jobs', 'GET', 502, 'upstream_invalid'],
    [200, { nope: true }, undefined, '/api/jobs', 'GET', 502, 'upstream_invalid'],
  ];
  for (const [upStatus, body, raw, p, method, status, code] of cases) {
    answer(upStatus, body, raw);
    const r = await call(p, { method });
    assert.equal(r.status, status, `${upStatus} ${p}`);
    assert.equal(r.data.error.code, code, `${upStatus} ${p}`);
    assert.equal(r.data.error.type !== undefined, true);
    assert.equal(r.headers['x-hermes-ui-bridge'], '1');
  }
  answer(409, { error: 'x'.repeat(400) });
  assert.equal((await call(`/api/jobs/${ID}/resume`, { method: 'POST' })).data.error.message.length, 300);
  answer(500, { error: 'Cannot resume a completed job' });
  assert.equal((await call(`/api/jobs/${ID}/resume`, { method: 'POST' })).data.error.message, 'Cannot resume a completed job');
  answer(401, { error: 'Invalid API key' });
  assert.equal((await call('/api/jobs')).text.includes('API key'), false);
});

test('upstream answer over 4 MiB → 502 upstream_too_large', async () => {
  reset();
  override = (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(`{"jobs":[],"pad":"${'x'.repeat(4 * 1024 * 1024 + 10)}"}`);
    return true;
  };
  const r = await call('/api/jobs');
  assert.equal(r.status, 502);
  assert.equal(r.data.error.code, 'upstream_too_large');
});

test('upstream timeout → 504, unreachable → 502', async () => {
  reset(fullJob());
  const slow = await startBridge({ BRIDGE_UPSTREAM_TIMEOUT_MS: '1000' });
  override = () => true; // never answers
  const r = await slow('/api/jobs');
  assert.equal(r.status, 504);
  assert.equal(r.data.error.code, 'upstream_timeout');
  override = () => false;
  const dead = await startBridge({ HERMES_BASE_URL: 'http://127.0.0.1:1/v1' });
  const d = await dead('/api/jobs');
  assert.equal(d.status, 502);
  assert.equal(d.data.error.code, 'upstream_unavailable');
});

test('BRIDGE_ROUTINES=read: GETs work (hui.routines=read), POSTs 403 without an upstream call', async () => {
  reset(fullJob());
  const ro = await startBridge({ BRIDGE_ROUTINES: 'read' });
  const l = await ro('/api/jobs');
  assert.equal(l.status, 200);
  assert.deepEqual(l.data.hui, { routines: 'read', rights: 'read' });
  assert.equal((await ro(`/api/jobs/${ID}`)).data.hui.routines, 'read');
  seen = [];
  for (const a of ['pause', 'resume', 'run']) {
    const r = await ro(`/api/jobs/${ID}/${a}`, { method: 'POST', body: '{}' });
    assert.equal(r.status, 403, a);
    assert.equal(r.data.error.code, 'routines_read_only');
  }
  assert.equal((await ro('/api/jobs', { method: 'POST', body: '{}' })).status, 405);
  assert.equal(seen.length, 0);
});

test('BRIDGE_ROUTINES=off: every /api/jobs path 404 routines_off, never upstream; sessions unaffected', async () => {
  reset(fullJob());
  const off = await startBridge({ BRIDGE_ROUTINES: 'off' });
  for (const [method, p] of [['GET', '/api/jobs'], ['GET', `/api/jobs/${ID}`], ['POST', `/api/jobs/${ID}/run`], ['GET', '/p/writer/api/jobs'], ['DELETE', `/api/jobs/${ID}`]]) {
    const r = await off(p, { method });
    assert.equal(r.status, 404, `${method} ${p}`);
    assert.equal(r.data.error.code, 'routines_off');
  }
  assert.equal(seen.length, 0);
  assert.equal((await off('/api/jobsx')).status, 404);
  assert.equal(seen.length, 0);
});
