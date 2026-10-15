/**
 * Web image search through the UI bridge (`GET {bridge}/bridge/images?q=&n=&lang=`, Bearer token).
 * Platform-free core (fetch/clock injected) + the combination with the Wikimedia resolver.
 * Second image source: used when a node says `source: 'web'` (then ONLY this, never Wikimedia), or when Wikimedia finds nothing.
 */
import { normalizeImageQuery, normalizeWikiLang } from '../protocol/validate.ts';
import { createLruCache } from './cache.ts';
import type { ResolvedImage } from './types.ts';

export type BridgeConn = { baseUrl: string; apiKey: string };

export interface WebResult {
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  title: string;
  sourcePage: string;
  sourceDomain: string;
  provider: string;
}

const HOUR = 3600_000;
const isHttps = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/[^\s/]+\.[^\s/]+/i.test(u);
const nonNeg = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);

/** Untrusted bridge response → clean results (https only, no svg/gif). */
export function parseWebResults(raw: unknown): WebResult[] {
  const list = raw && typeof raw === 'object' ? (raw as { results?: unknown }).results : undefined;
  if (!Array.isArray(list)) return [];
  const out: WebResult[] = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (!isHttps(o.url) || /\.(svg|gif)(\?|#|$)/i.test(o.url)) continue;
    out.push({
      url: o.url,
      thumbnailUrl: isHttps(o.thumbnailUrl) ? o.thumbnailUrl : o.url,
      width: nonNeg(o.width),
      height: nonNeg(o.height),
      title: typeof o.title === 'string' ? o.title : '',
      sourcePage: isHttps(o.sourcePage) ? o.sourcePage : '',
      sourceDomain: typeof o.sourceDomain === 'string' ? o.sourceDomain : '',
      provider: typeof o.provider === 'string' ? o.provider : '',
    });
  }
  return out;
}

/** Best result: bridge order is relevance; prefer a usable size/aspect among the first ones, else the first. */
export function pickWebResult(results: WebResult[]): WebResult | null {
  const good = results.find((r) => {
    if (!r.width || !r.height) return true; // unknown size: accept
    const a = r.width / r.height;
    return r.width >= 500 && a >= 0.5 && a <= 2.5;
  });
  return good ?? results[0] ?? null;
}

export function toResolvedImage(r: WebResult): ResolvedImage {
  const domain = r.sourceDomain || (/^https:\/\/([^/?#]+)/i.exec(r.sourcePage || r.url)?.[1] ?? '').replace(/^www\./, '');
  return {
    url: r.url,
    thumbUrl: r.thumbnailUrl,
    width: r.width,
    height: r.height,
    title: r.title,
    attribution: { sourceUrl: r.sourcePage || r.url, provider: 'web', domain: domain || undefined },
  };
}

export interface WebSearchOptions {
  fetch: (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  now?: () => number;
  timeoutMs?: number;
  maxEntries?: number;
  /** last probe answer per bridge (persisted by the app): see WebSearchHints */
  hints?: WebSearchHints;
}

/**
 * Remembered `/bridge/images/config` outcome per bridge base URL (true = provider, false = none / older bridge /
 * rejected token). A remembered `false` switches the search off right at `setConn`, before the probe answers, so a
 * restored chat's product cards without a photo collapse before the first paint instead of shimmering and jumping
 * up ~1 s later. The probe still runs and its answer replaces the hint; unknown bridges stay optimistic.
 */
export interface WebSearchHints {
  get(baseUrl: string): boolean | undefined;
  set(baseUrl: string, available: boolean): void;
}

export interface WebImageSearch {
  setConn(conn: BridgeConn | null): void;
  setPref(on: boolean): void;
  /** pref on + bridge profile present + bridge not known to lack the feature */
  enabled(): boolean;
  /** bumps whenever `enabled()` may have changed (for useSyncExternalStore) */
  version(): number;
  subscribe(l: () => void): () => void;
  peek(query: string, lang?: string): ResolvedImage | null | undefined;
  /** null = nothing found (cached 1 h) or unavailable; rejects on transient errors (not cached) */
  resolve(query: string, lang?: string): Promise<ResolvedImage | null>;
  /**
   * Asks the bridge once per connection (`GET /bridge/images/config`) whether it has an image provider. No provider
   * (`available: false`), an older bridge (404) or a wrong token (401/503) switch the search off (`enabled()` false)
   * so cards go straight to the keyless sources instead of requesting a search that cannot succeed. Network errors
   * leave it enabled and are retried on the next call. `resolve` waits for a running probe.
   */
  probe(): Promise<void>;
  /**
   * The bridge connection when that bridge advertises its image proxy (`proxy.available` in the same
   * `/bridge/images/config` answer, see proxy.ts), else null. Independent of the search provider: the public
   * default bridge has no provider but does have the proxy.
   */
  proxyConn(): BridgeConn | null;
  /** re-read the hint for the current bridge (the persisted hints finished loading after `setConn`) */
  applyHints(): void;
}

/** `/bridge/images/config` body → does the bridge offer the image proxy (`GET /bridge/img`)? Only an explicit `true`. */
export function parseProxyConfig(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const p = (raw as { proxy?: unknown }).proxy;
  return !!p && typeof p === 'object' && (p as { available?: unknown }).available === true;
}

/** `/bridge/images/config` body → is a provider configured? (unknown shape → true: do not disable on guesses) */
export function parseImagesConfig(raw: unknown): boolean {
  if (raw && typeof raw === 'object' && 'available' in raw) return (raw as { available: unknown }).available !== false;
  return true;
}

export function createWebImageSearch(opts: WebSearchOptions): WebImageSearch {
  // called as a plain function: a browser fetch called as `x.fetch()` throws "Illegal invocation" (wrong `this`)
  const doFetch = opts.fetch;
  const now = opts.now ?? Date.now;
  const cache = createLruCache<ResolvedImage | null>(opts.maxEntries ?? 300, now);
  const inflight = new Map<string, Promise<ResolvedImage | null>>();
  const listeners = new Set<() => void>();
  let conn: BridgeConn | null = null;
  let pref = true;
  let unavailableUntil = 0;
  let ver = 0;
  let probedFor = '';
  let probing: Promise<void> | null = null;
  let proxyOn = false;
  // remembered "no image search" for the current bridge, until this connection's probe answers
  let hintOff = false;
  let probeAnswered = false;
  const readHint = () => {
    if (!conn || probeAnswered) return false;
    return opts.hints?.get(conn.baseUrl) === false;
  };
  const remember = (c: BridgeConn, available: boolean) => {
    probeAnswered = true;
    try {
      opts.hints?.set(c.baseUrl, available);
    } catch {
      // hint store is best effort
    }
    if (hintOff) {
      hintOff = false;
      bump();
    }
  };
  const setProxy = (on: boolean) => {
    if (on === proxyOn) return;
    proxyOn = on;
    bump();
  };
  const bump = () => {
    ver++;
    listeners.forEach((l) => l());
  };
  const connKey = () => (conn ? `${conn.baseUrl}` : '');
  const key = (l: string, q: string) => `${connKey()}|${l}|${q.toLowerCase()}`;
  const clean = (query: string, lang?: string) => ({
    q: normalizeImageQuery(typeof query === 'string' ? query : '') ?? '',
    l: normalizeWikiLang(lang) ?? 'de',
  });

  const api: WebImageSearch = {
    setConn(c) {
      const same = (c?.baseUrl ?? '') === (conn?.baseUrl ?? '') && (c?.apiKey ?? '') === (conn?.apiKey ?? '');
      if (same) return;
      conn = c;
      unavailableUntil = 0;
      probedFor = '';
      probing = null;
      proxyOn = false;
      probeAnswered = false;
      hintOff = readHint();
      bump();
    },
    applyHints() {
      const next = readHint();
      if (next === hintOff) return;
      hintOff = next;
      bump();
    },
    probe() {
      const c = conn;
      if (!c) return Promise.resolve(); // also without the search pref: the same answer says whether the proxy exists
      const pk = `${c.baseUrl}\n${c.apiKey}`;
      if (probedFor === pk) return probing ?? Promise.resolve();
      probedFor = pk;
      const run = (async () => {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
        const timer = setTimeout(() => ctrl?.abort(), opts.timeoutMs ?? 6000);
        try {
          const base = c.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
          const res = await doFetch(`${base}/bridge/images/config`, { headers: { Accept: 'application/json', ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) }, signal: ctrl?.signal });
          if (conn !== c) return; // connection changed meanwhile
          if (res.status === 404 || res.status === 503 || res.status === 401) {
            unavailableUntil = now() + 10 * 60_000;
            proxyOn = false;
            bump();
            remember(c, false);
          } else if (res.ok) {
            const body = await res.json().catch(() => null);
            if (conn !== c) return;
            const available = parseImagesConfig(body);
            if (!available) {
              unavailableUntil = now() + 10 * 60_000;
              bump();
            }
            setProxy(parseProxyConfig(body));
            remember(c, available);
          }
        } catch {
          if (probedFor === pk) probedFor = ''; // transient: ask again next time
        } finally {
          clearTimeout(timer);
        }
      })();
      probing = run;
      void run.then(() => {
        if (probing === run) probing = null;
      });
      return run;
    },
    setPref(on) {
      if (on === pref) return;
      pref = on;
      bump();
    },
    enabled: () => pref && !!conn && !hintOff && now() >= unavailableUntil,
    proxyConn: () => (proxyOn && conn ? conn : null),
    version: () => ver,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    peek(query, lang) {
      if (!conn) return null;
      const { q, l } = clean(query, lang);
      if (!q) return null;
      const hit = cache.get(key(l, q));
      return hit ? hit.value : undefined;
    },
    resolve(query, lang) {
      const c = conn;
      const { q, l } = clean(query, lang);
      if (!c || !q || !pref || hintOff || now() < unavailableUntil) return Promise.resolve(null);
      if (probing) return probing.then(() => (conn === c ? api.resolve(query, lang) : null));
      const k = key(l, q);
      const hit = cache.get(k);
      if (hit) return Promise.resolve(hit.value);
      const running = inflight.get(k);
      if (running) return running;
      const p = (async () => {
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
        const timer = setTimeout(() => ctrl?.abort(), opts.timeoutMs ?? 6000);
        try {
          const base = c.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
          const url = `${base}/bridge/images?q=${encodeURIComponent(q)}&n=5&lang=${encodeURIComponent(l)}`;
          const res = await doFetch(url, { headers: { Accept: 'application/json', ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) }, signal: ctrl?.signal });
          if (res.status === 404 || res.status === 503 || res.status === 401) {
            // older bridge / no provider keys / wrong token: stop trying for a while
            unavailableUntil = now() + 10 * 60_000;
            bump();
            return null;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const best = pickWebResult(parseWebResults(await res.json()));
          const v = best ? toResolvedImage(best) : null;
          cache.set(k, v, v ? 24 * HOUR : HOUR);
          return v;
        } finally {
          clearTimeout(timer);
        }
      })().finally(() => inflight.delete(k));
      inflight.set(k, p);
      return p;
    },
  };
  return api;
}

type Peekable = {
  peek(query: string, lang?: string): ResolvedImage | null | undefined;
  resolve(query: string, lang?: string): Promise<ResolvedImage | null>;
};

/** What `combineImageSources` needs from a web source (bridge, own key, or a chain of them). */
export type WebLike = Peekable & { enabled(): boolean };

/**
 * Several web sources tried in order (e.g. UI bridge, then own key). Disabled ones are skipped; errors of one
 * source fall through to the next. `list` is evaluated on every call (the setting may change at runtime).
 */
export function chainWebSources(list: () => WebLike[]): WebLike {
  return {
    enabled: () => list().some((s) => s.enabled()),
    peek(query, lang) {
      for (const s of list()) {
        if (!s.enabled()) continue;
        const v = s.peek(query, lang);
        if (v !== null) return v;
      }
      return null;
    },
    async resolve(query, lang) {
      for (const s of list()) {
        if (!s.enabled()) continue;
        const v = await s.resolve(query, lang).catch(() => null);
        if (v) return v;
      }
      return null;
    },
  };
}

/** How `combineImageSources` weighs the two sources. */
export type WebPreference =
  | boolean // false: Wikimedia first, web as fallback · true: web first, Wikimedia as fallback
  | 'only'; // web only, NEVER Wikimedia (products / `source: 'web'`: keyless title matching picks nonsense)

/**
 * Wikimedia + web. `preferWeb` (node says source:'web'): web first, Wikimedia as fallback; otherwise
 * Wikimedia first, web only when Wikimedia found nothing. `'only'`: web search alone (no web search
 * available -> no image). Web errors never turn into an error state.
 */
export function combineImageSources(wiki: Peekable, web: WebLike) {
  return {
    peek(query: string, lang: string | undefined, preferWeb: WebPreference): ResolvedImage | null | undefined {
      const useWeb = web.enabled();
      if (preferWeb === 'only') return useWeb ? web.peek(query, lang) : null;
      if (useWeb && preferWeb) {
        const w = web.peek(query, lang);
        if (w !== null) return w;
        return wiki.peek(query, lang);
      }
      const k = wiki.peek(query, lang);
      if (k !== null || !useWeb) return k;
      return web.peek(query, lang);
    },
    async resolve(query: string, lang: string | undefined, preferWeb: WebPreference): Promise<ResolvedImage | null> {
      const tryWeb = () => (web.enabled() ? web.resolve(query, lang).catch(() => null) : Promise.resolve(null));
      if (preferWeb === 'only') return tryWeb();
      if (preferWeb && web.enabled()) {
        return (await tryWeb()) ?? wiki.resolve(query, lang);
      }
      return (await wiki.resolve(query, lang)) ?? (await tryWeb());
    },
  };
}
