// Web image search: GET /bridge/images?q=&n=&lang= and GET /bridge/images/config.
// Providers (fallback chain, BRIDGE_IMAGE_PROVIDERS, default "serper,brave"): Serper (Google Images) and
// Brave Image Search. Keys stay server-side. Queries are never logged at info level. See docs/ROUTER.md.
import { LruCache } from './lru.mjs';
import { silentLogger } from './log.mjs';
import { makeAuthorizer } from './auth.mjs';

export const IMAGES_PATH = '/bridge/images';
export const IMAGES_CONFIG_PATH = '/bridge/images/config';
export const MIN_SIDE = 300;
const MAX_Q = 200;
const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? d : Number(v));

/** @param {Record<string, string|undefined>} env */
export function loadImagesConfig(env = process.env) {
  const order = (env.BRIDGE_IMAGE_PROVIDERS || 'serper,brave').toLowerCase().split(/[,\s>]+/).filter((p) => p === 'serper' || p === 'brave');
  return {
    order: [...new Set(order)],
    keys: { serper: env.SERPER_API_KEY || '', brave: env.BRAVE_API_KEY || '' },
    timeoutMs: num(env.BRIDGE_IMAGE_TIMEOUT_MS, 4000),
    cacheSize: num(env.BRIDGE_IMAGE_CACHE_SIZE, 500),
    cacheTtlMs: num(env.BRIDGE_IMAGE_CACHE_TTL_MS, 24 * 3600_000),
    rateLimit: num(env.BRIDGE_IMAGE_RATE_LIMIT, 30), // uncached requests per minute (all clients)
  };
}

/**
 * Does this bridge offer web image search? Same answer as `available` in GET /bridge/images/config: at least one
 * provider of BRIDGE_IMAGE_PROVIDERS has its key. Fixed for the process lifetime (keys come from the environment).
 * @param {Record<string, string|undefined>} env
 */
export function imageSearchAvailable(env = process.env) {
  const cfg = loadImagesConfig(env);
  return cfg.order.some((p) => cfg.keys[p] && PROVIDERS[p]);
}

const COUNTRY = { de: 'de', en: 'us', es: 'es' };
const asNum = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);
const str = (v) => (typeof v === 'string' ? v : '');

/** Provider adapters: (q, lang, count, key, signal, fetch) -> raw items normalized to Candidate[]. */
export const PROVIDERS = {
  async serper(q, lang, count, key, signal, doFetch) {
    const r = await doFetch('https://google.serper.dev/images', {
      method: 'POST', signal,
      headers: { 'X-API-KEY': key, 'content-type': 'application/json' },
      body: JSON.stringify({ q, gl: COUNTRY[lang] ?? 'us', hl: lang, num: count, safe: 'active' }),
    });
    if (!r.ok) throw new Error(`serper HTTP ${r.status}`);
    const j = await r.json();
    return (Array.isArray(j?.images) ? j.images : []).map((i) => ({
      url: str(i.imageUrl), thumbnailUrl: str(i.thumbnailUrl), width: asNum(i.imageWidth), height: asNum(i.imageHeight),
      title: str(i.title), sourcePage: str(i.link), sourceDomain: str(i.domain) || str(i.source),
    }));
  },
  async brave(q, lang, count, key, signal, doFetch) {
    const u = new URL('https://api.search.brave.com/res/v1/images/search');
    u.search = new URLSearchParams({ q, count: String(count), safesearch: 'strict', search_lang: lang, country: (COUNTRY[lang] ?? 'us').toUpperCase(), spellcheck: '1' }).toString();
    const r = await doFetch(u, { signal, headers: { 'X-Subscription-Token': key, accept: 'application/json' } });
    if (!r.ok) throw new Error(`brave HTTP ${r.status}`);
    const j = await r.json();
    return (Array.isArray(j?.results) ? j.results : []).map((i) => ({
      url: str(i.properties?.url), thumbnailUrl: str(i.thumbnail?.src) || str(i.properties?.placeholder),
      width: asNum(i.properties?.width), height: asNum(i.properties?.height),
      title: str(i.title), sourcePage: str(i.url), sourceDomain: str(i.source),
    }));
  },
};

const httpsUrl = (s) => { try { const u = new URL(s); return u.protocol === 'https:' ? u : null; } catch { return null; } };
const host = (s) => (httpsUrl(s)?.hostname ?? '').replace(/^www\./, '').toLowerCase();

/**
 * Filter + dedupe candidates: https only (image + thumbnail), no svg/gif, known dimensions >= 300 px on both
 * sides (unknown dimensions are kept, the client checks), one result per image url, at most 2 per domain.
 */
export function filterCandidates(items, provider, n) {
  const seen = new Set();
  const perDomain = new Map();
  const out = [];
  for (const i of items) {
    const img = httpsUrl(i.url);
    if (!img) continue;
    if (/\.(svg|gif)(\?|#|$)/i.test(img.pathname + img.search)) continue;
    if (i.width && i.height && (i.width < MIN_SIDE || i.height < MIN_SIDE)) continue;
    const thumb = i.thumbnailUrl && httpsUrl(i.thumbnailUrl) ? i.thumbnailUrl : '';
    const key = img.origin + img.pathname;
    if (seen.has(key)) continue;
    const dom = host(i.sourcePage) || host(i.url);
    if ((perDomain.get(dom) ?? 0) >= 2) continue;
    seen.add(key);
    perDomain.set(dom, (perDomain.get(dom) ?? 0) + 1);
    out.push({
      url: img.toString(), thumbnailUrl: thumb || img.toString(), width: i.width, height: i.height,
      title: i.title.slice(0, 300), sourcePage: httpsUrl(i.sourcePage)?.toString() ?? '', sourceDomain: dom, provider,
    });
    if (out.length >= n) break;
  }
  return out;
}

/**
 * @param {{token?: string, allowNoAuth?: boolean, corsOrigins?: string[]}} bridgeConfig
 * @param {{env?: Record<string,string|undefined>, images?: ReturnType<typeof loadImagesConfig>, logger?: any,
 *   fetch?: typeof fetch, providers?: typeof PROVIDERS, now?: () => number,
 *   proxy?: {info: () => {available: boolean, path: string, maxBytes: number}}}} [o]
 *   `proxy`: the image proxy (src/image-proxy.mjs), advertised in the config answer so the app knows it may use it.
 */
export function createImages(bridgeConfig, o = {}) {
  const cfg = o.images ?? loadImagesConfig(o.env ?? process.env);
  const log = o.logger ?? silentLogger;
  const doFetch = o.fetch ?? ((...a) => fetch(...a));
  const providers = o.providers ?? PROVIDERS;
  const now = o.now ?? Date.now;
  const cache = new LruCache({ max: cfg.cacheSize, ttlMs: cfg.cacheTtlMs, now });
  const corsOrigins = bridgeConfig.corsOrigins ?? [];
  let windowStart = 0;
  let windowCount = 0;

  const available = () => cfg.order.filter((p) => cfg.keys[p] && providers[p]);
  const authorized = makeAuthorizer(bridgeConfig); // BRIDGE_TOKEN or a device token (src/auth.mjs)
  const routeOf = (req) => {
    const p = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && p === IMAGES_PATH) return 'search';
    if (req.method === 'GET' && p === IMAGES_CONFIG_PATH) return 'config';
    return null;
  };
  const matches = (req) => routeOf(req) !== null;

  function send(req, res, status, body, extra = {}) {
    const buf = Buffer.from(JSON.stringify(body));
    const h = { 'content-type': 'application/json', 'content-length': buf.length, 'x-hermes-ui-bridge': '1', 'cache-control': 'no-store', ...extra };
    const origin = req.headers.origin;
    if (origin && corsOrigins.length && (corsOrigins.includes('*') || corsOrigins.includes(origin))) {
      h['access-control-allow-origin'] = corsOrigins.includes('*') ? '*' : origin;
      h.vary = 'Origin';
    }
    res.writeHead(status, h);
    res.end(buf);
  }
  const fail = (req, res, status, message, code, extra) => send(req, res, status, { error: { message, type: 'bridge_error', code } }, extra);

  /** Search with fallback chain. Returns results ([] if no provider found anything). Throws only if all providers errored. */
  async function search(q, n, lang) {
    const key = `${lang}\n${n}\n${q.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit) return { results: hit, cached: true };
    const chain = available();
    if (!chain.length) { const e = new Error('no image provider configured'); e.status = 503; e.code = 'not_configured'; throw e; }
    if (now() - windowStart >= 60_000) { windowStart = now(); windowCount = 0; }
    if (++windowCount > cfg.rateLimit) { const e = new Error('image search rate limit'); e.status = 429; e.code = 'rate_limited'; throw e; }
    let errors = 0;
    for (const name of chain) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
      try {
        const raw = await providers[name](q, lang, Math.min(40, Math.max(n * 4, 10)), cfg.keys[name], ac.signal, doFetch);
        const results = filterCandidates(raw, name, n);
        if (results.length) { cache.set(key, results); return { results, cached: false }; }
      } catch (e) {
        errors++;
        log.warn('image provider failed', { provider: name, err: String(e.message ?? e).slice(0, 120) });
      } finally {
        clearTimeout(timer);
      }
    }
    if (errors === chain.length) { const e = new Error('all image providers failed'); e.status = 502; e.code = 'upstream_error'; throw e; }
    cache.set(key, []);
    return { results: [], cached: false };
  }

  async function handle(req, res) {
    if (!authorized(req)) return fail(req, res, 401, 'unauthorized', 'unauthorized', { 'www-authenticate': 'Bearer' });
    if (routeOf(req) === 'config') {
      return send(req, res, 200, { available: available().length > 0, providers: available(), maxResults: 8, cacheSize: cache.size, proxy: o.proxy?.info() ?? { available: false } });
    }
    const url = new URL(req.url, 'http://x');
    const q = (url.searchParams.get('q') ?? '').replace(/\s+/g, ' ').trim();
    if (!q || q.length > MAX_Q) return fail(req, res, 400, `q is required (max ${MAX_Q} chars)`, 'invalid_query');
    const n = Math.min(8, Math.max(1, Math.trunc(num(url.searchParams.get('n'), 4)) || 4));
    const l = (url.searchParams.get('lang') ?? 'de').toLowerCase().slice(0, 2);
    const lang = /^[a-z]{2}$/.test(l) ? l : 'de';
    try {
      const { results, cached } = await search(q, n, lang);
      log.debug('images', { n: results.length, cached });
      return send(req, res, 200, { results });
    } catch (e) {
      return fail(req, res, e.status ?? 502, e.message, e.code ?? 'upstream_error', e.status === 429 ? { 'retry-after': '30' } : {});
    }
  }

  return { config: cfg, matches, handle, search, available };
}
