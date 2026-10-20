// Routines (Hermes cron jobs), slice 1: read + pause / resume / run. Not a pass-through: a fixed allow-list, the client
// body is never forwarded, `run` is guarded (a run of a paused job resumes it upstream), and responses are projected
// to a small field set (delivery targets, chat ids, scripts, workdirs, base URLs never leave the bridge).
// docs/ROUTER.md, "Hermes routines (cron jobs)".

export const ROUTINES_MODES = /** @type {const} */ (['control', 'read', 'off']);
const JOB_ID = /^[a-f0-9]{12}$/;
const BODY_MAX = 1024;
const RESPONSE_MAX = 4 * 1024 * 1024;
const RUN_COOLDOWN_MS = 30_000;
const COOLDOWN_MAX_ENTRIES = 1000;
const MSG_MAX = 300;

/** True for every path this module owns (the bridge routes it here before the generic `/api/` allow-list). */
export const isJobsPath = (path) => path === '/api/jobs' || path.startsWith('/api/jobs/');

/**
 * Allowed methods for a jobs path, or null (→ 404). create / PATCH / DELETE are known but never allowed (→ 405).
 * @returns {{methods: string[], id: string|null, action: 'list'|'get'|'pause'|'resume'|'run'|null} | null}
 */
export function jobsRoute(path) {
  if (path === '/api/jobs') return { methods: ['GET'], id: null, action: 'list' };
  const m = /^\/api\/jobs\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if (!m || !JOB_ID.test(m[1])) return null;
  if (!m[2]) return { methods: ['GET'], id: m[1], action: 'get' };
  if (m[2] === 'pause' || m[2] === 'resume' || m[2] === 'run') return { methods: ['POST'], id: m[1], action: m[2] };
  return null;
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const strOrNum = (v, max) => num(v) ?? str(v, max);

/** "telegram:-100…:7,local,bot-chat:x" → "telegram,local,bot-chat": only the platform part of each target. */
export function deliverKind(deliver) {
  const raw = Array.isArray(deliver) ? deliver.filter((d) => typeof d === 'string').join(',') : deliver;
  if (typeof raw !== 'string') return undefined;
  const kinds = [];
  for (const t of raw.slice(0, 2000).split(',')) {
    const k = t.split(':')[0].trim();
    if (/^[A-Za-z0-9_.-]{1,40}$/.test(k) && !kinds.includes(k)) kinds.push(k);
  }
  return kinds.length ? kinds.slice(0, 20).join(',') : undefined;
}

/** Hermes job record → the fields the app may see. Unknown / mistyped fields are dropped. */
export function projectJob(j) {
  const job = obj(j);
  if (!job) return null;
  const sched = obj(job.schedule);
  const repeat = obj(job.repeat);
  const exec = obj(job.latest_execution);
  /** @type {Record<string, any>} */
  const out = {
    id: str(job.id, 64),
    name: str(job.name, 200),
    prompt: str(job.prompt, 5000),
    skills: Array.isArray(job.skills) ? job.skills.filter((s) => typeof s === 'string').slice(0, 20).map((s) => s.slice(0, 100)) : undefined,
    schedule: sched ? {
      kind: str(sched.kind, 20), expr: strOrNum(sched.expr, 200), minutes: strOrNum(sched.minutes, 40),
      run_at: strOrNum(sched.run_at, 64), display: str(sched.display, 200),
    } : undefined,
    schedule_display: str(job.schedule_display, 200),
    repeat: repeat ? { times: num(repeat.times) ?? null, completed: num(repeat.completed) ?? 0 } : undefined,
    enabled: bool(job.enabled),
    state: str(job.state, 40),
    paused_at: str(job.paused_at, 64),
    paused_reason: str(job.paused_reason, 300),
    created_at: str(job.created_at, 64),
    next_run_at: str(job.next_run_at, 64),
    last_run_at: str(job.last_run_at, 64),
    last_status: str(job.last_status, 40),
    last_error: str(job.last_error, 500),
    last_delivery_error: str(job.last_delivery_error, 500),
    failure_streak: num(job.failure_streak),
    model: str(job.model, 200),
    provider: str(job.provider, 100),
    no_agent: bool(job.no_agent),
    deliver_kind: deliverKind(job.deliver),
    origin_platform: str(obj(job.origin)?.platform, 40),
    latest_execution: exec ? {
      status: str(exec.status, 40), source: str(exec.source, 40), claimed_at: str(exec.claimed_at, 64),
      started_at: str(exec.started_at, 64), finished_at: str(exec.finished_at, 64),
    } : undefined,
  };
  // JSON.stringify drops the undefined ones anyway; strip them here so tests / callers see the same object
  for (const o of [out, out.schedule, out.latest_execution]) {
    if (o) for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  }
  return out;
}

/** Upstream error text for the client: Hermes already redacts it; single line, capped. */
function upstreamMessage(body, fallback) {
  const e = obj(body)?.error;
  const m = typeof e === 'string' ? e : typeof obj(e)?.message === 'string' ? e.message : '';
  // eslint-disable-next-line no-control-regex
  const clean = m.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MSG_MAX);
  return clean || fallback;
}

/**
 * access(req, bot): the request's routines right for a bot (src/routines-rights.mjs `access`): `manage` | `read` |
 * `none`, with status + code when refused (404 routines_off: bot not enabled / ceiling off, 403 routines_forbidden).
 * Without `access` (older callers) the server-wide `routines` mode decides alone, as in slice 1.
 * @param {{routines?: 'control'|'read'|'off',
 *   access?: (req: import('node:http').IncomingMessage, bot: string) => {right: 'manage'|'read'|'none', status?: number, code?: string, reasons?: string[]},
 *   upstreamRequest: (method: string, path: string, headers: Record<string, any>) => import('node:http').ClientRequest,
 *   openaiError: (res: any, status: number, message: string, type: string, code?: string) => void,
 *   sendJson: (res: any, status: number, body: any) => void,
 *   limits: {apiTimeoutMs: number},
 *   log: {info: Function, warn: Function},
 *   now?: () => number, runCooldownMs?: number}} deps
 */
export function createJobsHandler(deps) {
  const { upstreamRequest, openaiError, sendJson, limits, log } = deps;
  const mode = deps.routines ?? 'control';
  const access = deps.access ?? (() => (mode === 'off' ? { right: 'none', status: 404, code: 'routines_off', reasons: ['routines_off'] }
    : { right: mode === 'control' ? 'manage' : 'read', reasons: mode === 'read' ? ['read_only_server'] : [] }));
  const now = deps.now ?? Date.now;
  const cooldownMs = deps.runCooldownMs ?? RUN_COOLDOWN_MS;
  /** in-flight mutations per profile\0jobId */
  const busy = new Set();
  /** run cooldown: profile\0jobId → until (ms); insertion order = expiry order (fixed cooldown) */
  /** @type {Map<string, number>} */
  const cooldown = new Map();
  /** `routines` stays for slice-1 apps (control iff manage); `rights` is the request's effective right */
  const huiOf = (right) => ({ routines: right === 'manage' ? 'control' : 'read', rights: right });

  function pruneCooldown(t) {
    for (const [k, until] of cooldown) {
      if (until > t && cooldown.size <= COOLDOWN_MAX_ENTRIES) break;
      cooldown.delete(k);
    }
  }

  /**
   * One buffered upstream call. Resolves {status, body} (body = parsed JSON or undefined), or {error: code}.
   * Never forwards client headers: Hermes gets its key (upstreamRequest) and a fixed JSON request.
   * @param {import('node:http').ServerResponse} res  client response: an early close aborts the call when `abortOnClose`
   */
  function call(method, path, res, abortOnClose) {
    return new Promise((resolve) => {
      const payload = method === 'POST' ? Buffer.from('{}') : null;
      /** @type {Record<string, string>} */
      const headers = { accept: 'application/json', 'accept-encoding': 'identity' };
      if (payload) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = String(payload.length);
      }
      const up = upstreamRequest(method, path, headers);
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        res.off('close', onClose);
        resolve(v);
      };
      const onClose = () => { if (abortOnClose && !res.writableFinished) { up.destroy(); finish({ error: 'client_closed' }); } };
      res.on('close', onClose);
      up.setTimeout(limits.apiTimeoutMs, () => up.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
      up.on('response', (upRes) => {
        const chunks = [];
        let size = 0;
        upRes.on('data', (c) => {
          size += c.length;
          if (size > RESPONSE_MAX) {
            upRes.destroy();
            up.destroy();
            return finish({ error: 'too_large' });
          }
          chunks.push(c);
        });
        upRes.on('end', () => {
          let body;
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = undefined; }
          finish({ status: upRes.statusCode ?? 502, body });
        });
        upRes.on('error', () => finish({ error: 'unavailable' }));
      });
      up.on('error', (err) => finish({ error: err?.code === 'ETIMEDOUT' ? 'timeout' : 'unavailable', detail: String(err?.code ?? err?.message ?? err).slice(0, 120) }));
      up.end(payload ?? undefined);
    });
  }

  /** Map a failed / non-2xx upstream result onto the bridge's error contract. @returns {boolean} true if it answered */
  function failed(res, reqId, r, { list = false } = {}) {
    if (r.error === 'client_closed') { res.destroy(); return true; }
    if (r.error) {
      log.warn('jobs_upstream', { reqId, error: r.detail ?? r.error });
      if (r.error === 'timeout') openaiError(res, 504, 'Hermes upstream timed out', 'bridge_error', 'upstream_timeout');
      else if (r.error === 'too_large') openaiError(res, 502, 'Hermes answer too large', 'bridge_error', 'upstream_too_large');
      else openaiError(res, 502, 'Hermes upstream unavailable', 'bridge_error', 'upstream_unavailable');
      return true;
    }
    const st = r.status;
    if (st >= 200 && st < 300) {
      if (r.body !== undefined) return false;
      openaiError(res, 502, 'Hermes answered with invalid JSON', 'bridge_error', 'upstream_invalid');
      return true;
    }
    log.warn('jobs_upstream', { reqId, status: st });
    // older Hermes without the cron routes answers a plain 404 for the list
    if (st === 404) openaiError(res, 404, list ? 'Hermes does not offer routines' : 'Routine not found', 'invalid_request_error', list ? 'routines_unsupported' : 'job_not_found');
    else if (st === 501) openaiError(res, 501, 'Hermes does not offer routines', 'bridge_error', 'routines_unsupported');
    else if (st === 400 || st === 409) openaiError(res, st, upstreamMessage(r.body, 'Hermes rejected the request'), 'invalid_request_error', 'upstream_rejected');
    // a wrong HERMES_API_KEY is the operator's problem; the client only learns that Hermes refused the bridge
    else if (st === 401 || st === 403) openaiError(res, 502, 'Hermes refused the bridge', 'bridge_error', 'upstream_auth');
    else openaiError(res, 502, st >= 500 ? upstreamMessage(r.body, 'Hermes error') : 'Hermes error', 'bridge_error', 'upstream_error');
    return true;
  }

  /** @returns {Promise<{ok: true, body: Record<string, any>} | {ok: false}>} the POST body after the 1 KiB cap + shape check */
  async function readBody(req, res, action) {
    const declared = Number(req.headers['content-length']);
    const tooLarge = () => {
      res.setHeader('connection', 'close');
      openaiError(res, 413, 'Request body too large', 'invalid_request_error', 'payload_too_large');
      return /** @type {const} */ ({ ok: false });
    };
    if (Number.isFinite(declared) && declared > BODY_MAX) {
      req.resume();
      return tooLarge();
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const c of req) {
        size += c.length;
        if (size > BODY_MAX) return tooLarge();
        chunks.push(c);
      }
    } catch {
      res.destroy();
      return { ok: false };
    }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    let body = {};
    if (text) {
      try { body = JSON.parse(text); } catch { body = null; }
    }
    // only {} or (run) {"resume_paused": bool}; a one-run prompt override or anything else is refused, never forwarded
    const o = obj(body);
    const keys = o ? Object.keys(o) : [];
    const okShape = o && keys.every((k) => action === 'run' && k === 'resume_paused' && typeof o[k] === 'boolean');
    if (!okShape) {
      openaiError(res, 400, action === 'run' ? 'Only {} or {"resume_paused": true|false} is accepted' : 'Only an empty body or {} is accepted', 'invalid_request_error', 'unsupported_field');
      return { ok: false };
    }
    return { ok: true, body: o };
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} reqId
   * @param {string|null} profile  `/p/<name>/` profile (null = unprefixed)
   * @param {string} path  decoded path without the profile prefix (isJobsPath(path) is true)
   */
  async function handle(req, res, reqId, profile, path) {
    const method = req.method ?? '';
    const grant = access(req, profile ?? 'default');
    if (grant.code === 'routines_off') {
      req.resume();
      return openaiError(res, 404, 'Routines are disabled for this bot', 'invalid_request_error', 'routines_off');
    }
    // job ids are plain hex: any %-escape in the raw path is refused (no second decoding upstream)
    const route = (req.url ?? '').split('?')[0].includes('%') ? null : jobsRoute(path);
    if (!route) {
      req.resume();
      return openaiError(res, 404, 'Not found', 'invalid_request_error');
    }
    if (!route.methods.includes(method)) {
      req.resume();
      res.setHeader('Allow', route.methods.join(', '));
      return openaiError(res, 405, 'Method not allowed', 'invalid_request_error', 'method_not_allowed');
    }
    if (grant.right === 'none') {
      req.resume();
      return openaiError(res, 403, 'This device may not use routines of this bot', 'invalid_request_error', 'routines_forbidden');
    }
    const hui = huiOf(grant.right);
    // the literal /p/<name> prefix of req.url (handle() checked it), forwarded like every other profiled route
    const base = `${profile ? `/p/${profile}` : ''}/api/jobs`;

    if (method === 'GET') {
      req.resume();
      const list = route.action === 'list';
      // the client query is ignored: the app always sees paused jobs too
      const r = await call('GET', list ? `${base}?include_disabled=true` : `${base}/${route.id}`, res, true);
      if (failed(res, reqId, r, { list })) return;
      if (list) {
        const jobs = obj(r.body)?.jobs;
        if (!Array.isArray(jobs)) return openaiError(res, 502, 'Hermes answered without a job list', 'bridge_error', 'upstream_invalid');
        return sendJson(res, 200, { jobs: jobs.map(projectJob).filter(Boolean), hui });
      }
      const job = projectJob(obj(r.body)?.job);
      if (!job) return openaiError(res, 502, 'Hermes answered without a job', 'bridge_error', 'upstream_invalid');
      return sendJson(res, 200, { job, hui });
    }

    if (grant.right !== 'manage') {
      req.resume();
      const server = grant.reasons?.includes('read_only_server') && !grant.reasons?.includes('read_only_device');
      return openaiError(res, 403, server ? 'Routines are read-only on this bridge' : 'This device may only view routines', 'invalid_request_error', 'routines_read_only');
    }
    const parsed = await readBody(req, res, route.action);
    if (!parsed.ok) return;
    const key = `${profile ?? ''}\0${route.id}`;
    if (busy.has(key)) return openaiError(res, 409, 'Another change to this routine is in progress', 'invalid_request_error', 'job_busy');
    if (route.action === 'run') {
      const t = now();
      pruneCooldown(t);
      const until = cooldown.get(key);
      if (until && until > t) {
        res.setHeader('retry-after', String(Math.max(1, Math.ceil((until - t) / 1000))));
        return openaiError(res, 429, 'This routine was just started', 'rate_limit_error', 'run_cooldown');
      }
    }
    busy.add(key);
    try {
      if (route.action === 'run') {
        // Hermes' run enables a paused job and refuses terminal ones with a 500: check first, say why
        const g = await call('GET', `${base}/${route.id}`, res, true);
        if (failed(res, reqId, g)) return;
        const job = obj(obj(g.body)?.job);
        if (!job) return openaiError(res, 502, 'Hermes answered without a job', 'bridge_error', 'upstream_invalid');
        if (job.state === 'completed' || job.state === 'error') {
          return openaiError(res, 409, 'This routine has finished and cannot run again', 'invalid_request_error', 'job_terminal');
        }
        if ((job.enabled === false || job.state === 'paused') && parsed.body.resume_paused !== true) {
          return openaiError(res, 409, 'This routine is paused: running it now would also resume it', 'invalid_request_error', 'job_paused');
        }
      }
      // once sent, a mutation is not aborted by a client going away: the lock and cooldown must match what Hermes did
      const r = await call('POST', `${base}/${route.id}/${route.action}`, res, false);
      if (failed(res, reqId, r)) return;
      if (route.action === 'run') {
        cooldown.delete(key);
        cooldown.set(key, now() + cooldownMs);
      }
      log.info('jobs_action', { reqId, action: route.action, status: r.status });
      return sendJson(res, 200, { job: projectJob(obj(r.body)?.job), hui });
    } finally {
      busy.delete(key);
    }
  }

  return { handle, stats: () => ({ busy: busy.size, cooldown: cooldown.size }) };
}
