/**
 * Fold + this device's record → what the UI shows per card (tray rows, open card, receipts). Pure.
 */
import { diffStates, headOf, opTarget, patchesSinceFull, progressOf, type LiveCard, type LiveCardType, type LiveFold, type LiveItem, type LiveOp, type LiveVersion } from './model.ts';
import { pendingCount, viewOf, type PendingView } from './pending.ts';
import type { LiveLocalRecord } from './localStore.ts';

/** Version key of a card made on this device that is not in the transcript yet. */
export const LOCAL_KEY = 'local:';

export interface LiveCardModel {
  id: string;
  type: LiveCardType;
  card: LiveCard;
  head: LiveVersion;
  view: PendingView;
  title: string;
  progress: { done: number; total: number };
  pendingCount: number;
  /** conflicts the user has not confirmed yet */
  openConflicts: number;
  pinned: boolean;
  closed: boolean;
  /** a version newer than the one last looked at */
  unread: boolean;
  /** items Hermes added or changed since the version last looked at ("neu") */
  fresh: Set<string>;
  /** version number `fresh` counts from (the one last looked at): "15:00 → 11:00" compares against its state */
  since: number;
  /** items the head version (by Hermes) removed: "In v5 entfernt: Tomaten · Zurückholen" */
  removed: LiveItem[];
  /** version number of `removed` */
  removedIn?: number;
  /** last change on this card (sort key) */
  changedAt: number;
  /** Hermes patches since its last full version (X-HUI-Live `p<N>`) */
  patches: number;
  /** the card exists only on this device so far (made from a plain list, not sent yet) */
  local: boolean;
}

/** Version number the "neu" highlights count from: the last one looked at, or (never opened) the one before the head. */
export function seenBase(card: LiveCard, seen: number | undefined): number {
  const head = headOf(card);
  return seen ?? Math.max(1, head.n - 1);
}

export function freshItems(card: LiveCard, since: number): Set<string> {
  const out = new Set<string>();
  for (const v of card.versions) {
    if (v.n <= since || v.n === 1 || v.author !== 'hermes') continue;
    for (const op of v.ops) {
      const id = opTarget(op);
      if (id && ('add' in op || 'set' in op)) out.add(id);
    }
  }
  return out;
}

export function deriveCards(fold: LiveFold, rec: LiveLocalRecord): LiveCardModel[] {
  const out: LiveCardModel[] = [];
  const own = new Set(rec.own ?? []);
  for (const card of fold.cards.values()) {
    const head = headOf(card);
    const p = rec.pending[card.id];
    const view = viewOf(card, p);
    const state = view.state;
    const prev = card.versions[card.versions.length - 2];
    const removed = head.author === 'hermes' && prev ? diffStates(prev.state, head.state).filter((c) => c.kind === 'removed').map((c) => c.item) : [];
    // a removed item the user already brought back (pending) is not offered again
    const present = new Set(state.items.map((it) => it.id));
    const stillRemoved = removed.filter((it) => !present.has(it.id));
    const since = seenBase(card, rec.seen[card.id]);
    const fresh = freshItems(card, since);
    // a dot only for versions this device did not make itself (Hermes, or edits sent from another device)
    const unread = card.versions.some((v) => v.n > since && !(v.author === 'user' && v.bid && own.has(v.bid)));
    out.push({
      id: card.id,
      type: card.type,
      card,
      head,
      view,
      title: state.title || card.id,
      progress: progressOf(state),
      pendingCount: pendingCount(view),
      openConflicts: p?.confirmed ? 0 : view.conflicts.length,
      pinned: !rec.unpinned.includes(card.id),
      closed: !!state.closed,
      unread,
      fresh,
      since,
      removed: stillRemoved,
      ...(stillRemoved.length ? { removedIn: head.n } : {}),
      changedAt: Math.max(head.at, 0),
      patches: patchesSinceFull(card),
      local: !!p?.create && card.versions[0]?.bid === p.create.bid && card.versions[0].key.startsWith(LOCAL_KEY),
    });
  }
  // most recently changed first; ties (same message) by id, stable on every device
  return out.sort((a, b) => b.changedAt - a.changedAt || b.head.n - a.head.n || (a.id < b.id ? -1 : 1));
}

/** Tray rows: pinned open cards, at most `max`, the rest counted. */
export function trayCards(cards: readonly LiveCardModel[], max = 3): { rows: LiveCardModel[]; more: number } {
  const pinned = cards.filter((c) => c.pinned && !c.closed);
  return { rows: pinned.slice(0, max), more: Math.max(0, pinned.length - max) };
}

/**
 * What a version changed when no item changed (its receipt would be empty otherwise): the order ("Milch, Brot und
 * Tomaten stehen oben"), card fields (title, days, map), or the card was closed / reopened.
 */
export function cardLevelChange(ops: readonly LiveOp[]): 'order' | 'meta' | 'closed' | 'reopened' | undefined {
  if (ops.some((op) => 'close' in op)) return 'closed';
  if (ops.some((op) => 'reopen' in op)) return 'reopened';
  if (ops.some((op) => 'meta' in op)) return 'meta';
  if (ops.some((op) => 'order' in op || 'move' in op)) return 'order';
  return undefined;
}
