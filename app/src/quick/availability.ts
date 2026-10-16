/**
 * Is quick answering available on a connection? GET /bridge/quick/config, cached per bridge (origin + key suffix),
 * re-checked after QUICK_LIMITS.configTtlMs and whenever the app comes back to the foreground or the connection
 * comes back online (forced). A 404 `feature_off` from a quick request marks it off at once (markOff), so ⚡ hides
 * quietly. A network error never switches a known state; an unknown connection stays "off" (nothing is shown).
 * Pure: fetch and clock are injected (tests); the app instance lives in hooks.ts.
 */
import { bridgeOrigin, parseQuickConfig, quickConfigUrl, QUICK_LIMITS, type QuickConfig, type QuickConn } from './core.ts';

/** `reason`: why it is off, when the bridge said so (diagnostics only; the UI just hides ⚡) */
export type QuickAvailability = { on: boolean; config: QuickConfig | null; at: number; reason?: string };

export type ConfigFetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const DEMO_KEY = 'demo://local';
/** what the offline demo reports (quick/demo.ts answers locally) */
export const DEMO_CONFIG: QuickConfig = { available: true, model: 'flash-mini', provider: 'demo', perMinute: 20, perDay: 300, allowModelOverride: true };

/** ⚡ is offered only on an explicit "available" from the bridge (unknown, off with any reason, offline-unknown: hidden) */
export const quickOffered = (entry: QuickAvailability | undefined): boolean => entry?.on === true && entry.config !== null;

export const availabilityKey = (conn: QuickConn) => `${bridgeOrigin(conn.baseUrl)}#${conn.apiKey.slice(-6)}`;

export function createAvailability(o: { fetch: ConfigFetch; now?: () => number; ttlMs?: number; timeoutMs?: number }) {
  // called as a plain function: a browser fetch called as `x.fetch()` throws "Illegal invocation" (wrong `this`)
  const doFetch = o.fetch;
  const now = o.now ?? Date.now;
  const ttl = o.ttlMs ?? QUICK_LIMITS.configTtlMs;
  const entries = new Map<string, QuickAvailability>([[DEMO_KEY, { on: true, config: DEMO_CONFIG, at: 0 }]]);
  const conns = new Map<string, QuickConn>();
  const inflight = new Map<string, Promise<QuickAvailability | undefined>>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const fn of listeners) fn();
  };
  const set = (key: string, e: QuickAvailability) => {
    const prev = entries.get(key);
    entries.set(key, e);
    if (!prev || prev.on !== e.on || JSON.stringify(prev.config) !== JSON.stringify(e.config)) emit();
  };

  async function fetchConfig(conn: QuickConn): Promise<QuickConfig> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? QUICK_LIMITS.configTimeoutMs);
    try {
      const res = await doFetch(quickConfigUrl(conn.baseUrl), {
        headers: { Authorization: `Bearer ${conn.apiKey}`, Accept: 'application/json' },
        signal: ctrl.signal,
      });
      // an older bridge without the route (404), a rejected token (401/403): off
      if (!res.ok) return parseQuickConfig(null);
      return parseQuickConfig(await res.json());
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get(key: string | null | undefined): QuickAvailability | undefined {
      return key ? entries.get(key) : undefined;
    },
    /** check one connection (cached unless `force` or older than the TTL); resolves with the entry (undefined on a network error without a known state) */
    refresh(conn: QuickConn, force = false): Promise<QuickAvailability | undefined> {
      const key = availabilityKey(conn);
      conns.set(key, conn);
      const hit = entries.get(key);
      if (!force && hit && now() - hit.at < ttl) return Promise.resolve(hit);
      const running = inflight.get(key);
      if (running) return running;
      const p = fetchConfig(conn)
        .then((config) => {
          const e: QuickAvailability = { on: config.available, config: config.available ? config : null, at: now(), ...(config.reason ? { reason: config.reason } : {}) };
          set(key, e);
          return e;
        })
        .catch(() => entries.get(key)) // offline / timeout: keep what we knew
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    /** re-check every connection seen so far (app foreground) */
    refreshAll(force = true): void {
      for (const conn of conns.values()) void this.refresh(conn, force);
    },
    /** a quick request answered 404 feature_off: hide ⚡ until the next successful check */
    markOff(key: string): void {
      if (key === DEMO_KEY) return;
      set(key, { on: false, config: null, at: now() });
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export type Availability = ReturnType<typeof createAvailability>;
