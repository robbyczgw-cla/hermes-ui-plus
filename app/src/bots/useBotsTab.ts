/**
 * The drawer's Bots tab for the active connection (bots/core.ts): roster rows, "Wartet auf dich", opening a bot's Bot
 * Chat (adopt or create on the server, bots/api.ts) and a refresh of every bot's last activity. null = no Bots tab
 * (not a Hermes connection, no bot besides the default, or the caller passes `enabled: false`): the app looks exactly
 * like before. The offline demo gets its own tab with invented bots (bots/useDemoBotsTab.ts).
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { unreadStore } from '../background/noticeState';
import { useRunningIds } from '../conversations/BulkDeleteDialog';
import { useConversations } from '../conversations/ConversationsProvider';
import type { ConversationMeta } from '../conversations/types';
import { botOf, withBot, type HermesBot } from '../hermes/bots';
import { hermesJsonRequest } from '../hermes/client';
import { ensureBots, useHermesBots } from '../hermes/useHermesBots';
import { useT } from '../i18n';
import { openPendingApproval } from '../push/approvalInbox';
import type { ConnectionProfile } from '../settings/profiles';
import { resolveBotChat } from './api';
import { refreshBotChats } from './refresh';
import { attentionOf, botKey, botsTabAvailable, rosterRows, waitingSummary, type AttentionItem, type RosterRow } from './core';
import { setUnreachable, useAttention, useUnreachable } from './state';
import type { CreateResult } from './create/api';
import { createOffer, createShowsTab, type CreatedBot, type CreateOffer } from './create/core';
import { useBotCreate } from './create/useBotCreate';
import { useDemoBotsTab } from './useDemoBotsTab';

export type BotsTab = {
  profileId: string;
  rows: RosterRow[];
  waiting: { count: number; names: string[]; first: AttentionItem | null };
  /** display name of a bot key (`default` → "Hermes" or its label) */
  nameOf(key: string): string;
  /** the bot whose Bot Chat is being opened */
  opening: string | null;
  /** last problem opening / refreshing, shown in the tab until dismissed */
  notice: { key: string; text: string } | null;
  dismissNotice(): void;
  /** bot keys the server refused (profile without its key) */
  unreachable: ReadonlySet<string>;
  open(key: string): void;
  openWaiting(): void;
  refresh(force?: boolean): void;
  /** creating bots here (bots/create/): the button, the owner's note, or null (not offered) */
  create: CreateOffer;
  createBot(body: unknown): Promise<CreateResult>;
  /** a bot was made: reload the list, then open its Bot Chat */
  created(bot: CreatedBot): void;
  /** the offline demo's tab (bots/useDemoBotsTab.ts): invented bots, made on this device only */
  demo?: true;
};

export function useBotsTab(profile: ConnectionProfile | undefined, o: { enabled: boolean; onOpen(meta: ConversationMeta): void }): BotsTab | null {
  const tr = useT();
  const convs = useConversations();
  // the offline demo has a Bots tab of its own (invented bots, nothing on a server)
  const demoTab = useDemoBotsTab(profile, o);
  const hermes = profile?.kind === 'hermes' ? profile : undefined;
  const { bots } = useHermesBots(hermes);
  const { config: createConfig, refresh: refreshCreate, create: createBot } = useBotCreate(hermes);
  const available = o.enabled && !!hermes && botsTabAvailable(hermes.kind, bots, createShowsTab(createConfig));
  const running = useRunningIds();
  const unread = useSyncExternalStore(unreadStore.subscribe, unreadStore.get, unreadStore.get);
  const allAttention = useAttention();
  const refused = useUnreachable();
  const [opening, setOpening] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ key: string; text: string } | null>(null);
  const profileId = hermes?.id ?? '';

  const attention = useMemo(() => attentionOf(allAttention, profileId), [allAttention, profileId]);
  const rows = useMemo(
    () => (available ? rosterRows({ bots, items: convs.list, profileId, running, unread, attention }) : []),
    [available, bots, convs.list, profileId, running, unread, attention],
  );
  const byKey = useMemo(() => new Map<string, HermesBot>(bots.map((b) => [b.default ? 'default' : b.name, b])), [bots]);
  const nameOf = useCallback(
    (key: string) => {
      const b = byKey.get(key);
      if (!b || b.default) return b?.label ?? tr('bots.roster.defaultName');
      return b.label ?? b.name;
    },
    [byKey, tr],
  );
  const unreachable = useMemo(() => {
    const out = new Set<string>();
    for (const k of refused) if (k.startsWith(`${profileId}/`)) out.add(k.slice(profileId.length + 1));
    return out;
  }, [refused, profileId]);

  // callbacks read the latest values (stable identities for the drawer rows)
  const live = useRef({ hermes, convs, onOpen: o.onOpen, opening, nameOf });
  useLayoutEffect(() => {
    live.current = { hermes, convs, onOpen: o.onOpen, opening, nameOf };
  });

  const open = useCallback(
    (key: string) => {
      const { hermes: p, convs: c, onOpen, opening: busy, nameOf: name } = live.current;
      if (!p || busy) return;
      const bot = botOf(key);
      const ref = { id: p.id, kind: p.kind } as const;
      const known = c.list.find((m) => m.botChat && m.profileId === p.id && botOf(m.hermesProfile) === bot);
      if (known) {
        setNotice(null);
        onOpen(known);
        return;
      }
      setOpening(key);
      setNotice(null);
      void resolveBotChat(hermesJsonRequest(withBot({ baseUrl: p.baseUrl, apiKey: p.apiKey }, bot)))
        .then((r) => {
          if (r.ok) {
            setUnreachable(`${p.id}/${key}`, false);
            onOpen(c.openBotChat(ref, bot, r.session));
          } else if (r.reason === 'unsupported') {
            // an older bridge / Hermes without the session API: a thread of this app only (not Hermes Desktop's)
            onOpen(c.openBotChat(ref, bot, null));
          } else if (r.reason === 'auth') {
            setUnreachable(`${p.id}/${key}`, true);
            setNotice({ key, text: tr('bots.roster.notConnectedBody', { name: name(key) }) });
          } else {
            const reason = r.error instanceof Error && r.error.message ? r.error.message : tr('bots.roster.unknownError');
            setNotice({ key, text: tr('bots.roster.openFailed', { name: name(key), reason }) });
          }
        })
        .finally(() => setOpening(null));
    },
    [tr],
  );

  const openWaiting = useCallback(() => {
    const first = attention[0];
    if (!first) return;
    const meta = first.conversationId ? live.current.convs.get(first.conversationId) : undefined;
    if (meta) {
      live.current.onOpen(meta);
      openPendingApproval(meta.id, first.runId);
      return;
    }
    open(botKey(first.bot));
  }, [attention, open]);

  // last activity of every bot's Bot Chat (bots/refresh.ts)
  const refresh = useCallback(
    (force = false) => {
      const p = live.current.hermes;
      if (!p || !available) return;
      if (force) refreshCreate();
      refreshBotChats({ id: p.id, kind: 'hermes', baseUrl: p.baseUrl, apiKey: p.apiKey }, bots, () => live.current.convs, force);
    },
    [available, bots, refreshCreate],
  );

  const created = useCallback(
    (bot: CreatedBot) => {
      const p = live.current.hermes;
      if (!p) return;
      // the bridge lists the new bot right away; open its Bot Chat once the list has it (name, colour, template)
      void ensureBots(p, true).finally(() => open(bot.name));
    },
    [open],
  );

  const waiting = useMemo(() => {
    const s = waitingSummary(attention);
    return { count: s.count, names: s.bots.map(nameOf), first: s.first };
  }, [attention, nameOf]);

  if (demoTab) return demoTab;
  if (!available || !hermes) return null;
  return {
    profileId, rows, waiting, nameOf, opening, notice, dismissNotice: () => setNotice(null), unreachable, open, openWaiting, refresh,
    create: createOffer(createConfig), createBot, created,
  };
}
