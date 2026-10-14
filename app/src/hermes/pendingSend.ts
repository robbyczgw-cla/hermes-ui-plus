// Transcript side of "Send while uploads are still running" (pure, pendingSend.test.ts). useHermesChat shows the
// user message at once (`sendPending`, per-attachment upload state), keeps its attachments in step with the
// uploads (attachments/pendingUploads.ts) and, once every upload is done, turns it into a normal user message +
// the assistant placeholder of the turn that starts then. Cancel removes it again.
import type { Attachment } from '../attachments/types';
import { createAssistantMessage } from './chatState.ts';
import type { ChatMessage } from './types';

/** The pending user message's attachments changed. A transcript replaced meanwhile (recovery / sync) gets it back. */
export function patchPendingAttachments(list: readonly ChatMessage[], pending: ChatMessage, atts: Attachment[]): { list: ChatMessage[]; message: ChatMessage } {
  const i = list.findIndex((m) => m.id === pending.id);
  const base = i === -1 ? pending : list[i];
  const message: ChatMessage = { ...base, attachments: atts.length ? atts : undefined, sendPending: true };
  if (i === -1) return { list: [...list, message], message };
  const next = list.slice();
  next[i] = message;
  return { list: next, message };
}

/**
 * Every upload is done: the user message becomes a normal one carrying the sent attachments (remote refs), followed
 * by the assistant placeholder of the turn. The pending message moves to the end if anything was appended after it.
 */
export function releasePending(list: readonly ChatMessage[], pending: ChatMessage, sent: Attachment[], now: number): ChatMessage[] {
  const cur = list.find((m) => m.id === pending.id) ?? pending;
  const { sendPending: _p, attachments: _a, ...rest } = cur;
  const user: ChatMessage = { ...rest, ...(sent.length ? { attachments: sent } : {}) };
  return [...list.filter((m) => m.id !== pending.id), user, createAssistantMessage(now)];
}

/** Cancelled: the message goes (nothing was sent to the model). */
export function dropPending(list: readonly ChatMessage[], id: string): ChatMessage[] {
  return list.some((m) => m.id === id) ? list.filter((m) => m.id !== id) : (list as ChatMessage[]);
}

/** A send whose message would be empty once its attachments are gone (text only whitespace, nothing attached). */
export function pendingIsEmpty(text: string, atts: readonly Attachment[]): boolean {
  return !text.trim() && atts.length === 0;
}

/** The transcript still waits for uploads (last message is a pending user message): counts as a running turn. */
export function hasPendingSend(list: readonly ChatMessage[]): boolean {
  const last = list[list.length - 1];
  return !!last && last.role === 'user' && !!last.sendPending;
}
