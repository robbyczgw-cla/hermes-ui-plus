/**
 * Image search with the user's own provider key (Serper / Brave), called directly from the app.
 * Platform-free (fetch/clock injected). In-memory cache, in-flight de-duplication, a simple rate limit and
 * a cool-down after errors so a bad key / blocked browser never makes the app hammer the provider.
 * The key is only used for the request header; it is never logged or included in error messages.
 */
import { normalizeImageQuery, normalizeWikiLang } from '../protocol/validate.ts';
import { createLruCache } from './cache.ts';
import { buildRequest, candidateCount, filterCandidates, parseProviderResponse, type ImageProviderId } from './providers.ts';
import { pickWebResult, toResolvedImage, type WebResult } from './webCore.ts';
import type { ResolvedImage } from './types.ts';

export type OwnConfig = { provider: ImageProviderId; key: string };
/** ok | auth (401/403) | rate (429) | http (other status) | network (fetch threw: offline, timeout, or CORS in a browser) | empty (reachable, 0 usable results) */
export type OwnTestKind = 'ok' | 'auth' | 'rate' | 'http' | 'network' | 'empty';
export type OwnTestResult = { kind: OwnTestKind; status?: number; count: number };

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface OwnOptions {
  fetch: FetchLike;
  now?: () => number;
  timeoutMs?: number;
  /** uncached requests per minute (default 20) */
  rateLimit?: number;
}

class OwnError extends Error {
  kind: OwnTestKind;
  status?: number;
  constructor(kind: OwnTestKind, status?: number) {
    super(kind);
    this.kind = kind;
    this.status = status;
  }
}

const HOUR = 3600_000;

export interface OwnImageSearch {
  setConfig(c: OwnConfig | null): void;
  config(): OwnConfig | null;
  enabled(): boolean;
  version(): number;
  subscribe(l: () => void): () => void;
  peek(query: string, lang?: string): ResolvedImage | null | undefined;
  resolve(query: string, lang?: string): Promise<ResolvedImage | null>;
  /** One real query with the given config (ignores cache, cool-down and rate limit). Never throws. */
  test(c: OwnConfig, query?: string, lang?: string): Promise<OwnTestResult>;
}

export function createOwnImageSearch(opts: OwnOptions): OwnImageSearch {
  const now = opts.now ?? Date.now;
  const cache = createLruCache<ResolvedImage | null>(300, now);
  const inflight = new Map<string, Promise<ResolvedImage | null>>();
  const listeners = new Set<() => void>();
  let cfg: OwnConfig | null = null;
  let coolUntil = 0;
  let ver = 0;
  let windowStart = 0;
  let windowCount = 0;
  const bump = () => {
    ver++;
    listeners.forEach((l) => l());
  };
  const clean = (query: string, lang?: string) => ({
    q: normalizeImageQuery(typeof query === 'string' ? query : '') ?? '',
    l: normalizeWikiLang(lang) ?? 'de',
  });
  const key = (c: OwnConfig, l: string, q: string) => `${c.provider}|${l}|${q.toLowerCase()}`;

  async function request(c: OwnConfig, q: string, l: string, n: number): Promise<WebResult[]> {
    const req = buildRequest(c.provider, q, l, candidateCount(n), c.key);
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = setTimeout(() => ctrl?.abort(), opts.timeoutMs ?? 6000);
    try {
      let res;
      try {
        res = await opts.fetch(req.url, { ...req.init, signal: ctrl?.signal });
      } catch {
        throw new OwnError('network');
      }
      if (res.status === 401 || res.status === 403) throw new OwnError('auth', res.status);
      if (res.status === 429) throw new OwnError('rate', res.status);
      if (!res.ok) throw new OwnError('http', res.status);
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new OwnError('http', res.status);
      }
      return filterCandidates(parseProviderResponse(c.provider, json), c.provider, n);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    setConfig(c) {
      const next = c && c.key.trim() ? { provider: c.provider, key: c.key.trim() } : null;
      if (next?.provider === cfg?.provider && next?.key === cfg?.key) return;
      cfg = next;
      coolUntil = 0;
      cache.clear();
      bump();
    },
    config: () => cfg,
    enabled: () => !!cfg && now() >= coolUntil,
    version: () => ver,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    peek(query, lang) {
      if (!cfg) return null;
      const { q, l } = clean(query, lang);
      if (!q) return null;
      const hit = cache.get(key(cfg, l, q));
      return hit ? hit.value : undefined;
    },
    resolve(query, lang) {
      const c = cfg;
      const { q, l } = clean(query, lang);
      if (!c || !q || now() < coolUntil) return Promise.resolve(null);
      const k = key(c, l, q);
      const hit = cache.get(k);
      if (hit) return Promise.resolve(hit.value);
      const running = inflight.get(k);
      if (running) return running;
      if (now() - windowStart >= 60_000) {
        windowStart = now();
        windowCount = 0;
      }
      if (++windowCount > (opts.rateLimit ?? 20)) return Promise.resolve(null); // over budget: skip (Wikimedia/none), not cached
      const p = (async () => {
        try {
          const best = pickWebResult(await request(c, q, l, 5));
          const v = best ? toResolvedImage(best) : null;
          cache.set(k, v, v ? 24 * HOUR : HOUR);
          return v;
        } catch (e) {
          // cool-down: bad key → 10 min, 429 → 2 min, network/CORS/other → 5 min. Never retried in a loop.
          const kind = e instanceof OwnError ? e.kind : 'network';
          coolUntil = now() + (kind === 'auth' ? 10 : kind === 'rate' ? 2 : 5) * 60_000;
          bump();
          return null;
        }
      })().finally(() => inflight.delete(k));
      inflight.set(k, p);
      return p;
    },
    async test(c, query = 'Eiffelturm', lang = 'de') {
      const { q, l } = clean(query, lang);
      try {
        const out = await request({ provider: c.provider, key: c.key.trim() }, q, l, 3);
        return { kind: out.length ? 'ok' : 'empty', count: out.length };
      } catch (e) {
        return e instanceof OwnError ? { kind: e.kind, status: e.status, count: 0 } : { kind: 'network', count: 0 };
      }
    },
  };
}
