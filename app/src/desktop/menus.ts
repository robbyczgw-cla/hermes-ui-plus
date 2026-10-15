/**
 * Menu bar + keyboard of the desktop app (mounted once via DesktopHost).
 *
 * - Keys: one capture-phase keydown listener maps the desktop shortcuts (desktop/keys.ts) to desktop commands –
 *   the same commands the menu bar sends; bridge.ts lets each press act once.
 * - Menu bar: labels in the app language and the first 9 chats of the sidebar ("Chat" menu, ⌘1–9; the dock menu
 *   shows 5 of them) go to the shell (`desktop_set_menu`, only when they change). "The sidebar" = what the drawer
 *   lists (conversations/drawerFilter.ts: build kinds, Settings → Chat → "Chats") in its order.
 * - Commands that need the app shell: Settings (⌘,), open the n-th / previous / next chat, stop the open chat's
 *   answer (⌘.). New chat / find / search / sidebar are handled where they always were (ChatScreen / ChatView via
 *   useKeyboardShortcuts); copying the last answer lives in chatCommands.ts.
 */
import { useRouter } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { shellState } from '../background/noticeState';
import { turnRegistry } from '../background/turnRegistry';
import { useConversations, type ConversationMeta } from '../conversations';
import { shownInDrawer } from '../conversations/drawerFilter';
import { useDrawerView } from '../conversations/useDrawerView';
import { useT, type TKey } from '../i18n';
import { useConnection } from '../settings/ConnectionProvider';
import { emitDesktopCommand, invokeDesktop, isDesktopMac, onDesktopEvent } from './bridge';
import { desktopKeyFor, neighbourChat } from './keys';
import { menuChats, sidebarOrder } from './order';

/** desktop.menu.* keys = the label keys of desktop/src-tauri/src/menus.rs */
const MENU_KEYS = [
  'about', 'settings', 'services', 'hide', 'hideOthers', 'showAll', 'quit', 'file', 'newChat', 'closeWindow', 'edit', 'undo',
  'redo', 'cut', 'copy', 'paste', 'selectAll', 'find', 'view', 'toggleSidebar', 'search', 'reload', 'fullscreen', 'chat', 'stop',
  'copyLast', 'focusComposer', 'prevChat', 'nextChat', 'window', 'minimize', 'zoom', 'bringAllToFront', 'showWindow', 'allowOnce',
  'deny',
] as const;

let keysInstalled = false;

function installDesktopKeys(): void {
  if (keysInstalled || typeof document === 'undefined') return;
  keysInstalled = true;
  const mac = isDesktopMac();
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.defaultPrevented) return;
      const ev = desktopKeyFor(e, mac);
      if (!ev) return;
      e.preventDefault();
      e.stopPropagation();
      // held ⌥⌘↓ walks through the chats; everything else acts once per press
      if (e.repeat && ev.cmd !== 'prev-chat' && ev.cmd !== 'next-chat') return;
      emitDesktopCommand(ev);
    },
    true,
  );
}

export function useDesktopMenus(): void {
  const tr = useT();
  const router = useRouter();
  const convs = useConversations();
  const conn = useConnection();
  const view = useDrawerView();
  const order = useMemo(() => sidebarOrder(convs.list, (m) => shownInDrawer(m, view)), [convs.list, view]);
  const labels = useMemo(() => Object.fromEntries(MENU_KEYS.map((k) => [k, tr(`desktop.menu.${k}` as TKey)])), [tr]);
  const recent = useMemo(() => menuChats(order, tr('desktop.untitled')), [order, tr]);
  const recentKey = JSON.stringify(recent);

  useEffect(() => installDesktopKeys(), []);

  useEffect(() => {
    const h = setTimeout(() => void invokeDesktop('desktop_set_menu', { labels, recent }), 250);
    return () => clearTimeout(h);
    // recentKey stands for `recent`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels, recentKey]);

  const latest = useRef({ order, convs, conn, router, view });
  useLayoutEffect(() => {
    latest.current = { order, convs, conn, router, view };
  });

  useEffect(
    () =>
      onDesktopEvent((e) => {
        const { order: o, convs: c, conn: cn, router: r, view: v } = latest.current;
        const toChat = () => {
          if (!shellState.chatFocused) r.navigate('/');
        };
        const open = (m: ConversationMeta | undefined) => {
          // a dock entry from before a filter change: never open what the drawer hides
          if (!m || !shownInDrawer(m, v)) return;
          if (m.profileId !== cn.active.id && cn.profiles.some((p) => p.id === m.profileId)) cn.setActive(m.profileId);
          c.setActiveId(m.id);
          toChat();
        };
        switch (e.cmd) {
          case 'settings':
            if (shellState.chatFocused) r.push('/settings');
            break;
          case 'new-chat':
          case 'focus-composer':
            toChat(); // ChatScreen creates the chat / focuses the composer
            break;
          case 'open-recent':
            open(e.index === undefined ? undefined : o[e.index]);
            break;
          case 'open-chat':
            open(e.id ? c.get(e.id) : undefined);
            break;
          case 'prev-chat':
          case 'next-chat': {
            const id = neighbourChat(
              o.map((m) => m.id),
              shellState.openConversationId,
              e.cmd === 'next-chat' ? 1 : -1,
            );
            open(id ? c.get(id) : undefined);
            break;
          }
          case 'stop': {
            const id = shellState.openConversationId;
            if (id && shellState.chatFocused) turnRegistry.stop(id);
            break;
          }
          default:
            break;
        }
      }),
    [],
  );
}
