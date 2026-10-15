/**
 * In-memory cache of the bots a UI bridge offers (`GET /bridge/profiles`, hermes/bots.ts), one entry per server
 * (root URL + key suffix). Pure, erasable TS with an injected loader (node:test); the app-wide instance with the
 * real fetch lives in useHermesBots.ts.
 */
import { serverRootOf, type HermesBot } from './bots.ts';

export type BotConn = { baseUrl: string; apiKey: string };
export type BotLoader = (conn: BotConn) => Promise<HermesBot[] | null>;

type Entry = { at: number; bots?: HermesBot[] | null; pending?: Promise<HermesBot[] | null> };

/** refetch after 5 min (new profiles appear without an app restart); failures retry after 30 s */
export const BOTS_TTL_MS = 5 * 60_000;
export const BOTS_RETRY_MS = 30_000;

export function botServerKey(conn: BotConn): string {
  return `${serverRootOf(conn.baseUrl)}#${conn.apiKey.slice(-6)}`;
}

export function createBotStore(o: { load: BotLoader; now?: () => number; ttlMs?: number; retryMs?: number }) {
  const now = o.now ?? Date.now;
  const ttl = o.ttlMs ?? BOTS_TTL_MS;
  const retry = o.retryMs ?? BOTS_RETRY_MS;
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let version = 0;
  const emit = () => {
    version++;
    for (const f of Array.from(listeners)) f();
  };

  /** cached bots of the server (undefined = never loaded, null = server has no bot list / load failed) */
  function get(conn: BotConn): HermesBot[] | null | undefined {
    return entries.get(botServerKey(conn))?.bots;
  }

  function stale(e: Entry | undefined): boolean {
    if (!e || e.bots === undefined) return true;
    return now() - e.at > (e.bots ? ttl : retry);
  }

  /** load when missing / stale (or `force`); concurrent callers share one request. Never throws. */
  function ensure(conn: BotConn, force = false): Promise<HermesBot[] | null> {
    const key = botServerKey(conn);
    const e = entries.get(key);
    if (e?.pending) return e.pending;
    if (!force && e && !stale(e)) return Promise.resolve(e.bots ?? null);
    const pending = o
      .load(conn)
      .catch(() => null)
      .then((bots) => {
        const prev = entries.get(key)?.bots;
        // a failed refresh keeps the last good list (offline for a moment ≠ the bots are gone)
        const next = bots ?? prev ?? null;
        entries.set(key, { at: now(), bots: next });
        if (JSON.stringify(prev) !== JSON.stringify(next)) emit();
        return next;
      });
    entries.set(key, { at: e?.at ?? 0, bots: e?.bots, pending });
    return pending;
  }

  return {
    get,
    ensure,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    version: () => version,
    /** tests */
    clear() {
      entries.clear();
      emit();
    },
  };
}

export type BotStore = ReturnType<typeof createBotStore>;
