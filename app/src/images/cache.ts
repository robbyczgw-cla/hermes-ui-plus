/**
 * Small LRU cache with per-entry expiry and JSON (de)serialization. Pure (clock injected), so it
 * can be persisted to AsyncStorage by the resolver and tested under node.
 */

export type LruEntry<V> = [key: string, value: V, expiresAt: number];

export interface LruCache<V> {
  /** value, or undefined if missing/expired (a hit refreshes recency) */
  get(key: string): { value: V } | undefined;
  set(key: string, value: V, ttlMs: number): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
  /** oldest → newest, expired entries dropped */
  dump(): LruEntry<V>[];
  /** merge persisted entries (existing in-memory entries win) */
  load(entries: unknown, isValue: (v: unknown) => v is V): void;
}

export function createLruCache<V>(max: number, now: () => number = Date.now): LruCache<V> {
  const map = new Map<string, { v: V; exp: number }>();
  const trim = () => {
    while (map.size > max) {
      const first = map.keys().next();
      if (first.done) break;
      map.delete(first.value);
    }
  };
  return {
    get(key) {
      const e = map.get(key);
      if (!e) return undefined;
      if (e.exp <= now()) {
        map.delete(key);
        return undefined;
      }
      map.delete(key);
      map.set(key, e);
      return { value: e.v };
    },
    set(key, value, ttlMs) {
      map.delete(key);
      map.set(key, { v: value, exp: now() + ttlMs });
      trim();
    },
    delete(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
    dump() {
      const t = now();
      const out: LruEntry<V>[] = [];
      for (const [k, e] of map) if (e.exp > t) out.push([k, e.v, e.exp]);
      return out;
    },
    load(entries, isValue) {
      if (!Array.isArray(entries)) return;
      const t = now();
      const loaded = new Map<string, { v: V; exp: number }>();
      for (const e of entries) {
        if (!Array.isArray(e) || e.length !== 3) continue;
        const [k, v, exp] = e as unknown[];
        if (typeof k !== 'string' || typeof exp !== 'number' || exp <= t || !isValue(v)) continue;
        loaded.set(k, { v, exp });
      }
      // persisted entries are older than anything already in memory → insert them first
      for (const [k, e] of map) {
        loaded.delete(k);
        loaded.set(k, e);
      }
      map.clear();
      for (const [k, e] of loaded) map.set(k, e);
      trim();
    },
  };
}
