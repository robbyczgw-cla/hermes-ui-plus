/**
 * Live delivery into an OPEN chat: the session component of a conversation registers a handler; PushHost hands
 * inbox events for that conversation to it (merged into the chat hook state, persisted by the session's normal
 * persistence). Conversations that are not open are updated in storage by PushHost instead.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ChatMessage } from '../hermes/types';
import { registerApprovalOpener, type ApprovalOpener } from './approvalInbox';
import { createOpenChatApplier } from './inboxRouting';
import { mergeInboxMessage, type InboxEvent } from './model';

type Handler = (ev: InboxEvent) => void;
const open = new Map<string, Handler>();

/** true when an open chat took the event */
export function deliverToOpenChat(conversationId: string, ev: InboxEvent): boolean {
  const h = open.get(conversationId);
  if (!h) return false;
  h(ev);
  return true;
}

export function isChatOpen(conversationId: string): boolean {
  return open.has(conversationId);
}

/**
 * Hermes chats: an inbox event of the open chat's session goes to `handler` (completes an interrupted answer in
 * place, hermes/recovery.ts). The handler returns false when there was nothing to complete; the event is consumed
 * either way – the transcript sync (PushHost refreshes the session) brings everything else.
 */
export function useInboxHandler(conversationId: string | undefined, handler: (ev: InboxEvent) => boolean | void): void {
  const ref = useRef(handler);
  useLayoutEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!conversationId) return;
    const h: Handler = (ev) => void ref.current(ev);
    open.set(conversationId, h);
    return () => {
      if (open.get(conversationId) === h) open.delete(conversationId);
    };
  }, [conversationId]);
}

// ---- inbox stream (re)connected: a moment to look for answers that were lost with the connection
const connected = new Set<(profileId: string) => void>();

export function emitInboxConnected(profileId: string): void {
  for (const fn of connected) fn(profileId);
}

/** `fn` runs whenever the live inbox of `profileId` (re)connects. */
export function useInboxConnected(profileId: string | undefined, fn: () => void): void {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!profileId) return;
    const l = (id: string) => {
      if (id === profileId) ref.current();
    };
    connected.add(l);
    return () => {
      connected.delete(l);
    };
  }, [profileId]);
}

/**
 * For chat session components whose hook exposes `messages` + `replaceMessages` (agent servers).
 * Events that arrive while a turn streams are applied after the turn.
 */
export function useInboxDelivery(
  conversationId: string | undefined,
  chat: { messages: ChatMessage[]; status: string; replaceMessages?: (m: ChatMessage[]) => boolean },
): void {
  const ref = useRef(chat);
  useLayoutEffect(() => {
    ref.current = chat;
  });
  const pending = useRef<InboxEvent[]>([]);

  useEffect(() => {
    if (!conversationId) return;
    // several events in one tick: each merges into the previous one's result, not the stale ref (inboxRouting.ts)
    const apply = createOpenChatApplier(() => ref.current, pending.current);
    open.set(conversationId, apply);
    return () => {
      if (open.get(conversationId) === apply) open.delete(conversationId);
    };
  }, [conversationId]);

  useEffect(() => {
    if (chat.status === 'streaming' || !pending.current.length) return;
    let msgs = chat.messages;
    for (const ev of pending.current.splice(0)) msgs = mergeInboxMessage(msgs, ev) ?? msgs;
    if (msgs !== chat.messages) chat.replaceMessages?.(msgs);
  }, [chat.status, chat.messages, chat]);
}

/**
 * Hermes chats: lets a notification tap / banner bring the pending approval card of this conversation to the front
 * (`openPendingApproval`, push/approvalInbox.ts). Pass the chat hook's `openApproval` / `checkApprovals`.
 */
export function useApprovalOpener(conversationId: string | undefined, open: ApprovalOpener['open'] | undefined, check?: ApprovalOpener['check']): void {
  const ref = useRef({ open, check });
  useLayoutEffect(() => {
    ref.current = { open, check };
  });
  useEffect(() => {
    if (!conversationId) return;
    return registerApprovalOpener(conversationId, { open: (runId) => ref.current.open?.(runId), check: (runId) => ref.current.check?.(runId) });
  }, [conversationId]);
}
