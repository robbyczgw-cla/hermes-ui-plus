/**
 * Answer-provided images through the user's own bridge (`GET {bridge}/bridge/img?u=<https url>`, bridge/src/image-proxy.mjs).
 * A products / places card whose `image` URL came from Hermes' tools (og:image of the shop page, …) loads through
 * the bridge when it advertises the proxy: the picture shows at once (no tap-to-load) and the image host never sees
 * the user's IP address – only the bridge's. The bridge checks every URL itself (https, public addresses only, image
 * types only, size cap); this module only decides which URLs to hand it and adds the device token.
 * The proxy URL is loaded with an Authorization header (expo-image `source.headers`; on the web expo-image fetches
 * it and shows a blob URL), so no token ever appears in a URL. Pure: no RN imports (tested in proxy.test.ts).
 */
import type { BridgeConn } from './webCore.ts';

export const IMAGE_PROXY_PATH = '/bridge/img';
/** same limit as the bridge (MAX_URL_CHARS) */
const MAX_URL_CHARS = 2048;

/** `https://host/v1/` → `https://host` (bridge routes live next to /v1). */
export const bridgeRoot = (baseUrl: string): string => baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');

/**
 * Proxy URL for an answer-provided image, or null when it should load as before: no proxy, not https, credentials
 * or another port in the URL (the bridge would refuse it), too long, or already on the bridge's own origin.
 */
export function proxiedImageUrl(conn: BridgeConn | null, url: string | null | undefined): string | null {
  if (!conn || !url || url.length > MAX_URL_CHARS) return null;
  let u: URL;
  let root: URL;
  try {
    u = new URL(url);
    root = new URL(bridgeRoot(conn.baseUrl));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port !== '' && u.port !== '443')) return null;
  if (u.origin === root.origin) return null;
  return `${bridgeRoot(conn.baseUrl)}${IMAGE_PROXY_PATH}?u=${encodeURIComponent(url)}`;
}

/** Is `uri` a proxy URL of this bridge? */
export function isProxiedImageUrl(conn: BridgeConn | null, uri: string | null | undefined): boolean {
  return !!conn && !!uri && uri.startsWith(`${bridgeRoot(conn.baseUrl)}${IMAGE_PROXY_PATH}?u=`);
}

export type ImageSourceSpec = { uri: string; headers?: Record<string, string> };

/** expo-image source for `uri`: proxy URLs get the device token as a header, everything else loads as before. */
export function proxyImageSource(conn: BridgeConn | null, uri: string): ImageSourceSpec {
  return conn?.apiKey && isProxiedImageUrl(conn, uri) ? { uri, headers: { Authorization: `Bearer ${conn.apiKey}` } } : { uri };
}
