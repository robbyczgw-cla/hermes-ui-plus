// What the bots are doing right now (Bots v2 slice 5, docs/BOTS-SERVER.md "Activity"): GET /bridge/bots/activity.
//
// Hermes keeps no list of running runs (and /api/sessions has no "running" field), so this answers only what the bridge
// can know honestly:
//   turns     chat turns the bridge itself streams from Hermes right now (any device, also while the phone went away:
//             detached runs keep going), per Hermes profile, with the last tool steps parsed from the turn's SSE
//             (`event: hermes.tool.progress`). A chat that runs through another client (Telegram, CLI, another bridge)
//             is not seen.
//   routines  Hermes cron jobs whose latest execution is claimed / running (GET /api/jobs, `latest_execution.status`),
//             only for bots whose routines this credential may read (src/routines-rights.mjs: owner opt-in per bot,
//             device right), at most MAX_POLLED_PROFILES bots besides the default, cached 15 s per bot, 5 s timeout.
//
// GET /bridge/bots/activity (any authenticated credential) ->
//   {object: 'bots.activity', at: ms, turns: {known: true}, routines: {known, reason?, bots: [names read]},
//    data: [{bot: 'default'|name, turns: [{sessionId, since: ms, steps: [{name, label?, state: 'done'|'running'}]}],
//            routines: [{jobId, name, since?: ms}]}]}
//   routines.known=false: reason routines_off (no bot whose routines this credential may read) or failed (a job list
//   could not be read; what could be read is still listed). Only bots with something running are in `data`.
// Logs carry names and counts only, never labels, commands or job texts.
import { silentLogger } from './log.mjs';
import { makeAuthorizer } from './auth.mjs';
import { createSseParser } from './sse.mjs';
import { upstreamUrl } from './paths.mjs';
import { DEFAULT_PROFILE, isProfileName, profilePrefix } from './profiles.mjs';
import { MAX_POLLED_PROFILES } from './push-hermes.mjs';
import { corsHeaders } from './cors.mjs';

export const ACTIVITY_PATH = '/bridge/bots/activity';
export const TOOL_PROGRESS_EVENT = 'hermes.tool.progress';
export const STEPS_MAX = 12;
const ROUTINES_TTL_MS = 15_000;
const ROUTINES_TIMEOUT_MS = 5_000;
const RESPONSE_MAX = 4 * 1024 * 1024;
const NAME_MAX = 64;
const LABEL_MAX = 120;
const JOB_NAME_MAX = 200;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const JOB_ID = /^[a-f0-9]{12}$/;
const RUNNING = new Set(['claimed', 'running']);
/** tool statuses that end a step (same set as the app's mapToolStatus: done + error) */
const FINISHED = new Set(['completed', 'complete', 'done', 'success', 'finished', 'error', 'failed', 'failure']);

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const oneLine = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''); // eslint-disable-line no-control-regex
const str = (v) => (typeof v === 'string' && v ? v : undefined);

/**
 * One `hermes.tool.progress` data payload → {callId, name, label?, finished} or null. Tolerant like the app
 * (app/src/hermes/events.ts mapFrame): tool|name, toolCallId|tool_call_id|id.
 */
export function parseToolProgress(data) {
  let j;
  try { j = JSON.parse(data); } catch { return null; }
  if (!obj(j)) return null;
  const callId = str(j.toolCallId) ?? str(j.tool_call_id) ?? str(j.id);
  if (!callId || callId.length > 256) return null;
  const name = oneLine(str(j.tool) ?? str(j.name) ?? 'tool', NAME_MAX) || 'tool';
  const label = oneLine(j.label, LABEL_MAX);
  return { callId, name, ...(label ? { label } : {}), finished: FINISHED.has(String(j.status ?? '').toLowerCase()) };
}

/** ISO string or epoch seconds → ms, else undefined. */
function ms(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v < 1e12 ? v * 1000 : v);
  if (typeof v === 'string' && v.length <= 64) {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return undefined;
}

/** Running jobs of one GET /api/jobs answer → [{jobId, name, since?}]. Exported for tests. */
export function runningJobs(json) {
  const out = [];
  for (const raw of Array.isArray(json?.jobs) ? json.jobs : []) {
    const job = obj(raw);
    if (!job || typeof job.id !== 'string' || !JOB_ID.test(job.id)) continue;
    const ex = obj(job.latest_execution);
    if (!RUNNING.has(String(ex?.status ?? '')) && job.state !== 'running') continue;
    const since = ms(ex?.started_at) ?? ms(ex?.claimed_at);
    out.push({ jobId: job.id, name: oneLine(job.name, JOB_NAME_MAX) || job.id, ...(since ? { since } : {}) });
  }
  return out;
}

/**
 * @param {ReturnType<typeof import('./config.mjs').loadConfig>} config
 * @param {{logger?: any, fetch?: typeof fetch, now?: () => number,
 *   rights?: ReturnType<typeof import('./routines-rights.mjs').createRoutinesRights>|null,
 *   profiles?: {names: () => string[]}|null}} [o]
 */
export function createBotsActivity(config, o = {}) {
  const log = o.logger ?? silentLogger;
  const now = o.now ?? Date.now;
  const doFetch = o.fetch ?? ((...a) => fetch(...a));
  const rights = o.rights ?? null;
  const authorized = makeAuthorizer(config);
  const checkWho = (req) => (config.auth && typeof config.auth.check === 'function' ? config.auth.check(req) : authorized(req) ? { kind: 'admin' } : null);
  const corsOrigins = config.corsOrigins ?? [];

  // ---------- turns the bridge streams ----------
  /** @type {Set<{bot: string, sessionId: string|null, since: number, steps: Map<string, {name: string, label?: string, state: 'done'|'running'}>}>} */
  const turns = new Set();

  /**
   * The upstream chat request of one turn started (bridge.mjs). Returns the turn's observer: session(id) once Hermes
   * answered (its X-Hermes-Session-Id), push(chunk) for the SSE bytes, end() when the upstream request is over.
   * @param {string|null} profile  Hermes profile (null / default = the unprefixed one)
   * @param {string} [sessionId]  the client's X-Hermes-Session-Id, if any
   */
  function begin(profile, sessionId) {
    const t = {
      bot: profile && profile !== DEFAULT_PROFILE && isProfileName(profile) ? profile : DEFAULT_PROFILE,
      sessionId: typeof sessionId === 'string' && SAFE_ID.test(sessionId) ? sessionId : null,
      since: now(),
      steps: new Map(),
    };
    turns.add(t);
    let parser = null;
    let ended = false;
    return {
      session(id) { if (typeof id === 'string' && SAFE_ID.test(id)) t.sessionId = id; },
      push(chunk) {
        if (ended) return;
        parser ??= createSseParser(({ event, data }) => {
          if (event !== TOOL_PROGRESS_EVENT) return;
          const p = parseToolProgress(data);
          if (!p) return;
          const known = t.steps.get(p.callId);
          if (known) {
            if (p.finished) known.state = 'done';
            return;
          }
          if (p.finished) return; // a step that ended before we saw it start (or was dropped): nothing to show
          t.steps.set(p.callId, { name: p.name, ...(p.label ? { label: p.label } : {}), state: 'running' });
          while (t.steps.size > STEPS_MAX) t.steps.delete(t.steps.keys().next().value);
        }, { onOversize: (m) => log.debug?.('sse_frame_dropped', { where: 'activity', ...m }) });
        parser.push(chunk);
      },
      end() {
        if (ended) return;
        ended = true;
        try { parser?.end(); } catch { /* observer only */ }
        for (const s of t.steps.values()) s.state = 'done';
        turns.delete(t);
      },
    };
  }

  // ---------- routines (job lists, on demand, cached per bot) ----------
  /** @type {Map<string, {at: number, ok: boolean, jobs: {jobId: string, name: string, since?: number}[]}>} */
  const jobCache = new Map();
  /** @type {Map<string, Promise<{ok: boolean, jobs: any[]}>>} */
  const inflight = new Map();

  async function readJobs(bot) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ROUTINES_TIMEOUT_MS);
    timer.unref?.();
    try {
      const res = await doFetch(upstreamUrl(config.upstream.baseUrl, `${profilePrefix(bot)}/api/jobs?include_disabled=true`).href, {
        headers: { ...(config.upstream.apiKey ? { authorization: `Bearer ${config.upstream.apiKey}` } : {}), accept: 'application/json' },
        signal: ctl.signal,
        redirect: 'manual',
      });
      if (!res.ok) {
        try { await res.body?.cancel(); } catch { /* closed */ }
        throw Object.assign(new Error('status'), { status: res.status });
      }
      if (Number(res.headers.get('content-length')) > RESPONSE_MAX) throw Object.assign(new Error('too large'), { status: 'too_large' });
      const chunks = [];
      let size = 0;
      for await (const c of res.body ?? []) {
        size += c.length;
        if (size > RESPONSE_MAX) { ctl.abort(); throw Object.assign(new Error('too large'), { status: 'too_large' }); }
        chunks.push(c);
      }
      const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(json?.jobs)) throw Object.assign(new Error('no job list'), { status: 'no_job_list' });
      return { ok: true, jobs: runningJobs(json) };
    } catch (e) {
      log.debug?.('activity: job list failed', { bot, error: String(e?.status ?? (ctl.signal.aborted ? 'timeout' : e?.name ?? 'error')).slice(0, 40) });
      return { ok: false, jobs: [] };
    } finally {
      clearTimeout(timer);
    }
  }

  function jobsOf(bot) {
    const hit = jobCache.get(bot);
    if (hit && now() - hit.at < ROUTINES_TTL_MS) return Promise.resolve(hit);
    let p = inflight.get(bot);
    if (!p) {
      p = readJobs(bot).then((r) => {
        jobCache.set(bot, { at: now(), ...r });
        return r;
      }).finally(() => inflight.delete(bot));
      inflight.set(bot, p);
    }
    return p;
  }

  /** Bots whose routines this credential may read (default first, capped like the reconciler). */
  function readableBots(who) {
    if (!rights || rights.mode === 'off') return [];
    const others = (o.profiles?.names?.() ?? []).filter((n) => n !== DEFAULT_PROFILE && isProfileName(n)).slice(0, MAX_POLLED_PROFILES);
    return [DEFAULT_PROFILE, ...others].filter((b) => rights.access(who, b).right !== 'none');
  }

  /** The activity answer for one credential. */
  async function snapshot(who) {
    const bots = readableBots(who);
    const results = await Promise.all(bots.map(async (bot) => ({ bot, ...(await jobsOf(bot)) })));
    const failed = results.some((r) => !r.ok);
    const routines = !bots.length ? { known: false, reason: 'routines_off', bots: [] }
      : { known: !failed, ...(failed ? { reason: 'failed' } : {}), bots: results.filter((r) => r.ok).map((r) => r.bot) };
    /** @type {Map<string, {bot: string, turns: any[], routines: any[]}>} */
    const byBot = new Map();
    const row = (bot) => {
      if (!byBot.has(bot)) byBot.set(bot, { bot, turns: [], routines: [] });
      return byBot.get(bot);
    };
    for (const t of turns) {
      if (!t.sessionId) continue; // Hermes did not tell the session yet (no header, no answer)
      row(t.bot).turns.push({ sessionId: t.sessionId, since: t.since, steps: [...t.steps.values()].map((s) => ({ ...s })) });
    }
    for (const r of results) for (const j of r.jobs) row(r.bot).routines.push(j);
    const data = [...byBot.values()].sort((a, b) => (a.bot === DEFAULT_PROFILE ? -1 : b.bot === DEFAULT_PROFILE ? 1 : a.bot < b.bot ? -1 : a.bot > b.bot ? 1 : 0));
    for (const d of data) d.turns.sort((a, b) => a.since - b.since);
    return { object: 'bots.activity', at: now(), turns: { known: true }, routines, data };
  }

  function send(req, res, status, body, extra = {}) {
    const h = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-hermes-ui-bridge': '1', ...extra };
    Object.assign(h, corsHeaders(corsOrigins, req));
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { ...h, 'content-length': buf.length });
    res.end(buf);
  }

  async function handle(req, res) {
    req.resume();
    const who = checkWho(req);
    if (!who) return send(req, res, 401, { error: { message: 'Invalid bridge token', type: 'invalid_request_error', code: 'invalid_api_key' } }, { 'www-authenticate': 'Bearer' });
    if (req.method !== 'GET') return send(req, res, 405, { error: { message: 'Method not allowed', type: 'invalid_request_error', code: 'method_not_allowed' } }, { allow: 'GET' });
    const body = await snapshot(who);
    log.debug?.('activity', { turns: body.data.reduce((n, d) => n + d.turns.length, 0), routines: body.data.reduce((n, d) => n + d.routines.length, 0) });
    return send(req, res, 200, body);
  }

  return {
    begin,
    snapshot,
    running: () => turns.size,
    matches: (req) => req.method !== 'OPTIONS' && (req.url ?? '').split('?')[0] === ACTIVITY_PATH,
    handle,
  };
}
