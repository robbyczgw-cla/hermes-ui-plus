/**
 * Live inbox → conversation routing (agent servers with an inbox). Pure, erasable TS (node:test);
 * PushHost wires it to the conversation controller and the open-chat bus.
 *
 * Races: `readInbox` delivers every frame of a chunk synchronously (a reconnect with `since=` replays all
 * missed messages at once). Each event is load → merge → save, so concurrent events for one chat would merge
 * into the same old list and the last save would win. `createKeyedQueue` runs the jobs of one key (profile)
 * strictly one after another, so every event sees the previous one's result.
 */
import type { ChatMessage } from '../hermes/types.ts';
import type { ConversationMeta, ProfileRef } from '../conversations/types.ts';
import { applyInboxAnswer } from '../hermes/recovery.ts';
import { inboxToMessage, mergeInboxMessage, pickConversation, type InboxEvent, type PushProfile } from './model.ts';

/** Run async jobs serially per key (different keys run concurrently). A failing job does not stop the queue. */
export function createKeyedQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return function run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve();
    const next = prev.then(job, job);
    const tail = next.catch(() => {});
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return next;
  };
}

export type InboxRoutingDeps = {
  controller: {
    list(): ConversationMeta[];
    get(id: string): ConversationMeta | undefined;
    loadMessages(id: string): Promise<ChatMessage[]>;
    save(id: string, messages: ChatMessage[]): void;
    create(profile: ProfileRef, opts?: { fresh?: boolean }): ConversationMeta;
    setModel(id: string, model: string | undefined): void;
    /** bind a conversation to the server thread an event came from */
    setSessionId?(id: string, sessionId: string): void;
  };
  /** id of the open conversation */
  activeId(): string | undefined;
  /** hand the event to the mounted chat of that conversation; false = not open */
  deliverToOpenChat(conversationId: string, ev: InboxEvent): boolean;
};

export type InboxRouteResult = { conversationId: string; via: 'open' | 'stored' | 'created'; /** stored path: the answer this event completed */ recovered?: ChatMessage } | null;

/**
 * Put one inbox event into the right conversation (run it inside the per-profile queue):
 * 1. the chat of that agent (pickConversation), or the open EMPTY draft of this profile when it is set to
 *    exactly that agent → live into the open chat when mounted, else merged into the stored transcript
 * 2. otherwise a NEW conversation for that agent; the open chat (e.g. an empty draft of another agent) is
 *    never taken over and stays active
 */
export async function routeInboxEvent(deps: InboxRoutingDeps, p: Pick<PushProfile, 'id' | 'kind' | 'model'>, ev: InboxEvent): Promise<InboxRouteResult> {
  const ctl = deps.controller;
  let conv = pickConversation(ctl.list(), p, ev);
  const activeId = deps.activeId();
  const activeMeta = activeId ? ctl.get(activeId) : undefined;
  // agent fallback only for default-thread events: an explicit session never lands in another thread (Astra F09)
  if (!conv && !ev.sessionId && activeMeta && activeMeta.profileId === p.id && !activeMeta.preview && (activeMeta.model ?? p.model) === ev.agent) conv = activeMeta;
  if (conv) {
    if (deps.deliverToOpenChat(conv.id, ev)) return { conversationId: conv.id, via: 'open' };
    const msgs = await ctl.loadMessages(conv.id);
    const next = mergeInboxMessage(msgs, ev);
    if (next) ctl.save(conv.id, next);
    return { conversationId: conv.id, via: 'stored' };
  }
  const created = ctl.create({ id: p.id, kind: p.kind as ProfileRef['kind'] }, { fresh: true });
  if (ev.agent && ev.agent !== p.model) ctl.setModel(created.id, ev.agent);
  // follow-ups continue the thread that produced this answer, not a newly generated local session
  if (ev.sessionId) ctl.setSessionId?.(created.id, ev.sessionId);
  ctl.save(created.id, [inboxToMessage(ev)]);
  return { conversationId: created.id, via: 'created' };
}

/**
 * Hermes: an inbox event of a session completes the conversation's interrupted answer (the app lost the stream,
 * the bridge kept the run going, hermes/recovery.ts). The conversation is the one with `hermesSessionId ===
 * ev.sessionId` – never a new chat. Open chat → its handler; otherwise the stored transcript is updated in place.
 * Nothing interrupted → nothing changes here (the session refresh + transcript sync bring other messages).
 */
export async function recoverFromInbox(
  deps: Pick<InboxRoutingDeps, 'deliverToOpenChat'> & { controller: Pick<InboxRoutingDeps['controller'], 'list' | 'loadMessages' | 'save'> },
  p: Pick<PushProfile, 'id' | 'kind' | 'model'>,
  ev: InboxEvent,
): Promise<InboxRouteResult> {
  if (!ev.sessionId) return null;
  const conv = pickConversation(deps.controller.list(), p, ev);
  if (!conv) return null;
  if (deps.deliverToOpenChat(conv.id, ev)) return { conversationId: conv.id, via: 'open' };
  const before = await deps.controller.loadMessages(conv.id);
  const next = applyInboxAnswer(before, ev);
  if (next) deps.controller.save(conv.id, next);
  const recovered = next?.find((m, i) => m !== before[i] && m.recoveredAt !== undefined);
  return { conversationId: conv.id, via: 'stored', ...(recovered ? { recovered } : {}) };
}

type OpenChat = { messages: ChatMessage[]; status: string; replaceMessages?: (m: ChatMessage[]) => boolean };

/**
 * Applier for an OPEN chat (useInboxDelivery). The hook state behind `get()` is refreshed only after a
 * render, so several events in one tick would each merge into the same stale list and the last
 * `replaceMessages` would drop the others. The applier therefore merges into the list it handed to
 * `replaceMessages` last (as long as the hook has not moved on). Events refused while a turn runs are queued.
 */
export function createOpenChatApplier(get: () => OpenChat, pending: InboxEvent[]) {
  let mine: { base: ChatMessage[]; list: ChatMessage[] } | null = null;
  return (ev: InboxEvent) => {
    const c = get();
    // the hook still shows the list before our last replace (no render yet) → continue from ours
    const current = mine && c.messages === mine.base ? mine.list : c.messages;
    const next = mergeInboxMessage(current, ev);
    if (!next) return;
    if (c.status === 'streaming' || !c.replaceMessages?.(next)) {
      if (!pending.some((p) => p.id === ev.id)) pending.push(ev); // applied when the turn ends
      return;
    }
    mine = { base: mine && c.messages === mine.base ? mine.base : c.messages, list: next };
  };
}
