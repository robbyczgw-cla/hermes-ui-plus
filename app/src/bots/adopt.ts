/**
 * A bot's "Bot Chat" known from the server only (a job delivered into it, an inbox event, a notification tap): the app's
 * conversation for it, adopted on first sight (bots/core.ts). Pure, the session fetch is injected (node:test).
 */
import { withBot } from '../hermes/bots.ts';
import type { RemoteSession } from '../hermes/sessions.ts';
import type { ConversationMeta, ProfileRef } from '../conversations/types.ts';
import { BOT_CHAT_TITLE, findBotChat } from './core.ts';

export type BotChatController = {
  list(): ConversationMeta[];
  openBotChat(profile: ProfileRef, bot: string | undefined, session: RemoteSession | null, opts?: { activate?: boolean }): ConversationMeta;
};

/**
 * The conversation of `sessionId` as the bot's Bot Chat: the existing one, else adopted from the server (never
 * activated). null when the app keeps another thread for this bot (an older server without the Bot Chat route) or the
 * session is no Bot Chat. Throws when the session cannot be read.
 */
export async function adoptBotChat(
  ctl: BotChatController,
  p: { id: string; baseUrl: string; apiKey: string },
  bot: string | undefined,
  sessionId: string,
  fetchSession: (conn: { baseUrl: string; apiKey: string }, id: string) => Promise<RemoteSession>,
): Promise<ConversationMeta | null> {
  const known = findBotChat(ctl.list(), p.id, bot);
  if (known) return known.hermesSessionId === sessionId ? known : null;
  const s = await fetchSession(withBot({ baseUrl: p.baseUrl, apiKey: p.apiKey }, bot), sessionId);
  if (s.title !== BOT_CHAT_TITLE) return null;
  return ctl.openBotChat({ id: p.id, kind: 'hermes' }, bot, s, { activate: false });
}
