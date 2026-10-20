/**
 * Text of a routine row ("Nächster Lauf morgen 7:30 · Zuletzt heute 7:31: ok"), shared by the Routines screen and a
 * bot's "Über <Name>" sheet (bots/BotInfoSheet.tsx).
 */
import type { TKey, TFn } from '../i18n';
import type { RoutineJob } from './jobs';
import { isPaused, isRunning, lastOutcome, type RoutineGroup } from './status';

type T = TFn;

export const GROUP_KEYS: Record<RoutineGroup, TKey> = {
  attention: 'routines.groups.attention',
  active: 'routines.groups.active',
  paused: 'routines.groups.paused',
  completed: 'routines.groups.completed',
};

export function rowStatus(job: RoutineJob, t: T, rel: (d: number) => string): [string, string] {
  let when = '';
  if (isRunning(job)) when = t('routines.row.running');
  else if (isPaused(job)) when = t('routines.row.paused');
  else if (job.state !== 'completed') {
    const next = job.nextRunAt ? Date.parse(job.nextRunAt) : NaN;
    when = Number.isFinite(next) ? t('routines.row.next', { when: rel(next) }) : t('routines.row.noNext');
  }
  return [when, lastText(job, t, rel)];
}

export const OUTCOME_KEYS: Record<ReturnType<typeof lastOutcome>, TKey> = {
  ok: 'routines.outcome.ok',
  failed: 'routines.outcome.failed',
  deliveryFailed: 'routines.outcome.deliveryFailed',
  blocked: 'routines.outcome.blocked',
  other: 'routines.outcome.other',
  none: 'routines.outcome.none',
};

export function lastText(job: RoutineJob, t: T, rel: (d: number) => string): string {
  const at = job.lastRunAt ? Date.parse(job.lastRunAt) : NaN;
  const when = Number.isFinite(at) ? rel(at) : '';
  switch (lastOutcome(job)) {
    case 'ok':
      return t('routines.last.ok', { when });
    case 'failed':
      return t('routines.last.failed', { when });
    case 'deliveryFailed':
      return t('routines.last.deliveryFailed', { when });
    case 'blocked':
      return t('routines.last.blocked', { when });
    case 'other':
      return t('routines.last.other', { when });
    default:
      return t('routines.last.none');
  }
}

