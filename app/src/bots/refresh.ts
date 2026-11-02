/**
 * Last activity of bots' Bot Chats (bots/core.ts), looked up when the drawer opens (Bots tab: every bot; without a Bots
 * tab: the default bot, whose thread holds the reminders and routine results of a normal user). Lookup only, never
 * creates a session: a thread with messages is adopted (not activated), newer activity is marked unread and fetched when
 * the chat opens. At most every 30 s per connection unless forced; failures keep what the app has.
 */
import { markUnread, shellState } from '../background/noticeState';
import { botOf, withBot, type HermesBot } from '../hermes/bots';
import { hermesJsonRequest, hermesSessions } from '../hermes/client';
import type { ConversationsApi } from '../conversations/ConversationsProvider';
import type { ConversationMeta } from '../conversations/types';
import { rebindBotChat } from './adopt';
import { lookupBotChat } from './api';
import { findBotTalk } from './core';
import { setUnreachable } from './state';

/** the bot's merged screen (bots/timeline.ts) is what's open: its news is seen */
function botScreenOpen(chat: ConversationMeta, list: readonly ConversationMeta[]): boolean {
  return shellState.openConversationId === findBotTalk(list, chat.profileId, chat.hermesProfile)?.id;
}

const REFRESH_MS = 30_000;
/** never look up more bots than this in one refresh */
const REFRESH_MAX = 12;
const last = new Map<string, number>();

type Conn = { id: string; kind: 'hermes'; baseUrl: string; apiKey: string };
type Convs = Pick<ConversationsApi, 'list' | 'openBotChat' | 'retireBotChat' | 'botChatRemote'>;

export function refreshBotChats(p: Conn, bots: readonly Pick<HermesBot, 'name' | 'default'>[], convs: () => Convs, force = false): void {
  const key = `${p.id}|${bots.map((b) => b.name).join(',')}`;
  if (!force && Date.now() - (last.get(key) ?? 0) < REFRESH_MS) return;
  last.set(key, Date.now());
  void (async () => {
    for (const b of bots.slice(0, REFRESH_MAX)) {
      const bot = b.default ? undefined : b.name;
      const k = b.default ? 'default' : b.name;
      try {
        const s = await lookupBotChat(hermesJsonRequest(withBot({ baseUrl: p.baseUrl, apiKey: p.apiKey }, bot), 8000));
        setUnreachable(`${p.id}/${k}`, false);
        if (!s) continue;
        const c = convs();
        const meta = c.list.find((m) => m.botChat && m.profileId === p.id && botOf(m.hermesProfile) === botOf(bot));
        if (!meta) {
          if (s.messageCount > 0) c.openBotChat({ id: p.id, kind: p.kind }, bot, s, { activate: false });
          continue;
        }
        if (meta.hermesSessionId !== s.id) {
          // moved aside by the server: the new one takes over, what it holds is news. Still titled: leave it
          const next = await rebindBotChat(c, p, bot, meta, s, (conn, id) => hermesSessions(conn, 8000).get(id));
          if (next && s.messageCount > 0 && shellState.openConversationId !== next.id && !botScreenOpen(next, c.list)) markUnread(next.id);
          continue;
        }
        const seen = meta.remote?.loadedAt ?? meta.updatedAt;
        c.botChatRemote(meta.id, { lastActive: s.lastActive, remoteCount: s.messageCount });
        if (s.lastActive && s.lastActive > seen + 1000 && shellState.openConversationId !== meta.id && shellState.openBotChatId !== meta.id) markUnread(meta.id);
      } catch (e) {
        const status = (e as { status?: number } | null)?.status;
        if (status === 401 || status === 403) setUnreachable(`${p.id}/${k}`, true);
      }
    }
  })();
}
