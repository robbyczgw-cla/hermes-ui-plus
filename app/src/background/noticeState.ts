/**
 * Runtime state behind the "Antwort ist da" notices (pure module state, node:test – no React Native imports):
 *  - answer-ready bus: chat sessions / PushHost report finished answers, BackgroundTurnHost delivers them
 *  - unread conversations (drawer dot until opened; persisted by the host)
 *  - "Neue Antwort ↓" pill per conversation and the short "fertig/nachgeladen" flash per message
 *  - what the chat shell shows (open chat, focus, scrolled to bottom) for the routing
 */
import type { ChatMessage } from '../hermes/types.ts';
import { createNoticeDeduper, isFinishedAnswer, noticeKey, routeNotice, type NoticeContext, type NoticeEvent, type NoticeRoute } from './notice.ts';

type Listener = () => void;

/** tiny observable value store (useSyncExternalStore-friendly: snapshot identity changes only on change) */
export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      for (const fn of listeners) fn();
    },
    subscribe(fn: Listener) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

// ------------------------------------------------------------------ shell state (set by ChatScreen / MessageList)

export const shellState = {
  openConversationId: null as string | null,
  chatFocused: true,
  /** conversation id → list scrolled to the newest message */
  nearBottom: new Map<string, boolean>(),
};

export function setNearBottom(conversationId: string | undefined, v: boolean): void {
  if (!conversationId) return;
  shellState.nearBottom.set(conversationId, v);
  if (v) clearPill(conversationId);
}

// ------------------------------------------------------------------ unread / pill / flash

/** conversations with an answer the user has not seen yet */
export const unreadStore = createStore<ReadonlySet<string>>(new Set());

export function markUnread(id: string): void {
  const cur = unreadStore.get();
  if (cur.has(id)) return;
  unreadStore.set(new Set([...cur, id]));
}

export function markRead(id: string): void {
  const cur = unreadStore.get();
  if (!cur.has(id)) return;
  const next = new Set(cur);
  next.delete(id);
  unreadStore.set(next);
}

/** conversation id → message id of the new answer below the visible area */
export const pillStore = createStore<ReadonlyMap<string, string>>(new Map());

export function showPill(conversationId: string, messageId: string): void {
  const next = new Map(pillStore.get());
  next.set(conversationId, messageId);
  pillStore.set(next);
}

export function clearPill(conversationId: string): void {
  const cur = pillStore.get();
  if (!cur.has(conversationId)) return;
  const next = new Map(cur);
  next.delete(conversationId);
  pillStore.set(next);
}

export const FLASH_MS = 2600;
/** message id → flash end (ms) */
export const flashStore = createStore<ReadonlyMap<string, number>>(new Map());

export function flash(messageId: string, now: number): void {
  const next = new Map(flashStore.get());
  for (const [id, until] of next) if (until <= now) next.delete(id);
  next.set(messageId, now + FLASH_MS);
  flashStore.set(next);
}

// ------------------------------------------------------------------ answer-ready bus

const readyListeners = new Set<(ev: NoticeEvent) => void>();

/** a finished answer of a conversation (any backend, any delivery path) */
export function emitAnswerReady(ev: NoticeEvent): void {
  if (!isFinishedAnswer(ev.message)) return;
  for (const fn of readyListeners) fn(ev);
}

export function onAnswerReady(fn: (ev: NoticeEvent) => void): () => void {
  readyListeners.add(fn);
  return () => {
    readyListeners.delete(fn);
  };
}

/** answers that were completed in `after` by a recovery path (Hermes inbox / stored session / transcript sync) */
export function recoveredAnswers(before: readonly ChatMessage[], after: readonly ChatMessage[]): ChatMessage[] {
  const prev = new Map(before.map((m) => [m.id, m]));
  return after.filter((m) => m.recoveredAt !== undefined && isFinishedAnswer(m) && prev.has(m.id) && prev.get(m.id)?.status !== 'done');
}

// ------------------------------------------------------------------ delivery

export type NoticeDeps = {
  context(): NoticeContext;
  /** "Benachrichtigen, wenn eine Antwort fertig ist" */
  enabled(): boolean;
  notify(ev: NoticeEvent): void;
  banner(ev: NoticeEvent): void;
  now(): number;
};

/** de-duplicates, routes and executes one notice; returns what was done ('none' for duplicates) */
export function createNoticeDelivery(deps: NoticeDeps) {
  const dedupe = createNoticeDeduper();
  return function deliver(ev: NoticeEvent): NoticeRoute {
    if (!isFinishedAnswer(ev.message) || !dedupe.first(noticeKey(ev))) return 'none';
    const route = routeNotice(ev, deps.context());
    switch (route) {
      case 'notification':
        markUnread(ev.conversationId);
        if (deps.enabled()) {
          const notify = () => deps.notify(ev);
          if (ev.written) void ev.written.then(notify, notify);
          else notify();
        }
        break;
      case 'banner':
        markUnread(ev.conversationId);
        if (deps.enabled()) deps.banner(ev);
        break;
      case 'pill':
        showPill(ev.conversationId, ev.message.id);
        break;
      case 'flash':
        flash(ev.message.id, deps.now());
        break;
      default:
        break;
    }
    return route;
  };
}
