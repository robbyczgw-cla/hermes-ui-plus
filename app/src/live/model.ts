/**
 * Live cards: pure core (design: private design/0.2/live-cards.md).
 *
 * A live card is ONE answer card that Hermes keeps up to date over many turns (`"live":true`, same `id`): a checklist
 * (phase 1), a trip plan (`tabs` of `agenda` days, or one `agenda`) or a product watchlist (`products`, phase 2).
 * Hermes' session history is the database: every version is a message in it, either a full version from Hermes (the
 * node with `live:true`), a patch from Hermes (a `callout` carrying `livePatch`, only the changes), or a batch of the
 * user's own edits that rode along with a user message (`[hui:live]` trailer, live/trailer.ts). Every device folds
 * the same transcript in the same order to the same state; no wall clock and no device id take part in a decision.
 *
 * Merge rules (§6.2): Hermes' full version is diffed against the fold before it (= what Hermes could see) and turned
 * into ops; a missing `checked` (or another field the user owns: a trip block's own note, a product's target price) in
 * it keeps the user's value; ops on an id that no longer exists are skipped (a delete wins); among content edits the
 * later one in the transcript wins.
 */
import type { HuiChecklistKind } from '../protocol/types.ts';
import { editTarget, removalAsked } from './focus.ts';

export type LiveCardType = 'checklist' | 'trip' | 'products';
export const LIVE_CARD_TYPES: readonly LiveCardType[] = ['checklist', 'trip', 'products'];

export interface LiveOffer {
  merchant: string;
  price?: number | string;
  url: string;
}

/**
 * One addressable entry of a card: a checklist item, a trip block, a product. `text` is the item's name in every
 * type (checklist `text`, agenda `title`, product `name`); `checked` is ticked / done / bought.
 */
export interface LiveItem {
  id: string;
  text: string;
  checked?: boolean;
  // checklist
  qty?: number | string;
  unit?: string;
  category?: string;
  note?: string;
  // trip
  /** the day (tab) the block belongs to */
  day?: string;
  /** "HH:MM" */
  start?: string;
  end?: string;
  location?: string;
  kind?: string;
  /** the user's own note on a block ("Tisch für 2"), never overwritten by Hermes */
  userNote?: string;
  // products
  brand?: string;
  price?: number;
  currency?: string;
  priceNote?: string;
  rating?: number;
  reviews?: number;
  badge?: string;
  verdict?: string;
  image?: string;
  imageQuery?: string;
  url?: string;
  offers?: LiveOffer[];
  specs?: { label: string; value: string }[];
  pros?: string[];
  cons?: string[];
  scores?: { label: string; value: number }[];
  /** the user's wish price (Wunschpreis) */
  target?: number;
  /** the user took it off the watchlist view (kept for the history) */
  hidden?: boolean;
}

export type ItemField = Exclude<keyof LiveItem, 'id' | 'checked'>;

/** Every item field the fold knows, in a stable order (diffs and compaction iterate it). */
export const ITEM_FIELDS: readonly ItemField[] = [
  'text', 'qty', 'unit', 'category', 'note',
  'day', 'start', 'end', 'location', 'kind', 'userNote',
  'brand', 'price', 'currency', 'priceNote', 'rating', 'reviews', 'badge', 'verdict', 'image', 'imageQuery', 'url',
  'offers', 'specs', 'pros', 'cons', 'scores', 'target', 'hidden',
];
/** phase-1 name, still used for checklists */
export const CONTENT_FIELDS = ['text', 'qty', 'unit', 'category', 'note'] as const;

/** Fields only the user sets (design §4, field ownership): a Hermes full version without them keeps the user's value. */
export const USER_FIELDS: Readonly<Record<LiveCardType, readonly ItemField[]>> = {
  checklist: [],
  trip: ['userNote'],
  products: ['target', 'hidden'],
};

export interface LiveDay {
  id: string;
  label: string;
  /** ISO date YYYY-MM-DD */
  date?: string;
}

export interface LiveMapMarker {
  lat: number;
  lng: number;
  title: string;
  description?: string;
  number?: number;
}

export interface LiveMap {
  title?: string;
  markers: LiveMapMarker[];
  route?: boolean;
}

export interface LiveMeta {
  title?: string;
  // checklist
  kind?: HuiChecklistKind;
  groupBy?: 'category' | 'none';
  // trip: days in order (the blocks name theirs in `day`), the map tab (Hermes owns it, replaced as a whole)
  days?: LiveDay[];
  map?: LiveMap;
  // products
  ranked?: boolean;
  source?: string;
  basis?: string;
}

export type MetaKey = keyof LiveMeta;
/** Card-level fields a full version of each type can change (absent keeps the old value, except `map`). */
export const META_KEYS: Readonly<Record<LiveCardType, readonly MetaKey[]>> = {
  checklist: ['title', 'kind', 'groupBy'],
  trip: ['title', 'days', 'map'],
  products: ['title', 'ranked', 'source', 'basis'],
};
const ALL_META_KEYS: readonly MetaKey[] = ['title', 'kind', 'groupBy', 'days', 'map', 'ranked', 'source', 'basis'];

export interface LiveCardState extends LiveMeta {
  items: LiveItem[];
  closed?: boolean;
}

/** A field change: the new value, `null` removes the field. */
export type ItemPatch = { [K in ItemField]?: LiveItem[K] | null };
export type MetaPatch = { [K in MetaKey]?: LiveMeta[K] | null };

/**
 * One edit. The same vocabulary for Hermes (its patches, or derived from its full versions) and the user (trailer).
 * `after` = insert/move behind that item (`null` = first), `to` = the trip day it goes to.
 */
export type LiveOp =
  | { add: LiveItem; after?: string | null; to?: string }
  | ({ set: string } & ItemPatch)
  | { del: string }
  | { check: string }
  | { uncheck: string }
  | { move: string; after?: string | null; to?: string }
  | { meta: MetaPatch }
  | { order: string[] }
  | { close: true }
  | { reopen: true };

export const EMPTY_STATE: LiveCardState = { items: [] };

/** Limits (§14): items per card come from the validator (200); ops per Hermes patch / per user batch. */
export const MAX_PATCH_OPS = 100;
export const MAX_USER_OPS = 200;

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Comparable text of an item: lower case, letters and digits only (matching items without ids, merging adds). */
export function normText(s: unknown): string {
  return str(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '');
}

/**
 * The card's own spelling of a category the app inferred for an added item ("Brot & Backwaren" → the card's
 * "Backwaren"), so a user's item joins Hermes' group instead of opening a second one.
 */
export function fitCategory(category: string | undefined, existing: readonly (string | undefined)[]): string | undefined {
  if (!category) return category;
  const n = normText(category);
  const cats = Array.from(new Set(existing.filter((c): c is string => !!c)));
  return cats.find((c) => normText(c) === n) ?? cats.find((c) => { const m = normText(c); return m.length >= 4 && (n.includes(m) || m.includes(n)); }) ?? category;
}

/** Stable id for an item Hermes sent without one: `h` + a short hash of its text (never `i<index>`). */
export function hashItemId(text: string): string {
  let h = 0x811c9dc5;
  const s = normText(text) || text;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `h${h.toString(36)}`;
}

/** The op's target item id (undefined for card-level ops). */
export function opTarget(op: LiveOp): string | undefined {
  if ('add' in op) return op.add.id;
  if ('set' in op) return op.set;
  if ('del' in op) return op.del;
  if ('check' in op) return op.check;
  if ('uncheck' in op) return op.uncheck;
  if ('move' in op) return op.move;
  return undefined;
}

/** The fields a `set` op changes. */
export function patchOf(op: { set: string } & ItemPatch): ItemPatch {
  const p: ItemPatch = {};
  for (const f of ITEM_FIELDS) if (f in op) (p as Record<string, unknown>)[f] = op[f];
  return p;
}

/** Field values equal for the fold: empty = missing, numbers and their text alike ("2" = 2), lists by content. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b);
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return str(a) === str(b);
}

function applyPatch(item: LiveItem, patch: ItemPatch): LiveItem | null {
  let out: LiveItem | null = null;
  for (const f of ITEM_FIELDS) {
    if (!(f in patch)) continue;
    const v = patch[f];
    if (f === 'text' && (isEmpty(v) || str(v).trim() === '')) continue; // text is required
    if (sameValue(item[f], v)) continue;
    out ??= { ...item };
    if (isEmpty(v)) delete out[f];
    else (out as unknown as Record<string, unknown>)[f] = v;
  }
  return out;
}

/** `items` with `item` placed behind `after` (`null` = first, undefined or unknown = last). */
function insertAt(items: LiveItem[], item: LiveItem, after: string | null | undefined): LiveItem[] {
  const out = items.slice();
  if (after === null) {
    out.unshift(item);
    return out;
  }
  const i = after === undefined ? -1 : out.findIndex((it) => it.id === after);
  if (i < 0) out.push(item);
  else out.splice(i + 1, 0, item);
  return out;
}

/** Apply one op. `applied` false = no-op (missing id, duplicate add, nothing changed): the fold skips it. */
export function applyOp(state: LiveCardState, op: LiveOp): { state: LiveCardState; applied: boolean } {
  const same = { state, applied: false };
  const idx = (id: string) => state.items.findIndex((it) => it.id === id);
  const withItem = (i: number, item: LiveItem) => {
    const items = state.items.slice();
    items[i] = item;
    return { state: { ...state, items }, applied: true };
  };
  if ('add' in op) {
    const a = op.add;
    if (!a?.id || !str(a.text).trim() || idx(a.id) >= 0) return same;
    const item = cleanItem(op.to ? { ...a, day: op.to } : a);
    return { state: { ...state, items: insertAt(state.items, item, op.after) }, applied: true };
  }
  if ('set' in op) {
    const i = idx(op.set);
    if (i < 0) return same;
    const next = applyPatch(state.items[i], patchOf(op));
    return next ? withItem(i, next) : same;
  }
  if ('del' in op) {
    const i = idx(op.del);
    if (i < 0) return same;
    return { state: { ...state, items: state.items.filter((_, j) => j !== i) }, applied: true };
  }
  if ('check' in op || 'uncheck' in op) {
    const id = 'check' in op ? op.check : op.uncheck;
    const want = 'check' in op;
    const i = idx(id);
    if (i < 0 || !!state.items[i].checked === want) return same;
    const item = { ...state.items[i] };
    if (want) item.checked = true;
    else delete item.checked;
    return withItem(i, item);
  }
  if ('move' in op) {
    const i = idx(op.move);
    if (i < 0 || op.after === op.move) return same;
    let item = state.items[i];
    if (op.to && item.day !== op.to) item = { ...item, day: op.to };
    const rest = state.items.filter((_, j) => j !== i);
    const items = op.after === undefined && item === state.items[i] ? state.items : insertAt(rest, item, op.after === undefined ? state.items[i - 1]?.id ?? null : op.after);
    return items.some((it, j) => it !== state.items[j]) ? { state: { ...state, items }, applied: true } : same;
  }
  if ('meta' in op) {
    let next: LiveCardState | null = null;
    for (const k of ALL_META_KEYS) {
      if (!op.meta || !(k in op.meta)) continue;
      const v = op.meta[k];
      if (k === 'title' && isEmpty(v)) continue; // a card keeps its title
      if (sameValue(state[k], v)) continue;
      next ??= { ...state };
      if (isEmpty(v)) delete next[k];
      else (next as unknown as Record<string, unknown>)[k] = v;
    }
    if (!next) return same;
    // a day that is gone takes its blocks with it
    if ('days' in (op.meta ?? {}) && next.days) {
      const days = new Set(next.days.map((d) => d.id));
      next.items = next.items.filter((it) => !it.day || days.has(it.day));
    }
    return { state: next, applied: true };
  }
  if ('order' in op) {
    const pos = new Map(op.order.map((id, i) => [id, i]));
    const items = state.items
      .map((it, i) => ({ it, i, p: pos.get(it.id) }))
      .sort((a, b) => (a.p ?? Infinity) - (b.p ?? Infinity) || a.i - b.i)
      .map((x) => x.it);
    return items.some((it, i) => it !== state.items[i]) ? { state: { ...state, items }, applied: true } : same;
  }
  if ('close' in op) return state.closed ? same : { state: { ...state, closed: true }, applied: true };
  if ('reopen' in op) {
    if (!state.closed) return same;
    const { closed: _closed, ...rest } = state;
    return { state: rest, applied: true };
  }
  return same;
}

/** Apply ops in order; returns the state and the ops that changed something. */
export function applyOps(state: LiveCardState, ops: readonly LiveOp[]): { state: LiveCardState; applied: LiveOp[] } {
  let s = state;
  const applied: LiveOp[] = [];
  for (const op of ops) {
    const r = applyOp(s, op);
    if (r.applied) {
      s = r.state;
      applied.push(op);
    }
  }
  return { state: s, applied };
}

export function cleanItem(it: LiveItem): LiveItem {
  const o: LiveItem = { id: it.id, text: str(it.text).trim() };
  for (const f of ITEM_FIELDS) {
    if (f === 'text') continue;
    const v = it[f];
    if (!isEmpty(v) && v !== false) (o as unknown as Record<string, unknown>)[f] = v;
  }
  if (it.checked) o.checked = true;
  return o;
}

// ---- full versions -------------------------------------------------------------------------------------------------

/** An item as a full version states it; the id may be missing (matched by text, else hashed). */
export type FullItem = Omit<LiveItem, 'id'> & { id?: string };

/** A full version of a card in the fold's terms (live/nodes.ts turns validated nodes into this). */
export interface LiveFull {
  type: LiveCardType;
  id: string;
  closed?: boolean;
  meta: LiveMeta;
  items: FullItem[];
}

/** Card state from a full version (a first version). */
export function stateFromFull(full: Pick<LiveFull, 'meta' | 'items' | 'closed'>): LiveCardState {
  const s: LiveCardState = { items: [] };
  for (const k of ALL_META_KEYS) if (!isEmpty(full.meta[k])) (s as unknown as Record<string, unknown>)[k] = full.meta[k];
  if (full.closed) s.closed = true;
  const used = new Set<string>();
  for (const it of full.items ?? []) {
    const item = cleanItem({ ...it, id: uniqueId(it.id || hashItemId(it.text), used) } as LiveItem);
    if (item.text) s.items.push(item);
  }
  return s;
}

/** Card state from a checklist node (phase-1 API). */
export function stateFromNode(node: { title?: string; kind?: HuiChecklistKind; groupBy?: 'category' | 'none'; closed?: boolean; items?: FullItem[] }): LiveCardState {
  return stateFromFull({ meta: { title: node.title, kind: node.kind, groupBy: node.groupBy }, items: node.items ?? [], closed: node.closed });
}

function uniqueId(id: string, used: Set<string>): string {
  let out = id;
  for (let n = 2; used.has(out); n++) out = `${id}-${n}`;
  used.add(out);
  return out;
}

/**
 * A full version as ops against its base (the fold before it). Items match by id, then by normalised text among the
 * base items no other new item claimed (Hermes renamed or forgot an id). Unmatched base items are deleted, unmatched
 * new items added. `checked` only changes when Hermes says so explicitly, and so do the fields the user owns.
 * A ticked item Hermes left out stays (done, at its place): models list only what is still open ("Noch zu kaufen:
 * Hafermilch und Äpfel"), a tick is the user's. It goes only when the turn's user message (`turnText`) asked to take it
 * off (focus.ts `removalAsked`) or by an explicit `del` (a patch, the user's own edit).
 * `authoritative` (a user snapshot): the version states everything, missing user fields and ticked items are removed too.
 */
export function diffFull(base: LiveCardState, full: { type?: LiveCardType; meta?: LiveMeta; closed?: boolean; items: FullItem[] } & LiveMeta, opts: { authoritative?: boolean; turnText?: string } = {}): LiveOp[] {
  const type = full.type ?? 'checklist';
  const meta: LiveMeta = full.meta ?? full;
  const userFields = opts.authoritative ? [] : USER_FIELDS[type];
  const ops: LiveOp[] = [];
  const baseById = new Map(base.items.map((it) => [it.id, it]));
  const claimed = new Set<string>();
  const incoming = (full.items ?? []).filter((it) => str(it.text).trim());
  // pass 1: ids
  const match: (LiveItem | undefined)[] = incoming.map((it) => {
    const b = it.id ? baseById.get(it.id) : undefined;
    if (b && !claimed.has(b.id)) {
      claimed.add(b.id);
      return b;
    }
    return undefined;
  });
  // pass 2: text among the unclaimed
  incoming.forEach((it, i) => {
    if (match[i]) return;
    const n = normText(it.text);
    const b = base.items.find((x) => !claimed.has(x.id) && normText(x.text) === n);
    if (b) {
      claimed.add(b.id);
      match[i] = b;
    }
  });
  const left = base.items.filter((b) => !claimed.has(b.id));
  const ticked = opts.authoritative ? [] : left.filter((b) => b.checked);
  const asked = removalAsked(opts.turnText ?? '', ticked);
  const kept = new Set(ticked.filter((b) => !asked.has(b.id)).map((b) => b.id));
  for (const b of left) if (!kept.has(b.id)) ops.push({ del: b.id });
  const used = new Set(base.items.filter((b) => claimed.has(b.id) || kept.has(b.id)).map((b) => b.id));
  const order: string[] = [];
  incoming.forEach((it, i) => {
    const b = match[i];
    if (b) {
      order.push(b.id);
      const patch: ItemPatch = {};
      let changed = false;
      for (const f of ITEM_FIELDS) {
        if (userFields.includes(f) && !(f in it)) continue;
        const nv = isEmpty(it[f]) ? null : it[f];
        if (!sameValue(b[f], nv)) {
          (patch as Record<string, unknown>)[f] = nv;
          changed = true;
        }
      }
      if (changed) ops.push({ set: b.id, ...patch });
      if (it.checked === true && !b.checked) ops.push({ check: b.id });
      if (it.checked === false && b.checked) ops.push({ uncheck: b.id });
      return;
    }
    const id = uniqueId(it.id || hashItemId(it.text), used);
    order.push(id);
    ops.push({ add: cleanItem({ ...it, id } as LiveItem) });
  });
  // a kept ticked item stays behind the base item it followed
  base.items.forEach((b, i) => {
    if (!kept.has(b.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(base.items[j].id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    order.splice(at, 0, b.id);
  });
  const m: MetaPatch = {};
  for (const k of META_KEYS[type]) {
    const v = meta[k];
    if (isEmpty(v)) {
      // absent keeps the old value (a model forgets `kind`), except the trip's map tab: gone means removed
      if (k === 'map' && !isEmpty(base[k])) m.map = null;
      continue;
    }
    if (!sameValue(base[k], v)) (m as Record<string, unknown>)[k] = v;
  }
  if (Object.keys(m).length) ops.push({ meta: m });
  // the version's order is the truth: adds land at the end, so an inserted or restored item needs an order op too
  const landed = applyOps(base, ops).state.items.map((it) => it.id);
  if (landed.some((id, i) => id !== order[i])) ops.push({ order });
  if (full.closed === true && !base.closed) ops.push({ close: true });
  if (full.closed !== true && base.closed) ops.push({ reopen: true });
  return ops;
}

// ---- fold ----------------------------------------------------------------------------------------------------------

/** A user's batch of edits for one card, as carried by a trailer. */
export interface UserBatch {
  /** head version number of the sending device when the batch's first op was made (0 = the batch creates the card) */
  v: number;
  ops?: LiveOp[];
  /** full snapshot instead of ops (big batches, after Hermes compressed its context, a card the user created) */
  state?: LiveCardState;
  /** the user made this card a live card ("Als Live-Karte weiterführen"): its type; `state` is the first version */
  create?: LiveCardType;
  /** batch id: a retried send never applies twice */
  bid?: string;
  /** the message is about this card ("Hermes fragen") */
  focus?: boolean;
}

/**
 * What the user's message of a turn was about, for the answer's plain nodes (`plain`) and an answer without any card
 * block (`quiet`): the cards its trailer carried and its text without the trailer (edit phrases, live/focus.ts).
 */
export interface LiveTurn {
  cards: string[];
  /** cards the user asked about explicitly ("Hermes fragen": `focus`) */
  focus?: string[];
  text: string;
}

/** A live node of an answer in the fold's terms (live/nodes.ts `fullFromNode`). */
export type LiveEvent =
  /** `turn`: the user message before the answer (a ticked item it asked to remove may go, diffFull) */
  | { kind: 'hermes'; key: string; at: number; full: LiveFull; turn?: LiveTurn; excerpt?: string }
  | { kind: 'patch'; key: string; at: number; card: string; ops: LiveOp[]; excerpt?: string }
  | { kind: 'user'; key: string; at: number; card: string; batch: UserBatch }
  /**
   * A live-capable node WITHOUT `"live":true` (models forget it, or write a new list instead of updating the card).
   * The fold applies it as a full version of the card it clearly continues (`continuationOf`), else marks it
   * `unapplied` when the turn was about a card of that type. `node` = the node's id ('' without one).
   */
  | { kind: 'plain'; key: string; at: number; node: string; full: LiveFull; turn: LiveTurn; excerpt?: string }
  /** a finished answer without any card block after a turn about a card: "„Einkauf“ wurde nicht geändert" */
  | { kind: 'quiet'; key: string; at: number; turn: LiveTurn };

export interface LiveVersion {
  /** 1-based position in the card's fold order (display only, identical on every device) */
  n: number;
  key: string;
  author: 'hermes' | 'user';
  at: number;
  /** ops that changed something, in order */
  ops: LiveOp[];
  /** state after this version */
  state: LiveCardState;
  /** a Hermes patch (not a full version) */
  patch?: true;
  /** a user batch that carried the whole card (`state`): Hermes saw all of it here */
  snapshot?: true;
  /** first sentence of Hermes' answer */
  excerpt?: string;
  bid?: string;
}

export interface LiveCard {
  id: string;
  type: LiveCardType;
  versions: LiveVersion[];
}

/** What a message contributed: per card, the version number (unchanged = a Hermes version without changes). */
export interface MessageMark {
  card: string;
  n: number;
  unchanged?: boolean;
  /** the node's own id when the card got another one (same id, other type: `<id>-2`) */
  node?: string;
  /** user batches: ops that were sent (for the "mitgeschickt" line) */
  sent?: LiveOp[];
  /** user batches: the batch made the card ("Als Live-Karte weiterführen") */
  created?: boolean;
  /** a plain node (no `"live":true`) of this answer, by its id ('' = none): applied to the card, or `unapplied` */
  adopted?: string;
  /** NOT applied (shown as a note with "Übernehmen"): a plain node that does not clearly continue the card the turn was
   * about, or a patch for a card this chat does not have (`adopted` = `patch:<card>`) */
  unapplied?: true;
  /** a Hermes patch whose ops all failed (unknown item ids): "nicht übernommen" instead of "unverändert" */
  failed?: true;
  /** an answer without a block after a turn about this card: the card stayed as it was */
  quiet?: true;
}

export interface LiveFold {
  cards: Map<string, LiveCard>;
  /** message key → what it carried */
  marks: Map<string, MessageMark[]>;
  /** batch ids seen in the transcript (a device's sent edits arrived) */
  bids: Set<string>;
}

export const headOf = (card: LiveCard): LiveVersion => card.versions[card.versions.length - 1];
export const stateAt = (card: LiveCard, n: number): LiveCardState => (n >= 1 ? card.versions[Math.min(n, card.versions.length) - 1].state : EMPTY_STATE);

/** Hermes patches since its last full version (the router asks for a full version after 10, design §5.2). */
export function patchesSinceFull(card: LiveCard): number {
  let n = 0;
  for (let i = card.versions.length - 1; i >= 0; i--) {
    const v = card.versions[i];
    if (v.author !== 'hermes') continue;
    if (!v.patch) break;
    n++;
  }
  return n;
}

/** Fold a transcript's live events (in transcript order) into cards and versions. Pure and deterministic. */
export function foldLive(events: readonly LiveEvent[]): LiveFold {
  const cards = new Map<string, LiveCard>();
  const marks = new Map<string, MessageMark[]>();
  const bids = new Set<string>();
  // other ids a card was continued under (a plain list `einkaufsliste_samstag` that became card `liste`)
  const aliases = new Map<string, Set<string>>();
  const mark = (key: string, m: MessageMark) => {
    const list = marks.get(key);
    if (list) list.push(m);
    else marks.set(key, [m]);
  };
  const push = (card: LiveCard, v: Omit<LiveVersion, 'n'>): number => {
    const n = card.versions.length + 1;
    card.versions.push({ n, ...v });
    return n;
  };
  for (const ev of events) {
    if (ev.kind === 'hermes') {
      // the same id with another type is another card (the skill forbids it; never mix two types in one fold)
      let id = ev.full.id;
      for (let k = 2; cards.get(id) && cards.get(id)!.type !== ev.full.type; k++) id = `${ev.full.id}-${k}`;
      const nodeId = id === ev.full.id ? {} : { node: ev.full.id };
      const card = cards.get(id);
      if (!card) {
        const state = stateFromFull(ev.full);
        const ops: LiveOp[] = state.items.map((it) => ({ add: it }));
        cards.set(id, { id, type: ev.full.type, versions: [{ n: 1, key: ev.key, author: 'hermes', at: ev.at, ops, state, ...(ev.excerpt ? { excerpt: ev.excerpt } : {}) }] });
        mark(ev.key, { card: id, n: 1, ...nodeId });
        continue;
      }
      const head = headOf(card);
      const { state, applied } = applyOps(head.state, diffFull(head.state, ev.full, { turnText: ev.turn?.text }));
      if (!applied.length) {
        mark(ev.key, { card: id, n: head.n, unchanged: true, ...nodeId });
        continue;
      }
      const n = push(card, { key: ev.key, author: 'hermes', at: ev.at, ops: applied, state, ...(ev.excerpt ? { excerpt: ev.excerpt } : {}) });
      mark(ev.key, { card: id, n, ...nodeId });
      continue;
    }
    if (ev.kind === 'patch') {
      const card = cards.get(ev.card);
      if (!card) {
        // a patch for a card this chat never had: the callout stays a callout, with a note that nothing was applied
        mark(ev.key, { card: ev.card, n: 0, adopted: `patch:${ev.card}`, unapplied: true });
        continue;
      }
      const head = headOf(card);
      const { state, applied } = applyOps(head.state, ev.ops.slice(0, MAX_PATCH_OPS));
      if (!applied.length) {
        // ops on items the card does not have (or no change at all): say which of the two it was
        const failed = ev.ops.some((op) => !applyOp(head.state, op).applied && !opIsNoop(head.state, op));
        mark(ev.key, { card: card.id, n: head.n, unchanged: true, ...(failed ? { failed: true as const } : {}) });
        continue;
      }
      const n = push(card, { key: ev.key, author: 'hermes', at: ev.at, ops: applied, state, patch: true, ...(ev.excerpt ? { excerpt: ev.excerpt } : {}) });
      mark(ev.key, { card: card.id, n });
      continue;
    }
    if (ev.kind === 'plain') {
      const hit = continuationOf(cards, aliases, ev);
      if (!hit) continue;
      const card = cards.get(hit.card)!;
      const head = headOf(card);
      if (!hit.ok) {
        mark(ev.key, { card: card.id, n: head.n, adopted: ev.node, unapplied: true });
        continue;
      }
      if (ev.node && ev.node !== card.id) (aliases.get(card.id) ?? aliases.set(card.id, new Set()).get(card.id)!).add(ev.node);
      const { state, applied } = applyOps(head.state, diffFull(head.state, { ...ev.full, type: card.type }, { turnText: ev.turn.text }));
      if (!applied.length) {
        mark(ev.key, { card: card.id, n: head.n, unchanged: true, adopted: ev.node });
        continue;
      }
      const n = push(card, { key: ev.key, author: 'hermes', at: ev.at, ops: applied, state, ...(ev.excerpt ? { excerpt: ev.excerpt } : {}) });
      mark(ev.key, { card: card.id, n, adopted: ev.node });
      continue;
    }
    if (ev.kind === 'quiet') {
      const id = turnTarget(cards, ev.turn, undefined, true);
      const card = id ? cards.get(id) : undefined;
      if (card && !headOf(card).state.closed) mark(ev.key, { card: card.id, n: headOf(card).n, unchanged: true, quiet: true });
      continue;
    }
    const b = ev.batch;
    if (b.bid && bids.has(b.bid)) continue;
    const card = cards.get(ev.card);
    if (!card) {
      // "Als Live-Karte weiterführen": the user's batch is the card's first version
      if (!b.create || !b.state) continue;
      if (b.bid) bids.add(b.bid);
      const state = stateFromFull({ meta: b.state, items: b.state.items });
      cards.set(ev.card, { id: ev.card, type: b.create, versions: [{ n: 1, key: ev.key, author: 'user', at: ev.at, ops: state.items.map((it) => ({ add: it })), state, snapshot: true, ...(b.bid ? { bid: b.bid } : {}) }] });
      mark(ev.key, { card: ev.card, n: 1, created: true, sent: [] });
      continue;
    }
    if (b.bid) bids.add(b.bid);
    const head = headOf(card);
    const ops = b.state ? snapshotOps(head.state, b.state, card.type) : (b.ops ?? []).slice(0, MAX_USER_OPS);
    const { state, applied } = applyOps(head.state, ops);
    if (!applied.length) {
      if (b.ops?.length || b.state) mark(ev.key, { card: card.id, n: head.n, unchanged: true, sent: ops });
      continue;
    }
    const n = push(card, { key: ev.key, author: 'user', at: ev.at, ops: applied, state, ...(b.bid ? { bid: b.bid } : {}), ...(b.state ? { snapshot: true as const } : {}) });
    mark(ev.key, { card: card.id, n, sent: applied });
  }
  return { cards, marks, bids };
}

/** A user snapshot as ops: the user's state wins everything, including unticks and their own fields. */
export function snapshotOps(base: LiveCardState, target: LiveCardState, type: LiveCardType = 'checklist'): LiveOp[] {
  const items = target.items.map((it) => ({ ...it, checked: !!it.checked }));
  const meta: LiveMeta = {};
  for (const k of ALL_META_KEYS) if (target[k] !== undefined) (meta as Record<string, unknown>)[k] = target[k];
  return diffFull(base, { type, meta, items, closed: target.closed }, { authoritative: true });
}

// ---- plain nodes that continue a card --------------------------------------------------------------------------

/** an op that targets an existing item but changes nothing (a tick that is already there) */
function opIsNoop(state: LiveCardState, op: LiveOp): boolean {
  const id = opTarget(op);
  if (id === undefined) return true;
  return state.items.some((it) => it.id === id) || ('add' in op && state.items.some((it) => it.id === op.add.id));
}

/** a card id written as a slug: `einkaufsliste_samstag` → `einkaufsliste-samstag` (live/adopt.ts makes card ids so) */
export function slugId(id: string): string {
  return id.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * The one open card the turn was about: its explicit focus ("Hermes fragen"), else (not `asked`) the one card its
 * trailer carried, else an edit phrase about one fitting card. `asked`: only what the user asked for (focus, edit
 * phrase), not edits that merely rode along (a tick sent with "Danke" asks Hermes for nothing).
 */
export function turnTarget(cards: ReadonlyMap<string, LiveCard>, turn: LiveTurn, type?: LiveCardType, asked = false): string | undefined {
  const open = Array.from(cards.values()).filter((c) => !headOf(c).state.closed && (!type || c.type === type));
  const one = (ids: readonly string[] | undefined) => {
    const hit = open.filter((c) => ids?.includes(c.id));
    return hit.length === 1 ? hit[0].id : undefined;
  };
  return one(turn.focus) ?? (asked ? undefined : one(turn.cards)) ?? editTarget(turn.text, open);
}

/**
 * At least half of the card's items (by text) are still in the node: it is the same list, not another one. Counted
 * over the open items when there are any: a list of what is still missing leaves the ticked ones out (diffFull keeps them).
 */
function keepsCard(card: LiveCard, full: LiveFull): boolean {
  const all = headOf(card).state.items.filter((it) => !it.hidden);
  const open = all.filter((it) => !it.checked);
  const items = open.length ? open : all;
  if (!items.length) return false;
  const texts = new Set(full.items.map((it) => normText(it.text)));
  const kept = items.filter((it) => texts.has(normText(it.text))).length;
  return kept * 2 >= items.length;
}

/**
 * The card a plain node continues (design: real-user round 2, R2-01). In this order:
 * 1. its id is the card's id, an id the card was continued under before, or the card's id as a slug
 *    (`einkaufsliste_samstag` → card `einkaufsliste-samstag`): always;
 * 2. the turn was about one open card of the same type (focus, the card in the trailer, an edit phrase), or the node
 *    has the card's title: when at least half of the card's items are still in it.
 * `ok: false` = the turn was about that card but the node does not keep it: shown as not applied, never applied.
 */
export function continuationOf(cards: ReadonlyMap<string, LiveCard>, aliases: ReadonlyMap<string, ReadonlySet<string>>, ev: Extract<LiveEvent, { kind: 'plain' }>): { card: string; ok: boolean } | undefined {
  const type = ev.full.type;
  const open = Array.from(cards.values()).filter((c) => c.type === type && !headOf(c).state.closed);
  if (!open.length) return undefined;
  if (ev.node) {
    const slug = slugId(ev.node);
    const byId = open.filter((c) => c.id === ev.node || aliases.get(c.id)?.has(ev.node) || (slug && c.id === slug));
    if (byId.length === 1) return { card: byId[0].id, ok: true };
  }
  const about = turnTarget(cards, ev.turn, type);
  const title = normText(ev.full.meta.title);
  const titled = title ? open.filter((c) => normText(headOf(c).state.title) === title) : [];
  const id = about ?? (titled.length === 1 ? titled[0].id : undefined);
  if (!id) return undefined;
  const card = cards.get(id)!;
  if (keepsCard(card, ev.full)) return { card: id, ok: true };
  // only a turn that asked about the card makes a list that is not it worth a note; a mere title match or a tick that
  // rode along is another list
  return about && turnTarget(cards, ev.turn, type, true) === id ? { card: id, ok: false } : undefined;
}

// ---- diff for display ----------------------------------------------------------------------------------------------

export interface ItemChange {
  kind: 'added' | 'removed' | 'changed' | 'checked' | 'unchecked';
  id: string;
  text: string;
  item: LiveItem;
  /** changed: field → [before, after] */
  fields?: Partial<Record<ItemField, [unknown, unknown]>>;
}

/** What changed between two states, per item, in the order of the newer state (removed items last). */
export function diffStates(before: LiveCardState, after: LiveCardState): ItemChange[] {
  const out: ItemChange[] = [];
  const prev = new Map(before.items.map((it) => [it.id, it]));
  const next = new Set(after.items.map((it) => it.id));
  for (const it of after.items) {
    const b = prev.get(it.id);
    if (!b) {
      out.push({ kind: 'added', id: it.id, text: it.text, item: it });
      continue;
    }
    const fields: ItemChange['fields'] = {};
    for (const f of ITEM_FIELDS) if (!sameValue(b[f], it[f])) fields[f] = [b[f], it[f]];
    if (Object.keys(fields).length) out.push({ kind: 'changed', id: it.id, text: it.text, item: it, fields });
    if (!!b.checked !== !!it.checked) out.push({ kind: it.checked ? 'checked' : 'unchecked', id: it.id, text: it.text, item: it });
  }
  for (const b of before.items) if (!next.has(b.id)) out.push({ kind: 'removed', id: b.id, text: b.text, item: b });
  return out;
}

export interface ChangeCounts {
  added: number;
  removed: number;
  changed: number;
  checked: number;
  unchecked: number;
}

export function countChanges(changes: readonly ItemChange[]): ChangeCounts {
  const c: ChangeCounts = { added: 0, removed: 0, changed: 0, checked: 0, unchecked: 0 };
  for (const ch of changes) c[ch.kind]++;
  return c;
}

/** Ticked / done / bought of all (products: the ones still on the watchlist). */
export function progressOf(state: LiveCardState): { done: number; total: number } {
  const items = state.items.filter((it) => !it.hidden);
  return { done: items.filter((it) => it.checked).length, total: items.length };
}
