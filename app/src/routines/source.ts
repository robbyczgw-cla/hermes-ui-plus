/**
 * Where the Routines screen gets its data: the connection's Hermes job API under the bot's `/p/<bot>/` prefix (and,
 * behind the UI bridge, the bridge's result inbox at the server root), or the offline demo. Also small in-memory
 * caches shared with the drawer, so the entry shows when the server knows Routines (also when they are off for this bot
 * or this device, with a short note), its unread badge is known, and the screen opens with what the drawer probe already
 * fetched.
 */
import { useEffect, useState } from 'react';
import { bridgeRoutinesInbox, hermesJobs, hermesSessions } from '../hermes/client';
import { withBot } from '../hermes/bots';
import { serverKey } from '../hermes/support';
import type { Lang } from '../i18n/core';
import { isDemoProfile, type ConnectionProfile } from '../settings/profiles';
import { createDemoRoutines } from './demo';
import { onRoutineEvent, routineEventMatches } from './events';
import { inboxAvailability, inboxAvailabilityFromError, type InboxApi, type InboxAvailability } from './inbox';
import { routinesProbeState, type RoutinesState } from './availability';
import type { JobAction, JobList, RoutineJob } from './jobs';
import { loadLastResult, type LastResult } from './lastResult';
import type { RoutinesCapabilities } from './rights';

export type RoutinesSource = {
  /** cache key: server + key + bot */
  key: string;
  demo: boolean;
  /** app connection id + bot (matching live `hui.routine` events) */
  profileId: string;
  bot: string | undefined;
  list(): Promise<JobList>;
  get(id: string): Promise<RoutineJob>;
  act(id: string, action: JobAction, opts?: { resumePaused?: boolean }): Promise<RoutineJob>;
  lastResult(id: string): Promise<LastResult | null>;
  /** result inbox; null = this connection has none (direct Hermes, no UI bridge) */
  inbox: InboxApi | null;
};

type ProfileLike = Pick<ConnectionProfile, 'id' | 'kind' | 'baseUrl' | 'apiKey'> & { bridge?: boolean };

export { routinesEntry, routinesProbeState, type RoutinesState } from './availability';

const demos = new Map<string, ReturnType<typeof createDemoRoutines>>();

/** null: this connection kind has no Hermes jobs (other agents, no URL / key yet). `lang`: demo text language. */
export function routinesSource(profile: ProfileLike | null | undefined, bot: string | undefined, lang?: Lang): RoutinesSource | null {
  if (!profile) return null;
  if (isDemoProfile(profile)) {
    const key = `demo:${profile.id}:${bot ?? ''}:${lang ?? ''}`;
    let d = demos.get(key);
    if (!d) demos.set(key, (d = createDemoRoutines(Date.now(), lang, bot)));
    const demo = d;
    return {
      key,
      demo: true,
      profileId: profile.id,
      bot,
      list: () => demo.list(),
      get: (id) => demo.get(id),
      act: (id, a) => demo.act(id, a),
      lastResult: (id) => demo.lastResult(id),
      inbox: demo.inbox,
    };
  }
  if (profile.kind !== 'hermes' || !profile.apiKey || !/^https?:\/\//i.test(profile.baseUrl)) return null;
  const base = { baseUrl: profile.baseUrl, apiKey: profile.apiKey };
  const conn = withBot(base, bot);
  const jobs = hermesJobs(conn);
  const sessions = hermesSessions(conn);
  return {
    key: `${serverKey(conn)}|${bot ?? ''}`,
    demo: false,
    profileId: profile.id,
    bot,
    list: () => jobs.list(),
    get: (id) => jobs.get(id),
    act: (id, a, o) => jobs.act(id, a, o),
    lastResult: (id) => loadLastResult(sessions, id),
    inbox: profile.bridge ? bridgeRoutinesInbox(base, bot) : null,
  };
}

type Probe = { state: RoutinesState; list?: JobList; at: number };


const TTL_MS = 10 * 60_000;
const probes = new Map<string, Probe>();
const inflight = new Map<string, Promise<Probe | null>>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

/** Remember a fresh list (screen refresh): keeps the drawer entry and the next screen open in sync. */
export function rememberList(key: string, list: JobList): void {
  probes.set(key, { state: 'available', list, at: Date.now() });
  notify();
}

export function cachedList(key: string): JobList | undefined {
  return probes.get(key)?.list;
}

/**
 * Does the server have Routines? null = unknown (network / auth error: asked again next time, the entry stays hidden
 * meanwhile instead of flickering). Lasting answers (off, forbidden, unsupported) are cached like a loaded list.
 */
export async function probeRoutines(src: RoutinesSource, force = false): Promise<boolean | null> {
  const hit = probes.get(src.key);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.state === 'available';
  let p = inflight.get(src.key);
  if (!p) {
    p = src
      .list()
      .then((list): Probe => ({ state: 'available', list, at: Date.now() }))
      .catch((e: unknown): Probe | null => {
        const state = routinesProbeState(e);
        return state ? { state, at: Date.now() } : null;
      })
      .then((r) => {
        if (r) {
          probes.set(src.key, r);
          notify();
        }
        return r;
      })
      .finally(() => inflight.delete(src.key));
    inflight.set(src.key, p);
  }
  const r = await p;
  return r ? r.state === 'available' : null;
}

// ---------------------------------------------------------------- inbox: availability + unread count

/** `caps`: the bridge's capabilities answer when there was one (also for `off` / `forbidden`: rights + reasons). */
export type InboxProbe = { availability: InboxAvailability; caps: RoutinesCapabilities | null; unread: number | null; at: number };
const INBOX_TTL_MS = 60_000;
const inboxProbes = new Map<string, InboxProbe>();
const inboxInflight = new Map<string, Promise<InboxProbe | null>>();

export function cachedInbox(key: string): InboxProbe | undefined {
  return inboxProbes.get(key);
}

/** The screen learned a fresher unread count (list load, mark read): badge and drawer follow. */
export function rememberUnread(key: string, unread: number): void {
  const cur = inboxProbes.get(key);
  if (!cur || cur.availability.kind !== 'ready') return;
  inboxProbes.set(key, { ...cur, unread, at: Date.now() });
  notify();
}

/**
 * Capabilities + unread count of the bot's inbox (one small list request). null = transient failure (kept as it was,
 * asked again next time). A connection without the bridge answers `noBridge` without any request.
 */
export async function probeInbox(src: RoutinesSource, force = false): Promise<InboxProbe | null> {
  const hit = inboxProbes.get(src.key);
  if (!force && hit && Date.now() - hit.at < INBOX_TTL_MS) return hit;
  const api = src.inbox;
  if (!api) {
    const r: InboxProbe = { availability: { kind: 'noBridge' }, caps: null, unread: null, at: Date.now() };
    const known = !!hit;
    inboxProbes.set(src.key, r);
    if (!known) notify();
    return r;
  }
  let p = inboxInflight.get(src.key);
  if (!p) {
    p = (async (): Promise<InboxProbe | null> => {
      let availability: InboxAvailability | null;
      let caps: RoutinesCapabilities | null = null;
      try {
        caps = await api.capabilities();
        availability = inboxAvailability(caps);
      } catch (e) {
        availability = inboxAvailabilityFromError(e);
      }
      if (!availability) return null;
      let unread: number | null = null;
      if (availability.kind === 'ready') {
        try {
          unread = (await api.list({ filter: 'unread', limit: 1 })).unreadCount;
        } catch {
          unread = hit?.unread ?? null;
        }
      }
      return { availability, caps, unread, at: Date.now() };
    })()
      .then((r) => {
        if (r) {
          inboxProbes.set(src.key, r);
          notify();
        }
        return r;
      })
      .finally(() => inboxInflight.delete(src.key));
    inboxInflight.set(src.key, p);
  }
  return p;
}

function useCacheVersion(): void {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}

/** Drawer: what the server says about Routines. Probes once per server/bot (10 min), again when `kick` changes (drawer opened). */
export function useRoutinesState(src: RoutinesSource | null, kick = 0): RoutinesState | undefined {
  const key = src?.key;
  useCacheVersion();
  useEffect(() => {
    if (src) void probeRoutines(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `src` is rebuilt per render; its key identifies it
  }, [key, kick]);
  return key ? probes.get(key)?.state : undefined;
}

/**
 * Inbox availability + unread count of a connection + bot, kept fresh: asked when `enabled` (and again when `kick`
 * changes; 1 min cache) and at once on a live `hui.routine` event for this bot. `failed`: the last attempt hit a
 * transient error and nothing is known yet (the screen offers a retry instead of spinning).
 */
export function useInboxProbe(src: RoutinesSource | null, enabled: boolean, kick = 0): { probe: InboxProbe | undefined; failed: boolean } {
  const key = src?.key;
  useCacheVersion();
  const [failedKey, setFailedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!src || !enabled) return;
    let live = true;
    void probeInbox(src).then((r) => {
      if (live) setFailedKey(r ? null : src.key);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `src` is rebuilt per render; its key identifies it
  }, [key, enabled, kick]);
  useEffect(() => {
    if (!src || !enabled) return;
    return onRoutineEvent((e) => {
      if (routineEventMatches(e, src.profileId, src.bot)) void probeInbox(src, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [key, enabled]);
  const probe = key ? inboxProbes.get(key) : undefined;
  return { probe, failed: !!key && failedKey === key && !probe };
}

/** Drawer badge: unread Routine results of the open chat's connection + bot (0 when unknown / no inbox). */
export function useRoutinesUnread(src: RoutinesSource | null, enabled: boolean, kick = 0): number {
  const { probe } = useInboxProbe(src, enabled, kick);
  return probe?.availability.kind === 'ready' ? (probe.unread ?? 0) : 0;
}
