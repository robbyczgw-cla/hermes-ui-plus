/**
 * Settings → Chat → "Chats" (per device, preferences `chatScope`): which of the app's own Hermes chats the drawer lists.
 * Pure (node:test).
 *
 * - `all` (default): every Hermes UI chat, from every device (the app's sessions on the server, `hui-…`)
 * - `device`: only chats started on THIS device
 *
 * Rule: a chat counts as "created on this device" when it was started here – it was not taken from the Hermes
 * session list (`origin !== 'remote'`). The index knows that without any extra tracking: new chats, branches and
 * other backends are created locally; the session list only adds entries for sessions this install has never seen.
 * Opening or continuing a chat from another device does NOT make it this device's chat (it was not created here, and
 * a stable rule beats one that changes with every tap). Reinstalling the app or clearing its data therefore turns the
 * earlier chats into "other device" ones.
 *
 * Only the app's own chats are affected: Telegram / CLI / other API clients and cron reports keep following the
 * profile's switches ("Andere Hermes-Chats anzeigen", "Cron-Berichte anzeigen"). Hiding is a view filter: nothing is
 * deleted, switching back shows them at once.
 */
import type { ChatScopePref } from '../settings/preferences.ts';
import { isAppConversation } from './remoteSync.ts';
import type { ConversationMeta } from './types.ts';

export type ChatScope = ChatScopePref;

/** Was this chat started on this device (not taken from the Hermes session list)? */
export function createdOnThisDevice(c: ConversationMeta): boolean {
  return c.origin !== 'remote';
}

/** Does the drawer list this chat under the scope? */
export function inChatScope(c: ConversationMeta, scope: ChatScope): boolean {
  if (scope !== 'device') return true;
  return createdOnThisDevice(c) || !isAppConversation(c);
}

/** The chats of `items` the scope lists (`items` itself when nothing is hidden). */
export function filterChatScope<T extends ConversationMeta>(items: T[], scope: ChatScope): T[] {
  if (scope !== 'device') return items;
  const out = items.filter((c) => inChatScope(c, scope));
  return out.length === items.length ? items : out;
}
