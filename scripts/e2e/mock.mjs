#!/usr/bin/env node
// Deterministic Hermes + UI-bridge mock for the Android E2E smoke suite (scripts/e2e/smoke.sh, docs/E2E.md).
// Speaks what the app needs from a bridge: one-time-code pairing, `X-Hermes-UI-Bridge` on every answer, streamed turns
// with Idempotency-Key records and byte-offset resume (the bridge's own bridge/src/replay.mjs), a Hermes session store
// (recovery polling, "Send again" pre-check, drawer sync), run status, stop, bots (/bridge/profiles) and quick answers.
// A turn keeps running when the client goes away (like the bridge with a detached Hermes run).
//
//   node scripts/e2e/mock.mjs [--port 8791]          # binds 127.0.0.1 (the emulator reaches it as 10.0.2.2)
//
// Scenario = keywords in the user text (lower case): `long` (Markdown + cards + table + code, ~15 s), `checklist`,
// `table`, `slow` (numbered sentences, ~19 s), `perfreal` / `perfstress` (perf harness: ~13k chars at ~80 tok/s / as fast as
// the socket takes it), anything else a one-line answer that names the text. Same text → same
// bytes at the same rhythm (seeded). Test control, no auth (the mock listens on loopback only):
//   GET  /__e2e/state                     counters + config
//   POST /__e2e/pair-code                 → {code}: one-time code for a `hermesuiplus://pair?u=…&c=…` link
//   POST /__e2e/config {profiles, quick}  bots on/off (`profiles: true` → default + research), quick answers on/off
//   POST /__e2e/seed {messages, title}    perf harness: a Hermes session with that many transcript rows (perf-answers.mjs)
//   POST /__e2e/fault {kind, match, …}    one-shot fault for the next chat turn whose text contains `match`:
//        refuse {status}                 answer 503 before anything runs (no Retry-After → the app shows "Answer failed")
//        hold {ms}                       no response headers for `ms`; a client that leaves meanwhile = nothing ran
//        drop {afterChunks, resumable}   cut the client's socket after N content chunks; the turn goes on (recorded);
//                                        `resumable: false` omits X-Hermes-UI-Resume (the app then polls the session)
//   GET  /__e2e/turns                    every turn: text, scenario, state, expected answer, attaches
//   GET  /__e2e/requests                 every request (method, path, status, kind, key, offset, session)
//   GET  /__e2e/uploads                  every POST /bridge/uploads (name, mimeType, size, first bytes as hex)
//   GET  /__e2e/expected?text=…          the answer a text gets
import http from 'node:http';
import { SCENARIOS } from '../demo-videos/scenarios.mjs';
import { createReplayStore, idempotencyKey, resumeOffset, RESUMABLE_HEADER } from '../../bridge/src/replay.mjs';
import { PERF_HUGE, PERF_LONG, perfHistory } from './perf-answers.mjs';

const args = process.argv.slice(2);
const PORT = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : 8791) || 8791;

// ── scripted answers ────────────────────────────────────────────────────────────────────────────────────────────────
const hui = (node) => '```hui\n' + JSON.stringify(node, null, 2) + '\n```\n';
const texts = (name) => SCENARIOS[name].steps({ userText: '', turn: 1, sessionId: 'e2e', now: new Date(0) }).filter((s) => 'text' in s).map((s) => s.text).join('');
const LONG = [
  '## E-bike or car for the city?\n\nShort version: for trips under 10 km the **e-bike wins** on cost and often on time.\n\n',
  '### What matters most\n\n- **Distance:** most city trips are short\n- **Parking:** an e-bike parks at the door\n- **Cargo:** a trailer or box handles shopping\n\n',
  texts('ebike'),
  '\n\n| Trip | E-bike | Car | Bus |\n|---|---:|---:|---:|\n| 3 km to work | 11 min | 14 min | 19 min |\n| 7 km to the gym | 24 min | 21 min | 33 min |\n| 12 km to friends | 41 min | 27 min | 48 min |\n\n',
  texts('ebikeTable'),
  '\n\nA quick cost check:\n\n```python\ndef yearly_cost(km_per_day, price_per_km, days=220):\n    return round(km_per_day * price_per_km * days, 2)\n\nprint(yearly_cost(14, 0.04))  # e-bike\n```\n\n',
  texts('blocksWifi'),
  '\n\n**Bottom line:** try the e-bike for two weeks before deciding. [end of long answer]',
].join('');
const CHECKLIST = 'Here is your pack list, tick what is done:\n\n' + hui({
  type: 'checklist', id: 'e2e-pack', title: 'E2E pack list', basis: 'illustrative',
  items: [{ id: 'a', text: 'Walking shoes' }, { id: 'b', text: 'Rain jacket' }, { id: 'c', text: 'Phone charger' }, { id: 'd', text: 'Water bottle' }],
});
const TABLE = [
  'Milestones of the microscope:\n\n',
  '| Year | Milestone | Who |\n|---|---|---|\n',
  '| c. 1011–1021 | Book of Optics on lenses and vision | Ibn al-Haytham |\n',
  '| 1590 | First compound microscope | Janssen |\n',
  '| 1665 | Micrographia with cell drawings | Hooke |\n',
  '| 1931 | Electron microscope | Ruska |\n\n',
  'All four changed how we see small things. [end of table answer]',
].join('');
const SLOW = Array.from({ length: 24 }, (_, i) => `Sentence ${String(i + 1).padStart(2, '0')} of the slow answer keeps the stream going.`).join(' ') + ' [end of slow answer]';
const SHORT = (t) => `Short answer to "${t.replace(/["\n]/g, ' ').slice(0, 60)}": apple, mango and strawberry.`;
const QUICK = 'Quick answer from the E2E mock: 42.';

/** scenario of a user text: {name, text, ms: [min, max] per chunk} */
export function scenarioFor(userText) {
  const t = userText.toLowerCase();
  // perf harness (scripts/perf/droid.sh): the same ~13k-char answer at a realistic (~80 tok/s) or a stress rate
  if (/\bperfreal\b/.test(t)) return { name: 'perf-real', text: PERF_LONG, ms: [8, 16] };
  if (/\bperfstress\b/.test(t)) return { name: 'perf-stress', text: PERF_LONG, ms: [0, 2] };
  if (/\bperfhuge\b/.test(t)) return { name: 'perf-huge', text: PERF_HUGE, ms: [0, 2] };
  if (/\blong\b/.test(t)) return { name: 'long', text: LONG, ms: [12, 20] };
  if (/\bchecklist\b/.test(t)) return { name: 'checklist', text: CHECKLIST, ms: [4, 8] };
  if (/\btable\b/.test(t)) return { name: 'table', text: TABLE, ms: [8, 14] };
  if (/\bslow\b/.test(t)) return { name: 'slow', text: SLOW, ms: [45, 60] };
  // the --live stage's prompts, so the stage can be dry-run against this mock (docs/E2E.md)
  if (/exactly the word pong/.test(t)) return { name: 'live-pong', text: 'pong', ms: [20, 30] };
  if (/2 plus 3/.test(t)) return { name: 'live-sum', text: '5', ms: [20, 30] };
  return { name: 'short', text: SHORT(userText.trim()), ms: [20, 30] };
}

/** mulberry32: small seeded PRNG */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/** provider-like pieces: a word with its leading whitespace, long words cut into 2–7 chars */
export function chunks(text, rand) {
  const out = [];
  for (const piece of text.match(/\s*\S+|\s+/g) || []) {
    for (let i = 0; i < piece.length; ) {
      const n = 2 + Math.floor(rand() * 6);
      out.push(piece.slice(i, i + n));
      i += n;
    }
  }
  return out;
}

// ── state ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const config = { profiles: false, quick: false };
let fault = null; // one-shot
const codes = new Set();
const tokens = new Set(['nca_e2e_test_token_static_0000000000']);
const replay = createReplayStore({ retainMs: 30 * 60_000 });
/** @type {Map<string, {id: string, profile: string|null, title: string, rows: any[], started: number, last: number}>} */
const sessions = new Map();
const turns = []; // public turn records
const requests = [];
const uploads = []; // POST /bridge/uploads ("Share to HUI+" images / files)
let rowId = 0;
const nowS = () => Date.now() / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (data, event) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
const BRIDGE = { 'X-Hermes-UI-Bridge': '1' };

function json(res, status, body, headers = {}) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...BRIDGE, ...headers });
  res.end(JSON.stringify(body));
}
const apiError = (res, status, message, code, type = 'invalid_request_error') => json(res, status, { error: { message, type, param: null, code } });
const readBody = (req) =>
  new Promise((resolve, reject) => {
    const c = [];
    req.on('data', (d) => c.push(d));
    req.on('end', () => resolve(Buffer.concat(c).toString('utf8')));
    req.on('error', reject);
  });
const contentText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p?.type === 'text' ? p.text : '')).join('') : '');

function session(id, profile) {
  let s = sessions.get(id);
  if (!s) sessions.set(id, (s = { id, profile, title: '', rows: [], started: nowS(), last: nowS() }));
  return s;
}
function addRow(s, role, content, extra = {}) {
  s.rows.push({ id: ++rowId, role, content, timestamp: nowS(), ...extra });
  s.last = nowS();
  if (!s.title && role === 'user') s.title = content.slice(0, 40);
}

// ── a chat turn ─────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Runs the scripted answer into `rec` (replay record, may be null) and the original response while it is attached.
 * Never stops because the client left; only stop() (bridge/chat/stop) ends it early.
 */
function runTurn(t, res, rec, opts) {
  const parts = chunks(t.expected, rng(seedOf(t.text)));
  const rand = rng(seedOf(t.text) ^ 0x9e3779b9);
  const head = {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Hermes-Session-Id': t.sid, ...BRIDGE, ...(rec && opts.resumable ? { [RESUMABLE_HEADER]: '1' } : {}) },
  };
  let attached = !res.destroyed;
  res.on('close', () => (attached = false));
  if (attached) {
    res.writeHead(head.status, head.headers);
    res.flushHeaders?.();
  }
  rec?.start(head);
  if (rec && !opts.resumable) rec.unresumable(); // keeps the key (no second turn) without offering byte resume
  t.state = 'live';
  t.startedAt = Date.now();
  let sent = 0;
  const emit = (s) => {
    const b = Buffer.from(s);
    rec?.append(b);
    if (attached) res.write(b);
  };
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta, finish = null, x = {}) => ({ id: t.completionId, object: 'chat.completion.chunk', created, model: 'hermes-agent', choices: [{ index: 0, delta, finish_reason: finish }], ...x });
  t.stop = () => (t.state = 'stopped');
  (async () => {
    await sleep(300);
    emit(frame({ format: 'text', confidence: 0.6, reason: 'E2E', model: 'router', ms: 5 }, 'hermes.ui.route'));
    emit(frame(chunk({ role: 'assistant' })));
    for (const p of parts) {
      if (t.state !== 'live') break;
      await sleep(t.ms[0] + rand() * (t.ms[1] - t.ms[0]));
      if (t.state !== 'live') break;
      emit(frame(chunk({ content: p })));
      if (!t.streamed) t.firstChunkAt = Date.now();
      t.streamed += p;
      sent++;
      if (opts.dropAfter && sent === opts.dropAfter && attached) {
        t.drops++;
        attached = false;
        res.destroy(); // the client loses its connection; the turn goes on
      }
    }
    const s = session(t.sid, t.profile);
    if (t.state === 'stopped') {
      addRow(s, 'assistant', t.streamed, { finish_reason: 'stop' });
      rec?.end(true);
      if (attached) res.destroy();
    } else {
      emit(frame(chunk({}, 'stop', { usage: { prompt_tokens: 900, completion_tokens: Math.ceil(t.expected.length / 4), total_tokens: 900 + Math.ceil(t.expected.length / 4) } })));
      emit('data: [DONE]\n\n');
      t.state = 'ended';
      addRow(s, 'assistant', t.expected, { finish_reason: 'stop' });
      rec?.end(false);
      if (attached) res.end();
    }
    t.endedAt = Date.now();
    t.stop = null;
    console.log(`${new Date().toISOString().slice(11, 23)} turn ${t.n} ${t.scenario} ${t.state} ${sent}/${parts.length} chunks ${((t.endedAt - t.startedAt) / 1000).toFixed(1)} s`);
  })();
}

async function chat(req, res, path, profile, token, log) {
  const raw = await readBody(req);
  const key = idempotencyKey(req.headers);
  const offset = resumeOffset(req.headers);
  const sid = String(req.headers['x-hermes-session-id'] || '').trim();
  log.key = key;
  log.sid = sid;
  if (offset !== undefined) log.offset = offset;
  const scope = key ? `${token}\0${profile ?? ''}\0${key}` : '';
  if (key) {
    const known = replay.get(scope);
    const rerun = known && offset === undefined && replay.rerunnable(known);
    if ((known && !rerun) || offset !== undefined) {
      log.kind = offset !== undefined ? 'resume' : 'reattach';
      const t = turns.find((x) => x.scope === scope);
      if (t) t.attaches.push({ at: Date.now(), offset: offset ?? 0 });
      if (offset === null) return apiError(res, 400, 'Invalid X-Hermes-UI-Resume-Offset', 'invalid_resume_offset');
      if (!known) return apiError(res, 409, 'Nothing to resume for this Idempotency-Key', 'resume_unavailable');
      if (sid !== known.sessionId) return apiError(res, 409, 'Idempotency-Key was used for another session', 'idempotency_key_conflict');
      const refused = known.attach(res, offset ?? 0);
      if (refused) {
        log.status = refused.status;
        log.code = refused.code;
        return apiError(res, refused.status, refused.message, refused.code, refused.status === 429 ? 'rate_limit_error' : 'invalid_request_error');
      }
      return;
    }
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return apiError(res, 400, 'Invalid JSON', 'invalid_json');
  }
  const convo = (body.messages || []).filter((m) => m.role === 'user' || m.role === 'assistant');
  const userText = contentText(convo[convo.length - 1]?.content).trim();
  log.text = userText.slice(0, 120);
  let f = null;
  if (fault && userText.includes(fault.match ?? '')) [f, fault] = [fault, null];
  if (f) log.fault = f.kind;
  if (f?.kind === 'refuse') {
    log.kind = 'refused';
    return apiError(res, f.status ?? 503, 'The UI bridge refused the send (E2E fault)', 'e2e_refused', 'server_error');
  }
  if (!body.stream) return apiError(res, 400, 'The E2E mock only streams', 'stream_required');
  const sc = scenarioFor(userText);
  const t = {
    n: turns.length + 1, text: userText, scenario: sc.name, ms: sc.ms, expected: sc.text, streamed: '', sid: sid || `api-e2e-${turns.length + 1}`,
    profile, key, scope, state: 'pending', completionId: `chatcmpl-e2e-${turns.length + 1}`, attaches: [], drops: 0, receivedAt: Date.now(),
  };
  log.kind = 'turn';
  if (f?.kind === 'hold') {
    // "delayed confirmation": nothing is acknowledged for f.ms; a client that leaves meanwhile never reached Hermes
    t.state = 'held';
    turns.push(t);
    log.kind = 'held';
    let gone = false;
    res.on('close', () => (gone = true));
    const until = Date.now() + (f.ms ?? 60_000);
    while (!gone && Date.now() < until) await sleep(100);
    if (gone) {
      t.state = 'dropped';
      return;
    }
    t.state = 'pending';
  } else turns.push(t);
  const rec = key ? replay.begin(scope, sid) : null;
  const s = session(t.sid, profile);
  addRow(s, 'user', userText);
  runTurn(t, res, rec, { resumable: f?.kind === 'drop' ? f.resumable !== false : true, dropAfter: f?.kind === 'drop' ? f.afterChunks ?? 30 : 0 });
}

function quick(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', ...BRIDGE });
  const id = `chatcmpl-quick-${Date.now()}`;
  res.write(frame({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }));
  for (const p of chunks(QUICK, rng(1))) res.write(frame({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: p }, finish_reason: null }] }));
  res.write(frame({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
  res.end('data: [DONE]\n\n');
}

function sessionList(profile, url) {
  const all = [...sessions.values()].filter((s) => (s.profile ?? null) === (profile ?? null)).sort((a, b) => b.last - a.last);
  const limit = Number(url.searchParams.get('limit') || 50);
  const off = Number(url.searchParams.get('offset') || 0);
  const data = all.slice(off, off + limit).map((s) => ({
    id: s.id, source: 'api_server', title: s.title || null, preview: s.rows.at(-1)?.content.slice(0, 80) ?? '', model: 'hermes-agent',
    started_at: s.started, last_active: s.last, message_count: s.rows.length,
  }));
  return { object: 'list', data, has_more: off + limit < all.length, limit, offset: off };
}

// ── control + routing ───────────────────────────────────────────────────────────────────────────────────────────────
async function control(req, res, path, url) {
  if (path === '/__e2e/state') return json(res, 200, { config, fault, turns: turns.length, requests: requests.length, sessions: sessions.size, replay: replay.stats() });
  if (path === '/__e2e/turns') return json(res, 200, turns.map(({ stop: _s, scope: _c, ...t }) => t));
  if (path === '/__e2e/requests') return json(res, 200, requests);
  if (path === '/__e2e/uploads') return json(res, 200, uploads);
  if (path === '/__e2e/expected') return json(res, 200, scenarioFor(url.searchParams.get('text') || ''));
  if (req.method !== 'POST') return json(res, 404, { error: 'unknown control route' });
  const body = JSON.parse((await readBody(req)) || '{}');
  if (path === '/__e2e/pair-code') {
    const code = `e2e-pair-test-${Date.now().toString(36)}-${codes.size}`;
    codes.add(code);
    return json(res, 200, { code });
  }
  if (path === '/__e2e/config') {
    Object.assign(config, body);
    return json(res, 200, config);
  }
  if (path === '/__e2e/seed') {
    // perf harness: a Hermes session with `messages` transcript rows (perf-answers.mjs); `hui-` id = one of the app's
    // own sessions, so its default drawer filter lists it (conversations/remoteSync.ts)
    const n = Math.max(2, Math.min(20_000, Number(body.messages) || 2400));
    const s = session(`hui-perf-history-${n}`, null);
    s.rows = perfHistory(n).map((r) => ({ id: ++rowId, ...r }));
    s.title = body.title || `Perf history ${n}`;
    s.started = s.rows[0].timestamp;
    s.last = nowS();
    return json(res, 200, { id: s.id, title: s.title, rows: s.rows.length });
  }
  if (path === '/__e2e/fault') {
    fault = body.kind ? body : null;
    return json(res, 200, { fault });
  }
  return json(res, 404, { error: 'unknown control route' });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  let path = url.pathname.replace(/\/+$/, '') || '/';
  if (path.startsWith('/__e2e/')) return control(req, res, path, url);
  const log = { t: Date.now(), method: req.method, path, status: 200 };
  requests.push(log);
  res.on('finish', () => (log.status = res.statusCode));
  res.on('close', () => !res.writableFinished && (log.closed = 'early'));
  let profile = null;
  const pm = /^\/p\/([a-z0-9][a-z0-9_-]{0,63})(\/.*)$/.exec(path);
  if (pm) [profile, path] = [pm[1], pm[2]];
  if (req.method === 'GET' && !profile && (path === '/health' || path === '/v1/health')) return json(res, 200, { status: 'ok', platform: 'hermes-agent', version: 'e2e-mock' });
  if (req.method === 'POST' && path === '/bridge/pair/redeem') {
    const { code } = JSON.parse((await readBody(req)) || '{}');
    if (!codes.delete(code)) return apiError(res, 410, 'Pairing link expired or already used', 'pair_code_invalid');
    const token = `nca_e2e_test_token_${String(tokens.size).padStart(24, '0')}`;
    tokens.add(token);
    return json(res, 200, { token, deviceId: `e2e-device-${tokens.size}`, name: 'E2E' });
  }
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!tokens.has(token)) return apiError(res, 401, 'Invalid bridge token', 'invalid_api_key');
  if (profile && !(config.profiles && profile === 'research')) return apiError(res, 404, 'Not found', 'unknown_profile');
  if (path === '/health' || path === '/v1/health') return json(res, 200, { status: 'ok', platform: 'hermes-agent', version: 'e2e-mock' });
  if (path === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: 'hermes-agent', object: 'model', owned_by: 'hermes' }] });
  if (path === '/v1/capabilities')
    return json(res, 200, {
      object: 'hermes.api_server.capabilities', platform: 'hermes-agent', model: 'hermes-agent',
      features: { streaming: true, tool_progress: true, session_continuity_header: 'X-Hermes-Session-Id' },
      endpoints: { chat_completions: { method: 'POST', path: '/v1/chat/completions' } },
    });
  if (path === '/v1/skills') return json(res, 200, { object: 'list', data: [] });
  if (req.method === 'POST' && path === '/v1/chat/completions') return chat(req, res, path, profile, token, log);
  const run = /^\/v1\/runs\/([^/]+)$/.exec(path);
  if (run) {
    const t = turns.find((x) => x.completionId === run[1]);
    if (!t) return apiError(res, 404, 'Run not found', 'run_not_found');
    return json(res, 200, { id: t.completionId, status: t.state === 'live' ? 'running' : t.state === 'ended' ? 'completed' : 'cancelled' });
  }
  if (path === '/api/model/options') return json(res, 200, { providers: [] });
  if (req.method === 'GET' && path === '/api/sessions') return json(res, 200, sessionList(profile, url));
  const sm = /^\/api\/sessions\/([^/]+)(\/messages|\/model|\/fork)?$/.exec(path);
  if (sm) {
    const s = sessions.get(sm[1]);
    if (!s) return apiError(res, 404, 'Session not found', 'session_not_found');
    if (sm[2] === '/messages') {
      const limit = Number(url.searchParams.get('limit') || 120);
      return json(res, 200, { object: 'list', session_id: s.id, data: s.rows.slice(-limit) });
    }
    if (sm[2] === '/model') return json(res, 200, { ok: true, model: 'hermes-agent' });
    if (sm[2] === '/fork') return apiError(res, 501, 'Not supported by the E2E mock', 'not_supported');
    if (req.method === 'DELETE') {
      sessions.delete(s.id);
      return json(res, 200, { object: 'hermes.session.deleted', id: s.id, deleted: true });
    }
    if (req.method === 'PATCH') {
      const b = JSON.parse((await readBody(req)) || '{}');
      if (typeof b.title === 'string') s.title = b.title;
      return json(res, 200, { session: { id: s.id, title: s.title } });
    }
    return json(res, 200, { id: s.id, title: s.title, source: 'api_server', message_count: s.rows.length });
  }
  if (req.method === 'POST' && path === '/bridge/uploads') {
    // the bridge contract (app/src/attachments/uploadCore.ts): raw bytes, Content-Type, X-Filename → 201 RemoteRef
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bytes = Buffer.concat(chunks);
    let name = 'file';
    try {
      name = decodeURIComponent(String(req.headers['x-filename'] || 'file'));
    } catch {
      // keep the default
    }
    const mimeType = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
    const id = `e2e-up-${uploads.length + 1}`;
    uploads.push({ id, name, mimeType, size: bytes.length, head: bytes.subarray(0, 8).toString('hex') });
    return json(res, 201, { id, path: `/tmp/e2e-uploads/${id}-${name.replace(/[^\w.-]/g, '_')}`, name, size: bytes.length, mimeType });
  }
  if (path === '/bridge/profiles')
    return json(res, 200, { object: 'list', mode: 'list', data: [{ name: 'default', default: true, model: 'hermes-agent' }, ...(config.profiles ? [{ name: 'research', default: false, label: 'Research', model: 'hermes-agent' }] : [])] });
  if (path === '/bridge/quick/config')
    return json(res, 200, config.quick ? { available: true, source: 'hermes-plugin', model: 'quick-mock', provider: 'mock', limits: { perDeviceMinute: 20, perDeviceDay: 500 }, streaming: true } : { available: false });
  if (req.method === 'POST' && (path === '/bridge/quick/v1/chat/completions' || path === '/bridge/quick')) {
    await readBody(req);
    if (!config.quick) return apiError(res, 404, 'Quick answers are off', 'feature_off');
    return quick(req, res);
  }
  if (req.method === 'POST' && path === '/bridge/chat/stop') {
    const b = JSON.parse((await readBody(req)) || '{}');
    log.sid = b.sessionId;
    const live = turns.filter((t) => t.sid === b.sessionId && t.state === 'live' && t.stop);
    for (const t of live) t.stop();
    return json(res, 200, { stopped: live.length });
  }
  if (path === '/bridge/meta') return apiError(res, 404, 'Off in the E2E mock', 'feature_off');
  if (path === '/bridge/push/config') return json(res, 200, {});
  if (path === '/bridge/voice/config') return json(res, 200, { stt: { available: false }, tts: { available: false } });
  if (path === '/bridge/images/config') return json(res, 200, { available: false });
  if (path === '/bridge/status') return json(res, 200, { ok: true, router: null, hint: 'off', resume: { enabled: true, ...replay.stats() } });
  return apiError(res, 404, `Not found: ${path}`, 'not_found');
}

/** the mock as an http.Server (not listening); every server has its own state only if the module is re-imported */
export function createServer() {
  return http.createServer((req, res) =>
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) apiError(res, 500, String(e), 'mock_error', 'server_error');
      else res.destroy();
    })
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  createServer().listen(PORT, '127.0.0.1', () => console.log(`e2e mock on http://127.0.0.1:${PORT} (emulator: http://10.0.2.2:${PORT}/v1)`));
}
