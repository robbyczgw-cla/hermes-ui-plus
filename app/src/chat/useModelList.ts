/**
 * Hermes model ids from GET /v1/models, cached per profile (memory + AsyncStorage). The cache is
 * keyed by profile id and invalidated when the profile's base URL changes.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { listModels } from '../hermes/client';
import { useT } from '../i18n';
import type { ConnectionProfile } from '../settings/profiles';
import { cacheIsStale, cacheMatches, listsServerModels, parseModelCache, type ModelCacheEntry } from './models';


const mem = new Map<string, ModelCacheEntry>();
const storageKey = (profileId: string) => `hui.models.${profileId.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export type ModelList = {
  ids: string[];
  loading: boolean;
  error: string | null;
  /** fetch now (ignores the cache) */
  refresh(): void;
  /** fetch when nothing is cached or the cache is old */
  ensureFresh(): void;
};

export function useModelList(profile: Pick<ConnectionProfile, 'id' | 'kind' | 'baseUrl' | 'apiKey'>): ModelList {
  const { id, kind, baseUrl, apiKey } = profile;
  const tr = useT();
  // the module-level cache is the source of truth; `bump` re-renders after it changed
  const [, bump] = useState(0);
  const cached = mem.get(id);
  const entry = cacheMatches(cached, baseUrl) ? cached : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // hydrate from storage once per profile
  useEffect(() => {
    if (!listsServerModels(kind) || cacheMatches(mem.get(id), baseUrl)) return;
    let alive = true;
    AsyncStorage.getItem(storageKey(id))
      .then((raw) => {
        const e = parseModelCache(raw);
        if (!cacheMatches(e, baseUrl) || cacheMatches(mem.get(id), baseUrl)) return;
        mem.set(id, e);
        if (alive) bump((n) => n + 1);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, kind, baseUrl]);

  const refresh = useCallback(() => {
    if (!listsServerModels(kind) || !baseUrl) return;
    setLoading(true);
    setError(null);
    listModels({ baseUrl, apiKey })
      .then((ids) => {
        const e: ModelCacheEntry = { baseUrl, ids, at: Date.now() };
        mem.set(id, e);
        bump((n) => n + 1);
        AsyncStorage.setItem(storageKey(id), JSON.stringify(e)).catch(() => {});
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : tr('chat.modelPicker.loadFailed'));
      })
      .finally(() => setLoading(false));
  }, [id, kind, baseUrl, apiKey, tr]);

  const ensureFresh = useCallback(() => {
    const m = mem.get(id);
    if (!cacheMatches(m, baseUrl) || cacheIsStale(m, Date.now())) refresh();
  }, [id, kind, baseUrl, refresh]);

  return { ids: entry ? entry.ids : [], loading, error, refresh, ensureFresh };
}
