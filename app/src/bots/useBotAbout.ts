/**
 * Data and actions behind "Über <Name>" (bots/BotInfoSheet.tsx, slice 4): the bot's memory and skills summary
 * (library/source.ts), its "Immer erlaubt" list with revoke, archive, and the device's notification level for it.
 * Loads only while the sheet is open. The offline demo gets its invented library and an empty allow-list.
 */
import { fetch as expoFetch } from 'expo/fetch';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ensureBots } from '../hermes/useHermesBots';
import type { FetchLike } from '../hermes/stream';
import { librarySource } from '../library/source';
import { skillsFailure } from '../library/model';
import { setPushSettings, usePushSettingsState } from '../push/settingsStore';
import type { ConnectionProfile } from '../settings/profiles';
import { memorySummary, skillsSummary, type AllowList, type MemorySummary, type SkillsSummary } from './about';
import { fetchAllowList, fetchBotFields, parkBot, patchBotFields, revokeAllowed, type AboutFailure, type BotFields, type SaveResult } from './aboutApi';
import { useBotCreate } from './create/useBotCreate';
import { levelOf, withLevel, type BotNotifyLevel } from './notify';

const fetchImpl = expoFetch as unknown as FetchLike;

export type AllowState =
  | { kind: 'loading' }
  | { kind: 'ready'; list: AllowList }
  | { kind: 'failed'; failure: AboutFailure }
  /** no bridge (direct Hermes) or the demo: nothing to list */
  | { kind: 'none'; why: 'noBridge' | 'demo' };

export type BotAbout = {
  memory: MemorySummary | null;
  skills: SkillsSummary | null;
  allow: AllowState;
  level: BotNotifyLevel;
  setLevel(level: BotNotifyLevel): void;
  /** push for this connection: on, off, or the bridge ignores per-bot levels */
  push: 'on' | 'off';
  /** may this device change the bot (revoke, archive)? null = unknown */
  manage: { allowed: true } | { allowed: false; reason: string } | null;
  revoke(pattern: string): Promise<{ ok: true } | { ok: false; failure: AboutFailure }>;
  archive(): Promise<{ ok: true } | { ok: false; failure: AboutFailure }>;
  /** "So arbeitet <Name>": the three fields when this device may read them (null: not shown) */
  fields: BotFields | null;
  saveFields(f: { title: string; job: string; how: string }): Promise<SaveResult>;
  demo: boolean;
};

export function useBotAbout(profile: ConnectionProfile, bot: string | undefined, open: boolean, lang: 'de' | 'en' | 'es'): BotAbout {
  const demo = profile.kind === 'demo';
  const conn = useMemo(() => ({ baseUrl: profile.baseUrl, apiKey: profile.apiKey }), [profile.baseUrl, profile.apiKey]);
  const src = useMemo(() => (open ? librarySource(profile, bot, fetchImpl, lang) : null), [open, profile, bot, lang]);
  const [memory, setMemory] = useState<MemorySummary | null>(null);
  const [skills, setSkills] = useState<SkillsSummary | null>(null);
  const [allow, setAllow] = useState<AllowState>({ kind: 'loading' });
  const [fields, setFields] = useState<BotFields | null>(null);
  const { config, refresh: refreshConfig } = useBotCreate(profile.kind === 'hermes' ? profile : undefined);
  const pushState = usePushSettingsState();
  const settings = pushState.profiles[profile.id];
  const level = levelOf(settings?.bots, bot);

  useEffect(() => {
    if (!open || !src) {
      setMemory(null);
      setSkills(null);
      return;
    }
    let live = true;
    setMemory(null);
    setSkills(null);
    void (async () => {
      let features = null;
      try {
        features = await src.features();
      } catch (e) {
        if (!live) return;
        setMemory(memorySummary(null, null, true));
        setSkills(skillsSummary(null, null, skillsFailure(e)));
        return;
      }
      const [sk, mem] = await Promise.allSettled([src.skills(features), src.memory(features)]);
      if (!live) return;
      setSkills(sk.status === 'fulfilled' ? skillsSummary(sk.value.skills, sk.value.via) : skillsSummary(null, null, skillsFailure(sk.reason)));
      setMemory(mem.status === 'fulfilled' ? memorySummary(features, mem.value) : memorySummary(features, null, true));
    })();
    return () => {
      live = false;
    };
  }, [open, src]);

  const loadAllow = useCallback(async () => {
    if (demo) return setAllow({ kind: 'none', why: 'demo' });
    if (profile.kind !== 'hermes' || !profile.bridge) return setAllow({ kind: 'none', why: 'noBridge' });
    const r = await fetchAllowList(fetchImpl, conn, bot);
    setAllow(r.ok ? { kind: 'ready', list: r.list } : { kind: 'failed', failure: r.failure });
  }, [demo, profile.kind, profile.bridge, conn, bot]);
  useEffect(() => {
    if (!open) return;
    setAllow({ kind: 'loading' });
    void loadAllow();
    refreshConfig();
  }, [open, loadAllow, refreshConfig]);
  useEffect(() => {
    setFields(null);
    if (!open || !bot || profile.kind !== 'hermes' || !profile.bridge) return;
    let live = true;
    void fetchBotFields(fetchImpl, conn, bot).then((f) => {
      if (live) setFields(f);
    });
    return () => {
      live = false;
    };
  }, [open, bot, profile.kind, profile.bridge, conn]);

  const saveFields = useCallback(
    async (f: { title: string; job: string; how: string }): Promise<SaveResult> => {
      if (!bot) return { ok: false, failure: 'forbidden' };
      const r = await patchBotFields(fetchImpl, conn, bot, { ...f, lang });
      if (r.ok) {
        setFields((cur) => (cur ? { ...cur, ...f } : cur));
        void ensureBots(profile, true); // name and job in the list and the header
      }
      return r;
    },
    [bot, conn, lang, profile],
  );

  const revoke = useCallback(
    async (pattern: string) => {
      const r = await revokeAllowed(fetchImpl, conn, bot, pattern);
      if (r.ok) {
        setAllow({ kind: 'ready', list: r.list });
        return { ok: true as const };
      }
      return { ok: false as const, failure: r.failure };
    },
    [conn, bot],
  );

  const archive = useCallback(async () => {
    if (!bot) return { ok: false as const, failure: 'forbidden' as const };
    const r = await parkBot(fetchImpl, conn, bot, 'archive');
    if (!r.ok) return { ok: false as const, failure: r.failure };
    // the bot leaves /bridge/profiles; the archived list in GET /bridge/bots gains it
    refreshConfig();
    void ensureBots(profile, true);
    return { ok: true as const };
  }, [bot, conn, profile, refreshConfig]);

  const setLevel = useCallback(
    (next: BotNotifyLevel) => {
      setPushSettings(profile.id, { bots: withLevel(settings?.bots, bot, next) });
    },
    [profile.id, settings?.bots, bot],
  );

  // the allow-list answer carries the right for this bot; GET /bridge/bots the general one
  const manage = allow.kind === 'ready' ? allow.list.manage : (config?.manage ?? null);
  return { memory, skills, allow, level, setLevel, push: settings?.enabled ? 'on' : 'off', manage, revoke, archive, fields, saveFields, demo };
}
