// Routines result inbox (slice 2): a reconciler reads the Hermes job list of every enabled bot, turns each finished run
// into one inbox entry (final answer from the run's `cron_<job>_<ts>` session), stores it in
// <state-dir>/routines-inbox.json and then announces it (live inbox event `hui.routine` + push to registrations that
// asked for `routines`). Independent of push registrations and app streams: the inbox fills while nobody listens.
// Stock Hermes v0.22.2 only (job list + sessions API), no upstream changes.
//
// Endpoints (Bearer like every bridge route, rights per request, src/routines-rights.mjs):
//   GET   /bridge/routines/capabilities?hermesProfile=x
//   GET   /bridge/routines/inbox?hermesProfile=x&filter=all|unread&limit=1..100&before=<entry id>
//   GET   /bridge/routines/inbox/<id>?hermesProfile=x
//   PATCH /bridge/routines/inbox/<id>        {hermesProfile, read}
//   POST  /bridge/routines/inbox/read-all    {hermesProfile}
// Never logs content (ids, counts and status only). docs/ROUTER.md, "Hermes routines (cron jobs)".
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { silentLogger } from './log.mjs';
import { upstreamUrl } from './paths.mjs';
import { writeFileAtomicSync } from './atomic-write.mjs';
import { DEFAULT_PROFILE, profilePrefix } from './profiles.mjs';
import { isSilence, messageText, MAX_POLLED_PROFILES, OWNER } from './push-hermes.mjs';
import { previewText } from './push/index.mjs';
import { makeAuthorizer } from './auth.mjs';
import { applyCors } from './cors.mjs';

export const INBOX_FILE = 'routines-inbox.json';
export const ROUTINES_PREFIX = '/bridge/routines/';
const CAPS_PATH = '/bridge/routines/capabilities';
const LIST_PATH = '/bridge/routines/inbox';
const READ_ALL_PATH = '/bridge/routines/inbox/read-all';
const ITEM_RE = /^\/bridge\/routines\/inbox\/(ri_[0-9a-f]{20})$/;
const ENTRY_ID = /^ri_[0-9a-f]{20}$/;
const JOB_ID = /^[a-f0-9]{12}$/;
const UPSTREAM_TIMEOUT_MS = 20_000;
const RESPONSE_MAX = 4 * 1024 * 1024;
const STORE_MAX_BYTES = 4 * 1024 * 1024;
const RUNS_PER_POLL = 20;
const BACKFILL_MAX = 20;
const SESSION_SLACK_S = 120;
/** a run's session starts after the job's previous run ended (Hermes never overlaps runs of one job): small clock slack */
const PREV_RUN_SLACK_S = 5;
const TEXT_MAX = 16 * 1024;
const SUMMARY_MAX = 240;
const ERROR_MAX = 500;
const TITLE_MAX = 200;
const BODY_MAX = 1024;
const FIRST_POLL_MS = 3000;
const STATUSES = ['ok', 'failed', 'silent', 'blocked'];
const RUNNING = new Set(['claimed', 'running']);

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const isoOk = (v) => typeof v === 'string' && v.length <= 64 && Number.isFinite(Date.parse(v));
const oneLine = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max); // eslint-disable-line no-control-regex

/** `ri_` + sha256(`<bot>\0<jobId>\0<last_run_at>`) hex, 20 chars: one id per run, stable across polls and restarts. */
export function entryId(bot, jobId, lastRunAt) {
  return 'ri_' + crypto.createHash('sha256').update(`${bot}\0${jobId}\0${lastRunAt}`).digest('hex').slice(0, 20);
}

/** Cut `text` to at most `maxBytes` UTF-8 bytes at a character boundary. */
export function cutUtf8(text, maxBytes = TEXT_MAX) {
  const buf = Buffer.from(String(text ?? ''), 'utf8');
  if (buf.length <= maxBytes) return { text: String(text ?? ''), truncated: false };
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--; // never split a multi-byte sequence
  return { text: buf.subarray(0, end).toString('utf8'), truncated: true };
}

/**
 * Final visible assistant text of a message list (any order): role assistant, not hidden, not a tool-call step,
 * non-empty. Same rules as the push watcher (src/push-hermes.mjs).
 */
export function finalAssistantText(messages) {
  const list = (Array.isArray(messages) ? messages : []).filter((m) => obj(m));
  const ts = (m) => (typeof m.timestamp === 'number' ? m.timestamp : 0);
  const idOf = (m) => (typeof m.id === 'number' ? m.id : null);
  // newest first by timestamp, then by numeric id; otherwise the given order (order=latest: newest first)
  const sorted = list.map((m, i) => ({ m, i })).sort((a, b) => ts(b.m) - ts(a.m)
    || (idOf(a.m) !== null && idOf(b.m) !== null ? idOf(b.m) - idOf(a.m) : a.i - b.i));
  for (const { m } of sorted) {
    if (m.role !== 'assistant' || m.display_kind === 'hidden' || m.finish_reason === 'tool_calls') continue;
    const t = messageText(m.content);
    if (t.trim()) return t;
  }
  return '';
}

/** First string `title` / `summary` / `text` field found in a hui node (depth first). */
function huiField(node, depth = 0) {
  if (depth > 6 || !node || typeof node !== 'object') return '';
  if (!Array.isArray(node)) {
    for (const k of ['title', 'summary', 'text']) if (typeof node[k] === 'string' && node[k].trim()) return node[k];
  }
  for (const v of Array.isArray(node) ? node.slice(0, 50) : Object.values(node).slice(0, 50)) {
    const f = huiField(v, depth + 1);
    if (f) return f;
  }
  return '';
}

/** Plain summary (<= 240 chars): markdown / hui stripped; when nothing is left, the first title of the first hui block. */
export function summaryOf(text) {
  const plain = previewText(text, SUMMARY_MAX);
  if (plain) return plain;
  const m = /```hui[ \t]*\n([\s\S]*?)```/.exec(String(text ?? ''));
  if (!m) return '';
  try { return previewText(huiField(JSON.parse(m[1])), SUMMARY_MAX); } catch { return ''; }
}

/** Hermes last_status (+ final text) → inbox status. */
export function mapStatus(lastStatus, text) {
  const has = Boolean(String(text ?? '').trim());
  const silent = has && isSilence(text);
  if (lastStatus === 'ok') return { status: silent ? 'silent' : 'ok' };
  if (lastStatus === 'error') return { status: 'failed' };
  if (lastStatus === 'blocked_config') return { status: 'blocked' };
  if (lastStatus === 'delivery_failed') return { status: 'ok', deliveryFailed: true };
  return { status: has ? (silent ? 'silent' : 'ok') : 'failed' };
}

/** Equal job → last_run_at maps (insertion order ignored). */
const sameCheckpoints = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && a[k] === b[k]);
};

const itemBytes = (it) => Buffer.byteLength(JSON.stringify(it)) + 1;

/**
 * Retention: entries older than `days` (finishedAt) go; then, over `maxItems` or `maxBytes` serialized, the oldest
 * read entries first, then the oldest. Returns a new array (order kept).
 */
export function applyRetention(items, { nowMs, days, maxItems, maxBytes = STORE_MAX_BYTES, overhead = 0 }) {
  const cutoff = nowMs - days * 86_400_000;
  let keep = items.filter((it) => Date.parse(it.finishedAt) >= cutoff);
  let bytes = overhead + keep.reduce((n, it) => n + itemBytes(it), 0);
  if (keep.length <= maxItems && bytes <= maxBytes) return keep;
  const age = (a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt) || a.createdAt - b.createdAt;
  const order = [...keep.filter((it) => it.readAt).sort(age), ...keep.filter((it) => !it.readAt).sort(age)];
  const drop = new Set();
  for (const it of order) {
    if (keep.length - drop.size <= maxItems && bytes <= maxBytes) break;
    drop.add(it.id);
    bytes -= itemBytes(it);
  }
  keep = keep.filter((it) => !drop.has(it.id));
  return keep;
}

/** Stored entry, validated (unknown fields dropped). null when unusable. */
function parseEntry(e) {
  const o = obj(e);
  if (!o || !ENTRY_ID.test(String(o.id)) || typeof o.hermesProfile !== 'string' || !JOB_ID.test(String(o.jobId))) return null;
  if (!isoOk(o.finishedAt) || !STATUSES.includes(o.status)) return null;
  return {
    id: o.id,
    hermesProfile: o.hermesProfile.slice(0, 64),
    jobId: o.jobId,
    title: str(o.title, TITLE_MAX),
    runAt: isoOk(o.runAt) ? o.runAt : o.finishedAt,
    finishedAt: o.finishedAt,
    status: o.status,
    ...(o.deliveryFailed === true ? { deliveryFailed: true } : {}),
    summary: str(o.summary, SUMMARY_MAX),
    text: cutUtf8(str(o.text, TEXT_MAX * 2)).text,
    truncated: o.truncated === true,
    ...(typeof o.error === 'string' && o.error ? { error: o.error.slice(0, ERROR_MAX) } : {}),
    sessionId: typeof o.sessionId === 'string' && o.sessionId.length <= 200 ? o.sessionId : null,
    hasRich: o.hasRich === true,
    readAt: Number.isFinite(o.readAt) ? o.readAt : null,
    createdAt: Number.isFinite(o.createdAt) ? o.createdAt : 0,
  };
}

/** Stored state, validated. */
export function parseInboxState(doc) {
  const d = obj(doc);
  const bots = {};
  for (const [bot, b] of Object.entries(obj(d?.bots) ?? {})) {
    const bo = obj(b);
    if (!bo || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(bot) || !Number.isFinite(bo.baselineAt)) continue;
    const jobs = {};
    for (const [id, lr] of Object.entries(obj(bo.jobs) ?? {})) if (JOB_ID.test(id) && typeof lr === 'string' && lr.length <= 64) jobs[id] = lr;
    bots[bot] = { baselineAt: bo.baselineAt, jobs };
  }
  const seen = new Set();
  const items = [];
  for (const e of Array.isArray(d?.items) ? d.items : []) {
    const it = parseEntry(e);
    if (it && !seen.has(it.id)) { seen.add(it.id); items.push(it); }
  }
  return { v: 1, bots, items };
}

/** Summary view of an entry: without text / error, `read` instead of readAt. */
export function summaryView(it) {
  const { text: _t, error: _e, readAt, ...rest } = it;
  return { ...rest, read: readAt !== null };
}

/** Newest first: finishedAt desc, id desc as tiebreak. */
const newestFirst = (a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * @param {ReturnType<typeof import('./config.mjs').loadConfig>} config
 * @param {{stateDir?: string, logger?: any, fetch?: typeof fetch, now?: () => number,
 *   rights: ReturnType<typeof import('./routines-rights.mjs').createRoutinesRights>,
 *   push?: {service: any, previewDefault?: boolean}|null,
 *   profiles: {allowed: (name: string) => boolean}}} o
 */
export function createRoutinesInbox(config, o) {
  const log = o.logger ?? silentLogger;
  const now = o.now ?? Date.now;
  const doFetch = o.fetch ?? globalThis.fetch;
  const rights = o.rights;
  const settings = { pollMs: 60_000, retentionDays: 30, maxItems: 300, ...(config.routinesInbox ?? {}) };
  const stateDir = o.stateDir || '';
  const file = stateDir ? path.join(stateDir, INBOX_FILE) : null;
  const authorized = makeAuthorizer(config);
  const checkWho = (req) => (config.auth && typeof config.auth.check === 'function' ? config.auth.check(req) : authorized(req) ? { kind: 'admin' } : null);

  let state = { v: 1, bots: /** @type {Record<string, {baselineAt: number, jobs: Record<string, string>}>} */ ({}), items: /** @type {any[]} */ ([]) };
  if (file && fs.existsSync(file)) {
    try {
      state = parseInboxState(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      // a broken file: start over (new baseline, nothing pushed for old runs); it is replaced on the next write
      log.warn('routines_inbox_unreadable', { error: String(e?.code ?? e?.name ?? 'error').slice(0, 40) });
    }
  }

  /** Atomic write (0600). Memory-only without a state dir. @returns {boolean} */
  function persist(next) {
    if (!file) return true;
    try {
      fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
      writeFileAtomicSync(file, JSON.stringify(next), { mode: 0o600 });
      return true;
    } catch (e) {
      log.warn('routines_inbox_save_failed', { error: String(e?.code ?? e?.message ?? e).slice(0, 80) });
      return false;
    }
  }

  // ---------- Hermes API (key from config.upstream, never client headers; 20 s, 4 MiB) ----------
  async function hermesGet(p) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
    timer.unref?.();
    try {
      const res = await doFetch(upstreamUrl(config.upstream.baseUrl, p).href, {
        headers: { ...(config.upstream.apiKey ? { authorization: `Bearer ${config.upstream.apiKey}` } : {}), accept: 'application/json' },
        signal: ctrl.signal,
        redirect: 'manual',
      });
      if (!res.ok) {
        try { await res.body?.cancel(); } catch { /* already closed */ }
        throw Object.assign(new Error(`hermes ${res.status}`), { status: res.status });
      }
      if (Number(res.headers.get('content-length')) > RESPONSE_MAX) throw Object.assign(new Error('too large'), { code: 'too_large' });
      const chunks = [];
      let size = 0;
      for await (const c of res.body ?? []) {
        size += c.length;
        if (size > RESPONSE_MAX) {
          ctrl.abort();
          throw Object.assign(new Error('too large'), { code: 'too_large' });
        }
        chunks.push(c);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally {
      clearTimeout(timer);
    }
  }
  const failReason = (e) => String(e?.status ?? e?.code ?? e?.name ?? 'error').slice(0, 40);

  /** Bots the reconciler polls: the default profile + at most MAX_POLLED_PROFILES others. */
  function polledBots() {
    const all = rights.enabledBots();
    const others = all.filter((b) => b !== DEFAULT_PROFILE).slice(0, MAX_POLLED_PROFILES);
    return [...(all.includes(DEFAULT_PROFILE) ? [DEFAULT_PROFILE] : []), ...others];
  }

  const startedSec = (s) => (typeof s?.started_at === 'number' ? s.started_at : isoOk(s?.started_at) ? Date.parse(s.started_at) / 1000 : NaN);

  /**
   * Build the entry for one finished run. @returns {Promise<{entry: any} | {retry: true}>} retry: an upstream call
   * failed, the checkpoint stays (next poll).
   */
  async function buildEntry(bot, job, lr, prevLr, readAt, ctx) {
    const prefix = profilePrefix(bot);
    const jobId = job.id;
    const lrSec = Date.parse(lr) / 1000;
    // without this bound a run that left no session (script-only, failed before the agent) would inherit an older,
    // never imported session of the same job
    const minSec = isoOk(prevLr) ? Date.parse(prevLr) / 1000 - PREV_RUN_SLACK_S : -Infinity;
    let text = '';
    let session = null;
    if (!ctx.sessions) {
      try {
        const list = (await hermesGet(`${prefix}/api/sessions?source=cron&limit=50`))?.data;
        ctx.sessions = Array.isArray(list) ? list.filter((s) => obj(s) && typeof s.id === 'string') : [];
      } catch (e) {
        log.warn('routines_sessions_failed', { bot, error: failReason(e) });
        return { retry: true };
      }
    }
    const used = ctx.usedSessions;
    const candidates = ctx.sessions
      .filter((s) => s.id.startsWith(`cron_${jobId}_`) && !used.has(s.id) && startedSec(s) <= lrSec + SESSION_SLACK_S && startedSec(s) >= minSec)
      .sort((a, b) => startedSec(b) - startedSec(a));
    if (candidates.length) {
      const s = candidates[0];
      try {
        const msgs = (await hermesGet(`${prefix}/api/sessions/${encodeURIComponent(s.id)}/messages?order=latest&limit=30`))?.data;
        text = finalAssistantText(msgs);
      } catch (e) {
        log.warn('routines_messages_failed', { bot, job: jobId, error: failReason(e) });
        return { retry: true };
      }
      if (text) session = s;
    }
    const mapped = mapStatus(job.last_status, text);
    const lastError = oneLine(job.last_error, ERROR_MAX);
    const deliveryError = oneLine(job.last_delivery_error, ERROR_MAX);
    const error = mapped.deliveryFailed ? deliveryError || lastError : (!text || mapped.status === 'failed' || mapped.status === 'blocked') ? lastError : '';
    const cut = cutUtf8(text);
    const finishedAt = new Date(Date.parse(lr)).toISOString();
    const runSec = session ? startedSec(session) : NaN;
    if (session) used.add(session.id);
    const entry = {
      id: entryId(bot, jobId, lr),
      hermesProfile: bot,
      jobId,
      title: oneLine(job.name, TITLE_MAX),
      runAt: Number.isFinite(runSec) ? new Date(runSec * 1000).toISOString() : finishedAt,
      finishedAt,
      status: mapped.status,
      ...(mapped.deliveryFailed ? { deliveryFailed: true } : {}),
      summary: summaryOf(text),
      text: cut.text,
      truncated: cut.truncated,
      ...(error ? { error } : {}),
      sessionId: session ? session.id.slice(0, 200) : null,
      hasRich: /```hui(?:-html)?[ \t]*\n/.test(text),
      readAt: mapped.status === 'silent' ? now() : readAt,
      createdAt: now(),
    };
    return { entry };
  }

  /** One bot: job list → finished runs → entries → commit → announce. @returns {Promise<boolean>} false on failure */
  async function pollBot(bot) {
    let jobs;
    try {
      jobs = (await hermesGet(`${profilePrefix(bot)}/api/jobs?include_disabled=true`))?.jobs;
    } catch (e) {
      log.warn('routines_poll_failed', { bot, error: failReason(e) });
      return false;
    }
    if (!Array.isArray(jobs)) {
      log.warn('routines_poll_failed', { bot, error: 'no_job_list' });
      return false;
    }
    const t = now();
    const prev = state.bots[bot];
    const baseline = !prev;
    const baselineAt = prev?.baselineAt ?? t;
    /** @type {Record<string, string>} */
    const checkpoints = {};
    /** @type {{job: any, lr: string, unread: boolean, prevCp: string|undefined}[]} */
    const runs = [];
    const retentionMs = settings.retentionDays * 86_400_000;
    for (const raw of jobs) {
      const job = obj(raw);
      if (!job || typeof job.id !== 'string' || !JOB_ID.test(job.id) || job.id in checkpoints) continue;
      const lr = isoOk(job.last_run_at) ? job.last_run_at : '';
      const cp = prev?.jobs[job.id];
      if (baseline) {
        checkpoints[job.id] = lr;
        if (lr && Date.parse(lr) >= t - retentionMs) runs.push({ job, lr, unread: false, prevCp: undefined });
        continue;
      }
      if (cp === lr || !lr) { checkpoints[job.id] = lr; continue; }
      // the run that set last_run_at is over, but a next execution may already be claimed: wait for that one too
      if (RUNNING.has(String(obj(job.latest_execution)?.status ?? ''))) {
        if (cp !== undefined) checkpoints[job.id] = cp;
        continue;
      }
      // a job seen for the first time after the baseline: unread only when its run is newer than the baseline
      runs.push({ job, lr, unread: cp !== undefined || Date.parse(lr) > baselineAt, prevCp: cp });
    }
    let todo;
    if (baseline) todo = runs.sort((a, b) => Date.parse(b.lr) - Date.parse(a.lr)).slice(0, BACKFILL_MAX);
    else {
      runs.sort((a, b) => Date.parse(a.lr) - Date.parse(b.lr));
      todo = runs.slice(0, RUNS_PER_POLL);
      for (const r of runs.slice(RUNS_PER_POLL)) if (r.prevCp !== undefined) checkpoints[r.job.id] = r.prevCp; // next poll
    }
    const known = new Set(state.items.map((it) => it.id));
    const usedSessions = new Set(state.items.filter((it) => it.hermesProfile === bot && it.sessionId).map((it) => it.sessionId));
    const ctx = { sessions: null, usedSessions };
    const fresh = [];
    for (const r of todo) {
      const id = entryId(bot, r.job.id, r.lr);
      if (known.has(id)) { checkpoints[r.job.id] = r.lr; continue; } // duplicate poll / restart: already stored
      const built = await buildEntry(bot, r.job, r.lr, r.prevCp, r.unread ? null : t, ctx);
      if ('retry' in built) {
        if (baseline) return false; // the baseline is all or nothing: try again next poll
        if (r.prevCp !== undefined) checkpoints[r.job.id] = r.prevCp;
        continue;
      }
      checkpoints[r.job.id] = r.lr;
      // delivered into the bot's Bot Chat: the push comes from the Bot Chat watcher (src/push-hermes.mjs), not twice
      if (/^bot-chat\b/i.test(String(r.job.deliver ?? ''))) botChatEntries.add(built.entry.id);
      fresh.push(built.entry);
    }
    // commit (synchronously from the current state, so read marks made meanwhile are kept), then announce
    const ids = new Set(state.items.map((it) => it.id));
    const added = fresh.filter((e) => !ids.has(e.id));
    const bots = { ...state.bots, [bot]: { baselineAt, jobs: checkpoints } }; // jobs that disappeared lose their checkpoint
    const overhead = Buffer.byteLength(JSON.stringify({ v: 1, bots, items: [] }));
    const items = applyRetention([...state.items, ...added], { nowMs: now(), days: settings.retentionDays, maxItems: settings.maxItems, overhead });
    const next = { v: 1, bots, items };
    // the file holds result texts (up to a few MiB): rewrite it only when something changed, not on every poll
    const same = !baseline && !added.length && items.length === state.items.length && sameCheckpoints(prev.jobs, checkpoints);
    if (same) return true;
    if (!persist(next)) return false; // nothing announced, checkpoints unchanged: the next poll retries
    state = next;
    const kept = new Set(items.map((it) => it.id));
    const announce = added.filter((e) => kept.has(e.id) && e.readAt === null && e.status !== 'silent');
    log.info('routines_poll', { bot, jobs: jobs.length, added: added.length, announced: announce.length, ...(baseline ? { baseline: true } : {}) });
    for (const e of announce) announceEntry(e);
    return true;
  }

  /** entries of jobs that deliver into a Bot Chat: stored and hinted live, never pushed here */
  const botChatEntries = new Set();

  /** Live inbox hint (no content) + push to registrations with `routines` in scope and read on the bot. */
  function announceEntry(e) {
    const service = o.push?.service;
    if (!service) return;
    service.inbox.publish(OWNER, { id: e.id, hermesProfile: e.hermesProfile, jobId: e.jobId, status: e.status, source: 'routines' }, 'hui.routine');
    if (!service.canPush || botChatEntries.delete(e.id)) return;
    const bot = e.hermesProfile;
    void service.notifier.notify({
      user: OWNER,
      key: `routine|${e.id}`,
      threadKey: `routine|${bot}|${e.jobId}`,
      kind: 'routine',
      status: e.status,
      title: e.title,
      text: e.summary,
      previewDefault: o.push?.previewDefault ?? false,
      data: { src: 'hermes', ...(bot !== DEFAULT_PROFILE ? { hermesProfile: bot } : {}), jobId: e.jobId, itemId: e.id },
      // NOT dispatch(): a live stream on one device must not suppress another device's push
      match: (reg) => reg.enabled !== false && Array.isArray(reg.scope?.sources) && reg.scope.sources.includes('routines')
        && rights.rightOfCredential(reg.credential, bot) !== 'none',
    }).then((r) => log.info('routines_push', { bot, sent: r.sent, failed: r.failed, ...(r.skipped ? { skipped: r.skipped } : {}) }))
      .catch((err) => log.warn('routines_push_failed', { error: String(err?.message ?? err).slice(0, 80) }));
  }

  let polling = null;
  async function pollOnce() {
    if (rights.mode === 'off') return;
    const bots = polledBots();
    // a bot that is no longer enabled loses its checkpoints (entries stay): enabling it again starts with a baseline,
    // so runs from the disabled time are imported read instead of pushed in a burst
    const stale = Object.keys(state.bots).filter((b) => !rights.isEnabled(b));
    if (stale.length) {
      const nextBots = { ...state.bots };
      for (const b of stale) delete nextBots[b];
      const next = { ...state, bots: nextBots };
      if (persist(next)) state = next;
    }
    for (const bot of bots) await pollBot(bot);
  }
  function poll() {
    if (!polling) polling = pollOnce().catch((e) => log.warn('routines_poll_error', { error: String(e?.message ?? e).slice(0, 80) })).finally(() => { polling = null; });
    return polling;
  }
  let timer = null;
  let running = false;
  function schedule(ms) {
    if (!running) return;
    timer = setTimeout(async () => {
      timer = null;
      await poll();
      schedule(settings.pollMs);
    }, ms);
    timer.unref?.();
  }

  // ---------- HTTP ----------
  const sendJson = (req, res, status, body) => {
    applyCors(config.corsOrigins, req, res);
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': buf.length, 'cache-control': 'no-store', 'x-hermes-ui-bridge': '1' });
    res.end(buf);
  };
  const fail = (req, res, status, message, code, type = 'invalid_request_error') => sendJson(req, res, status, { error: { message, type, code } });

  /** @returns {Promise<{ok: true, body: Record<string, any>} | {ok: false}>} */
  async function readBody(req, res, allowed) {
    const tooLarge = () => {
      res.setHeader('connection', 'close');
      fail(req, res, 413, 'Request body too large', 'payload_too_large');
      return /** @type {const} */ ({ ok: false });
    };
    if (Number(req.headers['content-length']) > BODY_MAX) { req.resume(); return tooLarge(); }
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
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = null; }
    if (!obj(body)) {
      fail(req, res, 400, 'Body must be a JSON object', 'invalid_json');
      return { ok: false };
    }
    const unknown = Object.keys(body).find((k) => !allowed.includes(k));
    if (unknown) {
      fail(req, res, 400, `Unsupported field ${unknown.slice(0, 40)}`, 'unsupported_field');
      return { ok: false };
    }
    return { ok: true, body };
  }

  /** `default` or an allowed profile; else answers 400 / 404 and returns null. */
  function botOf(req, res, name) {
    if (typeof name !== 'string' || !name) {
      fail(req, res, 400, 'hermesProfile is required (default or a profile name)', 'missing_profile');
      return null;
    }
    if (name !== DEFAULT_PROFILE && !o.profiles.allowed(name)) {
      fail(req, res, 404, 'Not found', 'unknown_profile');
      return null;
    }
    return name;
  }

  /** Refused access → answered (404 routines_off / 403 routines_forbidden). @returns {boolean} true when answered */
  function refused(req, res, grant) {
    if (grant.code === 'routines_off') { fail(req, res, 404, 'Routines are disabled for this bot', 'routines_off'); return true; }
    if (grant.right === 'none') { fail(req, res, 403, 'This device may not use routines of this bot', 'routines_forbidden'); return true; }
    return false;
  }

  const unreadCount = (bot) => state.items.reduce((n, it) => n + (it.hermesProfile === bot && it.readAt === null ? 1 : 0), 0);
  const findItem = (bot, id) => state.items.find((it) => it.id === id && it.hermesProfile === bot) ?? null;

  /** Change read marks in place and persist; reverted when the write fails. @returns {boolean} */
  function setRead(list, read) {
    const before = list.map((it) => it.readAt);
    const t = now();
    for (const it of list) it.readAt = read ? it.readAt ?? t : null;
    if (persist(state)) return true;
    list.forEach((it, i) => { it.readAt = before[i]; });
    return false;
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://bridge');
    const p = url.pathname;
    const who = checkWho(req);
    if (!who) {
      req.resume();
      return fail(req, res, 401, 'Invalid bridge token', 'invalid_api_key');
    }
    const item = ITEM_RE.exec(p);
    const route = p === CAPS_PATH ? 'caps' : p === LIST_PATH ? 'list' : p === READ_ALL_PATH ? 'readAll' : item ? 'item' : null;
    if (!route) {
      req.resume();
      return fail(req, res, 404, 'Not found', 'not_found');
    }
    const methods = { caps: ['GET'], list: ['GET'], readAll: ['POST'], item: ['GET', 'PATCH'] }[route];
    if (!methods.includes(req.method ?? '')) {
      req.resume();
      res.setHeader('allow', methods.join(', '));
      return fail(req, res, 405, 'Method not allowed', 'method_not_allowed');
    }

    if (req.method === 'GET') {
      req.resume();
      const bot = botOf(req, res, url.searchParams.get('hermesProfile'));
      if (!bot) return;
      const grant = rights.access(who, bot);
      if (route === 'caps') {
        const available = grant.right !== 'none';
        const reasons = [...grant.reasons, ...(available && !file ? ['inbox_memory_only'] : [])];
        return sendJson(req, res, 200, {
          version: 1,
          hermesProfile: bot,
          available,
          rights: grant.right,
          mode: rights.mode,
          inbox: { available, durable: Boolean(file), retentionDays: settings.retentionDays, maxItems: settings.maxItems },
          push: { available: available && Boolean(o.push?.service?.canPush) },
          features: { crud: false, preservePausedRun: false, runLedger: false, timezone: false },
          reasons,
        });
      }
      if (refused(req, res, grant)) return;
      if (route === 'item') {
        const it = findItem(bot, item[1]);
        if (!it) return fail(req, res, 404, 'Inbox entry not found', 'item_not_found');
        return sendJson(req, res, 200, { item: { ...summaryView(it), text: it.text, truncated: it.truncated, ...(it.error ? { error: it.error } : {}) } });
      }
      const filter = url.searchParams.get('filter') ?? 'all';
      if (filter !== 'all' && filter !== 'unread') return fail(req, res, 400, 'filter must be all or unread', 'invalid_filter');
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit === null ? 50 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return fail(req, res, 400, 'limit must be 1..100', 'invalid_limit');
      let list = state.items.filter((it) => it.hermesProfile === bot && (filter === 'all' || it.readAt === null)).sort(newestFirst);
      const before = url.searchParams.get('before');
      if (before !== null) {
        const anchor = ENTRY_ID.test(before) ? findItem(bot, before) : null;
        if (!anchor) return fail(req, res, 400, 'Unknown cursor', 'invalid_cursor');
        list = list.filter((it) => newestFirst(anchor, it) < 0);
      }
      const page = list.slice(0, limit);
      return sendJson(req, res, 200, {
        items: page.map(summaryView),
        unreadCount: unreadCount(bot),
        nextCursor: list.length > limit ? page.at(-1).id : null,
      });
    }

    const parsed = await readBody(req, res, route === 'item' ? ['hermesProfile', 'read'] : ['hermesProfile']);
    if (!parsed.ok) return;
    const bot = botOf(req, res, parsed.body.hermesProfile);
    if (!bot) return;
    if (refused(req, res, rights.access(who, bot))) return;
    if (route === 'item') {
      if (typeof parsed.body.read !== 'boolean') return fail(req, res, 400, 'read must be true or false', 'invalid_request');
      const it = findItem(bot, item[1]);
      if (!it) return fail(req, res, 404, 'Inbox entry not found', 'item_not_found');
      if (!setRead([it], parsed.body.read)) return fail(req, res, 503, 'Cannot save the inbox, try again', 'store_unavailable', 'bridge_error');
      return sendJson(req, res, 200, { item: summaryView(it), unreadCount: unreadCount(bot) });
    }
    const unread = state.items.filter((it) => it.hermesProfile === bot && it.readAt === null);
    if (unread.length && !setRead(unread, true)) return fail(req, res, 503, 'Cannot save the inbox, try again', 'store_unavailable', 'bridge_error');
    return sendJson(req, res, 200, { updated: unread.length, unreadCount: unreadCount(bot) });
  }

  return {
    durable: Boolean(file),
    file,
    pollNow: () => poll(),
    /** The reconciler covers this bot (src/push-hermes.mjs then skips its cron sessions for routines registrations). */
    covers: (bot) => rights.mode !== 'off' && polledBots().includes(bot),
    /** Test / debug view (content included: never logged). */
    state: () => state,
    matches(req) {
      if (req.method === 'OPTIONS') return false; // CORS preflight: bridge handler
      const p = (req.url ?? '').split('?')[0];
      return p.startsWith(ROUTINES_PREFIX) && p !== '/bridge/routines/rights';
    },
    handle,
    start() {
      if (running) return;
      running = true;
      schedule(Math.min(FIRST_POLL_MS, settings.pollMs));
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
