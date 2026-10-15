// Quick answers: POST /bridge/quick (alias POST /bridge/quick/v1/chat/completions), GET /bridge/quick/config.
// Transport only: the answer comes from the optional Hermes plugin "hermes-ui-plus" (hermes-plugin/, ADR 0001),
// which uses Hermes' own providers on a loopback listener. The bridge adds device auth, per-device rate limits,
// override validation against Hermes' GET /api/model/options, and aborts the upstream call when the client leaves.
// Feature off (404 feature_off) whenever the plugin is not configured, not reachable or answers garbage:
// nothing else in the bridge depends on it. Message content is never logged. Docs: docs/HERMES-PLUGIN.md.
import { readFileSync } from 'node:fs';
import { silentLogger } from './log.mjs';
import { makeAuthorizer, makeCredentials } from './auth.mjs';
import { upstreamUrl } from './paths.mjs';

export const QUICK_PATHS = ['/bridge/quick', '/bridge/quick/v1/chat/completions'];
export const QUICK_CONFIG_PATH = '/bridge/quick/config';
const BODY_MAX_BYTES = 64 * 1024;
const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? d : Number(v));
const DEFAULT_ALIASES = new Set(['', 'auto', 'default', 'quick', 'hui-quick', 'hermes-agent', 'hermes']);

/** @param {Record<string, string|undefined>} env */
export function loadQuickConfig(env = process.env) {
  return {
    off: /^(0|off|false|no)$/i.test(env.BRIDGE_QUICK ?? ''),
    pluginUrl: (env.BRIDGE_HERMES_PLUGIN_URL || 'http://127.0.0.1:8646').replace(/\/+$/, ''),
    secretFile: env.BRIDGE_HERMES_PLUGIN_SECRET_FILE || '',
    perMinute: num(env.BRIDGE_QUICK_RATE, 20),
    perDay: num(env.BRIDGE_QUICK_DAILY, 300),
    probeTtlMs: num(env.BRIDGE_QUICK_PROBE_TTL_MS, 30_000),
    catalogTtlMs: num(env.BRIDGE_QUICK_CATALOG_TTL_MS, 300_000),
    timeoutMs: num(env.BRIDGE_QUICK_TIMEOUT_MS, 90_000),
    probeTimeoutMs: num(env.BRIDGE_QUICK_PROBE_TIMEOUT_MS, 1500),
  };
}

/** Per-key fixed windows (minute + UTC day). In memory: a restart resets the counters. */
export function createRateLimiter({ perMinute, perDay, now = Date.now }) {
  const buckets = new Map();
  return {
    /** @returns {{ok: true} | {ok: false, retryAfter: number}} */
    take(key) {
      const t = now();
      const minute = Math.floor(t / 60_000);
      const day = Math.floor(t / 86_400_000);
      let b = buckets.get(key);
      if (!b || b.day !== day) b = { minute, m: 0, day, d: 0 };
      if (b.minute !== minute) { b.minute = minute; b.m = 0; }
      if (perDay && b.d >= perDay) { buckets.set(key, b); return { ok: false, retryAfter: Math.ceil(((day + 1) * 86_400_000 - t) / 1000) }; }
      if (perMinute && b.m >= perMinute) { buckets.set(key, b); return { ok: false, retryAfter: Math.ceil(((minute + 1) * 60_000 - t) / 1000) }; }
      b.m++; b.d++;
      buckets.set(key, b);
      if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.day !== day) buckets.delete(k);
      return { ok: true };
    },
  };
}

/**
 * @param {{token?: string, allowNoAuth?: boolean, corsOrigins?: string[], upstream: {baseUrl: string, apiKey: string}}} bridgeConfig
 * @param {{env?: Record<string,string|undefined>, logger?: any, fetch?: typeof fetch, now?: () => number}} [o]
 */
export function createQuick(bridgeConfig, o = {}) {
  const cfg = loadQuickConfig(o.env ?? process.env);
  const log = o.logger ?? silentLogger;
  const doFetch = o.fetch ?? ((...a) => fetch(...a));
  const now = o.now ?? Date.now;
  const corsOrigins = bridgeConfig.corsOrigins ?? [];
  const authorized = makeAuthorizer(bridgeConfig);
  const credentials = makeCredentials(bridgeConfig);
  const limiter = createRateLimiter({ perMinute: cfg.perMinute, perDay: cfg.perDay, now });
  let probe = { at: 0, config: null }; // plugin /quick/config (null = off)
  let catalog = { at: 0, rows: null };

  const routeOf = (req) => {
    const p = (req.url ?? '').split('?')[0];
    if (req.method === 'POST' && QUICK_PATHS.includes(p)) return 'quick';
    if (req.method === 'GET' && p === QUICK_CONFIG_PATH) return 'config';
    return null;
  };
  const matches = (req) => routeOf(req) !== null;

  /** Read the secret on every probe so a rotated file needs no bridge restart. Never logged. */
  function secret() {
    if (!cfg.secretFile) return '';
    try { return readFileSync(cfg.secretFile, 'utf8').trim(); } catch { return ''; }
  }

  async function probePlugin(force = false) {
    if (cfg.off) return null;
    if (!force && probe.at && now() - probe.at < cfg.probeTtlMs) return probe.config;
    const s = secret();
    let config = null;
    if (s) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), cfg.probeTimeoutMs);
      try {
        const r = await doFetch(`${cfg.pluginUrl}/quick/config`, { headers: { authorization: `Bearer ${s}` }, signal: ctl.signal });
        if (r.ok) {
          const j = await r.json();
          if (j && typeof j === 'object' && j.enabled === true) config = j;
        } else {
          await r.body?.cancel?.();
          log.warn('quick plugin probe failed', { status: r.status });
        }
      } catch (e) {
        log.debug?.('quick plugin unreachable', { err: e.name });
      } finally { clearTimeout(timer); }
    }
    probe = { at: now(), config };
    return config;
  }

  /** Hermes' model picker inventory (public API), cached. Returns null when unavailable. */
  async function modelCatalog() {
    if (catalog.rows && now() - catalog.at < cfg.catalogTtlMs) return catalog.rows;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await doFetch(upstreamUrl(bridgeConfig.upstream.baseUrl, '/api/model/options?include_unconfigured=false').href, {
        headers: { ...(bridgeConfig.upstream.apiKey ? { authorization: `Bearer ${bridgeConfig.upstream.apiKey}` } : {}), accept: 'application/json' },
        signal: ctl.signal,
      });
      if (!r.ok) { await r.body?.cancel?.(); return catalog.rows; }
      const j = await r.json();
      const rows = new Map();
      for (const p of Array.isArray(j?.providers) ? j.providers : []) {
        const slug = String(p?.slug ?? '').toLowerCase();
        if (slug) rows.set(slug, new Set((Array.isArray(p.models) ? p.models : []).map((m) => (typeof m === 'string' ? m : String(m?.id ?? m?.name ?? '')))));
      }
      catalog = { at: now(), rows };
      return rows;
    } catch { return catalog.rows; } finally { clearTimeout(timer); }
  }

  function headers(req, extra = {}) {
    const h = { 'x-hermes-ui-bridge': '1', 'cache-control': 'no-store', ...extra };
    const origin = req.headers.origin;
    if (origin && corsOrigins.length && (corsOrigins.includes('*') || corsOrigins.includes(origin))) {
      h['access-control-allow-origin'] = corsOrigins.includes('*') ? '*' : origin;
      h.vary = 'Origin';
    }
    return h;
  }
  function send(req, res, status, body, extra = {}) {
    if (res.headersSent) return res.destroy();
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, headers(req, { 'content-type': 'application/json', 'content-length': buf.length, ...extra }));
    res.end(buf);
  }
  const fail = (req, res, status, message, code, extra) =>
    send(req, res, status, { error: { message, type: status === 429 ? 'rate_limit_error' : status < 500 ? 'invalid_request_error' : 'bridge_error', code } }, extra);

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > BODY_MAX_BYTES) { reject(Object.assign(new Error('body too large'), { code: 'TOO_LARGE' })); req.resume(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  /** Validate an optional provider/model override against Hermes' catalog. Returns an error tuple or null. */
  async function checkOverride(body) {
    const model = typeof body.model === 'string' ? body.model.trim() : body.model;
    const provider = typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : body.provider;
    if (model !== undefined && model !== null && typeof model !== 'string') return [400, 'model must be a string', 'invalid_model'];
    if (provider !== undefined && provider !== null && typeof provider !== 'string') return [400, 'provider must be a string', 'invalid_provider'];
    const wantModel = model && !DEFAULT_ALIASES.has(model.toLowerCase()) ? model : '';
    const wantProvider = provider && provider !== 'auto' ? provider : '';
    if (!wantModel && !wantProvider) { delete body.model; delete body.provider; return null; }
    const rows = await modelCatalog();
    if (!rows) return [503, 'Hermes model catalog unavailable', 'catalog_unavailable'];
    let slug = wantProvider;
    if (!slug) { for (const [s, models] of rows) if (models.has(wantModel)) { slug = s; break; } }
    if (!slug || !rows.has(slug)) return [400, 'provider is not configured in Hermes', 'unknown_provider'];
    if (wantModel && !rows.get(slug).has(wantModel)) return [400, 'model is not in Hermes\' catalog for this provider', 'unknown_model'];
    body.provider = slug;
    if (wantModel) body.model = wantModel; else delete body.model;
    return null;
  }

  async function handle(req, res) {
    const route = routeOf(req);
    if (!authorized(req)) { req.resume(); return fail(req, res, 401, 'Invalid bridge token', 'invalid_api_key', { 'www-authenticate': 'Bearer' }); }
    if (route === 'config') {
      const c = await probePlugin();
      if (!c) return send(req, res, 200, { available: false });
      return send(req, res, 200, {
        available: true, source: 'hermes-plugin', model: c.last_route?.model || null, provider: c.last_route?.provider || null,
        auxTask: c.aux_task ?? null, limits: { ...(c.limits ?? {}), perDeviceMinute: cfg.perMinute, perDeviceDay: cfg.perDay },
        allowModelOverride: c.allow_model_override === true, streaming: c.streaming === true,
      });
    }
    const plugin = await probePlugin();
    if (!plugin) { req.resume(); return fail(req, res, 404, 'quick answers are off (Hermes plugin not available)', 'feature_off'); }
    let raw;
    try { raw = await readBody(req); } catch (e) {
      return fail(req, res, e.code === 'TOO_LARGE' ? 413 : 400, e.code === 'TOO_LARGE' ? 'body too large' : 'invalid body', null, { connection: 'close' });
    }
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return fail(req, res, 400, 'invalid JSON', 'invalid_json'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(req, res, 400, 'body must be a JSON object', 'invalid_body');
    const who = credentials.of(req) ?? 'unknown';
    const rl = limiter.take(who);
    if (!rl.ok) return fail(req, res, 429, 'too many quick answers, try again later', 'rate_limited', { 'retry-after': String(rl.retryAfter) });
    const bad = await checkOverride(body);
    if (bad) return fail(req, res, bad[0], bad[1], bad[2]);
    const s = secret();
    if (!s) { probe = { at: 0, config: null }; return fail(req, res, 404, 'quick answers are off (Hermes plugin not available)', 'feature_off'); }

    const t0 = now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
    const onClose = () => { if (!res.writableFinished) ctl.abort(); };
    res.on('close', onClose);
    let status = 0;
    try {
      const up = await doFetch(`${cfg.pluginUrl}/quick/v1/chat/completions`, {
        method: 'POST', signal: ctl.signal,
        headers: { authorization: `Bearer ${s}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      status = up.status;
      const ct = up.headers.get('content-type') || 'application/json';
      const extra = { 'content-type': ct };
      const ra = up.headers.get('retry-after');
      if (ra) extra['retry-after'] = ra;
      if (ct.startsWith('text/event-stream')) extra['x-accel-buffering'] = 'no';
      res.writeHead(up.status, headers(req, extra));
      if (up.body) {
        for await (const chunk of up.body) {
          if (!res.write(chunk)) await new Promise((r) => res.once('drain', r));
        }
      }
      res.end();
    } catch (e) {
      if (ctl.signal.aborted && res.destroyed) { status = 499; return; }
      if (!res.headersSent) {
        probe = { at: 0, config: null }; // re-probe next time
        if (ctl.signal.aborted) { status = 504; return fail(req, res, 504, 'quick answer timed out', 'timeout'); }
        status = 404;
        return fail(req, res, 404, 'quick answers are off (Hermes plugin not available)', 'feature_off');
      }
      status = 502;
      res.destroy();
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
      log.info('quick', { status, ms: now() - t0, cred: who.slice(0, 12), stream: body.stream === true, override: Boolean(body.provider) }); // never content
    }
  }

  return { matches, handle, probe: probePlugin, config: cfg };
}
