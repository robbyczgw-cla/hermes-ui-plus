/**
 * Favicons of web sources (Sources block, web result card) under the image privacy settings. A favicon request tells
 * the (model- or search-chosen) host that this chat looked at it, so it follows the same rules as answer images
 * (trust.ts, itemImage.ts):
 *  - images off (Settings → Medien) → no request, the letter avatar stays;
 *  - the bridge image proxy is available → through the bridge (the host sees the bridge, never the phone), unless
 *    "Erst nach Tippen" is set and the icon was not unlocked;
 *  - otherwise only trusted hosts or "Immer laden" load directly; everything else keeps the letter avatar (no tap
 *    prompt for an 18 px icon).
 * Pure (node:test, favicon.test.ts); the hook lives in useFavicon.ts.
 */
import type { LoadDecision } from './itemImage.ts';

/** The site's own favicon (no third-party favicon service), or undefined for a non-http(s) URL. */
export function faviconOf(pageUrl: string): string | undefined {
  // the host must end the authority: `https://user@host/` (credentials) gives no icon
  const m = /^(https?):\/\/([^/?#\s@]+)(?=[/?#]|$)/i.exec(pageUrl.trim());
  return m ? `${m[1].toLowerCase()}://${m[2]}/favicon.ico` : undefined;
}

/** URL to load for the favicon of `pageUrl` (proxy URL or the icon itself), or null = letter avatar. */
export function planFavicon(
  pageUrl: string,
  decide: LoadDecision,
  opts: { allowed: boolean; proxy?: (url: string) => string | null; proxyAuto: boolean },
): string | null {
  if (!opts.allowed) return null;
  const icon = faviconOf(pageUrl);
  if (!icon) return null;
  const load = decide(icon) === 'load';
  const proxied = opts.proxy ? opts.proxy(icon) : null;
  if (proxied && (opts.proxyAuto || load)) return proxied;
  return load ? icon : null;
}
