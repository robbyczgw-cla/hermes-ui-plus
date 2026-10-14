/** Slot picker logic: labels from ISO times, grouping by day, reply text. Pure (node:test). */
import { formatDay, formatTime, parseIso, sameDay } from '../../../../actions/dates.ts';
import { S_DE, type ModuleStrings } from './text.ts';

type Rec = Record<string, unknown>;

export type SlotView = {
  key: string;
  /** reply / summary label: explicit label, else "Di 14. Okt, 10:00–11:00" */
  label: string;
  /** localized text for display / accessibility (label is protocol text) */
  display: string;
  /** "Di 14. Okt" (null when start is not parseable) */
  day: string | null;
  dayKey: string;
  /** "10:00–11:00", "ganztägig", or null */
  time: string | null;
  /** explicit model label (shown as title when present) */
  title?: string;
  note?: string;
  start?: Date;
};

export function slotKey(o: Rec, i: number): string {
  const id = typeof o.id === 'string' ? o.id.trim() : typeof o.id === 'number' ? String(o.id) : '';
  return id || `s${i}`;
}

/** Display day ("Di 14. Okt" / "Tue, Oct 14"); German output is the shared actions/dates format. */
function dayText(d: Date, ref: Date, locale?: string): string {
  if (!locale || !/^(en|es)\b/i.test(locale)) return formatDay(d, ref);
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== ref.getFullYear()) opts.year = 'numeric';
  return new Intl.DateTimeFormat(locale, opts).format(d);
}

function timeText(d: Date, locale?: string): string {
  if (!locale || !/^(en|es)\b/i.test(locale)) return formatTime(d);
  if (/^es\b/i.test(locale)) return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(d);
}

function timeRange(start: Date, end: Date | null, dateOnly: boolean, S: ModuleStrings, locale?: string): string {
  if (dateOnly) return S.slots.allDay;
  if (!end) return timeText(start, locale);
  if (sameDay(start, end)) return `${timeText(start, locale)}–${timeText(end, locale)}`;
  return `${timeText(start, locale)} – ${dayText(end, start, locale)}, ${timeText(end, locale)}`;
}

/** Protocol label (sent to the model in `[slot:id] …`): always the German format, never localized. */
function protocolTimeRange(start: Date, end: Date | null, dateOnly: boolean): string {
  if (dateOnly) return 'ganztägig';
  if (!end) return formatTime(start);
  if (sameDay(start, end)) return `${formatTime(start)}–${formatTime(end)}`;
  return `${formatTime(start)} – ${formatDay(end, start)}, ${formatTime(end)}`;
}

/** Turn raw slot objects into display rows. Slots with neither a parseable start nor a label are dropped. */
export function readSlots(raw: unknown, ref: Date, S: ModuleStrings = S_DE, locale?: string): SlotView[] {
  if (!Array.isArray(raw)) return [];
  const out: SlotView[] = [];
  const seen = new Set<string>();
  raw.forEach((x, i) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return;
    const o = x as Rec;
    let key = slotKey(o, i);
    while (seen.has(key)) key = `${key}_`;
    const start = parseIso(o.start);
    const end = parseIso(o.end);
    const title = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : undefined;
    const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim() : undefined;
    if (!start && !title) return;
    seen.add(key);
    if (!start) {
      out.push({ key, label: title!, display: title!, day: null, dayKey: '', time: null, title, note });
      return;
    }
    const endDate = end && end.date > start.date ? end.date : null;
    const day = dayText(start.date, ref, locale);
    const time = timeRange(start.date, endDate, start.dateOnly, S, locale);
    const auto = `${formatDay(start.date, ref)}, ${protocolTimeRange(start.date, endDate, start.dateOnly)}`;
    out.push({
      key,
      label: title ? `${title} (${auto})` : auto,
      display: title ? `${title} (${day}, ${time})` : `${day}, ${time}`,
      day,
      dayKey: `${start.date.getFullYear()}-${start.date.getMonth()}-${start.date.getDate()}`,
      time,
      title,
      note,
      start: start.date,
    });
  });
  return out;
}

/** Consecutive grouping by day (keeps the model's order). Undated slots form groups with `day: null`. */
export function groupSlotsByDay(slots: readonly SlotView[]): { day: string | null; slots: SlotView[] }[] {
  const groups: { day: string | null; key: string; slots: SlotView[] }[] = [];
  for (const s of slots) {
    const last = groups[groups.length - 1];
    if (last && last.key === s.dayKey) last.slots.push(s);
    else groups.push({ day: s.day, key: s.dayKey, slots: [s] });
  }
  return groups.map(({ day, slots: ss }) => ({ day, slots: ss }));
}
