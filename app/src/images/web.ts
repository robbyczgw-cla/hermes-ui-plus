/**
 * App-wide web image search: the UI bridge of the user's Hermes bridge profile and/or the user's own
 * provider key (Serper / Brave), combined with the Wikimedia resolver according to Settings → Medien →
 * Bildersuche: 'bridge' = bridge, then own key (if configured) · 'own' = own key only · 'wikipedia' = no web search.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createWebImageSearch, combineImageSources, chainWebSources, type BridgeConn, type WebPreference, type WebSearchHints } from './webCore';
import { createOwnImageSearch, type OwnConfig } from './ownCore';
import { imageResolver } from './instance';
import type { ImageSearchMode } from './mode';
import { markTrustedImageUrl } from './trust';
import { proxiedImageUrl, proxyImageSource, type ImageSourceSpec } from './proxy';
import type { ResolvedImage } from './types';

export type { BridgeConn, OwnConfig };
export { bridgeConnFromProfiles } from './webProfiles';
export const webImageSearch = createWebImageSearch({ fetch: (url, init) => fetch(url, init), hints: createProbeHints() });
export const ownImageSearch = createOwnImageSearch({ fetch: (url, init) => fetch(url, init) });

let mode: ImageSearchMode = 'bridge';
let modeVer = 0;
const modeListeners = new Set<() => void>();

const chain = chainWebSources(() => (mode === 'bridge' ? [webImageSearch, ownImageSearch] : mode === 'own' ? [ownImageSearch] : []));
const combined = combineImageSources(imageResolver, chain);
/** Results of our own resolver / image search may load without a tap (trust.ts, review H1). */
const trust = <T extends ResolvedImage | null | undefined>(img: T): T => {
  if (img) markTrustedImageUrl(img.url, img.thumbUrl);
  return img;
};
export const combinedImages = {
  peek: (query: string, lang: string | undefined, preferWeb: WebPreference) => trust(combined.peek(query, lang, preferWeb)),
  resolve: (query: string, lang: string | undefined, preferWeb: WebPreference) => combined.resolve(query, lang, preferWeb).then(trust),
};

export const setWebImageBridge = (c: BridgeConn | null) => {
  webImageSearch.setConn(c);
  // ask the bridge once whether it has an image provider (public default: none) → no pointless searches
  void webImageSearch.probe();
};
export const setImageSearchMode = (m: ImageSearchMode) => {
  if (m === mode) return;
  mode = m;
  modeVer++;
  modeListeners.forEach((l) => l());
};
export const setOwnImageConfig = (c: OwnConfig | null) => ownImageSearch.setConfig(c);
/** Settings → Medien → Bildersuche (read during render; `useWebImagesEnabled` re-renders on changes). */
export const getImageSearchMode = (): ImageSearchMode => mode;

const subscribe = (l: () => void) => {
  const offs = [webImageSearch.subscribe(l), ownImageSearch.subscribe(l)];
  modeListeners.add(l);
  return () => {
    offs.forEach((o) => o());
    modeListeners.delete(l);
  };
};
const version = () => webImageSearch.version() + ownImageSearch.version() + modeVer;

// load the persisted Wikimedia cache at startup (not only on the first search): restored chats' cards then know
// earlier hits / misses at their first paint; if it lands later, the cards re-render via useWebImagesEnabled
void imageResolver.warm().then(() => {
  modeVer++;
  modeListeners.forEach((l) => l());
});

/** Re-renders when web search becomes (un)available. */
export function useWebImagesEnabled(): boolean {
  useSyncExternalStore(subscribe, version, version);
  return chain.enabled();
}

/**
 * Answer-provided image URL → the bridge's image proxy URL (null: no proxy advertised / URL not proxyable).
 * The proxy URL is the user's own bridge, so it loads without a tap (trust.ts).
 */
export function imageProxyFor(url: string): string | null {
  const p = proxiedImageUrl(webImageSearch.proxyConn(), url);
  if (p) markTrustedImageUrl(p);
  return p;
}

/** expo-image source: proxy URLs carry the device token as a header (memoize it: a new object refetches on web). */
export function imageSourceFor(uri: string): ImageSourceSpec {
  return proxyImageSource(webImageSearch.proxyConn(), uri);
}

const proxyKey = () => webImageSearch.proxyConn()?.baseUrl ?? '';
/** Re-renders when the bridge's image proxy becomes (un)available; returns a key that changes with it ('' = none). */
export function useImageProxyKey(): string {
  return useSyncExternalStore(webImageSearch.subscribe, proxyKey, proxyKey);
}

/**
 * Persisted last `/bridge/images/config` answer per bridge (webCore.WebSearchHints): a bridge without an image provider
 * is known as such at the next app start before its probe answers, so restored product cards without a photo
 * collapse before the first paint. Best effort: loaded once at startup, entries older than 30 days are ignored.
 */
function createProbeHints(): WebSearchHints {
  const KEY = 'hermesui.images.bridgeProbe.v1';
  const MAX_AGE = 30 * 24 * 60 * 60_000;
  let map: Record<string, [boolean, number]> = {};
  const fresh = (e: unknown): e is [boolean, number] => Array.isArray(e) && typeof e[0] === 'boolean' && typeof e[1] === 'number' && Date.now() - e[1] < MAX_AGE;
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      const data: unknown = raw ? JSON.parse(raw) : null;
      if (!data || typeof data !== 'object') return;
      for (const [k, e] of Object.entries(data as Record<string, unknown>)) if (fresh(e) && !(k in map)) map[k] = e;
      webImageSearch.applyHints();
    })
    .catch(() => {});
  return {
    get: (baseUrl) => (fresh(map[baseUrl]) ? map[baseUrl][0] : undefined),
    set(baseUrl, available) {
      const e = map[baseUrl];
      if (e && e[0] === available && Date.now() - e[1] < MAX_AGE / 30) return; // unchanged and refreshed within a day
      map = { ...map, [baseUrl]: [available, Date.now()] };
      AsyncStorage.setItem(KEY, JSON.stringify(map)).catch(() => {});
    },
  };
}
