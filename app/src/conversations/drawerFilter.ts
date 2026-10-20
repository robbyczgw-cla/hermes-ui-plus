/**
 * Which chats the drawer lists (pure, node:test): this build's kinds (flavor.ts) and Settings → Chat → "Chats"
 * (chatScope.ts).
 * Everything else that lists chats as "the sidebar" uses the same rule – the desktop app's Chat / Dock menus and
 * ⌘1–9 (desktop/menus.ts) – so a chat hidden in the drawer never shows up or opens there. Archived chats are the
 * caller's business (drawer: own section).
 */
import { isConversationVisible } from '../flavor.ts';
import { inChatScope, type ChatScope } from './chatScope.ts';
import type { ConversationMeta } from './types.ts';

export type DrawerView = {
  chatScope: ChatScope;
  /**
   * no Bots tab (bots/): the default bot's Bot Chat is listed like a chat once it has messages, as "Hermes" (reminders and
   * routine results of a normal user land there). Every other Bot Chat lives in the Bots tab only.
   */
  defaultBotChat?: boolean;
};

export function shownInDrawer(m: ConversationMeta, v: DrawerView): boolean {
  // a bot's "Bot Chat" lives in the Bots tab (bots/), never in the desktop menus; without a Bots tab the default bot's
  // thread is listed once it has messages
  if (m.botChat && !(v.defaultBotChat && !m.hermesProfile && (m.messageCount > 0 || m.preview !== ''))) return false;
  if (!isConversationVisible(m) || !inChatScope(m, v.chatScope)) return false;
  return true;
}

/** the chats of `items` the drawer lists (`items` itself when nothing is hidden) */
export function filterDrawer<T extends ConversationMeta>(items: T[], v: DrawerView): T[] {
  const out = items.filter((m) => shownInDrawer(m, v));
  return out.length === items.length ? items : out;
}
