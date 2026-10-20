/**
 * Live cards of one Hermes chat (design: private design/0.2/live-cards.md). Folds the chat's transcript (live/model.ts),
 * merges this device's pending edits (live/pending.ts, live/localStore.ts) and hands the edits to the send path
 * (`controllerRef.current.outgoing(text)`, read by hermes/useHermesChat.ts at send time).
 *
 * Without the provider (other backends, no session API) live nodes render as plain nodes.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject, type ReactNode } from 'react';
import type { ChatMessage } from '../hermes/types';
import { cachedSegments, storeSegments } from '../chat/parseCache';
import { parseMessage } from '../protocol/streamParser';
import { deriveCards, LOCAL_KEY, type LiveCardModel } from './derive.ts';
import { hermesMayHaveLost, liveEventsOf, mayCarryLiveNode, transcriptBids } from './extract.ts';
import { editTarget, liveHeader } from './focus.ts';
import { getLiveLocalStore } from './defaultStore';
import { EMPTY_RECORD, MAX_OWN, type LiveLocalRecord } from './localStore.ts';
import { diffFull, fitCategory, foldLive, headOf, snapshotOps, stateAt, type LiveCardState, type LiveCardType, type LiveEvent, type LiveFold, type LiveFull, type LiveItem, type LiveOp, type MessageMark } from './model.ts';
import { inferCategory } from '../ui/components/modules/a/checklistModel.ts';
import { addPendingOp, afterAccepted, isEmptyPending, newBatchId, newUserItemId, pruneInflight, type DeleteChoice, type FieldChoice, type PendingMap } from './pending.ts';
import { budgetBatch, fitTotal, type LiveBatches, type LiveTypes } from './trailer.ts';
import type { LiveOutgoing } from './outgoing.ts';
import { registerLiveTarget } from './registry.ts';
import { adoptId } from './adopt.ts';

export type LiveSheet = { kind: 'card'; id: string } | { kind: 'history'; id: string; n?: number } | { kind: 'list' };

export interface LiveContextValue {
  conversationId: string;
  /** the offline demo: no Hermes and no other devices, the cards live in this chat only (sync lines say so) */
  demo: boolean;
  cards: LiveCardModel[];
  byId: Map<string, LiveCardModel>;
  marks: Map<string, MessageMark[]>;
  fold: LiveFold;
  /** batch ids this device sent (history: "dieses Gerät") */
  ownBids: ReadonlySet<string>;
  /** one edit on this device (pending until the next message) */
  edit(cardId: string, op: LiveOp): void;
  /** "Auf vN zurück": the card back to the state of version `n`, as ordinary edits (nothing is rewritten) */
  revert(cardId: string, n: number): void;
  /**
   * "Als Live-Karte weiterführen": a plain list of this chat becomes a live card on this device (sent with the next
   * message). Returns the new card's id, or null (nothing to keep).
   */
  adopt(input: { id?: string; type: LiveCardType; state: LiveCardState; source?: string }): string | null;
  /** the live card a plain list of this chat became on this device (`source` = "<messageId>:<nodeId>") */
  adoptedFrom(source: string): LiveCardModel | undefined;
  /** "In die Live-Karte übernehmen": a plain list the fold did not apply becomes this device's edits of the card */
  takeOver(cardId: string, full: LiveFull): void;
  setChoice(cardId: string, key: string, choice: FieldChoice | DeleteChoice): void;
  confirmConflicts(cardId: string): void;
  markSeen(cardId: string): void;
  setPinned(cardId: string, pinned: boolean): void;
  /** "Hermes fragen": the next message is about this card (composer chip) */
  setFocus(cardId: string | null): void;
  focus: string | null;
  sheet: LiveSheet | null;
  openSheet(s: LiveSheet | null): void;
}

const LiveContext = createContext<LiveContextValue | null>(null);

export function useLive(): LiveContextValue | null {
  return useContext(LiveContext);
}

export function useLiveCard(id: string | undefined): LiveCardModel | undefined {
  const ctx = useLive();
  return id ? ctx?.byId.get(id) : undefined;
}

export interface LiveController {
  /** what the next message carries; `text` = what the user typed (edit requests re-send a card Hermes may have lost) */
  outgoing(text: string): LiveOutgoing | null;
}

const parse = (m: ChatMessage) => {
  const hit = cachedSegments(m.id, m.text);
  if (hit) return hit;
  const segs = parseMessage(m.text);
  storeSegments(m.id, m.text, segs);
  return segs;
};

/** Signature of the messages that can matter for the fold (streaming ticks of other answers do not refold). */
function liveSignature(messages: readonly ChatMessage[]): string {
  let sig = '';
  // once the chat has a card, every finished answer counts (a plain list may continue it, extract.ts)
  let any = false;
  for (const m of messages) {
    if (m.role === 'user') {
      if (!m.live) continue;
      any = true;
      sig += `${m.id}:${m.text.length}:${Object.keys(m.live).join('+')};`;
    } else if (m.status !== 'streaming' && (any || mayCarryLiveNode(m.text))) {
      any ||= mayCarryLiveNode(m.text);
      sig += `${m.id}:${m.text.length}:${m.status};`;
    }
  }
  return sig;
}

/** Cards made on this device that are not in the transcript yet, as first versions after it (live/derive.ts LOCAL_KEY). */
function localCreates(pending: PendingMap): Extract<LiveEvent, { kind: 'user' }>[] {
  const out: Extract<LiveEvent, { kind: 'user' }>[] = [];
  for (const [card, p] of Object.entries(pending)) {
    if (!p.create) continue;
    out.push({ kind: 'user', key: `${LOCAL_KEY}${card}`, at: p.create.at, card, batch: { v: 0, create: p.create.type, state: p.create.state, bid: p.create.bid } });
  }
  return out.sort((a, b) => a.at - b.at || (a.card < b.card ? -1 : 1));
}

export function LiveProvider({
  conversationId,
  messages,
  controllerRef,
  demo = false,
  children,
}: {
  conversationId: string;
  messages: readonly ChatMessage[];
  controllerRef: MutableRefObject<LiveController | null>;
  demo?: boolean;
  children: ReactNode;
}) {
  const store = getLiveLocalStore();
  useEffect(() => {
    void store.load(conversationId);
  }, [store, conversationId]);
  const rec: LiveLocalRecord = useSyncExternalStore(
    useCallback((fn) => store.subscribe(conversationId, fn), [store, conversationId]),
    () => store.get(conversationId),
    () => EMPTY_RECORD,
  );

  const sig = liveSignature(messages);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const creates = useMemo(() => localCreates(rec.pending), [rec.pending]);
  const createSig = creates.map((e) => `${e.card}:${e.batch.bid}`).join(',');
  const createsRef = useRef(creates);
  createsRef.current = creates;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refold only when a live-relevant message (or a local card) changed
  const fold = useMemo(() => foldLive([...liveEventsOf(messagesRef.current, parse), ...createsRef.current]), [sig, createSig]);
  const cards = useMemo(() => deriveCards(fold, rec), [fold, rec]);
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const foldRef = useRef(fold);
  foldRef.current = fold;
  const cardsRef = useRef(byId);
  cardsRef.current = byId;

  // sent edits (and cards made here) that reached the transcript leave the in-flight list; only bids of user messages
  // count, never the fold's (a local first version carries its own bid there)
  useEffect(() => {
    const bids = transcriptBids(messagesRef.current);
    if (!bids.size) return;
    store.update(conversationId, (r) => {
      let changed = false;
      const pending = { ...r.pending };
      for (const [id, p] of Object.entries(r.pending)) {
        const next = pruneInflight(p, bids);
        if (next === p) continue;
        changed = true;
        if (next) pending[id] = next;
        else delete pending[id];
      }
      return changed ? { ...r, pending } : r;
    });
  }, [fold, store, conversationId]);

  const editMany = useCallback(
    (cardId: string, ops: readonly LiveOp[]) => {
      const card = foldRef.current.cards.get(cardId);
      if (!card || !ops.length) return;
      const headN = headOf(card).n;
      store.update(conversationId, (r) => {
        let p = r.pending[cardId];
        for (const op of ops) p = addPendingOp(p, op, headN);
        return { ...r, pending: { ...r.pending, [cardId]: p } };
      });
    },
    [store, conversationId],
  );
  const edit = useCallback((cardId: string, op: LiveOp) => editMany(cardId, [op]), [editMany]);
  const revert = useCallback(
    (cardId: string, n: number) => {
      const model = cardsRef.current.get(cardId);
      if (!model || n < 1 || n >= model.head.n + (model.pendingCount ? 1 : 0)) return;
      editMany(cardId, snapshotOps(model.view.state, stateAt(model.card, n), model.type));
    },
    [editMany],
  );
  const adopt = useCallback(
    (input: { id?: string; type: LiveCardType; state: LiveCardState; source?: string }) => {
      if (!input.state.items.length) return null;
      const taken = new Set(foldRef.current.cards.keys());
      const id = adoptId(input.id, input.state.title, taken);
      const bid = newBatchId();
      store.update(conversationId, (r) => ({
        ...r,
        pending: { ...r.pending, [id]: { base: 1, ops: [], bid, create: { type: input.type, state: input.state, at: Date.now(), bid } } },
        unpinned: r.unpinned.filter((x) => x !== id),
        ...(input.source ? { adopted: { ...r.adopted, [input.source]: id } } : {}),
      }));
      return id;
    },
    [store, conversationId],
  );
  const takeOver = useCallback(
    (cardId: string, full: LiveFull) => {
      const model = cardsRef.current.get(cardId);
      if (!model) return;
      editMany(cardId, diffFull(model.view.state, { ...full, type: model.type }));
    },
    [editMany],
  );
  const patchPending = useCallback(
    (cardId: string, fn: (p: NonNullable<LiveLocalRecord['pending'][string]>) => LiveLocalRecord['pending'][string] | undefined) =>
      store.update(conversationId, (r) => {
        const p = r.pending[cardId];
        if (!p) return r;
        const next = fn(p);
        const pending = { ...r.pending };
        if (next && !isEmptyPending(next)) pending[cardId] = next;
        else delete pending[cardId];
        return { ...r, pending };
      }),
    [store, conversationId],
  );
  const setChoice = useCallback((cardId: string, key: string, choice: FieldChoice | DeleteChoice) => patchPending(cardId, (p) => ({ ...p, choices: { ...p.choices, [key]: choice } })), [patchPending]);
  const confirmConflicts = useCallback((cardId: string) => patchPending(cardId, (p) => ({ ...p, confirmed: true })), [patchPending]);
  const markSeen = useCallback(
    (cardId: string) => {
      const card = foldRef.current.cards.get(cardId);
      if (!card) return;
      const n = headOf(card).n;
      store.update(conversationId, (r) => (r.seen[cardId] === n ? r : { ...r, seen: { ...r.seen, [cardId]: n } }));
    },
    [store, conversationId],
  );
  const setPinned = useCallback(
    (cardId: string, pinned: boolean) =>
      store.update(conversationId, (r) => {
        const has = r.unpinned.includes(cardId);
        if (pinned !== has) return r;
        return { ...r, unpinned: pinned ? r.unpinned.filter((x) => x !== cardId) : [...r.unpinned, cardId] };
      }),
    [store, conversationId],
  );
  const [focus, setFocusState] = useState<string | null>(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const setFocus = useCallback((cardId: string | null) => setFocusState(cardId), []);
  const [sheet, openSheet] = useState<LiveSheet | null>(null);

  // the send path: this device's pending edits (+ the focused card) as trailer batches, the open cards as header
  controllerRef.current = {
    outgoing(text: string) {
      const r = store.get(conversationId);
      const f = focusRef.current;
      const models = Array.from(cardsRef.current.values());
      const open = models.filter((m) => !m.closed);
      // an edit request about the one fitting open card counts as about it (design §9.3, same rule as the router)
      const about = f ?? editTarget(text, open);
      const batches: LiveBatches = {};
      const types: LiveTypes = {};
      const sent: Record<string, { bid: string; count: number; newBase: number; created: boolean }> = {};
      for (const model of models) {
        const p = r.pending[model.id];
        const focused = f === model.id;
        const ops = model.view.outgoing;
        const create = p?.create && !p.create.sent ? p.create.type : undefined;
        // Hermes may have lost the card from its context: a message about it carries the whole card again
        const snapshot = !create && about === model.id && hermesMayHaveLost(messagesRef.current, model.card);
        if (!ops.length && !focused && !create && !snapshot) continue;
        const bid = p?.bid ?? newBatchId();
        const { batch, carried } = budgetBatch({ v: create ? 0 : (p?.base ?? model.head.n), ops, bid, focus: focused, create, snapshot }, model.view.state, model.type);
        batches[model.id] = batch;
        types[model.id] = model.type;
        sent[model.id] = { bid, count: p && carried === 'all' ? p.ops.length : 0, newBase: create ? 1 : model.head.n + (ops.length || snapshot ? 1 : 0), created: !!create };
      }
      const fitted = fitTotal(batches, types);
      const header = liveHeader(open.filter((m) => !m.local || fitted[m.id]), f);
      if (!Object.keys(fitted).length && !header) return null;
      return {
        batches: fitted,
        types,
        header,
        onAccepted: () => {
          if (!Object.keys(fitted).length) return;
          if (f && fitted[f]) setFocusState((cur) => (cur === f ? null : cur));
          store.update(conversationId, (rec) => {
            const pending = { ...rec.pending };
            for (const id of Object.keys(fitted)) {
              const s = sent[id];
              const p = pending[id];
              if (!s || !p) continue;
              const accepted = afterAccepted(p, s, s.newBase) ?? p;
              const next = s.created && accepted.create ? { ...accepted, create: { ...accepted.create, sent: true } } : accepted;
              if (!isEmptyPending(next)) pending[id] = { ...next, ...(next.ops.length ? {} : { choices: undefined, confirmed: undefined }) };
              else delete pending[id];
            }
            const own = [...(rec.own ?? []), ...Object.values(sent).map((x) => x.bid)].slice(-MAX_OWN);
            return { ...rec, pending, own };
          });
        },
      };
    },
  };

  // add_to_list: the newest open live list of this chat takes the items (actions/executor.ts)
  useEffect(
    () =>
      registerLiveTarget(conversationId, (items, listTitle) => {
        const open = Array.from(cardsRef.current.values()).filter((c) => !c.closed && c.type === 'checklist');
        const want = listTitle?.trim().toLowerCase();
        const target = (want && open.find((c) => c.title.toLowerCase().includes(want))) || open.find((c) => c.pinned) || open[0];
        if (!target) return null;
        const added: string[] = [];
        const reopened: string[] = [];
        for (const text of items) {
          const op = addOpFor(target.view.state.items, text);
          if (!op) continue;
          edit(target.id, op);
          ('uncheck' in op ? reopened : added).push(text);
        }
        return { cardId: target.id, title: target.title, added, reopened };
      }),
    [conversationId, edit],
  );

  const adoptedMap = rec.adopted;
  const adoptedFrom = useCallback((source: string) => {
    const id = adoptedMap?.[source];
    return id ? byId.get(id) : undefined;
  }, [adoptedMap, byId]);
  const ownBids = useMemo(() => new Set(rec.own ?? []), [rec.own]);
  const value = useMemo<LiveContextValue>(
    () => ({ conversationId, demo, cards, byId, marks: fold.marks, fold, ownBids, edit, revert, adopt, adoptedFrom, takeOver, setChoice, confirmConflicts, markSeen, setPinned, setFocus, focus, sheet, openSheet }),
    [conversationId, demo, cards, byId, fold, ownBids, edit, revert, adopt, adoptedFrom, takeOver, setChoice, confirmConflicts, markSeen, setPinned, setFocus, focus, sheet],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/** add_to_list item → op: an open duplicate is skipped, a ticked one reopened, else added with a `u-` id. */
function addOpFor(items: readonly LiveItem[], text: string): LiveOp | null {
  const t = text.trim();
  if (!t) return null;
  const hit = items.find((i) => i.text.trim().toLowerCase() === t.toLowerCase());
  if (hit) return hit.checked ? { uncheck: hit.id } : null;
  const category = fitCategory(inferCategory(t), items.map((i) => i.category));
  return { add: { id: newUserItemId(), text: t.slice(0, 300), ...(category ? { category } : {}) } };
}
