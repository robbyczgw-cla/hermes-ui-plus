// QR pairing: GET /bridge/pair (+ .svg / .png) hands the app its connection settings as a
// hermesuiplus://pair?u=<public url>&c=<one-time pair code>&n=<name> QR code (BRIDGE_PAIR_SCHEME=hermesui for personal app
// builds, hermesiui for apps from before the rename; every app accepts all three when scanning in-app, the scheme only
// decides which app the system camera opens).
// The link never carries a token: the app trades `c=` once for its device token (POST /bridge/pair/redeem, below;
// src/devices.mjs). A pasted / screenshotted link is worthless after first use or after 1 hour.
// Without a device store (no state directory) pairing refuses instead of embedding BRIDGE_TOKEN; the old behaviour
// (`t=<BRIDGE_TOKEN>`, a permanent admin credential in the link) needs BRIDGE_PAIR_ADMIN_TOKEN=1 (unsafe).
// Page access: from the machine itself (direct loopback connection, no proxy headers, loopback `Host`, not a cross-site
// browser request), or - only with BRIDGE_PAIRING=1 - with a one-time page code (printed in the log, valid
// 10 min, rate limited). Requests with a `Host` that is neither loopback nor the public/allowed host name are
// refused outright (DNS rebinding, review H3).
// Docs: docs/BRIDGE.md ("Pairing"), docs/ROUTER.md, "Install & pairing".
import { randomInt, timingSafeEqual, createHash } from 'node:crypto';
import { silentLogger } from './log.mjs';

export const PAIR_PATH = '/bridge/pair';
/** first = default; mirrors app/brand/identity.json scheme + legacySchemes (test/pair-cli.test.mjs) */
export const PAIR_SCHEMES = ['hermesuiplus', 'hermesiui', 'hermesui'];
export const PAIR_SCHEME = `${PAIR_SCHEMES[0]}://pair`;
export const CODE_TTL_MS = 10 * 60_000;
export const MAX_FAILED_ATTEMPTS = 5;
export const FAIL_WINDOW_MS = 10 * 60_000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const sha = (s) => createHash('sha256').update(s).digest();

export const REDEEM_PATH = '/bridge/pair/redeem';
export const REDEEM_BODY_MAX = 1024;
export const REDEEM_PER_ADDRESS = 10; // per minute and remote address
export const REDEEM_GLOBAL = 60; // failed attempts per minute across all addresses
export const REDEEM_INFLIGHT = 60; // independent resource cap, including valid requests
const REDEEM_WINDOW_MS = 60_000;

/** Pairing cannot hand out a credential (no device store and no explicit BRIDGE_PAIR_ADMIN_TOKEN=1). */
export class PairingUnavailableError extends Error {
  constructor() {
    super('pairing needs a device store: set BRIDGE_STATE_DIR (and keep BRIDGE_DEVICE_TOKENS on). '
      + 'BRIDGE_PAIR_ADMIN_TOKEN=1 would put BRIDGE_TOKEN into the link instead (unsafe: a permanent admin credential).');
    this.code = 'PAIRING_NO_STORE';
  }
}

const query = ({ url, code, token, name }) => {
  const parts = [`u=${encodeURIComponent(url)}`];
  if (code) parts.push(`c=${encodeURIComponent(code)}`);
  else if (token) parts.push(`t=${encodeURIComponent(token)}`); // only BRIDGE_PAIR_ADMIN_TOKEN=1 (legacy, unsafe)
  if (name) parts.push(`n=${encodeURIComponent(name)}`);
  return parts.join('&');
};

/** hermesuiplus://pair?u=...&c=<code>&n=... (no credential at all when the bridge runs without auth). */
export function buildPairUri({ url, code, token, name, scheme }) {
  return `${scheme ? `${scheme}://pair` : PAIR_SCHEME}?${query({ url, code, token, name })}`;
}

/** `https://<bridge>/#pair?u=...&c=...` for a web app served by the bridge itself (same origin; the fragment never reaches a server log). */
export function buildWebPairLink({ url, code, token, name }) {
  return `${url}/#pair?${query({ url, code, token, name })}`;
}

/** @param {Record<string, string|undefined>} env */
export function loadPairConfig(env = process.env) {
  let publicUrl = (env.BRIDGE_PUBLIC_URL || '').trim();
  if (publicUrl) {
    let u;
    try { u = new URL(publicUrl); } catch { throw new Error('BRIDGE_PUBLIC_URL must be an absolute http(s) URL'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('BRIDGE_PUBLIC_URL must be an absolute http(s) URL');
    publicUrl = u.toString().replace(/\/+$/, '');
  }
  const scheme = (env.BRIDGE_PAIR_SCHEME || PAIR_SCHEMES[0]).trim().toLowerCase();
  if (!PAIR_SCHEMES.includes(scheme)) throw new Error(`BRIDGE_PAIR_SCHEME must be one of ${PAIR_SCHEMES.join(', ')}`);
  return {
    publicUrl,
    scheme,
    name: (env.BRIDGE_NAME || 'Hermes').trim().slice(0, 64) || 'Hermes',
    enabled: /^(1|true|yes|on)$/i.test(env.BRIDGE_PAIRING ?? ''),
    /** legacy, unsafe: embed BRIDGE_TOKEN (`t=`) when there is no device store */
    adminToken: /^(1|true|yes|on)$/i.test(env.BRIDGE_PAIR_ADMIN_TOKEN ?? ''),
    /** a web app is served by the bridge (BRIDGE_WEB_DIR): also offer the `https://<bridge>/#pair?…` link */
    web: Boolean((env.BRIDGE_WEB_DIR ?? '').trim()),
    /** extra Host names (comma separated, with or without port) the pairing page may be reached under */
    allowedHosts: (env.BRIDGE_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-server', 'x-real-ip', 'x-client-ip', 'forwarded', 'via', 'tailscale-user-login', 'tailscale-user-name', 'cf-connecting-ip', 'true-client-ip'];
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** `Host` header → lower-case host name without port ('' when missing or malformed). */
export function hostName(req) {
  const h = String(req.headers?.host ?? '').trim().toLowerCase();
  if (!h || h.length > 255) return '';
  const m = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(h);
  return m ? m[1] : '';
}

/**
 * True only for a direct loopback connection that was typed into a browser / curl on this machine:
 * loopback peer, none of the usual proxy headers (a plain `proxy_pass`, socat or ssh -L adds none, so this alone is
 * not enough), a loopback `Host` (a DNS-rebinding page has its own name there) and no cross-site fetch metadata.
 */
export function isLocalRequest(req) {
  if (!LOOPBACK.has(req.socket?.remoteAddress ?? '')) return false;
  if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  if (!LOOPBACK_HOSTS.has(hostName(req))) return false;
  const site = String(req.headers['sec-fetch-site'] ?? '').toLowerCase();
  if (site && site !== 'none' && site !== 'same-origin') return false;
  return true;
}

export function generateCode() {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
const normCode = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function qr() { return (await import('qrcode')).default; }
export async function qrSvg(text) { return (await qr()).toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }); }
export async function qrPng(text) { return (await qr()).toBuffer(text, { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: 512 }); }
/** Compact QR for terminals (half-block characters). */
export async function qrTerminal(text) { return (await qr()).toString(text, { type: 'terminal', small: true, errorCorrectionLevel: 'L' }); }

/**
 * @param {{host: string, port: number, token: string}} bridgeConfig
 * @param {{env?: Record<string,string|undefined>, logger?: any, now?: () => number, pair?: ReturnType<typeof loadPairConfig>, code?: string}} [o]
 */
export function createPairing(bridgeConfig, o = {}) {
  const cfg = o.pair ?? loadPairConfig(o.env ?? process.env);
  const log = o.logger ?? silentLogger;
  const now = o.now ?? Date.now;
  let code = null; // { value, expires }
  let failures = []; // timestamps of failed code attempts (global: behind a proxy all clients share one address)

  function issueCode() {
    code = { value: normCode(o.code) ? normCode(o.code) : normCode(generateCode()), expires: now() + CODE_TTL_MS };
    return `${code.value.slice(0, 4)}-${code.value.slice(4)}`;
  }
  if (cfg.enabled) {
    const shown = issueCode();
    log.info('pairing enabled: open the path below on the bridge URL within 10 minutes (one-time)', { path: `${PAIR_PATH}?code=${shown}` });
  }

  const devices = o.devices ?? null;
  // Host names the pairing page may be reached under: loopback, the public URL's host, BRIDGE_ALLOWED_HOSTS.
  const knownHosts = new Set([...LOOPBACK_HOSTS, ...cfg.allowedHosts.map((h) => h.replace(/:\d+$/, ''))]);
  if (cfg.publicUrl) knownHosts.add(new URL(cfg.publicUrl).hostname.toLowerCase());
  // Without a configured public name we cannot know the remote Host; the code is still required there, and the
  // local path checks for a loopback Host on its own.
  const hostKnown = (req) => (!cfg.publicUrl && !cfg.allowedHosts.length) || knownHosts.has(hostName(req));

  const effectiveUrl = () => cfg.publicUrl || `http://${bridgeConfig.host === '0.0.0.0' || bridgeConfig.host === '::' ? '127.0.0.1' : bridgeConfig.host}:${bridgeConfig.port}`;
  /**
   * New pending device + one-time pair code (src/devices.mjs) → pair URI with `c=`. Without a device store this
   * throws PairingUnavailableError, unless the bridge runs without auth (nothing secret to hand out) or
   * BRIDGE_PAIR_ADMIN_TOKEN=1 (legacy: BRIDGE_TOKEN as `t=`).
   * @returns {{id: string|null, code: string|null, expiresAt: number|null, uri: string, webUri: string}}
   */
  const issue = (label = 'paired device') => {
    const url = effectiveUrl();
    let id = null;
    let code = null;
    let expiresAt = null;
    let token = '';
    if (bridgeConfig.token) {
      if (devices) ({ id, code, expiresAt } = devices.issue(label));
      else if (cfg.adminToken) token = bridgeConfig.token;
      else throw new PairingUnavailableError();
    }
    const webUri = cfg.web && cfg.publicUrl ? buildWebPairLink({ url: cfg.publicUrl, code, token, name: cfg.name }) : '';
    return { id, code, expiresAt, uri: buildPairUri({ url, code, token, name: cfg.name, scheme: cfg.scheme }), webUri };
  };
  const payload = (label) => issue(label).uri;

  // ---- POST /bridge/pair/redeem {code} → {token, deviceId, name}: exactly once per code ----
  /** @type {Map<string, number[]>} */
  const redeemHits = new Map();
  /** @type {number[]} */
  let redeemGlobal = [];
  let redeemInFlight = 0;
  function redeemAllowed(addr) {
    const t = now();
    redeemGlobal = redeemGlobal.filter((x) => t - x < REDEEM_WINDOW_MS);
    for (const [key, hits] of redeemHits) {
      if (!hits.length || t - hits[hits.length - 1] >= REDEEM_WINDOW_MS) redeemHits.delete(key);
    }
    const mine = (redeemHits.get(addr) ?? []).filter((x) => t - x < REDEEM_WINDOW_MS);
    if (redeemGlobal.length >= REDEEM_GLOBAL || mine.length >= REDEEM_PER_ADDRESS) {
      return false;
    }
    mine.push(t);
    redeemGlobal.push(t);
    redeemHits.set(addr, mine);
    return true;
  }
  const corsHeaders = (req) => {
    const origin = req.headers.origin;
    const allowed = bridgeConfig.corsOrigins ?? [];
    if (!origin || !allowed.length || (!allowed.includes('*') && !allowed.includes(origin))) return {};
    return { 'access-control-allow-origin': allowed.includes('*') ? '*' : origin, vary: 'Origin' };
  };
  const json = (req, res, status, body, extra = {}) => {
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': buf.length, 'cache-control': 'no-store', 'x-hermes-ui-bridge': '1', ...corsHeaders(req), ...extra });
    res.end(buf);
  };
  const redeemError = (req, res, status, message, code, extra) => json(req, res, status, { error: { message, type: 'invalid_request_error', code } }, extra);
  // one answer for unknown, expired, revoked and used codes (no oracle)
  const INVALID = ['Invalid or expired pairing code', 'pair_code_invalid'];

  async function redeem(req, res) {
    if (redeemInFlight >= REDEEM_INFLIGHT) {
      req.resume();
      return redeemError(req, res, 429, 'Too many pairing requests in progress', 'rate_limit_exceeded', { 'retry-after': '5', connection: 'close' });
    }
    redeemInFlight++;
    const timer = setTimeout(() => req.destroy(), 10_000);
    try {
      return await redeemBody(req, res);
    } finally {
      clearTimeout(timer);
      redeemInFlight--;
    }
  }

  async function redeemBody(req, res) {
    const failed = (status, message, code, extra) => {
      if (!redeemAllowed(String(req.socket?.remoteAddress ?? ''))) {
        return redeemError(req, res, 429, 'Too many pairing attempts, try again in a minute', 'rate_limit_exceeded', { 'retry-after': '60', ...extra });
      }
      return redeemError(req, res, status, message, code, extra);
    };
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > REDEEM_BODY_MAX) {
      req.resume();
      return failed(413, 'Request body too large', 'payload_too_large', { connection: 'close' });
    }
    let raw = '';
    try {
      for await (const c of req) {
        raw += c;
        if (raw.length > REDEEM_BODY_MAX) return failed(413, 'Request body too large', 'payload_too_large', { connection: 'close' });
      }
    } catch {
      return res.destroy();
    }
    let code;
    try {
      code = JSON.parse(raw)?.code;
    } catch {
      return failed(400, 'Body must be JSON {"code": "…"}', 'invalid_json');
    }
    if (typeof code !== 'string' || !code) return failed(400, 'Body must be JSON {"code": "…"}', 'invalid_json');
    let d = null;
    try {
      d = devices ? devices.redeem(code) : null;
    } catch (e) {
      log.error('pairing: redeem failed', { err: String(e?.message ?? e).slice(0, 120) });
      return redeemError(req, res, 503, 'Pairing is temporarily unavailable', 'pairing_unavailable', { 'retry-after': '5' });
    }
    if (!d) {
      log.warn('pairing: invalid or expired pair code');
      return failed(410, ...INVALID);
    }
    log.info('pairing: code redeemed', { deviceId: d.id });
    return json(req, res, 200, { token: d.token, deviceId: d.id, name: cfg.name });
  }

  const routeOf = (req) => {
    const p = (req.url ?? '').split('?')[0];
    if (p === REDEEM_PATH) return req.method === 'POST' ? 'redeem' : null;
    if (req.method !== 'GET') return null;
    return p === PAIR_PATH ? 'html' : p === `${PAIR_PATH}.svg` ? 'svg' : p === `${PAIR_PATH}.png` ? 'png' : null;
  };
  const matches = (req) => routeOf(req) !== null;

  /** @returns {'local'|'code'|'locked'|'bad'|'missing'|'off'} */
  function authorize(req, supplied) {
    if (isLocalRequest(req)) return 'local';
    if (!cfg.enabled) return 'off';
    const t = now();
    failures = failures.filter((x) => t - x < FAIL_WINDOW_MS);
    if (failures.length >= MAX_FAILED_ATTEMPTS) return 'locked';
    if (!supplied) return 'missing';
    const ok = code && t < code.expires && timingSafeEqual(sha(normCode(supplied)), sha(code.value));
    if (!ok) { failures.push(t); log.warn('pairing: wrong or expired code'); return 'bad'; }
    code = null; // one-time
    return 'code';
  }

  const SEC = {
    'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'self'",
  };
  const send = (res, status, type, body, extra = {}) => {
    res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body), ...SEC, ...extra });
    res.end(body);
  };
  const page = (title, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:16px system-ui,sans-serif;max-width:30rem;margin:2rem auto;padding:0 1rem;color:#222}svg,img{width:100%;height:auto;background:#fff}code{word-break:break-all;font-size:.8rem}input{font:inherit;padding:.4rem}</style></head><body>${inner}</body></html>`;

  async function handle(req, res) {
    const route = routeOf(req);
    if (route === 'redeem') return redeem(req, res); // no Host / loopback trust involved: the code is the credential
    if (!hostKnown(req)) {
      log.warn('pairing: refused unknown Host (set BRIDGE_PUBLIC_URL or BRIDGE_ALLOWED_HOSTS if this is your address)');
      return send(res, 421, 'text/plain', 'unknown host\n');
    }
    // fail closed before a one-time page code is spent: nothing to hand out without a device store
    if (bridgeConfig.token && !devices && !cfg.adminToken && (cfg.enabled || isLocalRequest(req))) {
      log.error('pairing: refused, no device store (set BRIDGE_STATE_DIR)');
      return send(res, 503, 'text/plain; charset=utf-8', `${new PairingUnavailableError().message}\n`);
    }
    const url = new URL(req.url, 'http://x');
    const supplied = url.searchParams.get('code') || '';
    const verdict = authorize(req, supplied);
    if (verdict === 'off') return send(res, 404, 'text/plain', 'not found\n');
    if (verdict === 'locked') return send(res, 429, 'text/plain', 'too many wrong codes, try again in 10 minutes\n', { 'retry-after': '600' });
    if (verdict === 'bad') return send(res, 403, 'text/plain', 'wrong or expired pairing code\n');
    if (verdict === 'missing') {
      return send(res, 401, 'text/html; charset=utf-8', page('Pairing code', '<h1>Pairing code</h1><p>Enter the one-time code from the bridge log.</p><form method="get" action="' + PAIR_PATH + '"><input name="code" autocomplete="off" autofocus placeholder="XXXX-XXXX"> <button>Show QR</button></form>'));
    }
    const when = new Date(now()).toISOString().slice(0, 16).replace('T', ' ');
    let pair;
    try {
      pair = issue(`paired ${when} (${verdict === 'code' ? 'code' : 'local'}, ${route})`);
    } catch (e) {
      if (!(e instanceof PairingUnavailableError)) throw e;
      log.error('pairing: refused, no device store (set BRIDGE_STATE_DIR)');
      return send(res, 503, 'text/plain; charset=utf-8', `${e.message}\n`);
    }
    const uri = pair.uri;
    log.info('pairing: QR served', { via: verdict, route, deviceId: pair.id ?? undefined });
    if (route === 'svg') return send(res, 200, 'image/svg+xml', await qrSvg(uri));
    if (route === 'png') {
      const buf = await qrPng(uri);
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': buf.length, ...SEC });
      return res.end(buf);
    }
    const warn = cfg.publicUrl ? '' : '<p><strong>BRIDGE_PUBLIC_URL is not set.</strong> The QR points to the local address above, which a phone can only reach inside the same network. Set BRIDGE_PUBLIC_URL to the URL the app should use.</p>';
    const web = pair.webUri ? `<p>Web app: <a href="${esc(pair.webUri)}">open and pair</a></p>` : '';
    const secret = pair.code
      ? 'This QR code contains a one-time pairing code: it works once and expires in 1 hour. Reload the page for another device.'
      : pair.uri.includes('&t=') ? '<strong>This QR code contains BRIDGE_TOKEN (BRIDGE_PAIR_ADMIN_TOKEN=1)</strong>, a permanent admin credential; do not share a screenshot.' : '';
    const html = page('Pair Hermes UI+', `<h1>Pair Hermes UI+</h1><p>Open the app, choose "Scan QR code" and scan:</p>${await qrSvg(uri)}<p>Bridge: <code>${esc(effectiveUrl())}</code><br>Name: ${esc(cfg.name)}</p>${warn}<p><a href="${esc(uri)}">Open in the app on this device</a></p>${web}<p>${verdict === 'code' ? 'The page code is now used up. Restart the bridge to open this page remotely again.' : 'Shown because you are on the bridge machine itself.'} ${secret}</p>`);
    return send(res, 200, 'text/html; charset=utf-8', html);
  }

  return { matches, handle, payload, issue, issueCode, config: cfg, isEnabled: () => cfg.enabled, effectiveUrl, hasDeviceStore: () => Boolean(devices) };
}
