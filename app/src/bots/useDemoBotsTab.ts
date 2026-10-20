/**
 * The Bots tab of the offline demo (onboarding/demo/bots.ts): the same roster, Bot Chats and "Neuer Bot" as with Hermes,
 * on invented data. The example bots' Bot Chats are made once with their short history (Scout's approval waits in
 * "Wartet auf dich" until it is answered); "Neuer Bot" adds a local bot that answers in its role with canned texts.
 * Nothing is sent anywhere. null = not the demo connection.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { unreadStore } from '../background/noticeState';
import { useRunningIds } from '../conversations/BulkDeleteDialog';
import { useConversations } from '../conversations/ConversationsProvider';
import type { ConversationMeta } from '../conversations/types';
import { botOf } from '../hermes/bots';
import { useHermesBots } from '../hermes/useHermesBots';
import { useLocale, useT } from '../i18n';
import { openPendingApproval } from '../push/approvalInbox';
import type { ConnectionProfile } from '../settings/profiles';
import { DEMO_SEEDED, demoBotHistory, demoCreate, SCOUT_APPROVAL, SCOUT_APPROVAL_WAIT_S, scoutDeliveredAt } from '../onboarding/demo/bots';
import { demoBotStore, useDemoBotsState } from '../onboarding/demo/botStore';
import { attentionOf, botKey, findBotChat, rosterRows, waitingSummary } from './core';
import type { CreateResult } from './create/api';
import type { CreatedBot } from './create/core';
import { attention, useAttention } from './state';
import type { BotsTab } from './useBotsTab';

const NONE: ReadonlySet<string> = new Set();

export function useDemoBotsTab(profile: ConnectionProfile | undefined, o: { enabled: boolean; onOpen(meta: ConversationMeta): void }): BotsTab | null {
  const tr = useT();
  const { lang } = useLocale();
  const convs = useConversations();
  const demo = profile?.kind === 'demo' ? profile : undefined;
  const state = useDemoBotsState();
  const { bots } = useHermesBots(demo);
  const available = o.enabled && !!demo && state.loaded;
  const profileId = demo?.id ?? '';
  const running = useRunningIds();
  const unread = useSyncExternalStore(unreadStore.subscribe, unreadStore.get, unreadStore.get);
  const allAttention = useAttention();
  const items = useMemo(() => attentionOf(allAttention, profileId), [allAttention, profileId]);

  // the example bots' Bot Chats with their history, made once (the roster shows their last line and time)
  const list = convs.list;
  useEffect(() => {
    if (!available || !demo) return;
    const now = Date.now();
    for (const b of DEMO_SEEDED) {
      if (findBotChat(list, demo.id, b.name)) continue;
      const seed = demoBotHistory(b.name, lang, now) ?? undefined;
      convs.openBotChat({ id: demo.id, kind: 'demo' }, b.name, null, { activate: false, seed });
    }
  }, [available, demo, list, lang, convs]);

  // Scout's approval waits in "Wartet auf dich" while its chat is not open (the open chat reports the same request)
  const scoutChat = available ? findBotChat(list, profileId, 'scout') : undefined;
  useEffect(() => {
    if (!scoutChat || state.scoutApproval !== 'waiting') return;
    if (allAttention.some((i) => i.requestId === SCOUT_APPROVAL.requestId)) return;
    const since = scoutDeliveredAt(Date.now()) + 80_000;
    attention.addInbox({ requestId: SCOUT_APPROVAL.requestId, runId: SCOUT_APPROVAL.runId, profileId, bot: 'scout', conversationId: scoutChat.id, since, expiresAt: Date.now() + SCOUT_APPROVAL_WAIT_S * 1000 });
  }, [scoutChat, state.scoutApproval, allAttention, profileId]);
  useEffect(() => {
    if (state.scoutApproval === 'answered') attention.resolve(SCOUT_APPROVAL.requestId);
  }, [state.scoutApproval]);

  const rows = useMemo(
    () => (available ? rosterRows({ bots, items: list, profileId, running, unread, attention: items }) : []),
    [available, bots, list, profileId, running, unread, items],
  );
  const nameOf = useCallback(
    (key: string) => {
      const b = bots.find((x) => (x.default ? 'default' : x.name) === key);
      return !b || b.default ? (b?.label ?? tr('bots.roster.defaultName')) : (b.label ?? b.name);
    },
    [bots, tr],
  );

  const live = useRef({ demo, convs, onOpen: o.onOpen, bots });
  useLayoutEffect(() => {
    live.current = { demo, convs, onOpen: o.onOpen, bots };
  });

  const open = useCallback((key: string) => {
    const { demo: p, convs: c, onOpen } = live.current;
    if (!p) return;
    const bot = botOf(key);
    onOpen(findBotChat(c.list, p.id, bot) ?? c.openBotChat({ id: p.id, kind: 'demo' }, bot, null));
  }, []);

  const openWaiting = useCallback(() => {
    const first = items[0];
    if (!first) return;
    const meta = first.conversationId ? live.current.convs.get(first.conversationId) : undefined;
    if (meta) {
      live.current.onOpen(meta);
      openPendingApproval(meta.id, first.runId);
      return;
    }
    open(botKey(first.bot));
  }, [items, open]);

  const createBot = useCallback(async (body: unknown): Promise<CreateResult> => {
    const r = demoCreate(body, live.current.bots, Date.now());
    if (!r.ok) return r;
    demoBotStore.addCreated(r.entry);
    return { ok: true, bot: r.bot };
  }, []);
  const created = useCallback((bot: CreatedBot) => open(bot.name), [open]);

  const waiting = useMemo(() => {
    const s = waitingSummary(items);
    return { count: s.count, names: s.bots.map(nameOf), first: s.first };
  }, [items, nameOf]);

  if (!available || !demo) return null;
  return {
    profileId, rows, waiting, nameOf, opening: null, notice: null, dismissNotice: () => {}, unreachable: NONE, open, openWaiting,
    refresh: () => {}, create: { kind: 'create' }, createBot, created, demo: true,
  };
}
