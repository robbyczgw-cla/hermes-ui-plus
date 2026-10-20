/**
 * The user's live-card edits travel to Hermes as a trailer at the END of their next message (design §5.3):
 *
 *   Wir grillen doch am Samstag.
 *
 *   [hui:live]{"einkauf":{"v":4,"ops":[{"check":"milch"},{"add":{"id":"u-k3f9a","text":"Brot vom Bäcker"}}],"bid":"b-…"}}[/hui:live]
 *
 * It is part of the user message, so it lands in Hermes' session history: Hermes reads it, and every device folds it
 * (live/model.ts). The app cuts it for display. Ops and items use the card type's own words (live/codec.ts); decoding
 * is defensive: the text comes back from the server and may have been written by another app version.
 */
import { decodeOps, decodeState, encodeOp, encodeState, idOf } from './codec.ts';
import { LIVE_CARD_TYPES, type LiveCardState, type LiveCardType, type LiveOp, type UserBatch } from './model.ts';

export const LIVE_OPEN = '[hui:live]';
export const LIVE_CLOSE = '[/hui:live]';

export type LiveBatches = Record<string, UserBatch>;
/** card id → its type (how the trailer spells items); missing = checklist */
export type LiveTypes = Record<string, LiveCardType>;

/** Budgets (§14): ops per card, a snapshot, the whole trailer. */
export const TRAILER_OPS_BUDGET = 4096;
export const TRAILER_STATE_BUDGET = 6144;
export const TRAILER_TOTAL_BUDGET = 12288;
const MAX_CARDS = 8;
const MAX_OPS = 200;

const isRec = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** One batch as written: key order as Hermes reads it (version, what changed, then the bookkeeping). */
function wireBatch(b: UserBatch, type: LiveCardType): Record<string, unknown> {
  return {
    v: b.v,
    ...(b.create ? { create: b.create } : {}),
    ...(b.ops ? { ops: b.ops.map((op) => encodeOp(type, op)) } : {}),
    ...(b.state ? { state: encodeState(type, b.state) } : {}),
    ...(b.bid ? { bid: b.bid } : {}),
    ...(b.focus ? { focus: true } : {}),
  };
}

export function encodeBatches(batches: LiveBatches, types: LiveTypes = {}): string {
  const out: Record<string, unknown> = {};
  for (const [card, b] of Object.entries(batches)) out[card] = wireBatch(b, types[card] ?? b.create ?? 'checklist');
  return JSON.stringify(out);
}

/** The text with the trailer appended (none: the text unchanged). */
export function withLiveTrailer(text: string, batches: LiveBatches | null | undefined, types?: LiveTypes): string {
  if (!batches || !Object.keys(batches).length) return text;
  const t = `${LIVE_OPEN}${encodeBatches(batches, types)}${LIVE_CLOSE}`;
  return text ? `${text}\n\n${t}` : t;
}

const TRAILER_RE = /\n*\[hui:live\](\{[\s\S]*\})\[\/hui:live\]\s*$/;

/** Cut a trailer at the end of a text; `batches` only when it decodes to at least one valid batch. */
export function splitLiveTrailer(text: string): { text: string; batches?: LiveBatches } {
  const m = TRAILER_RE.exec(text);
  if (!m) return { text };
  const rest = text.slice(0, m.index);
  let raw: unknown;
  try {
    raw = JSON.parse(m[1]);
  } catch {
    return { text: rest }; // a broken trailer is still not what the user typed
  }
  const batches = decodeBatches(raw);
  return batches ? { text: rest, batches } : { text: rest };
}

export { decodeOp } from './codec.ts';

export function decodeBatches(raw: unknown): LiveBatches | undefined {
  if (!isRec(raw)) return undefined;
  const out: LiveBatches = {};
  for (const [card, b] of Object.entries(raw).slice(0, MAX_CARDS)) {
    if (!idOf(card) || !isRec(b)) continue;
    const v = typeof b.v === 'number' && Number.isInteger(b.v) && b.v >= 0 ? b.v : 0;
    const batch: UserBatch = { v };
    if (Array.isArray(b.ops)) batch.ops = decodeOps(b.ops, MAX_OPS);
    const state = b.state === undefined ? undefined : decodeState(b.state);
    if (state) batch.state = state;
    if (typeof b.create === 'string' && (LIVE_CARD_TYPES as readonly string[]).includes(b.create) && state) batch.create = b.create as LiveCardType;
    if (typeof b.bid === 'string' && b.bid.length <= 40) batch.bid = b.bid;
    if (b.focus === true) batch.focus = true;
    if (batch.ops?.length || batch.state || batch.focus) out[card] = batch;
  }
  return Object.keys(out).length ? out : undefined;
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** The card as a snapshot: its view without the bookkeeping. */
export function snapshotOf(view: LiveCardState): LiveCardState {
  const { closed, ...rest } = view;
  return { ...rest, ...(closed ? { closed } : {}) };
}

/**
 * One card's outgoing batch within the budgets: ops when they fit, else the full snapshot (the user's view of the card)
 * when that fits, else ops cut to the budget (the rest stays pending for the next message). `snapshot` asks for the
 * full state even when the ops fit (Hermes compressed its context, design §9.3; a card the user just created).
 * @returns the batch and how many of `ops` it carries (for clearing them after acceptance)
 */
export function budgetBatch(
  b: { v: number; ops: LiveOp[]; bid: string; focus?: boolean; create?: LiveCardType; snapshot?: boolean },
  view: LiveCardState,
  type: LiveCardType = 'checklist',
): { batch: UserBatch; carried: 'all' | number } {
  const tail = { bid: b.bid, ...(b.focus ? { focus: true } : {}) };
  const opsFit = bytes(JSON.stringify(b.ops.map((op) => encodeOp(type, op)))) <= TRAILER_OPS_BUDGET;
  if (opsFit && !b.snapshot && !b.create) return { batch: { v: b.v, ops: b.ops, ...tail }, carried: 'all' };
  const state = snapshotOf(view);
  if (b.create || bytes(JSON.stringify(encodeState(type, state))) <= TRAILER_STATE_BUDGET) return { batch: { v: b.v, ...(b.create ? { create: b.create } : {}), state, ...tail }, carried: 'all' };
  if (opsFit) return { batch: { v: b.v, ops: b.ops, ...tail }, carried: 'all' };
  const ops: LiveOp[] = [];
  let size = 2;
  for (const op of b.ops) {
    const s = bytes(JSON.stringify(encodeOp(type, op))) + 1;
    if (size + s > TRAILER_OPS_BUDGET) break;
    ops.push(op);
    size += s;
  }
  return { batch: { v: b.v, ops, ...tail }, carried: ops.length };
}

/** Drop whole cards (unfocused, then the rest) until the trailer fits the total budget. */
export function fitTotal(batches: LiveBatches, types?: LiveTypes): LiveBatches {
  const out = { ...batches };
  const size = () => bytes(encodeBatches(out, types));
  const order = Object.keys(out).sort((a, b) => Number(!!out[a].focus) - Number(!!out[b].focus));
  for (const k of order) {
    if (size() <= TRAILER_TOTAL_BUDGET) break;
    delete out[k];
  }
  return out;
}
