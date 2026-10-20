/**
 * What a Routine row says about a Hermes job: its group in the list, the outcome of the last run and which controls
 * make sense. Pure, erasable TS.
 *
 * Hermes v0.22.2 (cron/jobs.py `effective_job_state`, `_stamp_run_result`): `state` is scheduled | paused | running |
 * completed | error, derived from `enabled` (an enabled job never reads "paused"); `last_status` is ok | error |
 * delivery_failed | blocked_config; `failure_streak` counts failed runs in a row and resets on success.
 */
import type { RoutineJob } from './jobs.ts';

export type RoutineGroup = 'attention' | 'active' | 'paused' | 'completed';
export const GROUP_ORDER: readonly RoutineGroup[] = ['attention', 'active', 'paused', 'completed'];

export type LastOutcome = 'ok' | 'failed' | 'deliveryFailed' | 'blocked' | 'none' | 'other';

export function isRunning(job: RoutineJob): boolean {
  const s = job.latestExecution?.status;
  return job.state === 'running' || s === 'claimed' || s === 'running';
}

export function isCompleted(job: RoutineJob): boolean {
  return job.state === 'completed';
}

export function isPaused(job: RoutineJob): boolean {
  return !isCompleted(job) && job.state !== 'error' && (!job.enabled || job.state === 'paused');
}

export function lastOutcome(job: RoutineJob): LastOutcome {
  switch (job.lastStatus) {
    case undefined:
      return job.lastRunAt ? 'other' : 'none';
    case 'ok':
      return 'ok';
    case 'error':
      return 'failed';
    case 'delivery_failed':
      return 'deliveryFailed';
    case 'blocked_config':
      return 'blocked';
    default:
      return 'other';
  }
}

export function groupOf(job: RoutineJob): RoutineGroup {
  if (isCompleted(job)) return 'completed';
  const outcome = lastOutcome(job);
  if (job.state === 'error' || outcome === 'failed' || outcome === 'blocked' || outcome === 'deliveryFailed' || job.failureStreak > 0) return 'attention';
  return isPaused(job) ? 'paused' : 'active';
}

const ts = (iso: string | undefined): number => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};

/** Groups in display order, each sorted: soonest next run first, then by name. Empty groups are left out. */
export function groupJobs(jobs: readonly RoutineJob[]): { group: RoutineGroup; jobs: RoutineJob[] }[] {
  const by = new Map<RoutineGroup, RoutineJob[]>();
  for (const j of jobs) {
    const g = groupOf(j);
    const list = by.get(g) ?? [];
    list.push(j);
    by.set(g, list);
  }
  const out: { group: RoutineGroup; jobs: RoutineJob[] }[] = [];
  for (const group of GROUP_ORDER) {
    const list = by.get(group);
    if (!list?.length) continue;
    list.sort((a, b) => ts(a.nextRunAt) - ts(b.nextRunAt) || a.name.localeCompare(b.name));
    out.push({ group, jobs: list });
  }
  return out;
}

export type Controls = {
  pause: boolean;
  resume: boolean;
  /** run now; on a paused job it resumes the schedule as well (Hermes trigger_job), the UI must say so */
  run: boolean;
  runResumes: boolean;
};

/** Which controls a job offers. Completed one-shots and errored jobs cannot be run again through this API. */
export function controlsFor(job: RoutineJob, access: 'control' | 'read'): Controls {
  const none = { pause: false, resume: false, run: false, runResumes: false };
  if (access !== 'control' || isCompleted(job) || job.state === 'error') return none;
  const paused = isPaused(job);
  return { pause: !paused, resume: paused, run: !isRunning(job), runResumes: paused };
}
