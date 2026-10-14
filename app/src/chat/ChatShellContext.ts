import { createContext, useContext } from 'react';
import type { RemoteActions } from '../conversations';

/**
 * What the chat shell (ChatScreen) hands to every session component and its ChatView without
 * extra props (so backend session components stay uniform):
 * the open conversation id and the Hermes session-sync actions (title PATCH).
 */
export type ChatShell = {
  conversationId: string;
  /** from useHermesSessionSync(); undefined outside the chat screen */
  remote?: RemoteActions;
  /**
   * the conversation is not the open one: its session stays mounted only because a turn is still running
   * (background/turnRegistry). ChatView renders nothing then; the hooks keep streaming and persisting.
   */
  hidden?: boolean;
};

export const ChatShellContext = createContext<ChatShell | null>(null);

export function useChatShell(): ChatShell | null {
  return useContext(ChatShellContext);
}
