/**
 * Pure agenda helpers (docs/SPEC-modules-v3.md `agenda`): block parsing, 15-min snapping/time math,
 * overlap layout (side-by-side columns), visible hour range, locale time formatting, reply text and
 * calendar actions. No React / RN imports so node:test can run it.
 */
import { parseClock } from '../../../../protocol/validate.ts';
import { HUI_AGENDA_KINDS, type HuiAgendaKind, type HuiCalendarAction } from '../../../../protocol/types.ts';

export const SNAP_MIN = 15;
export const DAY_MIN = 24 * 60;
export const MIN_DURATION = SNAP_MIN;
export const MAX_BLOCKS = 30;

export type AgendaBlock = {
  id: string;
  /** minutes since midnight */
  start: number;
  /** minutes since midnight, > start, ≤ 1440 */
  end: number;
  title: string;
  location?: string;
  kind?: HuiAgendaKind;
  note?: string;
};

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 200): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
};

/** "HH:MM" / ISO date-time / minutes → minutes since midnight (undefined if invalid). */
export function toMinutes(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.min(DAY_MIN, Math.round(v)));
  if (v === '24:00') return DAY_MIN;
  return parseClock(v);
}

/** Tolerant block reader (nodes are normalised by the stream parser, gallery samples may be raw). */
export function readBlocks(raw: unknown): AgendaBlock[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const out: AgendaBlock[] = [];
  for (let i = 0; i < raw.length && out.length < MAX_BLOCKS; i++) {
    const r = raw[i];
    if (!isRec(r)) continue;
    const start = toMinutes(r.start);
    const title = str(r.title);
    if (start === undefined || !title || start >= DAY_MIN) continue;
    let end = toMinutes(r.end);
    if (end === undefined || end <= start) end = Math.min(start + 60, DAY_MIN - 1);
    if (end <= start) continue;
    let id = str(r.id, 100) ?? `b${i}`;
    while (used.has(id)) id = `${id}-${i}`;
    used.add(id);
    const kind = typeof r.kind === 'string' && (HUI_AGENDA_KINDS as readonly string[]).includes(r.kind) ? (r.kind as HuiAgendaKind) : undefined;
    out.push({ id, start, end, title, location: str(r.location), kind, note: str(r.note, 300) });
  }
  return sortBlocks(out);
}

export function sortBlocks(blocks: readonly AgendaBlock[]): AgendaBlock[] {
  return [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);
}

/* ───────────── time math ───────────── */

export function snapMinutes(min: number, step = SNAP_MIN): number {
  return Math.round(min / step) * step;
}

export function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Move by `delta` minutes keeping the duration; the new start snaps to 15 min and stays inside the day. */
export function moveBlock(b: AgendaBlock, delta: number, lo = 0, hi = DAY_MIN): AgendaBlock {
  const dur = b.end - b.start;
  const start = clampNum(snapMinutes(b.start + delta), lo, Math.max(lo, hi - dur));
  return { ...b, start, end: start + dur };
}

/** Move the end by `delta` minutes (snapped), keeping at least 15 min and staying ≤ 24:00. */
export function resizeBlockEnd(b: AgendaBlock, delta: number, hi = DAY_MIN): AgendaBlock {
  const end = clampNum(snapMinutes(b.end + delta), b.start + MIN_DURATION, hi);
  return { ...b, end: Math.max(end, b.start + Math.min(MIN_DURATION, hi - b.start)) };
}

/** Pixel drag → snapped minute delta (worklet-safe arithmetic is duplicated in the component). */
export function dragToMinutes(dy: number, pxPerHour: number, step = SNAP_MIN): number {
  if (pxPerHour <= 0) return 0;
  const steps = Math.round(dy / ((pxPerHour * step) / 60));
  return steps * step === 0 ? 0 : steps * step; // avoid -0
}

export function minutesToHHMM(min: number): string {
  const m = clampNum(Math.round(min), 0, DAY_MIN);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Locale clock: 24 h "09:05" for de/es (and 24 h locales), Intl for en (e.g. "9:05 AM" in en-US). */
export function formatClock(min: number, locale: string, lang: string): string {
  const m = clampNum(Math.round(min), 0, DAY_MIN);
  if (lang !== 'en') return minutesToHHMM(m);
  try {
    const d = new Date(2000, 0, 1, Math.floor(m / 60) % 24, m % 60);
    const s = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(d);
    return m === DAY_MIN && /^0?0:00$/.test(s) ? '24:00' : s;
  } catch {
    return minutesToHHMM(m);
  }
}

/**
 * Compact clock for narrow labels (weather hour row): like `formatClock`, but a full hour in a 12 h locale
 * drops ":00" ("12 PM" instead of "12:00 PM", which did not fit the 56 dp hour cell on Android).
 * 24 h output ("14:00") is unchanged.
 */
export function formatShortClock(min: number, locale: string, lang: string): string {
  const s = formatClock(min, locale, lang);
  return Math.round(min) % 60 === 0 && /[a-z]/i.test(s) ? s.replace(/:00(?!\d)/, '') : s;
}

/** Short hour label for the ruler: "09" (24 h) / "9 AM" (12 h locales). */
export function formatHourLabel(hour: number, locale: string, lang: string): string {
  if (lang !== 'en') return String(hour % 24).padStart(2, '0');
  try {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(new Date(2000, 0, 1, hour % 24, 0));
  } catch {
    return String(hour % 24).padStart(2, '0');
  }
}

export function durationParts(min: number): { h: number; m: number } {
  const m = Math.max(0, Math.round(min));
  return { h: Math.floor(m / 60), m: m % 60 };
}

/* ───────────── overlap layout ───────────── */

export type BlockLayout = { col: number; cols: number };

/**
 * Side-by-side columns for overlapping blocks. Blocks are grouped into clusters of transitively
 * overlapping blocks; inside a cluster each block takes the first column whose last block ended
 * (touching blocks, end == start, do not overlap). `cols` = column count of the cluster.
 */
export function layoutOverlaps(blocks: readonly AgendaBlock[]): Record<string, BlockLayout> {
  const sorted = sortBlocks(blocks);
  const out: Record<string, BlockLayout> = {};
  let cluster: AgendaBlock[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const b of cluster) out[b.id].cols = colEnds.length;
    cluster = [];
    colEnds = [];
  };
  for (const b of sorted) {
    if (cluster.length && b.start >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= b.start);
    if (col < 0) {
      col = colEnds.length;
      colEnds.push(b.end);
    } else colEnds[col] = b.end;
    out[b.id] = { col, cols: 1 };
    cluster.push(b);
    clusterEnd = Math.max(cluster.length === 1 ? b.end : clusterEnd, b.end);
  }
  if (cluster.length) flush();
  return out;
}

/* ───────────── visible range ───────────── */

/**
 * Whole hours shown by the ruler: from the earliest start to the latest end (plus the now-line hour
 * if given), at least `minSpan` hours, optionally padded (edit mode leaves room to drag).
 */
export function visibleRange(blocks: readonly AgendaBlock[], opts: { now?: number | null; pad?: number; minSpan?: number } = {}): { startH: number; endH: number } {
  const pad = opts.pad ?? 0;
  const minSpan = opts.minSpan ?? 4;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of blocks) {
    lo = Math.min(lo, b.start);
    hi = Math.max(hi, b.end);
  }
  if (opts.now != null) {
    lo = Math.min(lo, opts.now);
    hi = Math.max(hi, opts.now + 1);
  }
  if (!Number.isFinite(lo)) {
    lo = 8 * 60;
    hi = 18 * 60;
  }
  let startH = Math.max(0, Math.floor(lo / 60) - pad);
  let endH = Math.min(24, Math.ceil(hi / 60) + pad);
  while (endH - startH < minSpan && (startH > 0 || endH < 24)) {
    if (endH < 24) endH++;
    else startH--;
  }
  return { startH, endH };
}

/* ───────────── dates ───────────── */

export function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function readIsoDate(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? m[0] : undefined;
}

/** The now-line minute when `date` is today (local), else null. */
export function nowMinuteIfToday(date: string | undefined, now: Date): number | null {
  if (!date || date !== localIsoDate(now)) return null;
  return now.getHours() * 60 + now.getMinutes();
}

/* ───────────── reply + calendar ───────────── */

/** `[agenda:<id>] 09:00–10:00 Fokus · 10:30–11:00 Call @ Büro` (protocol – 24 h, not localised). */
export function agendaReply(id: string, blocks: readonly AgendaBlock[]): string {
  const parts = sortBlocks(blocks).map((b) => `${minutesToHHMM(b.start)}–${minutesToHHMM(b.end)} ${b.title}${b.location ? ` @ ${b.location}` : ''}`);
  return `[agenda:${id}] ${parts.length ? parts.join(' · ') : '–'}`;
}

/** Local ISO date-time for a calendar action; 24:00 becomes 23:59 (same day). */
function isoAt(date: string, min: number): string {
  return `${date}T${minutesToHHMM(Math.min(min, DAY_MIN - 1))}:00`;
}

export function calendarActionFor(b: AgendaBlock, date: string): HuiCalendarAction {
  const a: HuiCalendarAction = { type: 'calendar', title: b.title, start: isoAt(date, b.start), end: isoAt(date, b.end) };
  if (b.location) a.location = b.location;
  if (b.note) a.notes = b.note;
  return a;
}

/** Structural equality of two plans (used to show "Plan übernehmen" only after real edits). */
export function samePlan(a: readonly AgendaBlock[], b: readonly AgendaBlock[]): boolean {
  if (a.length !== b.length) return false;
  const sa = sortBlocks(a);
  const sb = sortBlocks(b);
  return sa.every((x, i) => {
    const y = sb[i];
    return x.id === y.id && x.start === y.start && x.end === y.end && x.title === y.title && x.location === y.location && x.kind === y.kind;
  });
}

/** Default start for a new block: end of the last block (snapped), else 09:00; leaves room for 15 min. */
export function suggestNewStart(blocks: readonly AgendaBlock[]): number {
  const last = sortBlocks(blocks).reduce((m, b) => Math.max(m, b.end), -1);
  const s = last < 0 ? 9 * 60 : snapMinutes(last);
  return clampNum(s, 0, DAY_MIN - MIN_DURATION);
}

export const KIND_ORDER: readonly HuiAgendaKind[] = HUI_AGENDA_KINDS;

/** Chart palette index per kind (fixed order, never cycles); no kind → last palette slot. */
export function kindPaletteIndex(kind: HuiAgendaKind | undefined, paletteSize: number): number {
  const i = kind ? KIND_ORDER.indexOf(kind) : -1;
  const n = Math.max(1, paletteSize);
  return i >= 0 ? i % n : n - 1;
}
