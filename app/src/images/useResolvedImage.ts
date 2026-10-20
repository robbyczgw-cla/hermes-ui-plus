import { useEffect, useState } from 'react';
import { combinedImages, imageProxyFor, useImageProxyKey, useWebImagesEnabled } from './web';
import { useImagesAllowed } from './policy';
import { proxiedImagesAutoLoad, useImageTrustVersion } from './trust';
import type { ResolvedImage } from './types';

/** `query` → resolved via Wikipedia/Commons; `url` (from a tool/source) is used as-is and wins. */
export type ImageSource = { query?: string; url?: string; lang?: string; /** 'web' = web image search only (via UI bridge / own key), never Wikimedia */ source?: 'web' };
export type ResolvedImageStatus = 'idle' | 'loading' | 'ok' | 'none' | 'error';
export type ResolvedImageState = { status: ResolvedImageStatus; image: ResolvedImage | null };

const isHttpUrl = (u: string | undefined): u is string => !!u && /^https?:\/\/\S+\.\S+/.test(u);

/** `shown` = what loads (the bridge proxy URL, when used), `source` = the answer's URL (attribution). */
function directImage(shown: string, source = shown): ResolvedImage {
  return { url: shown, thumbUrl: shown, width: 0, height: 0, title: '', attribution: { sourceUrl: source, provider: 'source' } };
}

type Proxy = ((url: string) => string | null) | null;

function initial(src: ImageSource | null, enabled: boolean, proxy: Proxy = null): ResolvedImageState {
  // disabled = the url/query may still be a partial (streaming) string → don't touch it
  if (!src || !enabled) return { status: 'idle', image: null };
  // answer-provided URL (from Hermes' tools): through the user's bridge image proxy when it has one (like product
  // photos, itemImage.ts) – loads at once and the image host never sees the phone; else as before (trust gate)
  if (isHttpUrl(src.url)) return { status: 'ok', image: directImage(proxy?.(src.url) ?? src.url, src.url) };
  if (!src.query) return { status: 'none', image: null };
  const hit = combinedImages.peek(src.query, src.lang, src.source === 'web' ? 'only' : false);
  if (hit) return { status: 'ok', image: hit };
  if (hit === null) return { status: 'none', image: null };
  return { status: 'loading', image: null };
}

/**
 * Resolve an image for rendering. `enabled: false` (e.g. while the query string is still
 * streaming) keeps it idle. Direct `url` images have `width/height = 0` (unknown) and a
 * 'source' attribution (host name only).
 */
export function useResolvedImage(source: ImageSource | string | null | undefined, opts: { enabled?: boolean } = {}): ResolvedImageState {
  const src: ImageSource | null = typeof source === 'string' ? (/^https?:\/\//.test(source) ? { url: source } : { query: source }) : source ?? null;
  return useResolvedImages([src], [opts.enabled ?? true])[0];
}

/**
 * Several images at once (gallery). `enabled[i] === false` keeps item i idle (still streaming).
 * State is derived from the (cache-peeked) sources during render; only async results are stored,
 * keyed by the source signature, so a growing (streaming) list never flickers.
 */
export function useResolvedImages(rawSources: (ImageSource | null)[], enabled: boolean[] = []): ResolvedImageState[] {
  // Settings → Medien → Bilder laden: query photos (Wikimedia) are dropped when not allowed → 'none' fallback
  const allowed = useImagesAllowed();
  const webOn = useWebImagesEnabled();
  const proxyKey = useImageProxyKey();
  useImageTrustVersion(); // "Erst nach Tippen" switches the proxy's auto-load off
  // the proxy only while images may load; with "Erst nach Tippen" the answer URL waits for a tap as before
  const proxy: Proxy = allowed && proxyKey && proxiedImagesAutoLoad() ? imageProxyFor : null;
  const sources = allowed ? rawSources : rawSources.map((s) => (s && !isHttpUrl(s.url) ? { ...s, query: undefined } : s));
  const sig = JSON.stringify(sources.map((s, i) => [s?.query ?? '', s?.url ?? '', s?.lang ?? '', enabled[i] ?? true, s?.source ?? '', webOn]));
  const [results, setResults] = useState<{ sig: string; items: (ResolvedImageState | undefined)[] }>({ sig: '', items: [] });

  useEffect(() => {
    const parsed = JSON.parse(sig) as [string, string, string, boolean, string][];
    let alive = true;
    parsed.forEach(([query, url, lang, en, source], i) => {
      const src: ImageSource | null = query || url ? { query: query || undefined, url: url || undefined, lang: lang || undefined, source: source === 'web' ? 'web' : undefined } : null;
      if (initial(src, en).status !== 'loading' || !query) return;
      const set = (v: ResolvedImageState) => {
        if (!alive) return;
        setResults((prev) => {
          const items = prev.sig === sig ? prev.items.slice() : [];
          items[i] = v;
          return { sig, items };
        });
      };
      combinedImages.resolve(query, lang || undefined, source === 'web' ? 'only' : false).then(
        (img) => set({ status: img ? 'ok' : 'none', image: img }),
        () => set({ status: 'error', image: null }),
      );
    });
    return () => {
      alive = false;
    };
  }, [sig]);

  return sources.map((s, i) => (results.sig === sig ? results.items[i] : undefined) ?? initial(s, enabled[i] ?? true, proxy));
}
