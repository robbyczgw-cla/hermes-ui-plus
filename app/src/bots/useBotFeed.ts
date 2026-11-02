/**
 * The read-only sources of a bot's screen (bots/timeline.ts): the Bot Chat and any former one, from storage first, then
 * kept current on open, on foreground, on a delivery's inbox or push event and every POLL_MS while the screen shows
 * (without the bridge nothing else tells the app).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { liveDraftUris } from '../attachments/liveDrafts';
import { markRead, shellState } from '../background/noticeState';
import { fetchRemoteTranscript, type SyncProfile } from '../conversations/hermesSync';
import { useConversationsInternals } from '../conversations/ConversationsProvider';
import type { ConversationMeta } from '../conversations/types';
import { withBot } from '../hermes/bots';
import { hermesJsonRequest, hermesSessions } from '../hermes/client';
import { sessionErrorText } from '../hermes/sessions';
import { HermesError } from '../hermes/stream';
import type { ChatMessage } from '../hermes/types';
import { useT, type TFn } from '../i18n';
import { rebindBotChat } from './adopt';
import { lookupBotChat } from './api';
import { findBotChat } from './core';
import { syncBotFeed } from './feedSync';
import { isTalkOfBot, type BotFeed } from './timeline';

const POLL_MS = 60_000;
const NONE: readonly BotFeed[] = [];

export type BotFeedState = {
  /** the current Bot Chat first, then former ones */
  feeds: readonly BotFeed[];
  /** the current Bot Chat's rows, what the bot is told about (deliveryContext) */
  botChat: readonly ChatMessage[];
  /** visible row: a source could not be loaded (what's stored stays) */
  error?: string;
  retry(): void;
};

function failureText(e: unknown, tr: TFn, key: 'bots.feed.deliveriesFailed' | 'bots.feed.talkFailed'): string {
  if (e instanceof HermesError && (e.status === 401 || e.status === 403)) return sessionErrorText(e, tr);
  return tr(key);
}

const sameRows = (a: readonly ChatMessage[] | undefined, b: readonly ChatMessage[]) => !!a && a.length === b.length && a.at(-1)?.id === b.at(-1)?.id && a.at(-1)?.text === b.at(-1)?.text;

export function useBotFeed(talk: ConversationMeta | undefined, profile: SyncProfile & { id: string }, visible: boolean): BotFeedState {
  const { store, controller } = useConversationsInternals();
  const tr = useT();
  const on = !!talk?.botTalk;
  const bot = talk?.hermesProfile;
  const talkId = talk?.id;
  const profileId = talk?.profileId;
  // a string snapshot: every chat runs this hook, only a bot's talk may re-render on what changes here
  const snapshot = useCallback(() => {
    if (!on || !profileId) return '';
    const items = store.get().items;
    const chat = findBotChat(items, profileId, bot);
    const retired = items.filter((c) => c.botChatRetired && c.profileId === profileId && c.hermesProfile === bot).map((c) => c.id);
    return [chat?.id ?? '', chat?.remote?.lastActive ?? '', ...retired].join('\n');
  }, [on, profileId, bot, store]);
  const [chatId = '', lastActive = '', ...retired] = useSyncExternalStore(store.subscribe, snapshot, snapshot).split('\n');
  const retiredKey = retired.join('\n');
  const retiredIds = useMemo(() => (retiredKey ? retiredKey.split('\n') : []), [retiredKey]);
  const conn = useMemo(() => withBot(profile, bot), [profile, bot]);

  const [rows, setRows] = useState<Record<string, ChatMessage[]>>({});
  const [errors, setErrors] = useState<{ feed?: unknown; talk?: unknown }>({});
  const reload = useCallback(
    async (ids: readonly string[]) => {
      for (const id of ids) {
        const m = await controller.loadMessages(id).catch(() => null);
        if (m) setRows((p) => (sameRows(p[id], m) ? p : { ...p, [id]: m }));
      }
    },
    [controller],
  );

  const sources = useMemo(() => [...(chatId ? [chatId] : []), ...retiredIds], [chatId, retiredIds]);
  const running = useRef(false);
  // asked while a round runs (a push, a Bot Chat just adopted): one more round with the newest values
  const again = useRef(false);
  const latest = useRef<() => Promise<void>>(async () => {});
  const sync = useCallback(async () => {
    if (!talkId) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      const r = await syncBotFeed(
        {
          ctl: controller,
          now: Date.now,
          lookupBotChat: () => lookupBotChat(hermesJsonRequest(conn, 8000)),
          fetchTranscript: (sid) => fetchRemoteTranscript(conn, sid),
          fetchSession: (sid) => hermesSessions(conn, 8000).get(sid),
          findTalkSession: async (except) => {
            const page = await hermesSessions(conn, 8000).list({ source: 'api_server', limit: 100 });
            return page.sessions.filter((s) => s.id !== except && isTalkOfBot(s.id, bot)).sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0))[0] ?? null;
          },
          moveTalk: (id, sid) => controller.moveBotTalk(id, sid),
          holdTalkMove: () => liveDraftUris().length > 0,
          adopt: async (s, known) => {
            if (known) await rebindBotChat(controller, { id: profile.id, baseUrl: profile.baseUrl, apiKey: profile.apiKey }, bot, known, s, (c, id) => hermesSessions(c, 8000).get(id));
            else controller.openBotChat({ id: profile.id, kind: 'hermes' }, bot, s, { activate: false });
          },
        },
        { botChatId: chatId || undefined, retiredIds, talkId },
      );
      setErrors({ feed: r.feedError, talk: r.talkError });
      await reload(sources);
    } finally {
      running.current = false;
      if (again.current) {
        again.current = false;
        void latest.current();
      }
    }
  }, [talkId, controller, conn, profile.id, bot, chatId, retiredIds, reload, sources]);
  latest.current = sync;

  useEffect(() => {
    if (on) void reload(sources);
  }, [on, reload, sources]);

  // a delivery's inbox / push event lifts the Bot Chat's activity: fetch at once
  useEffect(() => {
    if (on && visible) void sync();
  }, [on, visible, lastActive, sync]);
  useEffect(() => {
    if (!on || !visible) return;
    const t = setInterval(() => void sync(), POLL_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      if (chatId) markRead(chatId);
      void sync();
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [on, visible, sync, chatId]);

  // the Bot Chat is on screen: its news is seen
  useLayoutEffect(() => {
    if (!on || !visible || !chatId) return;
    shellState.openBotChatId = chatId;
    markRead(chatId);
    return () => {
      if (shellState.openBotChatId === chatId) shellState.openBotChatId = null;
    };
  }, [on, visible, chatId, lastActive]);

  const feeds = useMemo<readonly BotFeed[]>(() => {
    if (!on) return NONE;
    return sources.map((id) => ({ key: id, sessionId: controller.get(id)?.hermesSessionId, messages: rows[id] ?? [], carried: controller.get(id)?.carriedTurns }));
  }, [on, sources, rows, controller]);
  const error = errors.feed ? failureText(errors.feed, tr, 'bots.feed.deliveriesFailed') : errors.talk ? failureText(errors.talk, tr, 'bots.feed.talkFailed') : undefined;
  return { feeds, botChat: (chatId && rows[chatId]) || [], error, retry: () => void sync() };
}
