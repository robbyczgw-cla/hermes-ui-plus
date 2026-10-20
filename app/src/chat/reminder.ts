/**
 * Reminder card data: a `cronjob_manage` call that created / changed a job, read from the stored tool detail
 * (arguments + result JSON `{success, job_id, name, schedule, next_run_at, …}`, see tools/cronjob_tools.py). The live
 * stream only carries the action word, so the card appears when the turn's details are loaded. Pure (reminder.test.ts).
 */
import type { ToolEvent } from '../hermes/types.ts';
import { formatDate, type TFn } from '../i18n/core.ts';
import { cronAction, hermesToolKind, toolInput, toolOutput } from './hermesTools.ts';

export type Reminder = {
  /** tool call id (stable key) */
  id: string;
  action: 'create' | 'update';
  jobId?: string;
  /** name used in the chat messages ("Ändere die Erinnerung <name>") */
  name: string;
  /** what the reminder says */
  text: string;
  /** schedule as Hermes reports it (`every day at 9am`, `0 9 * * *`, `in 30m`, ISO timestamp) */
  schedule?: string;
  /** next run (ms since epoch) when the result carries a parsable `next_run_at` */
  nextRun?: number;
  /** recurring job (anything but "in 30m" / an absolute timestamp) */
  recurring: boolean;
  /** where Hermes posts the run's answer (`deliver` of the result / job / arguments): `local`, `telegram`, `all`, … */
  deliver?: string;
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** `next_run_at`: ISO string (with or without offset) or epoch seconds/milliseconds. */
export function parseNextRun(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
  const s = str(v);
  if (!s) return undefined;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * One-shot schedules fire once: "in 30m", an ISO timestamp, or Hermes' display of either ("once in 30m", "once at
 * 2026-10-21 09:00", what v0.22 returns as `schedule`). Everything else repeats ("30m" = every 30 minutes, "every monday
 * 9am", cron).
 */
export function isRecurringSchedule(schedule: string | undefined): boolean {
  if (!schedule) return false;
  const s = schedule.trim().toLowerCase();
  if (/^in\s+\d/.test(s) || /^once\b/.test(s)) return false;
  if (/^\d{4}-\d{2}-\d{2}([t ]\d{2}:\d{2}(:\d{2})?)?/.test(s)) return false;
  return true;
}

/** Reminders created / changed by the tool calls of one turn (finished, successful, with a result). */
export function parseReminders(tools: readonly ToolEvent[]): Reminder[] {
  const out: Reminder[] = [];
  for (const ev of tools) {
    if (hermesToolKind(ev.name) !== 'cron' || ev.status !== 'done' || ev.detail?.cancelled) continue;
    const action = cronAction(ev);
    if (action !== 'create' && action !== 'update') continue;
    const output = toolOutput(ev);
    if (!output || output.success === false || str(output.error)) continue;
    const input = toolInput(ev);
    const job = output.job && typeof output.job === 'object' && !Array.isArray(output.job) ? (output.job as Record<string, unknown>) : undefined;
    const jobId = str(output.job_id) ?? str(job?.id) ?? str(input?.job_id);
    const name = str(output.name) ?? str(job?.name) ?? str(input?.name) ?? jobId;
    if (!name) continue;
    const prompt = str(input?.prompt) ?? str(job?.prompt);
    const schedule = str(output.schedule) ?? str(job?.schedule_display) ?? str(input?.schedule);
    const deliver = str(output.deliver) ?? str(job?.deliver) ?? str(input?.deliver);
    out.push({
      id: ev.id,
      action,
      jobId,
      name,
      text: oneLine(str(output.name) ?? str(input?.name) ?? prompt ?? name, 90),
      schedule,
      nextRun: parseNextRun(output.next_run_at ?? job?.next_run_at),
      recurring: isRecurringSchedule(schedule),
      ...(deliver ? { deliver } : {}),
    });
  }
  return out;
}

/**
 * Where a fired reminder goes, from Hermes' `deliver` (tools/cronjob_tools.py): `none` = saved only (`local`; what a job
 * created from the app gets when Hermes has no home channel, because an API session cannot receive it), `botChat` = the
 * bot's "Bot Chat" thread, `all` = every connected channel (none connected: the run ends as "delivery failed"),
 * `targets` = named platforms. null = nothing reliable to say (`origin`, unknown words).
 */
export type ReminderDelivery = { kind: 'none' } | { kind: 'botChat' } | { kind: 'all' } | { kind: 'targets'; targets: string[] };

const PLATFORM_NAMES: Record<string, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  matrix: 'Matrix',
  email: 'E-Mail',
  sms: 'SMS',
};

export function reminderDelivery(deliver: string | undefined): ReminderDelivery | null {
  const parts = (deliver ?? '')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return null;
  if (parts.every((p) => p === 'local' || p === 'none')) return { kind: 'none' };
  if (parts.some((p) => p === 'origin')) return null;
  if (parts.some((p) => p === 'all')) return { kind: 'all' };
  if (parts.every((p) => p === 'bot-chat' || p.startsWith('bot-chat:'))) return { kind: 'botChat' };
  // `telegram:-100…:17` → Telegram (chat ids are never shown); unknown platforms keep their word
  const names = [...new Set(parts.filter((p) => p !== 'local' && p !== 'none').map((p) => (p.startsWith('bot-chat') ? 'Bot Chat' : (PLATFORM_NAMES[p.split(':')[0]] ?? p.split(':')[0]))))];
  return names.length ? { kind: 'targets', targets: names } : null;
}

/** A device reminder can mirror a one-shot reminder that is still at least a minute away; recurring jobs never. */
export function deviceReminderAt(r: Pick<Reminder, 'recurring' | 'nextRun'>, now: number = Date.now()): number | null {
  if (r.recurring || r.nextRun === undefined) return null;
  return r.nextRun > now + 60_000 ? r.nextRun : null;
}

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "heute 08:00" · "morgen 08:00" · "Mi. 08:00" (within a week) · "14.10., 08:00". Raw schedule text when no next run is known. */
export function reminderWhen(t: TFn, locale: string, r: Pick<Reminder, 'nextRun' | 'schedule'>, now: number = Date.now()): string {
  if (r.nextRun === undefined) return r.schedule ?? '';
  const time = formatDate(locale, r.nextRun, { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((startOfDay(r.nextRun) - startOfDay(now)) / 86_400_000);
  if (days === 0) return t('hermesTools.reminder.today', { time });
  if (days === 1) return t('hermesTools.reminder.tomorrow', { time });
  if (days > 1 && days < 7) return formatDate(locale, r.nextRun, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return formatDate(locale, r.nextRun, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Chat messages of the card buttons (the user's language; Hermes understands all of them). */
export function reminderChangePrefill(t: TFn, r: Pick<Reminder, 'name'>): string {
  return t('hermesTools.reminder.changeMessage', { name: r.name });
}

export function reminderDeleteMessage(t: TFn, r: Pick<Reminder, 'name'>): string {
  return t('hermesTools.reminder.deleteMessage', { name: r.name });
}
