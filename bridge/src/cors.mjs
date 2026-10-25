// Browser origins the bridge answers with CORS headers (one helper for every route family).
//
// The desktop app (Tauri) loads the web bundle from its own origin, so every call to the bridge is cross-origin and
// the webview sends a preflight first: `tauri://localhost` (macOS, Linux) or `http://tauri.localhost` (Windows).
// With Bearer auth on, these two origins are allowed by default: the CORS header only lets the app read answers,
// every real request still needs a bridge / device token or a one-time pairing code. No cookies are involved and
// `Access-Control-Allow-Credentials` is never sent. BRIDGE_DESKTOP_ORIGINS=off removes them.
// Open mode (BRIDGE_ALLOW_NO_AUTH, no token) never adds them: there the origin check is the only protection, so
// only origins the operator listed in BRIDGE_CORS_ORIGINS count (src/server.mjs openModeOriginAllowed).

/** Origins of the official desktop app's webview. */
export const DESKTOP_ORIGINS = Object.freeze(['tauri://localhost', 'http://tauri.localhost']);

/**
 * Effective CORS origins from the environment.
 * @param {Record<string, string|undefined>} env
 * @param {{authenticated: boolean}} o  true when BRIDGE_TOKEN is set (every route needs a credential)
 * @returns {{origins: string[], explicit: string[], desktop: boolean}}
 */
export function corsOriginsFromEnv(env, { authenticated }) {
  const explicit = String(env.BRIDGE_CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const desktop = authenticated && !/^(0|off|false|no)$/i.test(String(env.BRIDGE_DESKTOP_ORIGINS ?? '').trim());
  return { origins: [...new Set([...explicit, ...(desktop ? DESKTOP_ORIGINS : [])])], explicit, desktop };
}

/**
 * CORS response headers for this request: `{}` without an Origin header or for an origin that is not allowed.
 * @param {string[]|undefined} origins  config.corsOrigins
 * @param {{headers: Record<string, any>}} req
 * @returns {Record<string, string>}
 */
export function corsHeaders(origins, req) {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !origin || !origins?.length) return {};
  if (origins.includes('*')) return { 'access-control-allow-origin': '*', vary: 'Origin' };
  return origins.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
}

/** Same as corsHeaders, set on a response that is written later. */
export function applyCors(origins, req, res) {
  for (const [k, v] of Object.entries(corsHeaders(origins, req))) res.setHeader(k, v);
}

/**
 * One line for the startup summary, `doctor` and the setup wizard: which browser origins may call the bridge.
 * @param {{explicit: string[], desktop: boolean}} c  corsOriginsFromEnv() result
 * @param {{authenticated: boolean}} o
 */
export function describeOrigins(c, { authenticated }) {
  const parts = [];
  if (c.desktop) parts.push(`desktop app (${DESKTOP_ORIGINS.join(', ')})`);
  if (c.explicit.length) parts.push(`${c.explicit.join(', ')} (BRIDGE_CORS_ORIGINS)`);
  const off = !authenticated ? 'desktop app only via BRIDGE_CORS_ORIGINS in open mode'
    : !c.desktop ? 'desktop app off (BRIDGE_DESKTOP_ORIGINS=off)' : '';
  if (!parts.length) return `same origin only${off ? `; ${off}` : ''}`;
  return `${parts.join(' + ')}${off ? `; ${off}` : ''}`;
}
