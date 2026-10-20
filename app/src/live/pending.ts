/**
 * Pending edits: what the user changed on THIS device that is not in Hermes' history yet (design §6.2, §10).
 *
 * Ops are recorded as made, with the head version number the device had at the first one (`base`). For display and
 * sending they are compacted and rebased onto the current head. Rebase rules:
 * - ticks always win and never conflict;
 * - a field both sides changed to different values = a conflict, default = the own value;
 * - an item Hermes removed that the user ticked or edited = a conflict, default = leave it out (delete wins);
 * - an item the user deleted is gone, whatever Hermes changed on it;
 * - the user's choice becomes ordinary ops, so other devices fold to the same result without knowing of a conflict.
 */
import {
  applyOps,
  ITEM_FIELDS,
  headOf,
  normText,
  opTarget,
  patchOf,
  sameValue,
  stateAt,
  type ItemField,
  type ItemPatch,
  type LiveCardType,
  type LiveCard,
  type LiveCardState,
  type LiveItem,
  type LiveOp,
} from './model.ts';

export type FieldChoice = 'mine' | 'theirs';
export type DeleteChoice = 'drop' | 'keep';

export interface PendingCard {
  /** head version number when the first of these ops was made */
  base: number;
  ops: LiveOp[];
  /** batch id of the next send; a new one after each accepted send */
  bid: string;
  /** the next message is about this card ("Hermes fragen") */
  focus?: boolean;
  /**
   * the user made a plain list a live card on this device ("Als Live-Karte weiterführen"): until the transcript has
   * `bid`, the card exists only here (LiveProvider folds it as a local first version) and the next message sends it
   */
  create?: { type: LiveCardType; state: LiveCardState; at: number; bid: string; sent?: boolean };
  /** conflict key → the user's choice */
  choices?: Record<string, FieldChoice | DeleteChoice>;
  /** the user looked at the conflicts and confirmed ("Übernehmen") */
  confirmed?: boolean;
  /**
   * sent and accepted by Hermes, not yet seen in the transcript: still shown (re-applying them is a no-op once the
   * transcript has them), never sent again; dropped when the fold has `bid` (pruneInflight)
   */
  inflight?: { bid: string; base: number; ops: LiveOp[] };
}

export type PendingMap = Record<string, PendingCard>;

export type Conflict =
  | {
      key: string;
      kind: 'field';
      id: string;
      text: string;
      field: ItemField;
      /** the item's unit (shown next to a quantity) */
      unit?: string;
      theirs: unknown;
      mine: unknown;
      /** the version that changed it on the other side */
      theirsBy: 'hermes' | 'user';
      theirsAt: number;
      choice: FieldChoice;
    }
  | {
      key: string;
      kind: 'deleted';
      id: string;
      text: string;
      /** the item as the user would keep it (their edits applied) */
      item: LiveItem;
      checked: boolean;
      theirsBy: 'hermes' | 'user';
      theirsAt: number;
      choice: DeleteChoice;
    };

export interface PendingView {
  /** the card as this device shows it: head + resolved pending ops */
  state: LiveCardState;
  /** compacted, resolved ops that the next message carries */
  outgoing: LiveOp[];
  conflicts: Conflict[];
  /** items the user added (pending) / ticked or edited (pending) */
  ownAdded: Set<string>;
  ownTouched: Set<string>;
}

/** Fresh batch id (only uniqueness matters; the fold never compares ids by value otherwise). */
export function newBatchId(rand: () => number = Math.random): string {
  return `b-${Date.now().toString(36)}${Math.floor(rand() * 0xffffff).toString(36)}`;
}

/** Fresh id for an item the user adds: `u-` + short random (never collides with Hermes' slugs). */
export function newUserItemId(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(rand() * 36)];
  return `u-${s}`;
}

/** Record one op: a new pending card starts at the current head. */
export function addPendingOp(p: PendingCard | undefined, op: LiveOp, headN: number, bid: () => string = newBatchId): PendingCard {
  if (!p) return { base: headN, ops: [op], bid: bid() };
  const { confirmed: _confirmed, ...rest } = p;
  return { ...rest, ops: [...p.ops, op] };
}

/**
 * Net effect of a list of ops relative to `ref`: tick + untick cancel, add + del cancel, sets merge (fields equal
 * to `ref` drop), edits of an own new item fold into its add. Output order: by the item's first op.
 */
export function compactOps(ops: readonly LiveOp[], ref: LiveCardState): LiveOp[] {
  type Acc = { add?: LiveItem; deleted?: boolean; patch: ItemPatch; checked?: boolean; place?: { after?: string | null; to?: string }; moved?: boolean };
  const byId = new Map<string, Acc>();
  const order: string[] = [];
  const card: LiveOp[] = [];
  const refById = new Map(ref.items.map((it) => [it.id, it]));
  for (const op of ops) {
    const id = opTarget(op);
    if (id === undefined) {
      card.push(op);
      continue;
    }
    let a = byId.get(id);
    if (!a) {
      a = { patch: {} };
      byId.set(id, a);
      order.push(id);
    }
    if ('add' in op) {
      a.add = { ...op.add };
      a.deleted = false;
      if (op.after !== undefined || op.to) a.place = { ...(op.after !== undefined ? { after: op.after } : {}), ...(op.to ? { to: op.to } : {}) };
    } else if ('move' in op) {
      // the last move wins; an own new item just gets a new place
      a.place = { ...(op.after !== undefined ? { after: op.after } : {}), ...(op.to ? { to: op.to } : {}) };
      if (!a.add) a.moved = true;
    } else if ('del' in op) {
      if (a.add) {
        byId.delete(id);
        order.splice(order.indexOf(id), 1);
      } else a.deleted = true;
    } else if ('set' in op) {
      if (a.add) a.add = mergePatch(a.add, patchOf(op));
      else Object.assign(a.patch, patchOf(op));
    } else if ('check' in op || 'uncheck' in op) {
      const v = 'check' in op;
      if (a.add) {
        if (v) a.add.checked = true;
        else delete a.add.checked;
      } else a.checked = v;
    }
  }
  const out: LiveOp[] = [];
  for (const id of order) {
    const a = byId.get(id);
    if (!a) continue;
    const r = refById.get(id);
    if (a.add) {
      out.push({ add: a.add, ...a.place });
      continue;
    }
    if (a.deleted) {
      out.push({ del: id });
      continue;
    }
    const patch: ItemPatch = {};
    for (const f of ITEM_FIELDS) {
      if (!(f in a.patch)) continue;
      const v = a.patch[f];
      if (r && sameValue(r[f], v)) continue;
      (patch as Record<string, unknown>)[f] = v;
    }
    if (Object.keys(patch).length) out.push({ set: id, ...patch });
    if (a.checked !== undefined && (!r || !!r.checked !== a.checked)) out.push(a.checked ? { check: id } : { uncheck: id });
    if (a.moved) out.push({ move: id, ...a.place });
  }
  return [...out, ...card];
}

function mergePatch(item: LiveItem, patch: ItemPatch): LiveItem {
  const out = { ...item };
  for (const f of ITEM_FIELDS) {
    if (!(f in patch)) continue;
    const v = patch[f];
    if (f === 'text' && !String(v ?? '').trim()) continue;
    if (v === null || v === undefined || v === '') delete out[f];
    else (out as unknown as Record<string, unknown>)[f] = v;
  }
  return out;
}

/** Who changed `id` (field, or removed it) first after version `base`, for the conflict card ("Hermes, 17:58"). */
function changedBy(card: LiveCard, base: number, id: string, field?: ItemField): { by: 'hermes' | 'user'; at: number } {
  for (const v of card.versions) {
    if (v.n <= base) continue;
    for (const op of v.ops) {
      if (opTarget(op) !== id) continue;
      if (field ? 'set' in op && field in op : 'del' in op) return { by: v.author, at: v.at };
    }
  }
  const head = headOf(card);
  return { by: head.author, at: head.at };
}

/** Rebase this device's pending ops onto the card's head: the view, the conflicts and what to send. */
export function rebasePending(card: LiveCard, p: PendingCard | undefined): PendingView {
  const head = headOf(card);
  const empty = { state: head.state, outgoing: [], conflicts: [], ownAdded: new Set<string>(), ownTouched: new Set<string>() };
  if (!p || (!p.ops.length && !p.focus)) return empty;
  const baseState = stateAt(card, p.base);
  const headById = new Map(head.state.items.map((it) => [it.id, it]));
  const baseById = new Map(baseState.items.map((it) => [it.id, it]));
  const moved = head.n > p.base;
  const conflicts: Conflict[] = [];
  const outgoing: LiveOp[] = [];
  const ownAdded = new Set<string>();
  const ownTouched = new Set<string>();
  const ops = compactOps(p.ops, head.state);
  // kept-after-delete items collect all of the user's ops on them
  const deleted = new Map<string, { item: LiveItem; checked: boolean; touched: boolean }>();
  for (const op of ops) {
    const id = opTarget(op);
    if (id === undefined) {
      outgoing.push(op);
      continue;
    }
    if ('add' in op) {
      // both added the same open item (Hermes meanwhile): keep Hermes' one, carry the tick over
      const twin = moved && !baseById.has(id) ? head.state.items.find((it) => !baseById.has(it.id) && !it.checked && normText(it.text) === normText(op.add.text) && (it.unit ?? '') === (op.add.unit ?? '')) : undefined;
      if (twin) {
        if (op.add.checked) {
          outgoing.push({ check: twin.id });
          ownTouched.add(twin.id);
        }
        continue;
      }
      outgoing.push(op);
      ownAdded.add(id);
      continue;
    }
    const inHead = headById.get(id);
    if (!inHead) {
      const was = baseById.get(id);
      if (!was || 'del' in op || 'move' in op) continue; // never existed here / both deleted / moving a gone item
      const d = deleted.get(id) ?? { item: { ...was }, checked: !!was.checked, touched: false };
      if ('set' in op) d.item = mergePatch(d.item, patchOf(op));
      if ('check' in op) d.checked = true;
      if ('uncheck' in op) d.checked = false;
      d.touched = true;
      deleted.set(id, d);
      continue;
    }
    if ('set' in op) {
      const baseItem = baseById.get(id);
      const patch: ItemPatch = {};
      for (const f of ITEM_FIELDS) {
        if (!(f in op)) continue;
        const mine = op[f] ?? undefined;
        const theirs = inHead[f];
        const before = baseItem?.[f];
        const changedThere = moved && !sameValue(before, theirs);
        if (changedThere && !sameValue(theirs, mine)) {
          const key = `field:${id}:${f}`;
          const choice = (p.choices?.[key] as FieldChoice | undefined) ?? 'mine';
          const by = changedBy(card, p.base, id, f);
          conflicts.push({ key, kind: 'field', id, text: inHead.text, field: f, ...(inHead.unit ? { unit: inHead.unit } : {}), theirs, mine, theirsBy: by.by, theirsAt: by.at, choice });
          if (choice === 'theirs') continue;
        }
        (patch as Record<string, unknown>)[f] = op[f];
      }
      if (Object.keys(patch).length) {
        outgoing.push({ set: id, ...patch });
        ownTouched.add(id);
      }
      continue;
    }
    outgoing.push(op);
    ownTouched.add(id);
  }
  for (const [id, d] of deleted) {
    const key = `deleted:${id}`;
    const choice = (p.choices?.[key] as DeleteChoice | undefined) ?? 'drop';
    const by = changedBy(card, p.base, id);
    const item = { ...d.item, ...(d.checked ? { checked: true } : {}) };
    if (!d.checked) delete item.checked;
    conflicts.push({ key, kind: 'deleted', id, text: d.item.text, item, checked: d.checked, theirsBy: by.by, theirsAt: by.at, choice });
    if (choice === 'keep') {
      outgoing.push({ add: item });
      ownAdded.add(id);
    }
  }
  const state = applyOps(head.state, outgoing).state;
  return { state, outgoing, conflicts, ownAdded, ownTouched };
}

/** Number of user-visible changes waiting ("2 Änderungen noch nicht bei Hermes"). */
export function pendingCount(view: PendingView): number {
  return view.outgoing.filter((op) => !('order' in op)).length;
}

/**
 * After Hermes accepted a message that carried the first `count` ops of this batch: they move to `inflight` (shown
 * until the transcript has them), later ops (made while the message was on its way) stay pending under a new batch id
 * and `newBase` = the head that will include the sent batch (so own sent edits never read as the other side's).
 */
export function afterAccepted(p: PendingCard | undefined, sent: { bid: string; count: number }, newBase: number, bid: () => string = newBatchId): PendingCard | undefined {
  if (!p || p.bid !== sent.bid) return p;
  const rest = p.ops.slice(sent.count);
  const inflight = { bid: sent.bid, base: p.base, ops: [...(p.inflight?.ops ?? []), ...p.ops.slice(0, sent.count)] };
  return { base: newBase, ops: rest, bid: bid(), inflight };
}

/** Drop the in-flight ops (and a local first version) once the transcript has their batch; nothing left = removed. */
export function pruneInflight(p: PendingCard | undefined, bids: ReadonlySet<string>): PendingCard | undefined {
  if (!p) return p;
  const dropInflight = !!p.inflight && bids.has(p.inflight.bid);
  const dropCreate = !!p.create && bids.has(p.create.bid);
  if (!dropInflight && !dropCreate) return p;
  const { inflight, create, ...rest } = p;
  const next: PendingCard = { ...rest, ...(inflight && !dropInflight ? { inflight } : {}), ...(create && !dropCreate ? { create } : {}) };
  return next.ops.length || next.focus || next.inflight || next.create ? next : undefined;
}

/** True when nothing is pending and nothing is in flight (the record can go). */
export function isEmptyPending(p: PendingCard | undefined): boolean {
  return !p || (!p.ops.length && !p.focus && !p.inflight && !p.create);
}

/**
 * The device's view of a card: in-flight + pending ops rebased onto the head (display), and what the next message
 * sends (pending only).
 */
export function viewOf(card: LiveCard, p: PendingCard | undefined): PendingView {
  if (!p?.inflight) return rebasePending(card, p);
  const send = rebasePending(card, p);
  const all = rebasePending(card, { ...p, base: p.inflight.base, ops: [...p.inflight.ops, ...p.ops] });
  return { ...all, outgoing: send.outgoing, conflicts: send.conflicts };
}
