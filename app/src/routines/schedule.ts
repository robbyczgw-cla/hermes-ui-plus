/**
 * Schedules of Hermes cron jobs in plain language ("Mo–Fr um 07:00"), plus the server's clock. Pure, erasable TS.
 *
 * Hermes (cron/jobs.py `parse_schedule`, `compute_next_run`, hermes_time.py) evaluates cron expressions in the bot's
 * configured time zone (HERMES_TIMEZONE / config `timezone`, else server local time), intervals as elapsed time and
 * one-shots as an absolute instant. The job API does not report the zone's name; the UTC offset of the stored
 * instants (`next_run_at` is written in that zone) is the best signal it gives, so the UI shows "Server time, UTC+2".
 * Unknown shapes fall back to the expression itself: never guess a wrong time.
 */
import type { TFn } from '../i18n/core.ts';
import type { JobSchedule } from './jobs.ts';

type Fmt = { t: TFn; locale: string };

const WEEKDAY_NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** 2023-01-01 was a Sunday: weekday `d` (0 = Sunday) in the locale. */
function weekdayName(locale: string, d: number, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(Date.UTC(2023, 0, 1 + d));
}

/** Wall-clock time HH:MM in the locale's style, without any zone conversion (the server's wall time). */
export function wallTime(locale: string, hour: number, minute: number): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, hour, minute));
}

const int = (s: string, min: number, max: number): number | null => {
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
};

/** "1-5" / "MON-FRI" / "1,3,5" / "0" / "7" → sorted unique weekdays (0 = Sunday), null for anything else. */
export function parseWeekdays(field: string): number[] | null {
  const out = new Set<number>();
  for (const part of field.toLowerCase().split(',')) {
    const day = (s: string): number | null => {
      if (s in WEEKDAY_NAMES) return WEEKDAY_NAMES[s] ?? null;
      const n = int(s, 0, 7);
      return n === null ? null : n % 7;
    };
    const range = /^([a-z0-9]+)-([a-z0-9]+)$/.exec(part);
    if (range) {
      const a = day(range[1] ?? '');
      const b = day(range[2] ?? '');
      if (a === null || b === null) return null;
      // "1-7" includes Sunday as 7; a range never wraps backwards in cron
      const end = range[2] === '7' ? 7 : b;
      if (end < a) return null;
      for (let d = a; d <= end; d++) out.add(d % 7);
      continue;
    }
    const d = day(part);
    if (d === null) return null;
    out.add(d);
  }
  return out.size ? [...out].sort((x, y) => x - y) : null;
}

function joinList(items: string[], t: TFn): string {
  if (items.length <= 1) return items[0] ?? '';
  return t('routines.schedule.list', { items: items.slice(0, -1).join(', '), last: items[items.length - 1] ?? '' });
}

function daysPhrase(days: number[], { t, locale }: Fmt): string {
  const key = days.join(',');
  if (key === '0,1,2,3,4,5,6') return t('routines.schedule.daily');
  if (key === '1,2,3,4,5') return t('routines.schedule.weekdays');
  if (key === '0,6') return t('routines.schedule.weekends');
  // Monday first for display
  const ordered = [...days.filter((d) => d !== 0), ...days.filter((d) => d === 0)];
  if (ordered.length === 1) return t('routines.schedule.everyWeekday', { day: weekdayName(locale, ordered[0] ?? 0) });
  return joinList(ordered.map((d) => weekdayName(locale, d, 'short')), t);
}

/** Five-field cron (the shapes Hermes' own phrases and typical jobs produce); null = say the expression instead. */
export function describeCron(expr: string, f: Fmt): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [mi = '', hr = '', dom = '', mon = '', dow = ''] = parts;
  const { t, locale } = f;
  if (mon !== '*') return null;
  // every n minutes / every minute
  const stepMin = /^\*\/(\d{1,2})$/.exec(mi);
  if (hr === '*' && dom === '*' && dow === '*') {
    if (mi === '*') return t('routines.schedule.everyMinutes', { count: 1 });
    if (stepMin) return t('routines.schedule.everyMinutes', { count: Number(stepMin[1]) });
    const m = int(mi, 0, 59);
    if (m !== null) return t('routines.schedule.hourlyAt', { minute: String(m).padStart(2, '0') });
    return null;
  }
  const m = int(mi, 0, 59);
  if (m === null) return null;
  // every n hours at :mm
  const stepHr = /^\*\/(\d{1,2})$/.exec(hr);
  if (stepHr && dom === '*' && dow === '*') {
    return t('routines.schedule.everyHoursAt', { count: Number(stepHr[1]), minute: String(m).padStart(2, '0') });
  }
  const hours = hr.split(',').map((h) => int(h, 0, 23));
  if (!hours.length || hours.some((h) => h === null)) return null;
  const times = joinList((hours as number[]).sort((a, b) => a - b).map((h) => wallTime(locale, h, m)), t);
  if (dom === '*') {
    const days = dow === '*' ? [0, 1, 2, 3, 4, 5, 6] : parseWeekdays(dow);
    if (!days) return null;
    return t('routines.schedule.at', { days: daysPhrase(days, f), times });
  }
  const day = int(dom, 1, 31);
  if (day !== null && dow === '*') return t('routines.schedule.monthly', { day, times });
  return null;
}

function describeInterval(minutes: number, { t }: Fmt): string {
  if (minutes % 1440 === 0) return t('routines.schedule.everyDays', { count: minutes / 1440 });
  if (minutes % 60 === 0) return t('routines.schedule.everyHours', { count: minutes / 60 });
  return t('routines.schedule.everyMinutes', { count: minutes });
}

/** Plain-language schedule. `once` is an absolute instant, shown in this device's time. */
export function describeSchedule(s: JobSchedule, f: Fmt): string {
  const { t, locale } = f;
  if (s.kind === 'once' && s.runAt) {
    const at = Date.parse(s.runAt);
    if (Number.isFinite(at)) return t('routines.schedule.once', { when: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(at) });
  }
  if (s.kind === 'interval' && s.minutes) return describeInterval(s.minutes, f);
  if (s.kind === 'cron' && s.expr) {
    const text = describeCron(s.expr, f);
    if (text) return text;
    return t('routines.schedule.custom', { expr: s.expr });
  }
  return s.display ? t('routines.schedule.custom', { expr: s.display }) : t('routines.schedule.unknown');
}

/** Minutes east of UTC of an ISO instant's written offset ("…+02:00" → 120, "…Z" → 0); null without an offset. */
export function isoOffsetMinutes(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|([+-])(\d{2}):?(\d{2}))$/i.exec(iso.trim());
  if (!m) return null;
  if (m[1]?.toUpperCase() === 'Z') return 0;
  const sign = m[2] === '-' ? -1 : 1;
  return sign * (Number(m[3]) * 60 + Number(m[4]));
}

/** "UTC+2", "UTC−3:30", "UTC" */
export function offsetLabel(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const mm = abs % 60;
  return `UTC${sign}${h}${mm ? `:${String(mm).padStart(2, '0')}` : ''}`;
}

export type ServerClock = {
  /** offset of the bot's clock at the job's next (or last) run, null when no stored instant carries one */
  offsetMinutes: number | null;
  /** this device uses another offset at that instant: wall times in the schedule differ from local ones */
  differsFromDevice: boolean;
};

/** The bot's clock as far as the job tells it (see file comment). */
export function serverClock(job: { nextRunAt?: string; lastRunAt?: string; schedule: JobSchedule }): ServerClock {
  const iso = job.nextRunAt ?? job.schedule.runAt ?? job.lastRunAt;
  const offset = isoOffsetMinutes(iso);
  if (offset === null || !iso) return { offsetMinutes: null, differsFromDevice: false };
  const at = Date.parse(iso);
  const device = Number.isFinite(at) ? -new Date(at).getTimezoneOffset() : offset;
  return { offsetMinutes: offset, differsFromDevice: device !== offset };
}
