/**
 * The send path of a chat's live cards as pure steps (LiveProvider wires them to the local store and the chat hook):
 * - `planSend`: what the next message carries (this device's pending edits, the focused card, a card made here, the
 *   whole card when Hermes may have lost it, batches to send again after a turn broke off) and the router header;
 * - `acceptSend`: Hermes took the turn: the carried edits go in flight;
 * - `settleRecord`: the turn's answer is done (in flight dropped, the transcript holds the edits) or broke off (back to
 *   pending, sent again with `re`: never lost, never applied twice).
 * Kept apart from React so the whole round trip (send, accept, break off, send again, other device) is testable.
 */
import type { ChatMessage } from '../hermes/types';
import type { LiveCardModel } from './derive.ts';
import { batchTurns, hermesMayHaveLost, turnOfBatch } from './extract.ts';
import { editTarget, liveHeader } from './focus.ts';
import { MAX_OWN, type LiveLocalRecord } from './localStore.ts';
import { afterAccepted, isEmptyPending, newBatchId, settleInflight } from './pending.ts';
import { budgetBatch, fitTotal, type LiveBatches, type LiveTypes } from './trailer.ts';

export interface SentBatch {
  bid: string;
  /** how many of the card's pending ops the batch carries (0: a snapshot carried them as a state) */
  count: number;
  /** the head version that will include the sent batch */
  newBase: number;
  created: boolean;
  /** when it was planned (this device's clock): pending.ts `inflight.at` */
  at: number;
}

export interface SendPlan {
  /** trailer batches that fit (may be empty: then only the header goes along) */
  batches: LiveBatches;
  types: LiveTypes;
  /** `X-HUI-Live` for the bridge router; empty = no open cards */
  header: string;
  sent: Record<string, SentBatch>;
}

/** What the next message carries; null when there is nothing (no batch, no open card). */
export function planSend(input: {
  rec: LiveLocalRecord;
  models: readonly LiveCardModel[];
  /** "Hermes fragen": the card the message is about */
  focus: string | null;
  /** what the user typed (an edit request about the one fitting card re-sends a card Hermes may have lost) */
  text: string;
  messages: readonly ChatMessage[];
  now?: number;
  newBid?: () => string;
}): SendPlan | null {
  const { rec, models, focus: f, text, messages, now = Date.now(), newBid = newBatchId } = input;
  const open = models.filter((m) => !m.closed);
  // an edit request about the one fitting open card counts as about it (design §9.3, same rule as the router)
  const about = f ?? editTarget(text, open);
  const batches: LiveBatches = {};
  const types: LiveTypes = {};
  const sent: Record<string, SentBatch> = {};
  for (const model of models) {
    const p = rec.pending[model.id];
    const focused = f === model.id;
    const ops = model.view.outgoing;
    const create = p?.create && !p.create.sent ? p.create.type : undefined;
    // Hermes may have lost the card from its context: a message about it carries the whole card again
    const snapshot = !create && about === model.id && hermesMayHaveLost(messages, model.card);
    // a batch whose turn broke off is named again even when the user undid its edits since (`re` only): every device
    // skips it then, so nobody keeps an edit the user took back
    const resend = p?.resend?.length ? p.resend : undefined;
    if (!ops.length && !focused && !create && !snapshot && !resend) continue;
    const bid = p?.bid ?? newBid();
    const { batch, carried } = budgetBatch({ v: create ? 0 : (p?.base ?? model.head.n), ops, bid, focus: focused, create, snapshot, re: resend }, model.view.state, model.type);
    batches[model.id] = batch;
    types[model.id] = model.type;
    sent[model.id] = { bid, count: p && carried === 'all' ? p.ops.length : 0, newBase: create ? 1 : model.head.n + (ops.length || snapshot ? 1 : 0), created: !!create, at: now };
  }
  const fitted = fitTotal(batches, types);
  const header = liveHeader(open.filter((m) => !m.local || fitted[m.id]), f);
  if (!Object.keys(fitted).length && !header) return null;
  return { batches: fitted, types, header, sent };
}

/** Hermes took the turn: the carried edits are in flight (ops made meanwhile stay pending), the bids are this device's. */
export function acceptSend(rec: LiveLocalRecord, plan: SendPlan): LiveLocalRecord {
  const ids = Object.keys(plan.batches);
  if (!ids.length) return rec;
  const pending = { ...rec.pending };
  for (const id of ids) {
    const s = plan.sent[id];
    const p = pending[id];
    if (!s || !p) continue;
    const accepted = afterAccepted(p, s, s.newBase) ?? p;
    const next = s.created && accepted.create ? { ...accepted, create: { ...accepted.create, sent: true } } : accepted;
    if (!isEmptyPending(next)) pending[id] = { ...next, ...(next.ops.length ? {} : { choices: undefined, confirmed: undefined }) };
    else delete pending[id];
  }
  const own = [...(rec.own ?? []), ...ids.map((id) => plan.sent[id]?.bid).filter((b): b is string => !!b)].slice(-MAX_OWN);
  return { ...rec, pending, own };
}

/**
 * Settle every card's in-flight batch by its turn in `messages` (pending.ts `settleInflight`). Returns `rec` itself
 * when nothing changed.
 */
export function settleRecord(rec: LiveLocalRecord, messages: readonly ChatMessage[], now = Date.now()): LiveLocalRecord {
  const turns = batchTurns(messages);
  let changed = false;
  const pending = { ...rec.pending };
  for (const [id, p] of Object.entries(rec.pending)) {
    const next = settleInflight(p, (bid) => turnOfBatch(turns, messages, bid, bid === p.inflight?.bid ? p.inflight.at : undefined, now));
    if (next === p) continue;
    changed = true;
    if (next) pending[id] = next;
    else delete pending[id];
  }
  return changed ? { ...rec, pending } : rec;
}
