// Bubble actions of the user message that waits for its uploads (hermes/useHermesChat `pendingSend`), provided by
// ChatView, read by UserMessage: retry / remove a failed upload, cancel the send (its text returns to the composer).
import { createContext, useContext } from 'react';

export type PendingBubble = {
  messageId: string;
  retry(attachmentId: string): void;
  remove(attachmentId: string): void;
  cancel(): void;
};

export const PendingSendContext = createContext<PendingBubble | null>(null);

/** the actions when `messageId` is the message waiting for its uploads, else null */
export function usePendingBubble(messageId: string): PendingBubble | null {
  const c = useContext(PendingSendContext);
  return c && c.messageId === messageId ? c : null;
}
