/**
 * useHermesCapabilities – GET /v1/capabilities + GET /api/model/options once per server ("on connect"),
 * cached in memory for 10 min and shared by all chats. Both endpoints are optional: older servers / the
 * bridge / the mock answer 404 → `caps`/`catalog` stay null and the UI falls back to permissive defaults.
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchCapabilities, fetchModelOptions } from './client';
import { modelCapsFor, type HermesCapabilities, type ModelCaps, type ModelOptionsCatalog } from './capabilities';
import { serverKey } from './support';

type Entry = { caps: HermesCapabilities | null; catalog: ModelOptionsCatalog | null; at: number };

const TTL_MS = 10 * 60_000;
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

async function load(conn: { baseUrl: string; apiKey: string }, force: boolean): Promise<Entry> {
  const key = serverKey(conn);
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit;
  const running = inflight.get(key);
  if (running) return running;
  const p = (async () => {
    const [caps, catalog] = await Promise.all([
      fetchCapabilities(conn).catch(() => null),
      fetchModelOptions(conn).catch(() => null),
    ]);
    const e: Entry = { caps, catalog, at: Date.now() };
    cache.set(key, e);
    return e;
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

export type UseHermesCapabilities = {
  caps: HermesCapabilities | null;
  catalog: ModelOptionsCatalog | null;
  loading: boolean;
  /** reasoning/fast support of the chat's model (permissive defaults while unknown) */
  modelCaps: (model?: string) => ModelCaps;
  refresh: () => void;
};

/** `conn` undefined (e.g. a Claude profile) → nothing is fetched. */
export function useHermesCapabilities(conn: { baseUrl: string; apiKey: string } | undefined): UseHermesCapabilities {
  const key = conn && conn.apiKey && /^https?:\/\//i.test(conn.baseUrl) ? serverKey(conn) : undefined;
  const [entry, setEntry] = useState<{ key?: string; e?: Entry }>(() => ({ key, e: key ? cache.get(key) : undefined }));
  const [loading, setLoading] = useState(false);
  if (entry.key !== key) setEntry({ key, e: key ? cache.get(key) : undefined });

  const baseUrl = conn?.baseUrl;
  const apiKey = conn?.apiKey;
  const run = useCallback(
    (force: boolean) => {
      if (!key || !baseUrl || !apiKey) return;
      setLoading(true);
      void load({ baseUrl, apiKey }, force).then((e) => {
        setEntry((cur) => (cur.key === key ? { key, e } : cur));
        setLoading(false);
      });
    },
    [key, baseUrl, apiKey]
  );

  useEffect(() => {
    run(false);
  }, [run]);

  const catalog = entry.e?.catalog ?? null;
  const modelCaps = useCallback((model?: string) => modelCapsFor(catalog, model), [catalog]);
  return { caps: entry.e?.caps ?? null, catalog, loading, modelCaps, refresh: () => run(true) };
}
