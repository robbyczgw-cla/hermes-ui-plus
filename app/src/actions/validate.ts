/**
 * Input validation for HuiActions coming from the model (untrusted JSON). Error messages are shown to
 * the user (action cards), so they are translated.
 */
import type { TFn } from '../i18n/core.ts';
import { addDays, parseIso, startOfDay } from './dates.ts';
import type { ActionI18n, MapMode, ValidationResult, ValidAction } from './types.ts';

export const MAX_TITLE = 200;
export const MAX_LOCATION = 300;
export const MAX_NOTES = 2000;
export const MAX_BODY = 5000;
export const MAX_TEXT = 20000;
export const MAX_URL = 2048;
export const MAX_LIST_ITEMS = 100;
export const MAX_ITEM_LEN = 120;
export const MAX_TIMER_SECONDS = 24 * 60 * 60;
/** a reminder must be at least this far in the future */
export const MIN_REMINDER_LEAD_MS = 1000;

/** Schemes the executor may ever open. */
export const OPENABLE_SCHEMES = ['http', 'https', 'tel', 'mailto', 'sms', 'geo'] as const;

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function str(x: unknown): string | undefined {
  return typeof x === 'string' ? x : undefined;
}

/** Trim; reject control characters (but keep \n \t in free text). */
function cleanText(x: unknown, max: number): string | undefined {
  const s = str(x);
  if (s === undefined) return undefined;
  const t = s.replace(/\r\n?/g, '\n').trim();
  if (CONTROL.test(t)) return undefined;
  return t.length > max ? t.slice(0, max) : t;
}

export function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

// ---- URLs -------------------------------------------------------------------------------------

/** Validate an URL against the openable schemes; returns the trimmed URL or null. */
export function validateUrl(raw: unknown, schemes: readonly string[] = OPENABLE_SCHEMES): string | null {
  const s = str(raw)?.trim();
  if (!s || s.length > MAX_URL || /[\s\u0000-\u001f\u007f]/.test(s)) return null;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  if (!schemes.includes(scheme)) return null;
  if (scheme === 'http' || scheme === 'https') {
    const host = /^https?:\/\/([^/?#]+)/i.exec(s)?.[1];
    // empty host / userinfo tricks (https://trusted.example.com@evil.example.com) are rejected outright
    if (!host || host.includes('@') || host.startsWith(':') || host.includes('\\')) return null;
    return s;
  }
  if (s.length === scheme.length + 1) return null; // bare "tel:"
  return s;
}

// ---- phone / email ----------------------------------------------------------------------------

/**
 * Normalise a phone number to `+49…`/`0…` digits. Accepts spaces, ( ) - . /; rejects letters and
 * `*` `#` (USSD codes). 3–15 digits.
 */
export function normalizePhone(raw: unknown): string | null {
  const s = str(raw)?.trim();
  if (!s || s.length > 40) return null;
  if (!/^\+?[0-9\s().\-/]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 15) return null;
  return (s.startsWith('+') ? '+' : '') + digits;
}

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function isValidEmail(s: string): boolean {
  return s.length <= 254 && EMAIL.test(s) && !s.includes('..') && !s.startsWith('.') && !/\.@/.test(s);
}

/** "a@b.de, c@d.de" | string[] → unique addresses; null if any is invalid or none given. */
export function parseAddressList(raw: unknown, check: (s: string) => string | null, max = 10): string[] | null {
  let parts: string[];
  if (Array.isArray(raw)) {
    if (raw.some((x) => typeof x !== 'string')) return null;
    parts = raw as string[];
  } else if (typeof raw === 'string') {
    parts = raw.split(/[;,]/);
  } else return null;
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    const v = check(t);
    if (!v) return null;
    if (!out.includes(v)) out.push(v);
  }
  return out.length && out.length <= max ? out : null;
}

// ---- main -------------------------------------------------------------------------------------

type Raw = Record<string, unknown>;

const fail = (error: string): ValidationResult => ({ ok: false, error });
const ok = (action: ValidAction): ValidationResult => ({ ok: true, action });

const MODES: readonly MapMode[] = ['driving', 'walking', 'transit'];

/**
 * Validate + normalise any executable action. `now` (epoch ms) is injectable for tests.
 * Never throws.
 */
export function validateAction(raw: unknown, { t }: ActionI18n, now: number = Date.now()): ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail(t('actionRunner.validate.invalid'));
  const a = raw as Raw;
  switch (a.type) {
    case 'calendar':
      return validateCalendar(a, t);
    case 'reminder': {
      const title = cleanText(a.title, MAX_TITLE);
      if (!title) return fail(t('actionRunner.validate.reminderTitle'));
      const at = parseIso(a.at);
      if (!at) return fail(t('actionRunner.validate.reminderTime'));
      // date-only reminders fire at 09:00
      const when = at.dateOnly ? new Date(at.date.getFullYear(), at.date.getMonth(), at.date.getDate(), 9, 0, 0, 0) : at.date;
      if (when.getTime() < now + MIN_REMINDER_LEAD_MS) return fail(t('actionRunner.validate.reminderPast'));
      return ok({ type: 'reminder', title, at: when });
    }
    case 'maps': {
      const query = cleanText(a.query, MAX_LOCATION) || undefined;
      const hasLat = a.lat !== undefined && a.lat !== null;
      const hasLng = a.lng !== undefined && a.lng !== null;
      let lat: number | undefined;
      let lng: number | undefined;
      if (hasLat || hasLng) {
        const la = typeof a.lat === 'string' ? Number(a.lat) : a.lat;
        const ln = typeof a.lng === 'string' ? Number(a.lng) : a.lng;
        if (!isFiniteNumber(la) || !isFiniteNumber(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return fail(t('actionRunner.validate.coordinates'));
        lat = la;
        lng = ln;
      }
      if (!query && lat === undefined) return fail(t('actionRunner.validate.mapsPlace'));
      let mode: MapMode | undefined;
      if (a.mode !== undefined && a.mode !== null) {
        if (!MODES.includes(a.mode as MapMode)) return fail(t('actionRunner.validate.routeMode'));
        mode = a.mode as MapMode;
      }
      return ok({ type: 'maps', ...(query ? { query } : {}), ...(lat !== undefined ? { lat, lng } : {}), ...(mode ? { mode } : {}) });
    }
    case 'call': {
      const phone = normalizePhone(a.phone);
      return phone ? ok({ type: 'call', phone }) : fail(t('actionRunner.validate.phone'));
    }
    case 'email': {
      const to = parseAddressList(a.to, (s) => (isValidEmail(s) ? s : null));
      if (!to) return fail(t('actionRunner.validate.email'));
      const subject = cleanText(a.subject, MAX_TITLE) || undefined;
      const body = cleanText(a.body, MAX_BODY) || undefined;
      return ok({ type: 'email', to, ...(subject ? { subject } : {}), ...(body ? { body } : {}) });
    }
    case 'sms': {
      const to = parseAddressList(a.to, normalizePhone);
      if (!to) return fail(t('actionRunner.validate.phone'));
      const body = cleanText(a.body, 1000) || undefined;
      return ok({ type: 'sms', to, ...(body ? { body } : {}) });
    }
    case 'timer': {
      const sec = typeof a.seconds === 'string' ? Number(a.seconds) : a.seconds;
      if (!isFiniteNumber(sec) || sec < 1) return fail(t('actionRunner.validate.timerDuration'));
      if (sec > MAX_TIMER_SECONDS) return fail(t('actionRunner.validate.timerMax'));
      const label = cleanText(a.label, 80) || 'Timer';
      return ok({ type: 'timer', seconds: Math.round(sec), label });
    }
    case 'add_to_list': {
      if (!Array.isArray(a.items)) return fail(t('actionRunner.validate.listEmpty'));
      const items: string[] = [];
      for (const it of a.items) {
        const t = cleanText(it, MAX_ITEM_LEN);
        if (t && !items.some((x) => x.toLowerCase() === t.toLowerCase())) items.push(t);
      }
      if (!items.length) return fail(t('actionRunner.validate.listEmpty'));
      if (items.length > MAX_LIST_ITEMS) return fail(t('actionRunner.validate.listTooMany', { max: MAX_LIST_ITEMS }));
      const listTitle = cleanText(a.listTitle, 80) || undefined;
      return ok({ type: 'add_to_list', items, ...(listTitle ? { listTitle } : {}) });
    }
    case 'copy': {
      const text = str(a.text);
      if (!text || !text.trim()) return fail(t('actionRunner.validate.nothingToCopy'));
      if (text.length > MAX_TEXT) return fail(t('actionRunner.validate.textTooLong'));
      return ok({ type: 'copy', text });
    }
    case 'open_url': {
      const url = validateUrl(a.url, ['http', 'https']);
      return url ? ok({ type: 'open_url', url }) : fail(t('actionRunner.validate.url'));
    }
    case 'send': {
      const text = cleanText(a.text, MAX_TEXT);
      return text ? ok({ type: 'send', text }) : fail(t('actionRunner.validate.messageEmpty'));
    }
    default:
      return fail(t('actionRunner.validate.unsupported'));
  }
}

function validateCalendar(a: Raw, t: TFn): ValidationResult {
  const title = cleanText(a.title, MAX_TITLE);
  if (!title) return fail(t('actionRunner.validate.eventTitle'));
  const start = parseIso(a.start);
  if (!start) return fail(t('actionRunner.validate.eventStart'));
  const location = cleanText(a.location, MAX_LOCATION) || undefined;
  const notes = cleanText(a.notes, MAX_NOTES) || undefined;
  const extras = { ...(location ? { location } : {}), ...(notes ? { notes } : {}) };

  let allDay: boolean;
  if (a.allDay === undefined || a.allDay === null) allDay = start.dateOnly;
  else if (typeof a.allDay === 'boolean') allDay = a.allDay;
  else return fail(t('actionRunner.validate.allDay'));

  let end: ReturnType<typeof parseIso> = null;
  if (a.end !== undefined && a.end !== null && a.end !== '') {
    end = parseIso(a.end);
    if (!end) return fail(t('actionRunner.validate.eventEnd'));
  }

  if (allDay) {
    // `end` = inclusive last day
    const first = startOfDay(start.date);
    const last = end ? startOfDay(end.date) : first;
    if (last.getTime() < first.getTime()) return fail(t('actionRunner.validate.eventEndBeforeStart'));
    return ok({ type: 'calendar', title, start: first, end: last, allDay: true, ...extras });
  }
  const endDate = end ? (end.dateOnly ? addDays(startOfDay(end.date), 1) : end.date) : new Date(start.date.getTime() + 60 * 60000);
  if (endDate.getTime() <= start.date.getTime()) return fail(t('actionRunner.validate.eventEndBeforeStart'));
  return ok({ type: 'calendar', title, start: start.date, end: endDate, allDay: false, ...extras });
}
