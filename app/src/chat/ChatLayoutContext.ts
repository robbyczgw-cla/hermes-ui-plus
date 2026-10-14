import { createContext, useContext } from 'react';

/**
 * Wide-screen shell state for the chat header (ChatScreen provides it): `wide` = window ≥ 900 px (persistent
 * sidebar instead of the drawer), `sidebarOpen` = the sidebar is shown (the header then drops its toggle).
 */
export type ChatLayout = { wide: boolean; sidebarOpen: boolean };

export const ChatLayoutContext = createContext<ChatLayout>({ wide: false, sidebarOpen: false });

export function useChatLayout(): ChatLayout {
  return useContext(ChatLayoutContext);
}
