/**
 * Bots (Hermes profiles) of a connection for the picker / sync / drawer (hermes/bots.ts). Bridge connections load
 * `GET /bridge/profiles` once per server (cached app-wide, refreshed after 5 min); direct connections use the manual
 * list of the connection editor; the demo has its example bots and the ones made on this device (onboarding/demo/bots.ts).
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Lang } from '../i18n/core';
import { useLocale } from '../i18n';
import { demoBotList } from '../onboarding/demo/bots';
import { demoBotStore } from '../onboarding/demo/botStore';
import { fetchBridgeProfiles } from './client';
import { botsForProfile, type BotProfile, type HermesBot } from './bots';
import { createBotStore } from './botStore';

export const botStore = createBotStore({ load: (conn) => fetchBridgeProfiles(conn) });

export type BotConnProfile = BotProfile & { baseUrl: string; apiKey: string };

/** Does this connection have a bridge bot list to load? */
function loadsBridgeBots(p: BotConnProfile | undefined): p is BotConnProfile {
  return !!p && p.kind === 'hermes' && !!p.bridge && !!p.apiKey && /^https?:\/\//i.test(p.baseUrl);
}

/** Bots of `p` right now (sync; bridge list from the cache). `lang`: the demo bots' descriptions. */
export function botsNow(p: BotConnProfile | undefined, current?: string | null, lang: Lang = 'en'): HermesBot[] {
  if (p?.kind === 'demo') return botsForProfile(p, demoBotList(lang, demoBotStore.get().created), current);
  return botsForProfile(p, loadsBridgeBots(p) ? botStore.get(p) : null, current);
}

/** Load the bridge bot list if missing / stale (no-op for direct connections). Never throws. */
export async function ensureBots(p: BotConnProfile | undefined, force = false): Promise<void> {
  if (loadsBridgeBots(p)) await botStore.ensure(p, force);
}

/** Bots of a connection (default first); `current` = the chat's bot, kept in the list even when unknown. */
export function useHermesBots(p: BotConnProfile | undefined, current?: string | null): { bots: HermesBot[]; refresh(): void } {
  const ver = useSyncExternalStore(botStore.subscribe, botStore.version, botStore.version);
  const demo = useSyncExternalStore(demoBotStore.subscribe, demoBotStore.get, demoBotStore.get);
  const { lang } = useLocale();
  const kind = p?.kind;
  const bridge = p?.bridge;
  const baseUrl = p?.baseUrl;
  const apiKey = p?.apiKey;
  const manualKey = p?.hermesBots?.join(',') ?? '';
  useEffect(() => {
    if (kind === 'hermes' && bridge && baseUrl && apiKey) void botStore.ensure({ baseUrl, apiKey });
  }, [kind, bridge, baseUrl, apiKey]);
  const bots = useMemo(
    () => botsNow(p, current, lang),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ver, kind, bridge, baseUrl, apiKey, manualKey, current, lang, kind === 'demo' ? demo : null],
  );
  const refresh = useCallback(() => {
    if (kind === 'hermes' && bridge && baseUrl && apiKey) void botStore.ensure({ baseUrl, apiKey }, true);
  }, [kind, bridge, baseUrl, apiKey]);
  return { bots, refresh };
}
