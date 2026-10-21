/**
 * Keeps the device copy of a Hermes reminder ("Auch auf diesem Gerät erinnern", deviceReminder.ts) in line with the
 * Hermes job, and tells the reminder card what happened to the job afterwards. Two sources, both pure here:
 * - chat turns: a successful `cronjob_manage` remove / pause / update / resume of the job (the user wrote "lösch die
 *   Erinnerung", the card's own Delete button only sends that message),
 * - the job list (`GET /api/jobs`, routines/jobs.ts) on app start / chat open: a job that is gone, paused or moved
 *   elsewhere (another chat, Telegram, the Hermes dashboard).
 * Only a known state changes a device copy: a turn without a result, a failed call or an unreadable list changes nothing.
 * Newer information wins (`at`), so turns seen out of order (history pages) never undo a later change.
 * The impure side (notifications, storage, fetching) is reminderSyncStore.ts. Tests: reminderSync.test.ts.
 */
import type { ToolEvent } from '../hermes/types.ts';
import { parseJobList, type RoutineJob } from '../routines/jobs.ts';
import { deviceCopies, moveDeviceReminder, type DeviceNotifier } from './deviceReminder.ts';
import { cronAction, hermesToolKind, toolInput, toolOutput } from './hermesTools.ts';
import { isRecurringSchedule, parseNextRun } from './reminder.ts';

/** A pending device copy as deviceReminder.ts tagged it. `src`/`conn`/`bot` are missing on copies made by 0.2.0. */
export type DeviceCopy = {
  /** notification id */
  id: string;
  /** Hermes job id (or the tool call id when the result had none) */
  key: string;
  at: number;
  title?: string;
  body?: string;
  /** job name when the copy was set (rename detection) */
  name?: string;
  /** app connection id, Hermes profile ("" = default) and API root of that bot when the copy was set */
  conn?: string;
  bot?: string;
  src?: string;
};

export type CronChange =
  | { jobId: string; at: number; kind: 'removed' | 'paused' }
  /** update / resume: the job runs (again), next at `nextRun` (undefined: the result did not say) */
  | { jobId: string; at: number; kind: 'scheduled'; nextRun?: number; recurring: boolean; name?: string };

/** What the card shows about its job after the reminder was set. */
export type ReminderFate = {
  jobId: string;
  status: 'removed' | 'paused' | 'active';
  /** when Hermes' state was seen (tool call / list time, ms): newer wins */
  at: number;
  via: 'chat' | 'server';
  /** what the sync did with the device copy: removed it, or moved it to `deviceAt` */
  device?: 'removed' | 'moved';
  deviceAt?: number;
};

export type DeviceStep = { kind: 'cancel'; copy: DeviceCopy } | { kind: 'move'; copy: DeviceCopy; at: number; name?: string };

export type SyncPlan = { steps: DeviceStep[]; fates: ReminderFate[] };

const JOB_ID = /^[a-f0-9]{12}$/;
/** a device copy needs the reminder at least a minute ahead (reminder.ts deviceReminderAt) */
const LEAD_MS = 60_000;
/** times closer than this are the same reminder (Hermes' seconds vs. the copy's) */
const SAME_MS = 60_000;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

/**
 * Job changes in one turn's tool calls: finished, successful, with the job id. `fallbackAt`: the message time when a
 * call has no timestamps. `create`, `list` and `run` change nothing for a device copy.
 */
export function parseCronChanges(tools: readonly ToolEvent[], fallbackAt = 0): CronChange[] {
  const out: CronChange[] = [];
  for (const ev of tools) {
    if (hermesToolKind(ev.name) !== 'cron' || ev.status !== 'done' || ev.detail?.cancelled) continue;
    const action = cronAction(ev);
    if (action !== 'remove' && action !== 'pause' && action !== 'update' && action !== 'resume') continue;
    const output = toolOutput(ev);
    if (!output || output.success !== true || str(output.error)) continue;
    const input = toolInput(ev);
    const job = obj(output.job);
    const removed = obj(output.removed_job);
    const jobId = str(input?.job_id) ?? str(job?.job_id) ?? str(job?.id) ?? str(removed?.id) ?? str(output.job_id);
    if (!jobId) continue;
    const at = ev.endedAt ?? ev.startedAt ?? fallbackAt;
    if (action === 'remove') out.push({ jobId, at, kind: 'removed' });
    else if (action === 'pause') out.push({ jobId, at, kind: 'paused' });
    else {
      // a paused job stays paused by an update; resume / update of a running job: the job's next run
      if (job?.enabled === false || str(job?.state) === 'paused') {
        out.push({ jobId, at, kind: 'paused' });
        continue;
      }
      const schedule = str(job?.schedule_display) ?? str(job?.schedule) ?? str(output.schedule) ?? str(input?.schedule);
      const name = str(job?.name) ?? str(output.name);
      out.push({ jobId, at, kind: 'scheduled', nextRun: parseNextRun(job?.next_run_at ?? output.next_run_at), recurring: isRecurringSchedule(schedule), ...(name ? { name } : {}) });
    }
  }
  return out;
}

/** The newest change per job (ties: the later one in the list). */
function latest(changes: readonly CronChange[]): Map<string, CronChange> {
  const m = new Map<string, CronChange>();
  for (const c of changes) {
    const prev = m.get(c.jobId);
    if (!prev || c.at >= prev.at) m.set(c.jobId, c);
  }
  return m;
}

/**
 * Where the copy goes when the job runs at `nextRun`: null = keep it. Moved when the time differs (a one-shot still a
 * minute ahead) or the name changed; removed when the job now repeats (a copy mirrors one run only). An unknown or
 * already passed time keeps the copy: it fires about when Hermes does.
 */
function follow(copy: DeviceCopy, next: { nextRun?: number; recurring: boolean; name?: string }, now: number): DeviceStep | null {
  if (next.recurring) return { kind: 'cancel', copy };
  if (next.nextRun === undefined || next.nextRun <= now + LEAD_MS) return null;
  const renamed = !!next.name && !!copy.name && next.name !== copy.name;
  if (Math.abs(next.nextRun - copy.at) < SAME_MS && !renamed) return null;
  return { kind: 'move', copy, at: next.nextRun, ...(renamed ? { name: next.name } : {}) };
}

function fateOf(jobId: string, status: ReminderFate['status'], at: number, via: ReminderFate['via'], step: DeviceStep | null): ReminderFate {
  const f: ReminderFate = { jobId, status, at, via };
  if (step?.kind === 'cancel') f.device = 'removed';
  else if (step?.kind === 'move') {
    f.device = 'moved';
    f.deviceAt = step.at;
  }
  return f;
}

/** Device steps + card states for the job changes of the chat's turns. Changes not newer than the known fate are skipped. */
export function planTurnSync(changes: readonly CronChange[], copies: readonly DeviceCopy[], fates: ReadonlyMap<string, ReminderFate>, now: number): SyncPlan {
  const plan: SyncPlan = { steps: [], fates: [] };
  for (const c of latest(changes).values()) {
    const known = fates.get(c.jobId);
    if (known && known.at >= c.at) continue;
    const copy = copies.find((x) => x.key === c.jobId);
    let step: DeviceStep | null = null;
    if (c.kind === 'scheduled') step = copy ? follow(copy, c, now) : null;
    else step = copy ? { kind: 'cancel', copy } : null;
    if (step) plan.steps.push(step);
    plan.fates.push(fateOf(c.jobId, c.kind === 'scheduled' ? 'active' : c.kind, c.at, 'chat', step));
  }
  return plan;
}

const ms = (iso: string | undefined): number | undefined => (iso ? parseNextRun(iso) : undefined);

/**
 * Device steps + card states from a job list that was read successfully (never call it after an error: an unknown
 * state must not cancel anything). `copies`: only those known to belong to this list's Hermes bot. A job that is gone
 * → removed; paused → removed from the device; moved / renamed → the copy follows; completed / failed / running jobs
 * and copies without a Hermes job id stay as they are.
 */
export function planServerSync(jobs: readonly RoutineJob[], copies: readonly DeviceCopy[], fates: ReadonlyMap<string, ReminderFate>, now: number): SyncPlan {
  const plan: SyncPlan = { steps: [], fates: [] };
  const byId = new Map(jobs.map((j) => [j.id, j]));
  for (const copy of copies) {
    if (!JOB_ID.test(copy.key)) continue;
    const known = fates.get(copy.key);
    if (known && known.at > now) continue;
    const job = byId.get(copy.key);
    let status: ReminderFate['status'] = 'active';
    let step: DeviceStep | null = null;
    if (!job) {
      status = 'removed';
      step = { kind: 'cancel', copy };
    } else if (!job.enabled && (job.state === 'paused' || !!job.pausedAt)) {
      status = 'paused';
      step = { kind: 'cancel', copy };
    } else if (job.enabled && job.state === 'scheduled') {
      const kind = job.schedule.kind;
      if (kind === 'unknown') continue;
      step = follow(copy, { nextRun: ms(job.nextRunAt) ?? ms(job.schedule.runAt), recurring: kind !== 'once', name: job.name }, now);
    } else continue;
    if (!step && (known?.status ?? 'active') === status) continue;
    if (step) plan.steps.push(step);
    plan.fates.push(fateOf(copy.key, status, now, 'server', step));
  }
  return plan;
}

/** Carry out the device steps of a plan. `title`: notification title for a moved copy that has none. */
export async function runSteps(n: DeviceNotifier, steps: readonly DeviceStep[], title: string): Promise<void> {
  for (const s of steps) {
    if (s.kind === 'cancel') await n.cancel(s.copy.id);
    else await moveDeviceReminder(n, s.copy, { at: s.at, name: s.name }, title);
  }
}

/**
 * Check the device copies `owns` picks against a job list. null: nothing to check, or the list could not be read
 * (offline, routines off for this device or bot, older Hermes, 401): an unknown state never cancels anything. Only
 * copies that already existed when the list was asked for are judged (a copy set meanwhile belongs to a job the list
 * may not have yet).
 */
export async function checkAgainstJobs(o: {
  notifier: DeviceNotifier;
  /** raw `GET /api/jobs?include_disabled=true` body */
  list: () => Promise<unknown>;
  owns: (c: DeviceCopy) => boolean;
  fates: ReadonlyMap<string, ReminderFate>;
  now: number;
}): Promise<SyncPlan | null> {
  const before = (await deviceCopies(o.notifier)).filter((c) => o.owns(c) && JOB_ID.test(c.key));
  if (!before.length) return null;
  let raw: unknown;
  try {
    raw = await o.list();
  } catch {
    return null;
  }
  // only a body that really carries a job list: a 200 without `jobs` (a proxy page, `{}`) is not "no jobs"
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { jobs?: unknown }).jobs)) return null;
  const jobs = parseJobList(raw).jobs;
  const ids = new Set(before.map((c) => c.id));
  const copies = (await deviceCopies(o.notifier)).filter((c) => ids.has(c.id));
  return planServerSync(jobs, copies, o.fates, o.now);
}

/** Merge new fates into the known ones (newer wins), dropping entries older than `maxAgeMs`, at most `max` (newest kept). */
export function mergeFates(known: ReadonlyMap<string, ReminderFate>, add: readonly ReminderFate[], now: number, maxAgeMs = 90 * 86_400_000, max = 300): Map<string, ReminderFate> {
  const m = new Map(known);
  for (const f of add) {
    const prev = m.get(f.jobId);
    if (!prev || f.at >= prev.at) m.set(f.jobId, f);
  }
  const list = [...m.values()].filter((f) => now - f.at <= maxAgeMs).sort((a, b) => b.at - a.at).slice(0, max);
  return new Map(list.map((f) => [f.jobId, f]));
}

/** Stored fates (JSON) → map; anything malformed is dropped. */
export function parseFates(json: unknown): Map<string, ReminderFate> {
  const m = new Map<string, ReminderFate>();
  if (!Array.isArray(json)) return m;
  for (const x of json) {
    const o = obj(x);
    if (!o) continue;
    const jobId = str(o.jobId);
    const status = o.status === 'removed' || o.status === 'paused' || o.status === 'active' ? o.status : undefined;
    const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : undefined;
    if (!jobId || !status || at === undefined) continue;
    const f: ReminderFate = { jobId, status, at, via: o.via === 'server' ? 'server' : 'chat' };
    if (o.device === 'removed' || o.device === 'moved') f.device = o.device;
    if (typeof o.deviceAt === 'number' && Number.isFinite(o.deviceAt)) f.deviceAt = o.deviceAt;
    m.set(jobId, f);
  }
  return m;
}

/**
 * What the card says about its job: null = nothing (the job is as the card shows it). `moved` only for the copy the
 * sync moved (a newer card in the chat shows the new time itself).
 */
export type FateNote = { kind: 'removed' | 'paused'; device: boolean } | { kind: 'moved'; at: number } | { kind: 'deviceStopped' };

export function fateNote(f: ReminderFate | undefined, card: { nextRun?: number }): FateNote | null {
  if (!f) return null;
  if (f.status === 'removed' || f.status === 'paused') return { kind: f.status, device: f.device === 'removed' };
  if (f.device === 'removed') return { kind: 'deviceStopped' };
  if (f.device === 'moved' && f.deviceAt !== undefined && (card.nextRun === undefined || Math.abs(card.nextRun - f.deviceAt) >= SAME_MS)) return { kind: 'moved', at: f.deviceAt };
  return null;
}
