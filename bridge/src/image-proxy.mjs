// Image proxy: GET /bridge/img?u=<https url> (device-token auth like every bridge route).
// Pure transport: the bridge fetches a picture that Hermes' own tools returned (og:image of a product page, …) so the
// app can show it at once without exposing the user's IP to the image host. No keys, no provider, no "thinking".
// This is an SSRF surface, so every hop is checked strictly:
//  - https only, port 443 only, no credentials in the URL, no single-label / *.localhost / *.local hosts;
//  - the host is resolved by the bridge and EVERY address must be public (no private, loopback, link-local, CGNAT,
//    ULA, multicast, documentation or reserved ranges); the socket connects to exactly that checked address (no
//    second lookup, so DNS rebinding cannot swap it); IP literals are checked the same way;
//  - at most 3 redirects, each target re-validated as above;
//  - status 200 only, Content-Type image/* (never svg), the body is identified by its magic bytes (jpeg, png, webp,
//    gif, avif, ico for site favicons) and served with that type; max 8 MB; connect timeout 5 s, total 15 s;
//  - no client headers are forwarded (no cookies, no referrer, no Authorization); a generic User-Agent is sent.
// Results are kept in a small disk cache below the state directory (sha256(url) file names, LRU, size cap, TTL).
// Logs carry only metadata (host, status, bytes, ms), never the path or query string. Docs: docs/BRIDGE.md.
import https from 'node:https';
import net from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { silentLogger } from './log.mjs';
import { LruCache } from './lru.mjs';
import { makeAuthorizer, makeCredentials } from './auth.mjs';

export const IMAGE_PROXY_PATH = '/bridge/img';
export const MAX_URL_CHARS = 2048;
const MiB = 1024 * 1024;
export const IMAGE_PROXY_DEFAULTS = Object.freeze({
  maxBytes: 8 * MiB,
  connectTimeoutMs: 5000,
  totalTimeoutMs: 15_000,
  maxRedirects: 3,
  cacheBytes: 200 * MiB,
  cacheTtlMs: 24 * 3600_000,
  ratePerMin: 120, // uncached upstream fetches per credential and minute
  maxInFlight: 8, // upstream fetches at the same time (whole bridge)
  maxQueue: 64, // waiting fetches before 429
  failTtlMs: 5 * 60_000, // a URL that failed is not retried for 5 min
});
export const USER_AGENT = 'Mozilla/5.0 (compatible; HermesUI-ImageProxy/1.0)';
const OFF = /^(off|0|false|no)$/i;
const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? d : Number(v));

/** @param {Record<string, string|undefined>} env */
export function loadImageProxyConfig(env = process.env) {
  const stateDir = env.BRIDGE_STATE_DIR || String(env.STATE_DIRECTORY ?? '').split(':')[0] || '';
  const cacheMb = num(env.BRIDGE_IMAGE_PROXY_CACHE_MB, IMAGE_PROXY_DEFAULTS.cacheBytes / MiB);
  return {
    ...IMAGE_PROXY_DEFAULTS,
    enabled: !OFF.test((env.BRIDGE_IMAGE_PROXY ?? '').trim()),
    cacheDir: cacheMb > 0 && stateDir ? join(stateDir, 'image-cache') : '',
    cacheBytes: cacheMb * MiB,
    ratePerMin: num(env.BRIDGE_IMAGE_PROXY_RATE_LIMIT, IMAGE_PROXY_DEFAULTS.ratePerMin),
  };
}

/* ───────────── address policy ───────────── */

const subnets = (list, family) => {
  const b = new net.BlockList();
  for (const cidr of list) {
    const [addr, bits] = cidr.split('/');
    b.addSubnet(addr, Number(bits), family);
  }
  return b;
};
// IPv4: this network, private (RFC 1918), CGNAT, loopback, link-local, IETF protocol assignments, documentation,
// 6to4 relay, benchmarking, multicast, reserved + broadcast.
const V4_DENY = subnets([
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24',
  '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
], 'ipv4');
// IPv6: only global unicast (2000::/3) is allowed at all; that already excludes ::/8 (unspecified, loopback,
// IPv4-mapped/-compatible), 64:ff9b::/96 (NAT64), 100::/64, fc00::/7 (ULA), fe80::/10 (link-local), ff00::/8 (multicast).
// Inside it: IETF protocol assignments incl. Teredo, documentation, 6to4 (embeds an IPv4 address).
const V6_GLOBAL = subnets(['2000::/3'], 'ipv6');
const V6_DENY = subnets(['2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20'], 'ipv6');

/** May the proxy connect to this IP address? Public unicast only. */
export function isPublicAddress(ip) {
  const s = String(ip ?? '').replace(/^\[|\]$/g, '');
  const fam = net.isIP(s);
  if (fam === 4) return !V4_DENY.check(s, 'ipv4');
  if (fam === 6) return V6_GLOBAL.check(s, 'ipv6') && !V6_DENY.check(s, 'ipv6');
  return false;
}

/** Host names that never point at the public internet. */
const LOCAL_SUFFIX = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|home\.arpa|in-addr\.arpa|ip6\.arpa|onion)$/i;

/**
 * Syntactic + literal-address check of a target URL (no DNS).
 * @returns {{ok: true, url: URL} | {ok: false, status: number, code: string, reason: string}}
 */
export function parseTarget(raw) {
  const bad = (status, code, reason) => ({ ok: false, status, code, reason });
  if (typeof raw !== 'string' || !raw) return bad(400, 'invalid_url', 'missing');
  if (raw.length > MAX_URL_CHARS) return bad(400, 'invalid_url', 'too long');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f\\]/.test(raw)) return bad(400, 'invalid_url', 'control, space or backslash');
  let u;
  try { u = new URL(raw); } catch { return bad(400, 'invalid_url', 'unparseable'); }
  if (u.protocol !== 'https:') return bad(400, 'invalid_url', 'https only');
  if (u.username || u.password) return bad(400, 'invalid_url', 'credentials in url');
  if (u.port && u.port !== '443') return bad(400, 'invalid_url', 'port 443 only');
  const host = u.hostname.replace(/\.$/, '').toLowerCase();
  if (!host) return bad(400, 'invalid_url', 'no host');
  const literal = host.replace(/^\[|\]$/g, '');
  if (net.isIP(literal)) {
    if (!isPublicAddress(literal)) return bad(403, 'forbidden_address', 'non-public address');
  } else if (!host.includes('.') || LOCAL_SUFFIX.test(host)) {
    return bad(403, 'forbidden_address', 'local host name');
  }
  u.hash = '';
  return { ok: true, url: u };
}

/* ───────────── image type ───────────── */

/** Image type from the magic bytes, or null. Only types every app platform can show; never svg. */
export function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  const head = buf.subarray(0, 12).toString('latin1');
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
  if (head.slice(4, 8) === 'ftyp') {
    // ISO-BMFF: major brand or one of the compatible brands of the ftyp box must be avif/avis
    const boxLen = Math.min(buf.readUInt32BE(0), buf.length, 64);
    for (let i = 8; i + 4 <= boxLen; i += 4) {
      if (i === 12) continue; // minor version
      const brand = buf.subarray(i, i + 4).toString('latin1');
      if (brand === 'avif' || brand === 'avis') return 'image/avif';
    }
  }
  // ICO (site favicons): reserved 0, type 1 = icon, 1–64 images, the first entry's reserved byte 0
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) {
    const count = buf.readUInt16LE(4);
    if (count >= 1 && count <= 64 && buf[9] === 0) return 'image/x-icon';
  }
  return null;
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/x-icon': 'ico' };
const TYPE_OF_EXT = Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t]));

/* ───────────── fetch ───────────── */

class ProxyError extends Error {
  constructor(status, code, message) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

/**
 * `lookup` for http(s).request: resolve all addresses, refuse if ANY is not allowed, hand back only checked
 * addresses. The socket connects to what this returns, so the checked address is the connected one.
 */
export function makeCheckedLookup(resolveAll, allowAddress) {
  return (hostname, options, cb) => {
    if (typeof options === 'function') { cb = options; options = {}; }
    Promise.resolve()
      .then(() => resolveAll(hostname))
      .then((addrs) => {
        const list = (Array.isArray(addrs) ? addrs : []).filter((a) => a && net.isIP(a.address));
        if (!list.length) throw Object.assign(new Error('no address'), { code: 'ENOTFOUND' });
        if (list.some((a) => !allowAddress(a.address))) throw Object.assign(new Error('forbidden address'), { code: 'EFORBIDDENADDR' });
        const out = list.map((a) => ({ address: a.address, family: a.family ?? net.isIP(a.address) }));
        if (options?.all) cb(null, out);
        else cb(null, out[0].address, out[0].family);
      })
      .catch((e) => cb(e));
  };
}

const defaultResolve = (host) => dnsLookup(host, { all: true, verbatim: true });

/**
 * @param {ReturnType<typeof loadImageProxyConfig>} cfg
 * @param {{resolve?: (host: string) => Promise<{address: string, family?: number}[]>, allowAddress?: (ip: string) => boolean,
 *   transport?: {request?: typeof https.request, port?: number, ca?: string|Buffer}}} [o]
 *   `transport` is a test seam (a local server on another port / with a test CA); production uses https on 443.
 */
export function createImageFetcher(cfg, o = {}) {
  const allowAddress = o.allowAddress ?? isPublicAddress;
  const lookup = makeCheckedLookup(o.resolve ?? defaultResolve, allowAddress);
  const request = o.transport?.request ?? https.request;

  function hop(url, signal) {
    return new Promise((resolve, reject) => {
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const literal = net.isIP(host);
      if (literal && !allowAddress(host)) return reject(new ProxyError(403, 'forbidden_address'));
      const req = request({
        protocol: o.transport?.request ? undefined : 'https:',
        hostname: host,
        port: o.transport?.port ?? 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        // a fixed header set: nothing from the client (no cookies, referrer, auth), identity encoding only
        headers: { 'user-agent': USER_AGENT, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8,image/x-icon;q=0.5', 'accept-encoding': 'identity', connection: 'close' },
        lookup,
        agent: false,
        signal,
        ...(literal ? {} : { servername: host }),
        ...(o.transport?.ca ? { ca: o.transport.ca } : {}),
      });
      const connectTimer = setTimeout(() => req.destroy(new ProxyError(504, 'timeout', 'connect timeout')), cfg.connectTimeoutMs);
      req.once('socket', (s) => {
        if (!s.connecting) clearTimeout(connectTimer);
        else s.once('connect', () => clearTimeout(connectTimer));
      });
      req.once('response', (res) => { clearTimeout(connectTimer); resolve(res); });
      req.on('error', (e) => { clearTimeout(connectTimer); reject(e); }); // on: a late error (abort after the response) must not crash
      req.end();
    });
  }

  function readCapped(res, signal) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let settled = false;
      // settle first, then destroy: destroying emits 'aborted' / 'error' synchronously
      const done = (err, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (err) { reject(err); res.destroy(); } else resolve(value);
      };
      const onAbort = () => done(new ProxyError(504, 'timeout'));
      signal.addEventListener('abort', onAbort, { once: true });
      res.on('data', (c) => {
        size += c.length;
        if (size > cfg.maxBytes) return done(new ProxyError(413, 'too_large'));
        chunks.push(c);
      });
      res.once('end', () => done(null, Buffer.concat(chunks)));
      res.once('error', (e) => done(e));
      res.once('aborted', () => done(new ProxyError(502, 'upstream_error', 'aborted')));
      res.once('close', () => done(new ProxyError(502, 'upstream_error', 'closed')));
    });
  }

  /**
   * @param {URL} start  already checked by parseTarget
   * @returns {Promise<{body: Buffer, type: string, host: string, redirects: number}>}
   */
  return async function fetchImage(start) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.totalTimeoutMs);
    let url = start;
    try {
      for (let redirects = 0; ; redirects++) {
        const res = await hop(url, ac.signal);
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          res.destroy();
          if (redirects >= cfg.maxRedirects) throw new ProxyError(502, 'too_many_redirects');
          let next;
          try { next = new URL(String(res.headers.location ?? ''), url); } catch { throw new ProxyError(502, 'bad_redirect'); }
          if (!res.headers.location) throw new ProxyError(502, 'bad_redirect');
          const p = parseTarget(next.href);
          if (!p.ok) throw new ProxyError(p.status, p.code, `redirect refused (${p.reason})`);
          url = p.url;
          continue;
        }
        if (status !== 200) { res.destroy(); throw new ProxyError(502, 'upstream_status', `upstream HTTP ${status}`); }
        const ctype = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        if (!ctype.startsWith('image/') || ctype.includes('svg')) { res.destroy(); throw new ProxyError(415, 'unsupported_type'); }
        const enc = String(res.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
        if (enc !== 'identity' && enc !== '') { res.destroy(); throw new ProxyError(415, 'unsupported_type', 'encoded body'); }
        const len = Number(res.headers['content-length']);
        if (Number.isFinite(len) && len > cfg.maxBytes) { res.destroy(); throw new ProxyError(413, 'too_large'); }
        const body = await readCapped(res, ac.signal);
        const type = sniffImageType(body);
        if (!type) throw new ProxyError(415, 'unsupported_type', 'not an image');
        return { body, type, host: url.hostname, redirects };
      }
    } catch (e) {
      if (e instanceof ProxyError) throw e;
      if (ac.signal.aborted || e?.name === 'AbortError') throw new ProxyError(504, 'timeout');
      if (e?.code === 'EFORBIDDENADDR') throw new ProxyError(403, 'forbidden_address');
      throw new ProxyError(502, 'upstream_error', String(e?.code ?? e?.message ?? e).slice(0, 80));
    } finally {
      clearTimeout(timer);
      ac.abort(); // close every hop, including responses rejected before body consumption
    }
  };
}

/* ───────────── disk cache ───────────── */

/**
 * Tiny LRU disk cache: `<dir>/<sha256>.<ext>`, index in memory (rebuilt from the directory on first use, oldest
 * mtime first), total size capped, entries older than `ttlMs` are dropped on read. Errors only disable caching.
 */
export function createDiskCache({ dir, maxBytes, ttlMs, now = Date.now, logger = silentLogger }) {
  /** @type {Map<string, {type: string, bytes: number, at: number}>} */
  const index = new Map();
  let total = 0;
  let ready = null;
  let broken = !dir || !(maxBytes > 0);
  const file = (key, type) => join(dir, `${key}.${EXT[type]}`);
  const drop = (key) => {
    const e = index.get(key);
    if (!e) return;
    index.delete(key);
    total -= e.bytes;
    unlink(file(key, e.type)).catch(() => {});
  };
  function init() {
    ready ??= (async () => {
      try {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const found = [];
        for (const name of await readdir(dir)) {
          const m = /^([0-9a-f]{64})\.(jpg|png|gif|webp|avif)$/.exec(name);
          if (!m) {
            if (name.endsWith('.tmp')) await unlink(join(dir, name)).catch(() => {});
            continue;
          }
          const st = await stat(join(dir, name)).catch(() => null);
          if (st?.isFile()) found.push({ key: m[1], type: TYPE_OF_EXT[m[2]], bytes: st.size, at: st.mtimeMs });
        }
        found.sort((a, b) => a.at - b.at);
        for (const f of found) { index.set(f.key, { type: f.type, bytes: f.bytes, at: f.at }); total += f.bytes; }
        evict();
      } catch (e) {
        broken = true;
        logger.warn('image_proxy_cache_off', { error: String(e?.code ?? e?.message ?? e).slice(0, 80) });
      }
    })();
    return ready;
  }
  function evict() {
    for (const key of index.keys()) {
      if (total <= maxBytes) break;
      drop(key);
    }
  }
  return {
    get enabled() { return !broken; },
    get size() { return total; },
    async get(key) {
      if (broken) return null;
      await init();
      const e = index.get(key);
      if (!e) return null;
      if (now() - e.at > ttlMs) { drop(key); return null; }
      try {
        const body = await readFile(file(key, e.type));
        index.delete(key);
        index.set(key, e); // most recently used last
        return { body, type: e.type };
      } catch {
        drop(key);
        return null;
      }
    },
    async set(key, body, type) {
      if (broken || body.length > maxBytes) return;
      await init();
      if (broken) return;
      const target = file(key, type);
      const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        await writeFile(tmp, body, { mode: 0o600, flag: 'wx' });
        await rename(tmp, target);
      } catch {
        await unlink(tmp).catch(() => {});
        return;
      }
      const old = index.get(key);
      if (old) { index.delete(key); total -= old.bytes; }
      index.set(key, { type, bytes: body.length, at: now() });
      total += body.length;
      evict();
    },
  };
}

/* ───────────── route ───────────── */

/**
 * @param {{token?: string, allowNoAuth?: boolean, corsOrigins?: string[], auth?: any}} bridgeConfig
 * @param {{env?: Record<string,string|undefined>, config?: ReturnType<typeof loadImageProxyConfig>, logger?: any,
 *   now?: () => number, resolve?: any, allowAddress?: (ip: string) => boolean, transport?: any}} [o]
 */
export function createImageProxy(bridgeConfig, o = {}) {
  const cfg = o.config ?? loadImageProxyConfig(o.env ?? process.env);
  const log = o.logger ?? silentLogger;
  const now = o.now ?? Date.now;
  const authorized = makeAuthorizer(bridgeConfig);
  const credentials = makeCredentials(bridgeConfig);
  const corsOrigins = bridgeConfig.corsOrigins ?? [];
  const fetchImage = createImageFetcher(cfg, { resolve: o.resolve, allowAddress: o.allowAddress, transport: o.transport });
  const cache = createDiskCache({ dir: cfg.cacheDir, maxBytes: cfg.cacheBytes, ttlMs: cfg.cacheTtlMs, now, logger: log });
  const failures = new LruCache({ max: 1000, ttlMs: cfg.failTtlMs, now });
  /** @type {Map<string, Promise<{body: Buffer, type: string, host: string}>>} */
  const inflight = new Map();
  /** @type {Map<string, {start: number, count: number}>} */
  const windows = new Map();
  let active = 0;
  const waiting = [];

  const matches = (req) => req.method === 'GET' && (req.url ?? '').split('?')[0] === IMAGE_PROXY_PATH;

  const baseHeaders = (req) => {
    const h = { 'x-hermes-ui-bridge': '1', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
    const origin = req.headers.origin;
    if (origin && corsOrigins.length && (corsOrigins.includes('*') || corsOrigins.includes(origin))) {
      h['access-control-allow-origin'] = corsOrigins.includes('*') ? '*' : origin;
      h.vary = 'Origin';
    }
    return h;
  };
  function fail(req, res, status, code, extra = {}) {
    if (res.headersSent) return res.destroy();
    const buf = Buffer.from(JSON.stringify({ error: { message: code.replace(/_/g, ' '), type: status === 401 || status === 400 ? 'invalid_request_error' : 'bridge_error', code } }));
    res.writeHead(status, { ...baseHeaders(req), 'content-type': 'application/json', 'content-length': buf.length, 'cache-control': 'no-store', ...extra });
    res.end(buf);
  }
  function sendImage(req, res, body, type) {
    res.writeHead(200, {
      ...baseHeaders(req),
      'content-type': type,
      'content-length': body.length,
      'content-disposition': 'inline',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=86400',
    });
    res.end(body);
  }

  /** Per-credential window of uncached upstream fetches. */
  function allow(cred) {
    const t = now();
    let w = windows.get(cred);
    if (!w || t - w.start >= 60_000) {
      if (windows.size > 1000) for (const [k, v] of windows) if (t - v.start >= 60_000) windows.delete(k);
      w = { start: t, count: 0 };
      windows.set(cred, w);
    }
    if (w.count >= cfg.ratePerMin) return false;
    w.count++;
    return true;
  }
  async function slot() {
    if (active < cfg.maxInFlight) { active++; return; }
    if (waiting.length >= cfg.maxQueue) throw new ProxyError(429, 'busy');
    await new Promise((resolve) => waiting.push(resolve)); // the finishing fetch hands its slot over
  }
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  async function load(key, url) {
    const running = inflight.get(key);
    if (running) return running;
    const p = (async () => {
      await slot();
      try {
        const r = await fetchImage(url);
        await cache.set(key, r.body, r.type);
        return r;
      } finally {
        release();
      }
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  async function handle(req, res) {
    if (!authorized(req)) return fail(req, res, 401, 'invalid_api_key', { 'www-authenticate': 'Bearer' });
    if (!cfg.enabled) return fail(req, res, 404, 'proxy_disabled');
    const t0 = now();
    let raw = null;
    try { raw = new URL(req.url ?? '', 'http://x').searchParams.get('u'); } catch { /* invalid */ }
    const parsed = parseTarget(raw);
    if (!parsed.ok) {
      log.info('image_proxy_refused', { code: parsed.code, reason: parsed.reason });
      return fail(req, res, parsed.status, parsed.code);
    }
    const host = parsed.url.hostname;
    const key = createHash('sha256').update(parsed.url.href).digest('hex');
    const hit = await cache.get(key);
    if (hit) {
      log.info('image_proxy', { host, status: 200, bytes: hit.body.length, ms: now() - t0, cached: true });
      return sendImage(req, res, hit.body, hit.type);
    }
    const failed = failures.get(key);
    if (failed) return fail(req, res, failed.status, failed.code);
    if (!inflight.has(key) && !allow(credentials.of(req) ?? 'anonymous')) {
      log.info('image_proxy_refused', { code: 'rate_limited', host });
      return fail(req, res, 429, 'rate_limited', { 'retry-after': '30' });
    }
    try {
      const r = await load(key, parsed.url);
      log.info('image_proxy', { host, status: 200, bytes: r.body.length, ms: now() - t0, cached: false, ...(r.redirects ? { redirects: r.redirects } : {}) });
      if (res.destroyed) return;
      return sendImage(req, res, r.body, r.type);
    } catch (e) {
      const status = e instanceof ProxyError ? e.status : 502;
      const code = e instanceof ProxyError ? e.code : 'upstream_error';
      if (status !== 429) failures.set(key, { status, code });
      log.info('image_proxy_failed', { host, status, code, ms: now() - t0 });
      return fail(req, res, status, code, status === 429 ? { 'retry-after': '5' } : {});
    }
  }

  return {
    config: cfg,
    get enabled() { return cfg.enabled; },
    /** advertised in GET /bridge/images/config as `proxy` */
    info: () => ({ available: cfg.enabled, path: IMAGE_PROXY_PATH, maxBytes: cfg.maxBytes }),
    matches,
    handle,
    cache,
  };
}
