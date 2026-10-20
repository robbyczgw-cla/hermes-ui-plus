/**
 * May this device create bots on its bridge (bots/create/core.ts)? `GET /bridge/bots` once per server, cached app-wide
 * for a minute; a successful create refreshes it. Bridge connections only: a direct Hermes, the demo or an older bridge
 * answer nothing we understand (null) and the app shows no create button.
 */
import { fetch as expoFetch } from 'expo/fetch';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { FetchLike } from '../../hermes/stream';
import { fetchBotsConfig, postBot, type CreateResult } from './api';
import type { BotsConfig } from './core';

const fetchImpl = expoFetch as unknown as FetchLike;
const TTL_MS = 60_000;

type Conn = { baseUrl: string; apiKey: string };
type Entry = { at: number; config: BotsConfig | null; loading?: Promise<void> };

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const f of Array.from(listeners)) f();
};
const keyOf = (c: Conn) => `${c.baseUrl}\n${c.apiKey}`;

function ensure(c: Conn, force = false): Promise<void> {
  const k = keyOf(c);
  const e = cache.get(k);
  if (e?.loading) return e.loading;
  if (!force && e && Date.now() - e.at < TTL_MS) return Promise.resolve();
  const loading = fetchBotsConfig(fetchImpl, c)
    .then((config) => {
      cache.set(k, { at: Date.now(), config });
    })
    .catch(() => {
      cache.set(k, { at: Date.now(), config: null });
    })
    .finally(emit);
  cache.set(k, { at: e?.at ?? 0, config: e?.config ?? null, loading });
  return loading;
}

type Profile = { kind: string; bridge?: boolean; baseUrl: string; apiKey: string } | undefined;
const usable = (p: Profile): p is NonNullable<Profile> => !!p && p.kind === 'hermes' && !!p.bridge && !!p.apiKey && /^https?:\/\//i.test(p.baseUrl);

/** The create right of a connection (null = unknown / not offered) and the create call. */
export function useBotCreate(p: Profile): { config: BotsConfig | null; refresh(): void; create(body: unknown): Promise<CreateResult> } {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
    () => version,
  );
  const ok = usable(p);
  const baseUrl = p?.baseUrl ?? '';
  const apiKey = p?.apiKey ?? '';
  useEffect(() => {
    if (ok) void ensure({ baseUrl, apiKey });
  }, [ok, baseUrl, apiKey]);
  const refresh = useCallback(() => {
    if (ok) void ensure({ baseUrl, apiKey }, true);
  }, [ok, baseUrl, apiKey]);
  const create = useCallback(
    async (body: unknown): Promise<CreateResult> => {
      const r = await postBot(fetchImpl, { baseUrl, apiKey }, body);
      void ensure({ baseUrl, apiKey }, true);
      return r;
    },
    [baseUrl, apiKey],
  );
  return { config: ok ? (cache.get(keyOf({ baseUrl, apiKey }))?.config ?? null) : null, refresh, create };
}
