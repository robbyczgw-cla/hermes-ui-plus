/**
 * A bot's "Bot Chat" known from the server only (a job delivered into it, an inbox event, a notification tap): the app's
 * conversation for it, adopted on first sight (bots/core.ts). Pure, the session fetch is injected (node:test).
 *
 * The server's Bot Chat can change under a known one: Hermes v0.22.3+ moves a Bot Chat it cannot own (an API session a
 * bridge created under an older Hermes) aside as "Bot Chat (API <id>)" at the next delivery and mints a new one. The app
 * then follows it (rebindBotChat), else that delivery and every later one would never reach this entry.
 */
import { withBot } from '../hermes/bots.ts';
import type { RemoteSession } from '../hermes/sessions.ts';
import type { ConversationMeta, ProfileRef } from '../conversations/types.ts';
import { BOT_CHAT_TITLE, findBotChat } from './core.ts';

export type BotChatController = {
  list(): ConversationMeta[];
  openBotChat(profile: ProfileRef, bot: string | undefined, session: RemoteSession | null, opts?: { activate?: boolean }): ConversationMeta;
  /** absent: the caller only looks a Bot Chat up, it never follows a moved one (null, see rebindBotChat) */
  retireBotChat?(id: string, title?: string, remoteCount?: number): boolean;
};

type FetchSession = (conn: { baseUrl: string; apiKey: string }, id: string) => Promise<RemoteSession>;

/**
 * `server` is the bot's Bot Chat on the server, `known` the app's and a different session. When `known` no longer is one
 * (another title, or gone) it stays as an ordinary chat and `server` becomes the entry, the open chat moves along. null:
 * `known` still has the title (two sessions titled exactly so, or a thread of this app on an older server), it stays.
 * Throws when `known` cannot be read, so a failed request never changes anything.
 */
export async function rebindBotChat(
  ctl: Pick<BotChatController, 'openBotChat'> & Required<Pick<BotChatController, 'retireBotChat'>>,
  p: { id: string; baseUrl: string; apiKey: string },
  bot: string | undefined,
  known: ConversationMeta,
  server: RemoteSession,
  fetchSession: FetchSession,
): Promise<ConversationMeta | null> {
  let row: RemoteSession | undefined;
  try {
    row = await fetchSession(withBot({ baseUrl: p.baseUrl, apiKey: p.apiKey }, bot), known.hermesSessionId!);
  } catch (e) {
    if ((e as { status?: number } | null)?.status !== 404) throw e;
  }
  if (row?.title === BOT_CHAT_TITLE) return null;
  const wasOpen = ctl.retireBotChat(known.id, row?.title, row?.messageCount);
  return ctl.openBotChat({ id: p.id, kind: 'hermes' }, bot, server, { activate: wasOpen });
}

/**
 * The conversation of `sessionId` as the bot's Bot Chat: the existing one, else adopted from the server (never
 * activated), also when it replaces a Bot Chat the server moved aside. null when the app keeps another thread for this
 * bot (rebindBotChat) or the session is no Bot Chat. Throws when a session cannot be read.
 */
export async function adoptBotChat(
  ctl: BotChatController,
  p: { id: string; baseUrl: string; apiKey: string },
  bot: string | undefined,
  sessionId: string,
  fetchSession: FetchSession,
): Promise<ConversationMeta | null> {
  const known = findBotChat(ctl.list(), p.id, bot);
  if (known?.hermesSessionId === sessionId) return known;
  const s = await fetchSession(withBot({ baseUrl: p.baseUrl, apiKey: p.apiKey }, bot), sessionId);
  if (s.title !== BOT_CHAT_TITLE) return null;
  if (known) return ctl.retireBotChat ? rebindBotChat({ openBotChat: ctl.openBotChat, retireBotChat: ctl.retireBotChat }, p, bot, known, s, fetchSession) : null;
  return ctl.openBotChat({ id: p.id, kind: 'hermes' }, bot, s, { activate: false });
}
