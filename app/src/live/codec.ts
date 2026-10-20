/**
 * Ops and items on the wire (design §5.2, §5.3): Hermes' patches (`livePatch` on a callout) and the user's trailer
 * use the same op vocabulary. Items are written in the node's own words, so the model reads what it writes: a trip
 * block has `title`, a product `name`, a checklist item `text`; agenda `done` / products `bought` mean `checked`.
 * Decoding is defensive and forward compatible: the JSON comes from a model or from another app version, unknown
 * ops and fields are dropped, bad values never throw.
 */
import { ITEM_FIELDS, type ItemField, type LiveCardState, type LiveCardType, type LiveDay, type LiveItem, type LiveMap, type LiveMeta, type LiveOp, type MetaPatch } from './model.ts';

const MAX_ID = 64;
const ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}_.:-]{0,63}$/u;
const PROTO = new Set(['__proto__', 'constructor', 'prototype']);

const isRec = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
export const idOf = (x: unknown): string | undefined => (typeof x === 'string' && x.length <= MAX_ID && ID_RE.test(x) && !PROTO.has(x) ? x : undefined);
const textOf = (x: unknown, max = 300): string | undefined => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined);
const numOf = (x: unknown, min = -1e9, max = 1e9): number | undefined => {
  const n = typeof x === 'number' ? x : typeof x === 'string' && /^\s*-?\d+(?:[.,]\d+)?\s*$/.test(x) ? Number(x.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};
/** "9:5" / "09:05" / "2026-11-14T09:05" → "09:05" */
const clockOf = (x: unknown): string | undefined => {
  if (typeof x !== 'string') return undefined;
  const m = /(?:^|T)(\d{1,2}):(\d{2})/.exec(x.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : undefined;
};
const httpUrl = (x: unknown): string | undefined => (typeof x === 'string' && /^https?:\/\/[^\s]{1,2000}$/i.test(x.trim()) ? x.trim() : undefined);
const lines = (x: unknown, max: number, len: number): string[] | undefined => (Array.isArray(x) ? x.map((s) => textOf(s, len)).filter((s): s is string => !!s).slice(0, max) : undefined);

/** One field value from untrusted JSON (undefined: dropped). */
function fieldValue(f: ItemField, v: unknown): unknown {
  switch (f) {
    case 'text':
      return textOf(v, 300);
    case 'qty':
      return typeof v === 'number' && Number.isFinite(v) ? v : textOf(v, 20);
    case 'unit':
      return textOf(v, 20);
    case 'category':
    case 'brand':
    case 'kind':
      return textOf(v, 60);
    case 'note':
    case 'userNote':
      return textOf(v, 300);
    case 'day':
      return idOf(v);
    case 'start':
    case 'end':
      return clockOf(v);
    case 'location':
    case 'priceNote':
      return textOf(v, 200);
    case 'price':
    case 'target':
      return numOf(v, 0);
    case 'currency':
      return textOf(v, 8);
    case 'rating':
      return numOf(v, 0, 5);
    case 'reviews':
      return numOf(v, 0);
    case 'badge':
      return textOf(v, 40);
    case 'verdict':
      return textOf(v, 160);
    case 'image':
    case 'url':
      return httpUrl(v);
    case 'imageQuery':
      return textOf(v, 120);
    case 'hidden':
      return typeof v === 'boolean' ? v : undefined;
    case 'pros':
    case 'cons':
      return lines(v, 6, 200);
    case 'specs':
      return Array.isArray(v) ? v.filter(isRec).map((s) => ({ label: textOf(s.label, 60), value: textOf(s.value, 120) })).filter((s): s is { label: string; value: string } => !!s.label && !!s.value).slice(0, 6) : undefined;
    case 'scores':
      return Array.isArray(v) ? v.filter(isRec).map((s) => ({ label: textOf(s.label, 40), value: numOf(s.value, 0, 10) })).filter((s): s is { label: string; value: number } => !!s.label && s.value !== undefined).slice(0, 5) : undefined;
    case 'offers':
      return Array.isArray(v)
        ? v
            .filter(isRec)
            .map((o) => {
              const merchant = textOf(o.merchant, 80);
              const url = httpUrl(o.url);
              if (!merchant || !url) return undefined;
              const price = numOf(o.price, 0) ?? textOf(o.price, 40);
              return { merchant, url, ...(price !== undefined ? { price } : {}) };
            })
            .filter((o): o is NonNullable<typeof o> => !!o)
            .slice(0, 4)
        : undefined;
  }
  return undefined;
}

/** Wire names → item fields (the node's own words). */
const ALIASES: Record<string, ItemField | 'checked'> = { title: 'text', name: 'text', done: 'checked', bought: 'checked' };

function fieldName(k: string): ItemField | 'checked' | undefined {
  if (k in ALIASES) return ALIASES[k];
  return (ITEM_FIELDS as readonly string[]).includes(k) ? (k as ItemField) : k === 'checked' ? 'checked' : undefined;
}

/** An item (add, snapshot) from untrusted JSON: needs an id and a name. */
export function decodeItem(x: unknown): LiveItem | undefined {
  if (!isRec(x)) return undefined;
  const id = idOf(x.id);
  if (!id) return undefined;
  const it: Record<string, unknown> = { id };
  for (const [k, v] of Object.entries(x)) {
    const f = fieldName(k);
    if (!f) continue;
    if (f === 'checked') {
      if (v === true) it.checked = true;
      continue;
    }
    if (f === 'text' && it.text) continue; // `text` before `title`/`name`: the first one wins
    const val = fieldValue(f, v);
    if (val !== undefined && !(Array.isArray(val) && !val.length)) it[f] = val;
  }
  return typeof it.text === 'string' && it.text ? (it as unknown as LiveItem) : undefined;
}

function decodeDays(x: unknown): LiveDay[] | undefined {
  if (!Array.isArray(x)) return undefined;
  const seen = new Set<string>();
  const out: LiveDay[] = [];
  for (const d of x.slice(0, 14)) {
    if (!isRec(d)) continue;
    const id = idOf(d.id);
    const label = textOf(d.label, 40) ?? textOf(d.title, 40);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    const date = typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : undefined;
    out.push({ id, label, ...(date ? { date } : {}) });
  }
  return out;
}

function decodeMap(x: unknown): LiveMap | null | undefined {
  if (x === null) return null;
  if (!isRec(x) || !Array.isArray(x.markers)) return undefined;
  const markers = x.markers
    .filter(isRec)
    .map((m) => {
      const lat = numOf(m.lat, -90, 90);
      const lng = numOf(m.lng, -180, 180);
      const title = textOf(m.title, 120);
      if (lat === undefined || lng === undefined || !title) return undefined;
      const description = textOf(m.description, 200);
      const number = numOf(m.number, 1, 999);
      return { lat, lng, title, ...(description ? { description } : {}), ...(number !== undefined ? { number } : {}) };
    })
    .filter((m): m is NonNullable<typeof m> => !!m)
    .slice(0, 30);
  if (!markers.length) return undefined;
  const title = textOf(x.title, 120);
  return { ...(title ? { title } : {}), markers, ...(x.route === true ? { route: true } : {}) };
}

function decodeMeta(x: unknown): MetaPatch | undefined {
  if (!isRec(x)) return undefined;
  const m: MetaPatch = {};
  const title = textOf(x.title, 200);
  if (title) m.title = title;
  if (typeof x.kind === 'string' && ['shopping', 'todo', 'packing', 'generic'].includes(x.kind)) m.kind = x.kind as LiveMeta['kind'];
  if (x.groupBy === 'category' || x.groupBy === 'none') m.groupBy = x.groupBy;
  const days = decodeDays(x.days);
  if (days?.length) m.days = days;
  const map = decodeMap(x.map);
  if (map !== undefined) m.map = map;
  if (typeof x.ranked === 'boolean') m.ranked = x.ranked;
  const source = textOf(x.source, 200);
  if (source) m.source = source;
  return Object.keys(m).length ? m : undefined;
}

const afterOf = (x: Record<string, unknown>): { after?: string | null } => (x.after === null ? { after: null } : idOf(x.after) ? { after: idOf(x.after)! } : {});
const toOf = (x: Record<string, unknown>): { to?: string } => (idOf(x.to) ? { to: idOf(x.to)! } : {});

/** One op from untrusted JSON; unknown keys and shapes are ignored (forward compatible). */
export function decodeOp(x: unknown): LiveOp | undefined {
  if (!isRec(x)) return undefined;
  if ('add' in x) {
    const add = decodeItem(x.add);
    return add ? { add, ...afterOf(x), ...toOf(x) } : undefined;
  }
  if ('set' in x) {
    const id = idOf(x.set);
    if (!id) return undefined;
    const op: Record<string, unknown> = { set: id };
    let checked: boolean | undefined;
    for (const [k, v] of Object.entries(x)) {
      if (k === 'set') continue;
      const f = fieldName(k);
      if (!f) continue;
      if (f === 'checked') {
        if (typeof v === 'boolean') checked = v;
        continue;
      }
      if (v === null) {
        if (f !== 'text') op[f] = null;
        continue;
      }
      const val = fieldValue(f, v);
      if (val !== undefined) op[f] = val;
    }
    // `{"set":"milch","checked":true}` is a tick
    if (Object.keys(op).length === 1 && checked !== undefined) return checked ? { check: id } : { uncheck: id };
    return Object.keys(op).length > 1 ? (op as LiveOp) : undefined;
  }
  if ('move' in x) {
    const id = idOf(x.move);
    return id ? { move: id, ...afterOf(x), ...toOf(x) } : undefined;
  }
  for (const k of ['del', 'check', 'uncheck'] as const) {
    if (k in x) {
      const id = idOf(x[k]);
      return id ? ({ [k]: id } as LiveOp) : undefined;
    }
  }
  if ('done' in x || 'bought' in x) {
    const id = idOf(x.done ?? x.bought);
    return id ? { check: id } : undefined;
  }
  if ('meta' in x) {
    const meta = decodeMeta(x.meta);
    return meta ? { meta } : undefined;
  }
  if (x.close === true) return { close: true };
  if (x.reopen === true) return { reopen: true };
  return undefined;
}

export function decodeOps(x: unknown, max: number): LiveOp[] {
  return Array.isArray(x) ? x.slice(0, max).map(decodeOp).filter((op): op is LiveOp => !!op) : [];
}

/** A snapshot (`state` in a trailer) from untrusted JSON. */
export function decodeState(x: unknown): LiveCardState | undefined {
  if (!isRec(x) || !Array.isArray(x.items)) return undefined;
  const items: LiveItem[] = [];
  const seen = new Set<string>();
  for (const r of x.items.slice(0, 200)) {
    const it = decodeItem(r);
    if (it && !seen.has(it.id)) {
      seen.add(it.id);
      items.push(it);
    }
  }
  const s: LiveCardState = { items };
  const meta = decodeMeta(x);
  if (meta) for (const [k, v] of Object.entries(meta)) if (v !== null) (s as unknown as Record<string, unknown>)[k] = v;
  if (x.closed === true) s.closed = true;
  return s;
}

// ---- encoding (the app writes) ---------------------------------------------------------------------------------------

/** The name field of an item in the node's words. */
export const NAME_FIELD: Readonly<Record<LiveCardType, string>> = { checklist: 'text', trip: 'title', products: 'name' };

function encodeFields(type: LiveCardType, o: Record<string, unknown>): Record<string, unknown> {
  if (!('text' in o) || type === 'checklist') return o;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k === 'text' ? NAME_FIELD[type] : k] = v;
  return out;
}

/** An op in the card type's own words (trip: `title`, products: `name`). */
export function encodeOp(type: LiveCardType, op: LiveOp): Record<string, unknown> {
  if ('add' in op) return { ...op, add: encodeFields(type, op.add as unknown as Record<string, unknown>) };
  if ('set' in op) return encodeFields(type, op as unknown as Record<string, unknown>);
  return op as unknown as Record<string, unknown>;
}

export function encodeState(type: LiveCardType, s: LiveCardState): Record<string, unknown> {
  const { items, ...rest } = s;
  return { ...rest, items: items.map((it) => encodeFields(type, it as unknown as Record<string, unknown>)) };
}
