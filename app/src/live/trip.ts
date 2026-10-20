/**
 * Trip cards (design §13 #2, mockup 05): pure helpers for the open card, the receipts and the tray. A trip's items
 * are blocks with a `day` (one of `state.days`), `start`/`end` ("HH:MM"), a title (`text`) and optional location,
 * note and the user's own note. No React.
 */
import { minutesToHHMM, toMinutes } from '../ui/components/modules/c2/agendaModel.ts';
import type { ItemChange, LiveCardState, LiveDay, LiveItem } from './model.ts';

/** How a block moved since the version last looked at: earlier / later the same day, swapped with another, other day. */
export type TripShiftKind = 'earlier' | 'later' | 'swapped' | 'day';
export interface TripShift {
  kind: TripShiftKind;
  /** the old start ("HH:MM"), when it changed */
  from?: string;
  /** the old day id (kind `day`) */
  fromDay?: string;
}

const minOf = (v: string | undefined): number => toMinutes(v) ?? Infinity;

/** The card's days in order; a card without `days` (older shape) gets one per day id its blocks name. */
export function tripDays(state: LiveCardState): LiveDay[] {
  if (state.days?.length) return state.days;
  const ids = Array.from(new Set(state.items.map((it) => it.day ?? 'd1')));
  return ids.map((id) => ({ id, label: id }));
}

/** The day a block belongs to (a block without a day, or with an unknown one, is on the first day). */
export function dayOf(item: LiveItem, days: readonly LiveDay[]): string | undefined {
  return item.day && days.some((d) => d.id === item.day) ? item.day : days[0]?.id;
}

/** Blocks of one day in time order (blocks without a start last, otherwise the card's order). */
export function dayBlocks(state: LiveCardState, dayId: string, days: readonly LiveDay[] = tripDays(state)): LiveItem[] {
  return state.items
    .map((it, i) => ({ it, i }))
    .filter((x) => dayOf(x.it, days) === dayId)
    .sort((a, b) => minOf(a.it.start) - minOf(b.it.start) || a.i - b.i)
    .map((x) => x.it);
}

/** Label of a day id ("Sa 14."), the id itself when the day is unknown. */
export function dayLabel(days: readonly LiveDay[], id: string | undefined): string {
  if (!id) return '';
  return days.find((d) => d.id === id)?.label || id;
}

/**
 * Moved blocks between two states (`before` = the version last looked at, `after` = what the card shows), limited to
 * `ids` (the blocks Hermes changed since then). Two blocks that took each other's start are both "getauscht"; a block
 * that had to make room for another one (the other took its old start, it went the other way) is "getauscht", the one
 * that took the slot is "vorgezogen" / "später". Another day wins over a time change.
 */
export function tripShifts(before: LiveCardState, after: LiveCardState, ids?: ReadonlySet<string>): Map<string, TripShift> {
  const prev = new Map(before.items.map((it) => [it.id, it]));
  const moved: { id: string; day?: string; from: string; to: string }[] = [];
  const out = new Map<string, TripShift>();
  for (const it of after.items) {
    const b = prev.get(it.id);
    if (!b) continue;
    if ((b.day ?? '') !== (it.day ?? '')) {
      out.set(it.id, { kind: 'day', ...(b.start && b.start !== it.start ? { from: b.start } : {}), ...(b.day ? { fromDay: b.day } : {}) });
      continue;
    }
    if (b.start && it.start && b.start !== it.start) moved.push({ id: it.id, day: it.day, from: b.start, to: it.start });
  }
  const dir = (m: { from: string; to: string }) => Math.sign(minOf(m.to) - minOf(m.from));
  for (const m of moved) {
    const same = moved.filter((o) => o.id !== m.id && o.day === m.day);
    const mutual = same.some((o) => o.to === m.from && o.from === m.to);
    // another block took this one's old start and this one went the other way: it made room
    const displaced = same.some((o) => o.to === m.from && dir(o) === -dir(m) && m.to !== o.from) && !same.some((o) => o.from === m.to && dir(o) === -dir(m) && o.to !== m.from);
    const kind: TripShiftKind = mutual || displaced ? 'swapped' : dir(m) < 0 ? 'earlier' : 'later';
    out.set(m.id, { kind, from: m.from });
  }
  if (!ids) return out;
  for (const id of Array.from(out.keys())) if (!ids.has(id)) out.delete(id);
  return out;
}

/** Changed blocks per day (the brass count on a day chip): `fresh` blocks that are still open. */
export function freshPerDay(state: LiveCardState, fresh: ReadonlySet<string>, days: readonly LiveDay[] = tripDays(state)): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of state.items) {
    if (!fresh.has(it.id) || it.checked) continue;
    const d = dayOf(it, days);
    if (d) out.set(d, (out.get(d) ?? 0) + 1);
  }
  return out;
}

/** The day to show first: the first one with changes, else the one of `today` (ISO date), else the first. */
export function initialDay(state: LiveCardState, fresh: ReadonlySet<string>, today?: string): string | undefined {
  const days = tripDays(state);
  const per = freshPerDay(state, fresh, days);
  return days.find((d) => per.get(d.id))?.id ?? (today ? days.find((d) => d.date === today)?.id : undefined) ?? days[0]?.id;
}

/** The first open block in day and time order (tray: "Sa 14. 11:00 Vatikanische Museen"). */
export function nextOpenBlock(state: LiveCardState): LiveItem | undefined {
  const days = tripDays(state);
  for (const d of days) {
    const hit = dayBlocks(state, d.id, days).find((it) => !it.checked);
    if (hit) return hit;
  }
  return undefined;
}

/** "HH:MM" from what the user typed ("9" → "09:00", "9.30" / "930" → "09:30"), undefined if it is no time. */
export function parseTimeInput(s: string): string | undefined {
  const v = s.trim().replace(/\s*(uhr|h)$/i, '');
  const m = /^(\d{1,2})(?:[:.]?(\d{2}))?$/.exec(v);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return undefined;
  return minutesToHHMM(h * 60 + min);
}

/** One receipt / history line's right side: "15:00 → 11:00", "Sa 14. 11:00 → So 15. 11:00", or "So 15. 10:00". */
export interface TripLineDetail {
  before?: string;
  after?: string;
  shift?: 'earlier' | 'later' | 'day';
}

export function tripChangeDetail(c: ItemChange, days: readonly LiveDay[], clock: (hhmm: string) => string): TripLineDetail {
  const when = (day: string | undefined, start: string | undefined) => [dayLabel(days, day), start ? clock(start) : ''].filter(Boolean).join(' ');
  if (c.kind !== 'changed') return { after: when(c.item.day, c.item.start) || undefined };
  const f = c.fields ?? {};
  const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  if (f.day) {
    const oldStart = f.start ? s(f.start[0]) : c.item.start;
    return { before: when(s(f.day[0]) || undefined, oldStart), after: when(c.item.day, c.item.start), shift: 'day' };
  }
  if (f.start) {
    const [a, b] = [s(f.start[0]), s(f.start[1])];
    const shift = a && b ? (minOf(b) < minOf(a) ? 'earlier' : 'later') : undefined;
    return { before: a ? clock(a) : '', after: b ? clock(b) : '', ...(shift ? { shift } : {}) };
  }
  if (f.end) return { before: f.end[0] ? clock(s(f.end[0])) : '', after: f.end[1] ? clock(s(f.end[1])) : '' };
  for (const k of ['text', 'location', 'note', 'userNote'] as const) {
    const v = f[k];
    if (v) return { before: s(v[0]), after: s(v[1]) };
  }
  return {};
}
