/**
 * Image URLs inside markdown answers. Hermes / agent servers may send server-relative links
 * (`/v1/attachments/<token>`); in the Android APK (and any app origin ≠ server) those only work
 * when resolved against the active profile's base URL. Pure TS so `node --test` can run it.
 */

/** Absolute http(s) URL for `src`, or null (unsafe scheme / relative without a base). */
export function resolveImageUrl(src: string, baseUrl: string | null | undefined): string | null {
  const s = src.trim();
  if (!s) return null;
  if (/^https?:\/\/[^\s/]+/i.test(s)) return s;
  // protocol-relative or any other scheme (data:, javascript:, file:, blob: …) is not accepted as-is
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  if (s.startsWith('//') || !baseUrl) return null;
  try {
    const base = new URL(baseUrl);
    if (base.protocol !== 'http:' && base.protocol !== 'https:') return null;
    // root-relative links hang off the server origin; other relative ones off the base path
    const u = s.startsWith('/') ? new URL(s, base.origin) : new URL(s, base.href.endsWith('/') ? base.href : base.href + '/');
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
