/**
 * Receipts for the user's own live-card edits (0.3 "trustworthy live cards"): what a batch changed, by name, and how
 * far it got: waiting for Hermes' answer, saved (in Hermes' history, the answer kept it), changed back by Hermes in
 * that same answer (named, with the ops that restore the user's version), sent again with a later message (its turn
 * broke off), or not applied because its items were gone. Pure: transcript + fold in, the same on every device
 * (only `waiting` depends on this device's view of a running answer).
 */
import type { ChatMessage } from '../hermes/types';
import { answerTurnState } from './extract.ts';
import { removalAsked } from './focus.ts';
import { diffStates, headOf, normText, opTarget, sameValue, stateAt, type ItemChange, type ItemField, type LiveCard, type LiveFold, type LiveItem, type LiveOp, type MessageMark } from './model.ts';

/** One of the user's changes that Hermes' answer in the same turn did differently. */
export interface UndoneChange {
  id: string;
  text: string;
  /** removed: Hermes took the user's added / ticked / edited item off; unchecked / checked: the tick flipped back;
   * restored: an item the user deleted is back; changed: a field the user set has another value */
  kind: 'removed' | 'unchecked' | 'checked' | 'restored' | 'changed';
  field?: ItemField;
  mine?: unknown;
  theirs?: unknown;
}

export type BatchState = 'waiting' | 'saved' | 'changed' | 'resent' | 'nothing';

export interface BatchOutcome {
  card: string;
  state: BatchState;
  /** the user's version (absent: the batch changed nothing, or was sent again later) */
  n?: number;
  /** what the batch changed, item by item (for the "mitgeschickt" line) */
  changes: ItemChange[];
  /** ops whose item was not in the card any more: their names */
  missed: string[];
  /** Hermes' answer in the same turn did these differently */
  undone: UndoneChange[];
  /** ops that put the user's version back (as new edits) */
  restore: LiveOp[];
  /** the version Hermes' answer made (`changed`) */
  answerN?: number;
}

/** The name of item `id` in the newest version that still had it (missed ops point at items that are gone). */
export function itemName(card: LiveCard, id: string): string {
  for (let i = card.versions.length - 1; i >= 0; i--) {
    const it = card.versions[i].state.items.find((x) => x.id === id);
    if (it) return it.text;
  }
  return id;
}

/** Names of ops that missed their item (add ops carry their own text). */
export function missedNames(card: LiveCard | undefined, ops: readonly LiveOp[] | undefined): string[] {
  if (!ops?.length) return [];
  const out: string[] = [];
  for (const op of ops) {
    const name = 'add' in op ? op.add.text : card ? itemName(card, opTarget(op) ?? '') : (opTarget(op) ?? '');
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Edit distance of two short strings (swapped neighbours count once: "Brto"), early exit above `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      low = Math.min(low, cur[j]);
    }
    if (low > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** The same item with its spelling fixed ("Brto" → "Brot", "Tomatn" → "Tomaten"): one or two letters apart. */
export function nearText(a: string, b: string): boolean {
  const x = normText(a);
  const y = normText(b);
  if (x === y) return true;
  const len = Math.min(x.length, y.length);
  if (len < 3) return false;
  return distance(x, y, len >= 7 ? 2 : 1) <= (len >= 7 ? 2 : 1);
}

/**
 * What Hermes' answer (state `after`) did differently from the user's applied ops of this turn (state `mine` right after
 * them). Removals the user's own message asked for ("Brot streichen") do not count, nor an item Hermes lists again with
 * its spelling fixed. Moves, order and card fields don't.
 */
export function undoneBy(ops: readonly LiveOp[], mine: { items: readonly LiveItem[] }, after: { items: readonly LiveItem[] }, turnText = ''): { undone: UndoneChange[]; restore: LiveOp[] } {
  const undone: UndoneChange[] = [];
  const restore: LiveOp[] = [];
  const byId = new Map(after.items.map((it) => [it.id, it]));
  const mineById = new Map(mine.items.map((it) => [it.id, it]));
  // by id, by text, else an item Hermes newly listed under a fixed spelling (it took the user's item, not removed it)
  const findSame = (it: LiveItem) =>
    byId.get(it.id) ?? after.items.find((x) => normText(x.text) === normText(it.text)) ?? after.items.find((x) => !mineById.has(x.id) && nearText(x.text, it.text));
  const asked = (it: LiveItem) => removalAsked(turnText, [it]).has(it.id);
  const seen = new Set<string>();
  for (const op of ops) {
    const id = opTarget(op);
    if (id === undefined || seen.has(id)) continue;
    const it = mineById.get(id);
    if ('del' in op) {
      if (it) continue; // deleted and added again within the batch
      const back = byId.get(id);
      if (back) {
        seen.add(id);
        undone.push({ id, text: back.text, kind: 'restored' });
        restore.push({ del: id });
      }
      continue;
    }
    if (!it) continue;
    const now = findSame(it);
    if (!now) {
      if (asked(it)) continue;
      seen.add(id);
      undone.push({ id, text: it.text, kind: 'removed' });
      restore.push({ add: it });
      continue;
    }
    if (('check' in op || ('add' in op && it.checked)) && !now.checked) {
      seen.add(id);
      undone.push({ id, text: it.text, kind: 'unchecked' });
      restore.push({ check: now.id });
      continue;
    }
    if ('uncheck' in op && now.checked) {
      seen.add(id);
      undone.push({ id, text: it.text, kind: 'checked' });
      restore.push({ uncheck: now.id });
      continue;
    }
    if ('set' in op) {
      for (const f of Object.keys(op) as (ItemField | 'set')[]) {
        if (f === 'set') continue;
        if (sameValue(it[f], now[f])) continue;
        seen.add(id);
        undone.push({ id, text: it.text, kind: 'changed', field: f, mine: it[f], theirs: now[f] });
        restore.push({ set: now.id, [f]: it[f] ?? null } as LiveOp);
      }
    }
  }
  return { undone, restore };
}

const userMessageIndex = (messages: readonly ChatMessage[], key: string) => messages.findIndex((m) => m.id === key);

/**
 * The outcome of the batch a user message (`key`) carried for `card`. Undefined when the message carried none for it.
 */
export function batchOutcome(fold: LiveFold, messages: readonly ChatMessage[], key: string, cardId: string): BatchOutcome | undefined {
  const mark: MessageMark | undefined = fold.marks.get(key)?.find((m) => m.card === cardId && m.sent !== undefined);
  if (!mark) return undefined;
  const card = fold.cards.get(cardId);
  const base: BatchOutcome = { card: cardId, state: 'nothing', changes: [], missed: missedNames(card, mark.missed), undone: [], restore: [] };
  if (mark.resent) return { ...base, state: 'resent', missed: [] };
  const i = userMessageIndex(messages, key);
  const user = messages[i];
  const answer = messages[i + 1]?.role === 'assistant' ? messages[i + 1] : undefined;
  const turn = answerTurnState(answer, i === messages.length - 1);
  if (!card) return { ...base, state: turn === 'running' ? 'waiting' : 'nothing' };
  const version = mark.unchanged || mark.created ? undefined : card.versions[mark.n - 1];
  const out: BatchOutcome = { ...base, ...(version ? { n: version.n, changes: diffStates(stateAt(card, version.n - 1), version.state) } : {}) };
  if (mark.created) out.n = mark.n;
  if (turn === 'running') return { ...out, state: 'waiting' };
  if (!version && !mark.created) return { ...out, state: 'nothing' };
  // Hermes' answer of this same turn: its last version of the card
  const hv = answer ? card.versions.filter((v) => v.key === answer.id && v.author === 'hermes') : [];
  const after = hv[hv.length - 1];
  if (!after || !version) return { ...out, state: 'saved' };
  const { undone, restore } = undoneBy(version.ops, version.state, after.state, user?.text ?? '');
  return undone.length ? { ...out, state: 'changed', undone, restore, answerN: after.n } : { ...out, state: 'saved' };
}

/** Every batch outcome of one user message (one per card it carried), in its trailer's order. */
export function messageOutcomes(fold: LiveFold, messages: readonly ChatMessage[], key: string): BatchOutcome[] {
  const m = messages.find((x) => x.id === key);
  if (!m?.live) return [];
  return Object.keys(m.live)
    .map((card) => batchOutcome(fold, messages, key, card))
    .filter((o): o is BatchOutcome => !!o);
}

/**
 * The card's newest user batch whose answer changed something back, while that answer's version is still the head:
 * the open card says so ("Hermes hat … anders gemacht · Wiederherstellen"). A later Hermes or user version settles it.
 */
export function openUndone(fold: LiveFold, messages: readonly ChatMessage[], cardId: string): BatchOutcome | undefined {
  const card = fold.cards.get(cardId);
  if (!card) return undefined;
  const head = headOf(card);
  if (head.author !== 'hermes') return undefined;
  for (let i = card.versions.length - 1; i >= 0; i--) {
    const v = card.versions[i];
    if (v.author !== 'user') continue;
    const o = batchOutcome(fold, messages, v.key, cardId);
    return o?.state === 'changed' && o.answerN === head.n ? o : undefined;
  }
  return undefined;
}
