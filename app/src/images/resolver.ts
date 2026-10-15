/**
 * Image-by-query resolver: query ("Kolosseum") → real photo + attribution from Wikipedia /
 * Wikimedia Commons (free, keyless). Platform-free core (fetch/storage/clock injected).
 *
 * Pipeline per language, for a micro-batch of queries collected within `batchWindowMs`
 * (Wikimedia rate-limits anonymous bursts, so requests are batched where the API allows it):
 *   A  {lang}.wikipedia  titles=Q1|Q2|…&redirects=1  prop=pageimages|pageprops   (1 request / batch)
 *   B  {lang}.wikipedia  generator=search per remaining query                    (1 request / query)
 *   C  en.wikipedia      titles=… for the rest (lang ≠ en)                       (1 request / batch)
 *   D  commons           generator=search filetype:bitmap per remaining query    (1 request / query)
 *   E  imageinfo (author/license) for the Wikipedia picks, per wiki host        (1 request / host)
 * A typical answer with 6 well-named images costs 2 requests. Results are cached (LRU, 300
 * entries, 7 days; misses 1 day) in memory + persisted storage. Transient failures (timeout,
 * HTTP error, 429) are NOT cached; a 429/503 pauses all requests for Retry-After (default 30 s).
 */
import { normalizeImageQuery, normalizeWikiLang } from '../protocol/validate.ts';
import { createLruCache } from './cache.ts';
import { fileKey, parseImageInfo, parseSearchPages, parseTitleLookup, resizeThumb, safeWikimediaUrl } from './parse.ts';
import { acceptableFile, pickCommonsFile, pickWikiPage } from './rank.ts';
import type { FetchLike, KeyValueStorage, ResolvedImage, WikiFile, WikiPage } from './types.ts';

export const USER_AGENT = 'HermesUI/0.1 (personal app)';
export const DISPLAY_WIDTH = 960;
export const THUMB_WIDTH = 330;
const DAY = 24 * 60 * 60 * 1000;
const COMMONS = 'commons.wikimedia.org';

export interface ResolverOptions {
  fetch: FetchLike;
  /** e.g. { 'Api-User-Agent': USER_AGENT } (+ 'User-Agent' on native) */
  headers?: Record<string, string>;
  storage?: KeyValueStorage | null;
  storageKey?: string;
  now?: () => number;
  concurrency?: number;
  timeoutMs?: number;
  batchWindowMs?: number;
  maxEntries?: number;
  ttlMs?: number;
  missTtlMs?: number;
  saveDelayMs?: number;
}

export interface ResolverStats {
  requests: number;
  cacheHits: number;
}

export interface ImageResolver {
  /** null = nothing suitable found (cached); rejects on transient errors (not cached). */
  resolve(query: string, lang?: string): Promise<ResolvedImage | null>;
  /** synchronous memory-cache lookup: image, null (known miss) or undefined (unknown) */
  peek(query: string, lang?: string): ResolvedImage | null | undefined;
  /**
   * Loads the persisted cache now (otherwise only on the first `resolve`), so `peek` already knows earlier hits and
   * misses when a restored chat first paints its cards (no shimmer → collapse jump for known misses).
   */
  warm(): Promise<void>;
  clear(): Promise<void>;
  stats(): ResolverStats;
}

export class ImageResolveError extends Error {
  readonly kind: 'timeout' | 'http' | 'rate-limited' | 'parse' | 'network';
  constructor(kind: ImageResolveError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Query string encoder (no URLSearchParams: incomplete in some RN runtimes). */
export function qs(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

const BASE = { action: 'query', format: 'json', formatversion: 2, origin: '*' };
const PAGE_PROPS = { prop: 'pageimages|pageprops', piprop: 'thumbnail|name', pithumbsize: DISPLAY_WIDTH, pilimit: 'max', ppprop: 'disambiguation' };
const II_PROPS = (lang: string) => ({
  prop: 'imageinfo',
  iiprop: 'url|size|mime|extmetadata',
  iiurlwidth: DISPLAY_WIDTH,
  iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ObjectName',
  iiextmetadatalanguage: lang,
});

export const wikiHost = (lang: string) => `${lang}.wikipedia.org`;
export const apiUrl = (host: string, params: Record<string, string | number>) => `https://${host}/w/api.php?${qs({ ...BASE, ...params })}`;

export function titlesUrl(lang: string, titles: string[]): string {
  return apiUrl(wikiHost(lang), { ...PAGE_PROPS, redirects: 1, titles: titles.join('|') });
}
export function searchUrl(lang: string, query: string): string {
  return apiUrl(wikiHost(lang), { ...PAGE_PROPS, generator: 'search', gsrsearch: query, gsrlimit: 5, gsrnamespace: 0 });
}
export function imageInfoUrl(host: string, files: string[], lang: string): string {
  return apiUrl(host, { ...II_PROPS(lang), titles: files.map((f) => `File:${f}`).join('|') });
}
export function commonsSearchUrl(query: string, lang: string): string {
  return apiUrl(COMMONS, { ...II_PROPS(lang), generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: 6, gsrlimit: 8 });
}

/** Wikipedia pick + (optional) imageinfo → ResolvedImage */
export function fromWikiPage(page: WikiPage, host: string, info: WikiFile | undefined): ResolvedImage | null {
  const thumb = info?.thumb ?? page.thumb;
  if (!thumb || !page.file) return null;
  const file = fileKey(page.file);
  return {
    url: thumb.url,
    thumbUrl: resizeThumb(thumb.url, THUMB_WIDTH),
    width: thumb.width,
    height: thumb.height,
    title: page.title,
    attribution: {
      author: info?.author,
      license: info?.license,
      licenseUrl: info?.licenseUrl,
      sourceUrl: info?.descriptionUrl ?? `https://${host}/wiki/File:${encodeURIComponent(file.replace(/ /g, '_'))}`,
      provider: 'wikipedia',
    },
  };
}

export function fromCommonsFile(f: WikiFile): ResolvedImage | null {
  if (!f.thumb) return null;
  return {
    url: f.thumb.url,
    thumbUrl: resizeThumb(f.thumb.url, THUMB_WIDTH),
    width: f.thumb.width,
    height: f.thumb.height,
    title: f.objectName ?? f.name.replace(/\.[a-z0-9]+$/i, ''),
    attribution: {
      author: f.author,
      license: f.license,
      licenseUrl: f.licenseUrl,
      sourceUrl: f.descriptionUrl ?? `https://${COMMONS}/wiki/File:${encodeURIComponent(f.name.replace(/ /g, '_'))}`,
      provider: 'commons',
    },
  };
}

const optStr = (x: unknown) => x === undefined || typeof x === 'string';

/** Validates a persisted cache value (storage content is not trusted blindly). */
export function isResolvedImage(v: unknown): v is ResolvedImage | null {
  if (v === null) return true;
  if (typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  const a = r.attribution as Record<string, unknown> | undefined;
  return (
    !!safeWikimediaUrl(r.url) &&
    !!safeWikimediaUrl(r.thumbUrl) &&
    typeof r.width === 'number' &&
    typeof r.height === 'number' &&
    typeof r.title === 'string' &&
    !!a &&
    typeof a === 'object' &&
    typeof a.sourceUrl === 'string' &&
    /^https:\/\//.test(a.sourceUrl) &&
    (a.provider === 'wikipedia' || a.provider === 'commons') &&
    optStr(a.author) &&
    optStr(a.license) &&
    optStr(a.licenseUrl)
  );
}

type Waiter = { query: string; resolve: (v: ResolvedImage | null) => void; reject: (e: unknown) => void };

export function createImageResolver(opts: ResolverOptions): ImageResolver {
  // called as a plain function: a browser fetch called as `x.fetch()` throws "Illegal invocation" (wrong `this`)
  const doFetch = opts.fetch;
  const now = opts.now ?? Date.now;
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const timeoutMs = opts.timeoutMs ?? 4000;
  const batchWindowMs = opts.batchWindowMs ?? 30;
  const ttlMs = opts.ttlMs ?? 7 * DAY;
  const missTtlMs = opts.missTtlMs ?? DAY;
  const storageKey = opts.storageKey ?? 'hermesui.images.v1';
  const headers = opts.headers ?? {};
  const cache = createLruCache<ResolvedImage | null>(opts.maxEntries ?? 300, now);
  const inflight = new Map<string, Promise<ResolvedImage | null>>();
  const pending = new Map<string, Waiter[]>();
  const stats: ResolverStats = { requests: 0, cacheHits: 0 };
  let blockedUntil = 0;
  let hydrated: Promise<void> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  // ── concurrency limit ──
  let active = 0;
  const queue: (() => void)[] = [];
  const acquire = () =>
    new Promise<void>((res) => {
      if (active < concurrency) {
        active++;
        res();
      } else queue.push(res);
    });
  const release = () => {
    const next = queue.shift();
    if (next) next();
    else active--;
  };

  async function getJson(url: string): Promise<unknown> {
    await acquire();
    try {
      if (now() < blockedUntil) throw new ImageResolveError('rate-limited', 'Wikimedia rate limit – paused');
      stats.requests++;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => {
          ctrl?.abort();
          rej(new ImageResolveError('timeout', `timeout after ${timeoutMs} ms`));
        }, timeoutMs);
      });
      try {
        const res = await Promise.race([doFetch(url, { headers, signal: ctrl?.signal }), timeout]);
        if (res.status === 429 || res.status === 503) {
          const ra = Number(res.headers.get('retry-after'));
          blockedUntil = now() + Math.min(300, Number.isFinite(ra) && ra > 0 ? ra : 30) * 1000;
          throw new ImageResolveError('rate-limited', `HTTP ${res.status}`);
        }
        if (!res.ok) throw new ImageResolveError('http', `HTTP ${res.status}`);
        const text = await Promise.race([res.text(), timeout]);
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          throw new ImageResolveError('parse', 'response is not JSON');
        }
        if (json && typeof json === 'object' && 'error' in json) throw new ImageResolveError('http', 'API error');
        return json;
      } catch (e) {
        if (e instanceof ImageResolveError) throw e;
        throw new ImageResolveError('network', e instanceof Error ? e.message : String(e));
      } finally {
        if (timer) clearTimeout(timer);
      }
    } finally {
      release();
    }
  }

  // ── persistence ──
  function hydrate(): Promise<void> {
    if (!hydrated) {
      hydrated = (async () => {
        if (!opts.storage) return;
        try {
          const raw = await opts.storage.getItem(storageKey);
          if (!raw) return;
          const data = JSON.parse(raw) as { v?: number; entries?: unknown };
          if (data && data.v === 1) cache.load(data.entries, isResolvedImage);
        } catch {
          // corrupt/unavailable storage → start empty
        }
      })();
    }
    return hydrated;
  }

  function scheduleSave() {
    if (!opts.storage || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      opts.storage?.setItem(storageKey, JSON.stringify({ v: 1, entries: cache.dump() })).catch(() => {});
    }, opts.saveDelayMs ?? 1000);
    (saveTimer as { unref?: () => void }).unref?.();
  }

  // ── pipeline ──
  async function resolveBatch(lang: string, queries: string[]): Promise<{ found: Map<string, ResolvedImage | null>; failed: Map<string, unknown> }> {
    const found = new Map<string, ResolvedImage | null>();
    const failed = new Map<string, unknown>();
    const wikiPicks = new Map<string, { page: WikiPage; host: string; lang: string }>();
    let rest = [...queries];
    const done = (q: string) => found.has(q) || failed.has(q) || wikiPicks.has(q);
    const failAll = (e: unknown) => {
      for (const q of rest) if (!done(q)) failed.set(q, e);
      rest = [];
    };
    const titleStage = async (l: string) => {
      if (!rest.length) return;
      try {
        for (let i = 0; i < rest.length; i += 50) {
          const chunk = rest.slice(i, i + 50);
          const map = parseTitleLookup(await getJson(titlesUrl(l, chunk)), chunk);
          for (const q of chunk) {
            const page = map.get(q);
            // exact title / curated redirect: trust it if the page image is a proper photo
            if (page && !page.disambiguation && page.file && page.thumb && acceptableFile(page.file, q)) {
              wikiPicks.set(q, { page, host: wikiHost(l), lang: l });
            }
          }
        }
      } catch (e) {
        failAll(e);
      }
      rest = rest.filter((q) => !done(q));
    };
    const perQuery = async (fn: (q: string) => Promise<void>) => {
      await Promise.all(
        rest.map(async (q) => {
          try {
            await fn(q);
          } catch (e) {
            failed.set(q, e);
          }
        }),
      );
      rest = rest.filter((q) => !done(q));
    };

    await titleStage(lang); // A
    await perQuery(async (q) => {
      // B
      const page = pickWikiPage(parseSearchPages(await getJson(searchUrl(lang, q))), q);
      if (page) wikiPicks.set(q, { page, host: wikiHost(lang), lang });
    });
    if (lang !== 'en') await titleStage('en'); // C
    await perQuery(async (q) => {
      // D
      const f = pickCommonsFile(parseImageInfo(await getJson(commonsSearchUrl(q, lang))), q);
      found.set(q, f ? fromCommonsFile(f) : null);
    });

    // E: attribution for Wikipedia picks, one request per host (non-fatal)
    const byHost = new Map<string, string[]>();
    for (const [q, p] of wikiPicks) byHost.set(p.host, [...(byHost.get(p.host) ?? []), q]);
    await Promise.all(
      [...byHost].map(async ([host, qs_]) => {
        const files = [...new Set(qs_.map((q) => fileKey(wikiPicks.get(q)!.page.file!)))];
        const infos = new Map<string, WikiFile>();
        try {
          for (let i = 0; i < files.length; i += 50) {
            for (const f of parseImageInfo(await getJson(imageInfoUrl(host, files.slice(i, i + 50), lang)))) infos.set(f.name, f);
          }
        } catch {
          // keep the images, just without author/license details
        }
        for (const q of qs_) {
          const p = wikiPicks.get(q)!;
          found.set(q, fromWikiPage(p.page, host, infos.get(fileKey(p.page.file!))));
        }
      }),
    );
    return { found, failed };
  }

  function flush(lang: string) {
    const waiters = pending.get(lang) ?? [];
    pending.delete(lang);
    if (!waiters.length) return;
    const queries = [...new Set(waiters.map((w) => w.query))];
    resolveBatch(lang, queries).then(
      ({ found, failed }) => {
        for (const w of waiters) {
          if (failed.has(w.query)) w.reject(failed.get(w.query));
          else {
            const v = found.get(w.query) ?? null;
            cache.set(cacheKey(lang, w.query), v, v ? ttlMs : missTtlMs);
            w.resolve(v);
          }
        }
        scheduleSave();
      },
      (e) => waiters.forEach((w) => w.reject(e)),
    );
  }

  const cacheKey = (lang: string, q: string) => `${lang}|${q.toLowerCase()}`;
  const clean = (query: string, lang?: string) => ({
    q: normalizeImageQuery(typeof query === 'string' ? query.replace(/[|[\]{}<>#]/g, ' ') : '') ?? '',
    l: normalizeWikiLang(lang) ?? 'de',
  });

  return {
    peek(query, lang) {
      const { q, l } = clean(query, lang);
      if (!q) return null;
      const hit = cache.get(cacheKey(l, q));
      return hit ? hit.value : undefined;
    },
    resolve(query, lang) {
      const { q, l } = clean(query, lang);
      if (!q) return Promise.resolve(null);
      const key = cacheKey(l, q);
      const hit = cache.get(key);
      if (hit) {
        stats.cacheHits++;
        return Promise.resolve(hit.value);
      }
      const existing = inflight.get(key);
      if (existing) return existing;
      const p = hydrate()
        .then(() => {
          const h2 = cache.get(key);
          if (h2) {
            stats.cacheHits++;
            return h2.value;
          }
          return new Promise<ResolvedImage | null>((resolve, reject) => {
            const list = pending.get(l);
            if (list) list.push({ query: q, resolve, reject });
            else {
              pending.set(l, [{ query: q, resolve, reject }]);
              setTimeout(() => flush(l), batchWindowMs);
            }
          });
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    warm: () => hydrate(),
    async clear() {
      cache.clear();
      await opts.storage?.setItem(storageKey, JSON.stringify({ v: 1, entries: [] })).catch(() => {});
    },
    stats: () => ({ ...stats }),
  };
}
