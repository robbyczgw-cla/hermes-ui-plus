// Bubble actions of the user message that waits for its uploads (hermes/useHermesChat `pendingSend`), provided by
// ChatView, read by UserMessage: retry / remove a failed upload, cancel the send (its text returns to the composer).
import { createContext, useContext } from 'react';
import type { QueuedState } from '../hermes/pendingSend';

export type PendingBubble = {
  messageId: string;
  retry(attachmentId: string): void;
  remove(attachmentId: string): void;
  cancel(): void;
};

export const PendingSendContext = createContext<PendingBubble | null>(null);

/**
 * Bubble actions of user messages queued when the app stopped while their uploads ran (`sendQueued`,
 * hermes/pendingSend.ts): "Erneut senden" / "Verwerfen" (its text goes back into the composer).
 */
export type QueuedBubble = {
  state(messageId: string): QueuedState;
  /** another turn of this chat is running: "Erneut senden" waits */
  busy: boolean;
  resend(messageId: string): void;
  discard(messageId: string): void;
};

export const QueuedSendContext = createContext<QueuedBubble | null>(null);

export function useQueuedBubble(): QueuedBubble | null {
  return useContext(QueuedSendContext);
}

/** the actions when `messageId` is the message waiting for its uploads, else null */
export function usePendingBubble(messageId: string): PendingBubble | null {
  const c = useContext(PendingSendContext);
  return c && c.messageId === messageId ? c : null;
}
