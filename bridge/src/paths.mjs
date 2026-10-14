// Request-target hygiene (security review M1): the bridge routes on the path and forwards it to Hermes, so
// the path that is routed must be exactly the path Hermes sees. Node hands us the raw request-target; WHATWG
// URL parsing (and most upstream servers) resolve `..` and `%2e%2e` later, which let `/v1/../api/jobs` slip
// past the `/api` allow-list. We decode once, refuse anything ambiguous, and route on the result.

/** Raw sequences that are never legitimate in a bridge/Hermes path (encoded dots, slashes, backslashes, NUL, double encoding). */
const ENCODED_BAD = /%(2e|2f|5c|00|25)/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * @param {string|undefined} rawUrl  req.url
 * @returns {{ok: true, path: string, search: string} | {ok: false, reason: string}}
 *   `path` is the decoded path (route on it); the raw path equals it after one decode and contains nothing
 *   an upstream could normalize differently, so `path + search` can be forwarded as-is.
 */
export function checkRequestPath(rawUrl) {
  const raw = String(rawUrl ?? '');
  if (!raw.startsWith('/')) return { ok: false, reason: 'not origin-form' }; // absolute-form / authority-form / '*'
  if (raw.length > 8192) return { ok: false, reason: 'too long' };
  const q = raw.indexOf('?');
  const rawPath = q === -1 ? raw : raw.slice(0, q);
  const search = q === -1 ? '' : raw.slice(q);
  if (rawPath.includes('#') || search.includes('#')) return { ok: false, reason: 'fragment' };
  if (ENCODED_BAD.test(rawPath)) return { ok: false, reason: 'encoded dot/slash' };
  let path;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return { ok: false, reason: 'bad encoding' };
  }
  if (CONTROL.test(path) || path.includes('\\')) return { ok: false, reason: 'control/backslash' };
  if (path.includes('//')) return { ok: false, reason: 'empty segment' };
  for (const seg of path.split('/')) {
    if (seg === '.' || seg === '..') return { ok: false, reason: 'dot segment' };
  }
  // what a WHATWG URL parser would make of it must be the same path (catches anything we did not think of)
  let normalized;
  try {
    normalized = new URL(rawPath, 'http://x').pathname;
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
  if (normalized !== rawPath) return { ok: false, reason: 'not normalized' };
  return { ok: true, path, search };
}

/**
 * Upstream URL for an origin-form request target (`/v1/models?x=1`, `/p/<profile>/v1/…`): the target is appended to
 * the path of `baseUrl` (HERMES_BASE_URL after normalizeBaseUrl, e.g. `http://host:8642/prefix`), so a reverse-proxy
 * sub-path is kept. `new URL('/v1/x', base)` would replace it. The target can never leave the base path: dot segments
 * (also encoded), backslashes and anything that a URL parser would rewrite are refused (throws).
 * @param {string} baseUrl  absolute http(s) URL; its search/hash are ignored
 * @param {string} target   origin-form path (+ optional query), already checked by checkRequestPath for client input
 * @returns {URL}
 */
export function upstreamUrl(baseUrl, target) {
  const t = String(target ?? '');
  const q = t.indexOf('?');
  const path = q === -1 ? t : t.slice(0, q);
  const search = q === -1 ? '' : t.slice(q);
  if (!path.startsWith('/') || path.startsWith('//') || t.includes('#') || path.includes('\\') || CONTROL.test(t)) {
    throw new Error('upstream target must be an origin-form path');
  }
  for (const seg of path.split('/')) {
    if (seg === '.' || seg === '..' || /^(\.|%2e)+$/i.test(seg)) throw new Error('upstream target must not contain dot segments');
  }
  const url = new URL(baseUrl);
  const prefix = url.pathname.replace(/\/+$/, '');
  url.pathname = prefix + path;
  url.search = search;
  url.hash = '';
  if (url.pathname !== prefix + path || (prefix && !url.pathname.startsWith(`${prefix}/`))) throw new Error('upstream target escapes the base path');
  return url;
}
