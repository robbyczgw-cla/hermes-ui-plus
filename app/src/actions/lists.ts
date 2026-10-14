/**
 * add_to_list support: append items to the conversation's latest checklist through nodestate.
 *
 * CONTRACT with the checklist module (see INTEGRATION.md): a checklist node persists its state with
 * `useNodeState<ChecklistNodeState>(node.id, …)` where the state has `kind: 'checklist'`,
 * `createdAt` (message order key) and `items` (the FULL, materialised list). The module writes this
 * state on mount (so untouched lists are discoverable) and always renders from `state.items`.
 */
import { splitNodeKey, type ConversationRecord } from '../nodestate/model.ts';
import type { NodeStateStore } from '../nodestate/store.ts';
import { listBus, type ListBus } from './listBus.ts';

export type ChecklistStateItem = {
  id: string;
  text: string;
  checked: boolean;
  qty?: string | number;
  unit?: string;
  category?: string;
  note?: string;
};

export type ChecklistNodeState = {
  kind: 'checklist';
  title?: string;
  /** ordering key between checklists of a conversation (epoch ms of the message/node creation) */
  createdAt: number;
  items: ChecklistStateItem[];
  [extra: string]: unknown;
};

export const CHECKLIST_STATE_VERSION = 1;
export const DEFAULT_LIST_TITLE = 'Einkaufsliste';

export function isChecklistState(x: unknown): x is ChecklistNodeState {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return o.kind === 'checklist' && Array.isArray(o.items) && typeof o.createdAt === 'number';
}

/**
 * `createdAt` for a checklist: the creation time of its MESSAGE (NodeScope.createdAt), so the order
 * between lists follows the conversation and not which list happened to render first (e.g. scrolling
 * up on a new device). `now` only outside a message scope.
 */
export function checklistCreatedAt(messageCreatedAt: number | undefined, now: number): number {
  return typeof messageCreatedAt === 'number' && Number.isFinite(messageCreatedAt) ? messageCreatedAt : now;
}

/**
 * A stored list whose `createdAt` is not its message's time (materialised at first render by older
 * builds) → the corrected state; null when nothing to fix.
 */
export function withMessageCreatedAt<S extends ChecklistNodeState>(state: S, messageCreatedAt: number | undefined): S | null {
  if (typeof messageCreatedAt !== 'number' || !Number.isFinite(messageCreatedAt) || state.createdAt === messageCreatedAt) return null;
  return { ...state, createdAt: messageCreatedAt };
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Pick the checklist to append to: a title match (if `listTitle` given) wins, otherwise the one with
 * the highest `createdAt` (ties: latest `updatedAt`).
 */
export function pickChecklist(rec: ConversationRecord, listTitle?: string): { key: string; state: ChecklistNodeState } | null {
  const all: { key: string; state: ChecklistNodeState; updatedAt: number }[] = [];
  for (const [key, node] of Object.entries(rec)) if (isChecklistState(node.data)) all.push({ key, state: node.data, updatedAt: node.updatedAt });
  if (!all.length) return null;
  const newest = (xs: typeof all) => [...xs].sort((a, b) => b.state.createdAt - a.state.createdAt || b.updatedAt - a.updatedAt || (a.key < b.key ? -1 : 1))[0];
  if (listTitle) {
    const t = norm(listTitle);
    const hit = all.filter((x) => x.state.title && norm(x.state.title) === t);
    if (hit.length) return newest(hit);
  }
  return newest(all);
}

export type AppendOutcome = { state: ChecklistNodeState; added: string[]; reopened: string[]; skipped: string[] };

/**
 * Append items (case-insensitive de-dup). An existing CHECKED item is un-checked ("reopened");
 * an existing unchecked one is skipped.
 */
export function appendItems(state: ChecklistNodeState, items: readonly string[], newId: () => string): AppendOutcome {
  const next = state.items.map((i) => ({ ...i }));
  const added: string[] = [];
  const reopened: string[] = [];
  const skipped: string[] = [];
  for (const raw of items) {
    const text = raw.trim();
    if (!text) continue;
    const hit = next.find((i) => norm(i.text) === norm(text));
    if (hit) {
      if (hit.checked) {
        hit.checked = false;
        reopened.push(text);
      } else skipped.push(text);
      continue;
    }
    next.push({ id: newId(), text, checked: false });
    added.push(text);
  }
  return { state: { ...state, items: next }, added, reopened, skipped };
}

export type AppendResult =
  | { status: 'appended'; key: string; messageId: string; nodeId: string; added: string[]; reopened: string[]; skipped: string[] }
  /** No checklist in this conversation: the caller (UI) must create a local "Einkaufsliste". */
  | { status: 'no_checklist'; listTitle: string; items: string[] };

let seq = 0;
const defaultNewId = () => `li-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export type AppendOptions = {
  store: NodeStateStore;
  bus?: ListBus;
  newId?: () => string;
};

/**
 * Append `items` to the latest checklist of `conversationId` (persisted via nodestate; mounted
 * checklist nodes update through their `useNodeState` subscription) and publish `items_added`.
 * Without any checklist returns `{status:'no_checklist'}` and publishes nothing — the executor then
 * publishes `create_list`.
 */
export async function appendToLatestChecklistWith(
  o: AppendOptions,
  conversationId: string,
  items: readonly string[],
  listTitle?: string,
): Promise<AppendResult> {
  const rec = await o.store.getRecord(conversationId);
  const picked = pickChecklist(rec, listTitle);
  if (!picked) return { status: 'no_checklist', listTitle: listTitle?.trim() || DEFAULT_LIST_TITLE, items: [...items] };
  const out = appendItems(picked.state, items, o.newId ?? defaultNewId);
  const version = rec[picked.key]?.v ?? CHECKLIST_STATE_VERSION;
  if (out.added.length || out.reopened.length) {
    if (!o.store.set(conversationId, picked.key, out.state, version)) throw new Error('Checkliste ist zu groß');
  }
  const { messageId, nodeId } = splitNodeKey(picked.key);
  (o.bus ?? listBus).publish({ type: 'items_added', conversationId, messageId, nodeId, added: out.added, reopened: out.reopened, skipped: out.skipped });
  return { status: 'appended', key: picked.key, messageId, nodeId, added: out.added, reopened: out.reopened, skipped: out.skipped };
}
