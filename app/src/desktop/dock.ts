/**
 * Dock icon of the desktop app (mounted once via DesktopHost): badge = number of chats with an unread answer
 * (the drawer's dot), a small accent dot on the icon while an answer is being written. The dock menu (right-click:
 * New Chat + the 5 most recent chats) is fed by menus.ts (`desktop_set_menu`).
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { unreadStore } from '../background/noticeState';
import { turnRegistry } from '../background/turnRegistry';
import { useConversations } from '../conversations';
import { invokeDesktop } from './bridge';

export function useDesktopDock(): void {
  const convs = useConversations();
  const unread = useSyncExternalStore(unreadStore.subscribe, unreadStore.get, unreadStore.get);
  const running = useSyncExternalStore(turnRegistry.subscribe, turnRegistry.snapshot, turnRegistry.snapshot);
  // unread ids may outlive their chat (deleted / archived elsewhere): count what the list still shows
  const count = useMemo(() => [...unread].filter((id) => { const m = convs.get(id); return !!m && !m.archived; }).length, [unread, convs]);
  const busy = running.length > 0;
  useEffect(() => {
    void invokeDesktop('desktop_set_badge', { unread: count, running: busy });
  }, [count, busy]);
}
