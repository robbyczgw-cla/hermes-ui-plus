/**
 * Direct image-search providers (Settings → Bildersuche → "Eigener API-Key"). Pure: request building, response
 * parsing and filtering, ported 1:1 from bridge/src/images.mjs (keep both in sync): https only (image +
 * thumbnail), no svg/gif, known size >= MIN_SIDE on both sides (unknown size is kept), one result per image
 * url, at most 2 per source domain, SafeSearch on. The API key is only ever put into a request header.
 */
import type { WebResult } from './webCore.ts';

export type ImageProviderId = 'serper' | 'brave';
export const IMAGE_PROVIDERS: readonly ImageProviderId[] = ['serper', 'brave'];
export const isImageProviderId = (v: unknown): v is ImageProviderId => v === 'serper' || v === 'brave';
export const MIN_SIDE = 300;

export type Candidate = { url: string; thumbnailUrl: string; width: number; height: number; title: string; sourcePage: string; sourceDomain: string };
export type ProviderRequest = { url: string; init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string } };

const COUNTRY: Record<string, string> = { de: 'de', en: 'us', es: 'es' };
const asNum = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Request for one search (`count` = candidates asked from the provider, the caller filters down). */
export function buildRequest(provider: ImageProviderId, q: string, lang: string, count: number, key: string): ProviderRequest {
  lang = /^[a-z]{2}/i.test(lang) ? lang.slice(0, 2).toLowerCase() : 'de';
  const country = COUNTRY[lang] ?? 'us';
  if (provider === 'serper') {
    return {
      url: 'https://google.serper.dev/images',
      init: { method: 'POST', headers: { 'X-API-KEY': key, 'content-type': 'application/json' }, body: JSON.stringify({ q, gl: country, hl: lang, num: count, safe: 'active' }) },
    };
  }
  const params = new URLSearchParams({ q, count: String(count), safesearch: 'strict', search_lang: lang, country: country.toUpperCase(), spellcheck: '1' });
  return {
    url: `https://api.search.brave.com/res/v1/images/search?${params.toString()}`,
    init: { method: 'GET', headers: { 'X-Subscription-Token': key, accept: 'application/json' } },
  };
}

/** Raw provider JSON → candidates (untrusted input, never throws). */
export function parseProviderResponse(provider: ImageProviderId, json: unknown): Candidate[] {
  if (provider === 'serper') {
    const list = obj(json).images;
    return (Array.isArray(list) ? list : []).map((raw) => {
      const i = obj(raw);
      return {
        url: str(i.imageUrl), thumbnailUrl: str(i.thumbnailUrl), width: asNum(i.imageWidth), height: asNum(i.imageHeight),
        title: str(i.title), sourcePage: str(i.link), sourceDomain: str(i.domain) || str(i.source),
      };
    });
  }
  const list = obj(json).results;
  return (Array.isArray(list) ? list : []).map((raw) => {
    const i = obj(raw);
    const props = obj(i.properties);
    return {
      url: str(props.url), thumbnailUrl: str(obj(i.thumbnail).src) || str(props.placeholder),
      width: asNum(props.width), height: asNum(props.height),
      title: str(i.title), sourcePage: str(i.url), sourceDomain: str(i.source),
    };
  });
}

const httpsUrl = (s: string): URL | null => {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
};
const host = (s: string) => (httpsUrl(s)?.hostname ?? '').replace(/^www\./, '').toLowerCase();

/** Filter + dedupe (same rules as the bridge). `provider` is recorded on every result. */
export function filterCandidates(items: readonly Candidate[], provider: string, n: number): WebResult[] {
  const seen = new Set<string>();
  const perDomain = new Map<string, number>();
  const out: WebResult[] = [];
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

/** Candidates to request for `n` wanted results (same as the bridge: 4x, 10..40). */
export const candidateCount = (n: number) => Math.min(40, Math.max(n * 4, 10));
