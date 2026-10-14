/**
 * ISO-8601 (local time by default) parsing, plus locale-aware date and duration text for the action
 * cards. Weekday/month names come from Intl (via the i18n core formatter), the surrounding words and
 * word order from the `actionRunner.dates.*` messages.
 */
import { formatDate, makeT } from '../i18n/core.ts';
import type { ActionI18n } from './types.ts';

export type ParsedIso = { date: Date; dateOnly: boolean };

const RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;

/**
 * Parse `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm[:ss[.sss]][Z|±hh:mm]`. Without an offset the time is LOCAL
 * (the SPEC says "ISO 8601 local time"). Impossible dates (Feb 30, 25:00) → null.
 */
export function parseIso(input: unknown): ParsedIso | null {
  if (typeof input !== 'string') return null;
  const m = RE.exec(input.trim());
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const hasTime = m[4] !== undefined;
  const h = hasTime ? +m[4] : 0;
  const mi = hasTime ? +m[5] : 0;
  const s = m[6] !== undefined ? +m[6] : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  // calendar validity (Feb 30 …) checked on UTC components
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  const tz = m[7];
  if (tz) {
    let offMin = 0;
    if (tz.toUpperCase() !== 'Z') {
      const sign = tz[0] === '-' ? -1 : 1;
      const digits = tz.slice(1).replace(':', '');
      const oh = +digits.slice(0, 2);
      const om = digits.length > 2 ? +digits.slice(2, 4) : 0;
      if (oh > 14 || om > 59) return null;
      offMin = sign * (oh * 60 + om);
    }
    return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s) - offMin * 60000), dateOnly: false };
  }
  const local = new Date(y, mo - 1, d, h, mi, s, 0);
  if (Number.isNaN(local.getTime())) return null;
  return { date: local, dateOnly: !hasTime };
}

const p2 = (n: number) => String(n).padStart(2, '0');

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** German default for callers outside the i18n tree (ui/components/modules/a/slotsModel.ts) until they pass `i18n`. */
const GERMAN: ActionI18n = { t: makeT('de', 'de-DE'), locale: 'de-DE' };

/** "Di 14. Okt" (+ " 2027" when not in the reference year); English: "Tue, Oct 14" */
export function formatDay(d: Date, ref: Date, { t, locale }: ActionI18n = GERMAN): string {
  const vars = {
    weekday: formatDate(locale, d, { weekday: 'short' }),
    day: d.getDate(),
    month: formatDate(locale, d, { month: 'short' }),
    year: d.getFullYear(),
  };
  return d.getFullYear() === ref.getFullYear() ? t('actionRunner.dates.day', vars) : t('actionRunner.dates.dayYear', vars);
}

export function formatTime(d: Date): string {
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** "Di 14. Okt, 10:00" */
export function formatDateTime(d: Date, ref: Date, i18n: ActionI18n = GERMAN): string {
  return i18n.t('actionRunner.dates.dateTime', { day: formatDay(d, ref, i18n), time: formatTime(d) });
}

/**
 * Event range for the confirmation sheet:
 *  "Di 14. Okt, 10:00–11:00" · "Di 14. Okt, 22:00 – Mi 15. Okt, 02:00" ·
 *  "Di 14. Okt (ganztägig)" · "Di 14. Okt – Do 16. Okt (ganztägig)".
 * For all-day events `end` is the INCLUSIVE last day (see calendarModel.lastDayOf).
 */
export function formatRange(start: Date, end: Date, allDay: boolean, ref: Date, i18n: ActionI18n = GERMAN): string {
  const { t } = i18n;
  if (allDay) {
    const value = sameDay(start, end)
      ? formatDay(start, ref, i18n)
      : t('actionRunner.dates.range', { from: formatDay(start, ref, i18n), to: formatDay(end, ref, i18n) });
    return t('actionRunner.dates.allDay', { value });
  }
  if (sameDay(start, end)) {
    return t('actionRunner.dates.timeRange', { day: formatDay(start, ref, i18n), start: formatTime(start), end: formatTime(end) });
  }
  return t('actionRunner.dates.range', { from: formatDateTime(start, ref, i18n), to: formatDateTime(end, ref, i18n) });
}

/** 90 → "1 Min 30 Sek", 3600 → "1 Std", 5400 → "1 Std 30 Min" (en: "1 h 30 min") */
export function formatDuration(totalSeconds: number, { t }: ActionI18n = GERMAN): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h) parts.push(t('actionRunner.dates.duration.hours', { count: h }));
  if (m) parts.push(t('actionRunner.dates.duration.minutes', { count: m }));
  if (sec && !h) parts.push(t('actionRunner.dates.duration.seconds', { count: sec }));
  return parts.length ? parts.join(' ') : t('actionRunner.dates.duration.seconds', { count: 0 });
}

/** Countdown clock: 125000 ms → "02:05", 3725000 → "1:02:05" (rounded UP to full seconds). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`;
}
