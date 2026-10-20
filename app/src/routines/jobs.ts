/**
 * Routines, slice 1: read-only view and basic controls over Hermes' own cron jobs (the job API of Hermes Agent v0.22).
 * Pure, erasable TS (node:test); the fetch implementation is injected like hermes/sessions.ts.
 *
 * Verified against NousResearch/hermes-agent v0.22.2 (gateway/platforms/api_server.py `_http_route_table`,
 * `_handle_*_job`; cron/jobs.py `list_jobs`, `pause_job`, `resume_job`, `trigger_job`):
 *
 *   GET  /api/jobs?include_disabled=true → {jobs:[Job]}   (without the flag paused jobs are left out)
 *   GET  /api/jobs/{id}                  → {job}           id = 12 hex chars, unknown → 404
 *   POST /api/jobs/{id}/pause | /resume  → {job}
 *   POST /api/jobs/{id}/run              → {job}           queues the job for the next scheduler tick (~60 s). It ALSO
 *                                                          resumes a paused job and refuses completed/error jobs.
 * Mirrored under /p/<bot>/… (the bot's own job store). Cron module missing → 501, older Hermes → plain 404.
 *
 * The UI bridge passes exactly these routes through (bridge/src/jobs.mjs), strips private fields (delivery chat ids,
 * origin, work dir, script paths) and adds `hui.routines` (`control` | `read`). Direct Hermes connections return the
 * raw record; both shapes are read here. Creating and editing jobs is not part of this slice.
 */
import { HermesError, type FetchLike } from '../hermes/stream.ts';
import { createJsonRequest, type ApiConn } from '../hermes/sessions.ts';
import { parseRights, type RoutinesRights } from './rights.ts';

export const JOB_ID_RE = /^[a-f0-9]{12}$/;

export type JobScheduleKind = 'once' | 'interval' | 'cron' | 'unknown';

export type JobSchedule = {
  kind: JobScheduleKind;
  /** cron: 5 (or 6) field expression, evaluated in the bot's configured time zone */
  expr?: string;
  /** interval: minutes between runs (elapsed time) */
  minutes?: number;
  /** once: ISO instant with offset */
  runAt?: string;
  /** Hermes' own label ("every 30m", "once at 2026-10-20 09:00", the original phrase) */
  display?: string;
};

/** What the latest execution record of the job says (cron/executions.py). */
export type JobExecution = {
  status: 'claimed' | 'running' | 'completed' | 'failed' | 'unknown' | string;
  source?: string;
  claimedAt?: string;
  startedAt?: string;
  finishedAt?: string;
};

export type RoutineJob = {
  id: string;
  name: string;
  prompt: string;
  skills: string[];
  schedule: JobSchedule;
  enabled: boolean;
  /** Hermes' effective state: scheduled | paused | running | completed | error | … */
  state: string;
  pausedAt?: string;
  pausedReason?: string;
  createdAt?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  /** "ok" | "error" | … as stored by the scheduler */
  lastStatus?: string;
  lastError?: string;
  lastDeliveryError?: string;
  failureStreak: number;
  repeat?: { times: number | null; completed: number };
  model?: string;
  provider?: string;
  /** a script job without an agent turn */
  noAgent: boolean;
  /** delivery targets reduced to their platform: "local", "origin", "telegram", "telegram,discord" … */
  deliverKind?: string;
  /** where the job was created: "telegram", "cli", "api_server" … */
  originPlatform?: string;
  latestExecution?: JobExecution;
};

/** `control`: list + pause/resume/run; `read`: list only (bridge BRIDGE_ROUTINES=read). Direct Hermes: control. */
export type RoutinesAccess = 'control' | 'read';

/**
 * `rights`: the bridge's per-device answer (slice 2, `hui.rights`); absent on slice-1 bridges and direct Hermes, then
 * derived from `access`. `access` stays `control` exactly when the rights are `manage`.
 */
export type JobList = { jobs: RoutineJob[]; access: RoutinesAccess; rights: RoutinesRights };

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 5000): string | undefined => (typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** "telegram:-100…:7, origin" → "telegram,origin": never keeps a chat id (also for direct Hermes records). */
export function deliverKindOf(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const kinds: string[] = [];
  for (const part of raw.split(',')) {
    const k = part.trim().split(':')[0]?.trim().toLowerCase();
    if (k && /^[a-z0-9_-]{1,40}$/.test(k) && !kinds.includes(k)) kinds.push(k);
  }
  return kinds.length ? kinds.join(',') : undefined;
}

function parseSchedule(raw: unknown, display: unknown): JobSchedule {
  const s = isObj(raw) ? raw : {};
  const kind = s.kind === 'once' || s.kind === 'interval' || s.kind === 'cron' ? s.kind : 'unknown';
  const out: JobSchedule = { kind };
  const expr = str(s.expr, 200);
  if (expr) out.expr = expr.trim();
  const minutes = num(s.minutes);
  if (minutes !== undefined && minutes > 0) out.minutes = minutes;
  const runAt = str(s.run_at, 64);
  if (runAt) out.runAt = runAt;
  const d = str(display, 200) ?? str(s.display, 200);
  if (d) out.display = d.trim();
  return out;
}

function parseExecution(raw: unknown): JobExecution | undefined {
  if (!isObj(raw)) return undefined;
  const status = str(raw.status, 40);
  if (!status) return undefined;
  const out: JobExecution = { status };
  const source = str(raw.source, 40);
  if (source) out.source = source;
  const claimedAt = str(raw.claimed_at, 64);
  if (claimedAt) out.claimedAt = claimedAt;
  const startedAt = str(raw.started_at, 64);
  if (startedAt) out.startedAt = startedAt;
  const finishedAt = str(raw.finished_at, 64);
  if (finishedAt) out.finishedAt = finishedAt;
  return out;
}

export function parseJob(raw: unknown): RoutineJob | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 64);
  if (!id) return null;
  const enabled = raw.enabled !== false;
  const job: RoutineJob = {
    id,
    name: str(raw.name, 200)?.trim() || id,
    prompt: str(raw.prompt) ?? '',
    skills: Array.isArray(raw.skills) ? raw.skills.filter((x): x is string => typeof x === 'string' && !!x).slice(0, 20) : [],
    schedule: parseSchedule(raw.schedule, raw.schedule_display),
    enabled,
    state: str(raw.state, 40) ?? (enabled ? 'scheduled' : 'paused'),
    failureStreak: Math.max(0, Math.floor(num(raw.failure_streak) ?? 0)),
    noAgent: raw.no_agent === true,
  };
  const opt: [keyof RoutineJob, unknown, number][] = [
    ['pausedAt', raw.paused_at, 64],
    ['pausedReason', raw.paused_reason, 300],
    ['createdAt', raw.created_at, 64],
    ['nextRunAt', raw.next_run_at, 64],
    ['lastRunAt', raw.last_run_at, 64],
    ['lastStatus', raw.last_status, 40],
    ['lastError', raw.last_error, 500],
    ['lastDeliveryError', raw.last_delivery_error, 500],
    ['model', raw.model, 120],
    ['provider', raw.provider, 80],
  ];
  for (const [k, v, max] of opt) {
    const s = str(v, max);
    if (s) (job as Record<string, unknown>)[k] = s;
  }
  if (isObj(raw.repeat)) {
    const times = num(raw.repeat.times);
    job.repeat = { times: times === undefined ? null : times, completed: Math.max(0, Math.floor(num(raw.repeat.completed) ?? 0)) };
  }
  const deliverKind = str(raw.deliver_kind, 200) ?? deliverKindOf(raw.deliver);
  if (deliverKind) job.deliverKind = deliverKind;
  const origin = str(raw.origin_platform, 40) ?? (isObj(raw.origin) ? str(raw.origin.platform, 40) : undefined);
  if (origin) job.originPlatform = origin;
  const exec = parseExecution(raw.latest_execution);
  if (exec) job.latestExecution = exec;
  return job;
}

export function parseJobList(json: unknown): JobList {
  const j = isObj(json) ? json : {};
  const list = Array.isArray(j.jobs) ? j.jobs : [];
  const hui = isObj(j.hui) ? j.hui : {};
  const fromServer = parseRights(hui.rights);
  const rights: RoutinesRights = fromServer ?? (hui.routines === 'read' ? 'read' : 'manage');
  // the stricter of both wins (a bridge that says `routines: read` never gets controls through `rights`)
  const access: RoutinesAccess = rights === 'manage' && hui.routines !== 'read' ? 'control' : 'read';
  return { jobs: list.map(parseJob).filter((x): x is RoutineJob => !!x), access, rights: access === 'control' ? 'manage' : rights === 'none' ? 'none' : 'read' };
}

/**
 * The server has no Routines at all: older Hermes without `/api/jobs` (plain 404), cron module missing (501),
 * bridge with BRIDGE_ROUTINES=off (404 `routines_off`), a bridge older than this slice (404). 401/403/network
 * errors are NOT "unsupported": the entry must not vanish because of a flaky connection.
 */
export function isRoutinesUnsupported(e: unknown): boolean {
  if (!(e instanceof HermesError)) return false;
  if (e.status === 501 || e.status === 405) return true;
  return e.status === 404 && e.code !== 'job_not_found';
}

export type JobAction = 'pause' | 'resume' | 'run';

export function createJobsClient(fetchImpl: FetchLike, conn: ApiConn, timeoutMs = 15000) {
  const request = createJsonRequest(fetchImpl, conn, timeoutMs);
  const jobPath = (id: string) => {
    if (!JOB_ID_RE.test(id)) throw new HermesError('bad_request', 'invalid job id');
    return `/api/jobs/${id}`;
  };
  const one = (j: unknown): RoutineJob => {
    const job = parseJob(isObj(j) ? j.job : undefined);
    if (!job) throw new HermesError('server', 'invalid job response');
    return job;
  };
  return {
    async list(): Promise<JobList> {
      return parseJobList(await request('GET', '/api/jobs?include_disabled=true'));
    },
    async get(id: string): Promise<RoutineJob> {
      return one(await request('GET', jobPath(id)));
    },
    /**
     * `run` on a paused job resumes it as a side effect of Hermes' trigger_job: the caller must have confirmed that
     * (`resumePaused`); the bridge refuses it otherwise (409 job_paused). Never sends a one-run prompt.
     */
    async act(id: string, action: JobAction, opts: { resumePaused?: boolean } = {}): Promise<RoutineJob> {
      const body = action === 'run' && opts.resumePaused ? { resume_paused: true } : {};
      return one(await request('POST', `${jobPath(id)}/${action}`, body));
    },
  };
}

export type JobsClient = ReturnType<typeof createJobsClient>;
