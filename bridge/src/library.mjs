// Skills & memory library: GET /bridge/library/{config,skills,skills/content,memory} (docs/SKILLS-MEMORY.md).
// Read-only transport over the optional Hermes plugin "hermes-ui-plus" (same URL and secret as quick answers:
// BRIDGE_HERMES_PLUGIN_URL / BRIDGE_HERMES_PLUGIN_SECRET_FILE). The bridge adds device auth, bot (profile) checks and
// projects every plugin answer onto known fields with capped sizes: no free text from the plugin reaches the app.
// Feature off (404 feature_off + reason) whenever the plugin is not configured, not reachable or does not offer it.
// BRIDGE_LIBRARY=off switches it off; BRIDGE_QUICK=off does not. Never writes anything; secret never logged.
// Other bots: a plugin in the root (default) profile that says `profiles: true` in /library/config reads other profiles
// too; the bridge then asks it with `?profile=<bot>` (config probed and cached per bot). An older plugin (no flag) or
// one in another profile: `other_bot` as before. The plugin's 404 unknown_bot becomes 404 unknown_profile.
import { readFileSync } from 'node:fs';
import { silentLogger } from './log.mjs';
import { makeAuthorizer } from './auth.mjs';
import { DEFAULT_PROFILE, isProfileName } from './profiles.mjs';
import { loadQuickConfig, quickReason } from './quick.mjs';
import { corsHeaders } from './cors.mjs';

export const LIBRARY_PREFIX = '/bridge/library/';
const ROUTES = { '/bridge/library/config': 'config', '/bridge/library/skills': 'skills', '/bridge/library/skills/content': 'content', '/bridge/library/memory': 'memory' };
const SOURCES = new Set(['bundled', 'hub', 'external', 'local', 'plugin']);
const LIMITS = { rows: 2000, name: 200, description: 1000, category: 100, content: 256 * 1024, provider: 64, entries: 200, entry: 4000 };
const BODY_MAX = 1024 * 1024;
const CONTENT_BODY_MAX = 512 * 1024;
const CONTROL = /[\u0000-\u001f\u007f]/;
const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? d : Number(v));
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
const int = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

export function loadLibraryConfig(env = process.env) {
  const q = loadQuickConfig(env);
  return {
    off: /^(0|off|false|no)$/i.test(env.BRIDGE_LIBRARY ?? ''),
    pluginUrl: q.pluginUrl,
    secretFile: q.secretFile,
    probeTtlMs: num(env.BRIDGE_LIBRARY_PROBE_TTL_MS, 30_000),
    probeTimeoutMs: num(env.BRIDGE_LIBRARY_PROBE_TIMEOUT_MS, 1500),
    timeoutMs: num(env.BRIDGE_LIBRARY_TIMEOUT_MS, 10_000),
  };
}

/** Known fields only, capped. Exported for tests. */
export function projectSkills(j) {
  const rows = [];
  for (const r of Array.isArray(j?.data) ? j.data : []) {
    if (rows.length >= LIMITS.rows) break;
    if (!r || typeof r !== 'object' || typeof r.name !== 'string' || !r.name) continue;
    rows.push({
      name: r.name.slice(0, LIMITS.name),
      description: str(r.description, LIMITS.description) ?? '',
      category: str(r.category, LIMITS.category) || null,
      // unknown stays unknown (omitted): the app must not show a skill as off on a guess
      ...(typeof r.enabled === 'boolean' ? { enabled: r.enabled } : {}),
      source: SOURCES.has(r.source) ? r.source : 'local',
    });
  }
  return { object: 'list', data: rows };
}
export function projectContent(j, name) {
  const raw = typeof j?.content === 'string' ? j.content : '';
  const cut = raw.length > LIMITS.content;
  return { name: str(j?.name, LIMITS.name) || name, content: cut ? raw.slice(0, LIMITS.content) : raw, truncated: j?.truncated === true || cut };
}
export function projectMemory(j) {
  const stores = [];
  for (const s of Array.isArray(j?.stores) ? j.stores : []) {
    if (!s || (s.target !== 'memory' && s.target !== 'user') || stores.some((x) => x.target === s.target)) continue;
    const t = typeof s.updated_at === 'string' ? new Date(s.updated_at) : null;
    stores.push({
      target: s.target,
      enabled: s.enabled === true,
      entries: (Array.isArray(s.entries) ? s.entries : []).filter((e) => typeof e === 'string').slice(0, LIMITS.entries).map((e) => e.slice(0, LIMITS.entry)),
      chars: int(s.chars),
      limit: int(s.limit),
      updated_at: t && Number.isFinite(t.getTime()) ? t.toISOString() : null,
    });
  }
  return { provider: str(j?.provider, LIMITS.provider) || null, stores };
}

/**
 * @param {{token?: string, allowNoAuth?: boolean, corsOrigins?: string[]}} bridgeConfig
 * @param {{env?: Record<string,string|undefined>, logger?: any, fetch?: typeof fetch, now?: () => number,
 *   profiles?: {allowed: (name: string) => boolean}}} [o]
 */
export function createLibrary(bridgeConfig, o = {}) {
  const cfg = loadLibraryConfig(o.env ?? process.env);
  const log = o.logger ?? silentLogger;
  const doFetch = o.fetch ?? ((...a) => fetch(...a));
  const now = o.now ?? Date.now;
  const corsOrigins = bridgeConfig.corsOrigins ?? [];
  const authorized = makeAuthorizer(bridgeConfig);
  /** plugin /library/config: {config} or {reason}; cached */
  let probe = { at: 0, config: null, reason: 'plugin_unreachable' };
  /** /library/config?profile=<bot> per other bot: {at, config, reason, unknown?}; cached like the main probe */
  const botProbes = new Map();
  const BOT_PROBES_MAX = 64;

  const pathOf = (req) => (req.url ?? '').split('?')[0];
  // OPTIONS stays with the bridge's own CORS preflight handling
  const matches = (req) => req.method !== 'OPTIONS' && pathOf(req) in ROUTES;

  function secret() {
    if (!cfg.secretFile) return '';
    try { return readFileSync(cfg.secretFile, 'utf8').trim(); } catch { return ''; }
  }

  function headers(req, extra = {}) {
    const h = { 'x-hermes-ui-bridge': '1', 'cache-control': 'no-store', ...extra };
    Object.assign(h, corsHeaders(corsOrigins, req));
    return h;
  }
  function send(req, res, status, body, extra = {}) {
    if (res.headersSent) return res.destroy();
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, headers(req, { 'content-type': 'application/json', 'content-length': buf.length, ...extra }));
    res.end(buf);
  }
  const fail = (req, res, status, message, code, extra, more = {}) =>
    send(req, res, status, { error: { message, type: status < 500 ? 'invalid_request_error' : 'bridge_error', code, ...more } }, extra);
  const featureOff = (req, res, reason) =>
    fail(req, res, 404, 'skills and memory library is not available', 'feature_off', undefined, { reason: quickReason(reason, 'plugin_unreachable') });

  /** GET a plugin path. Resolves {status, json}; throws Error with .kind 'timeout' | 'unreachable' | 'bad'. */
  async function pluginGet(path, { timeoutMs, maxBytes }) {
    const s = secret();
    if (!s) throw Object.assign(new Error('no secret'), { kind: 'not_configured' });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await doFetch(`${cfg.pluginUrl}${path}`, { headers: { authorization: `Bearer ${s}`, accept: 'application/json' }, signal: ctl.signal });
      const ct = r.headers.get('content-type') || '';
      if (!/json/i.test(ct)) { await r.body?.cancel?.(); throw Object.assign(new Error('not json'), { kind: 'bad', status: r.status }); }
      const declared = Number(r.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) { await r.body?.cancel?.(); throw Object.assign(new Error('too large'), { kind: 'bad', status: r.status }); }
      const chunks = [];
      let size = 0;
      for await (const c of r.body ?? []) {
        size += c.length;
        if (size > maxBytes) { ctl.abort(); throw Object.assign(new Error('too large'), { kind: 'bad', status: r.status }); }
        chunks.push(c);
      }
      let json;
      try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('bad json'), { kind: 'bad', status: r.status }); }
      return { status: r.status, json };
    } catch (e) {
      if (e.kind) throw e;
      throw Object.assign(new Error('plugin call failed'), { kind: ctl.signal.aborted ? 'timeout' : 'unreachable' });
    } finally { clearTimeout(timer); }
  }

  async function probePlugin() {
    if (cfg.off) return { config: null, reason: 'bridge_off' };
    if (probe.at && now() - probe.at < cfg.probeTtlMs) return probe;
    let next;
    try {
      const { status, json } = await pluginGet('/library/config', { timeoutMs: cfg.probeTimeoutMs, maxBytes: 64 * 1024 });
      if (status === 200 && json && typeof json === 'object' && !Array.isArray(json)) next = { config: json, reason: null };
      else next = { config: null, reason: status === 404 ? quickReason(json?.error?.reason, 'plugin_unsupported') : 'plugin_unreachable' };
    } catch (e) {
      if (e.kind !== 'not_configured') log.debug?.('library plugin probe failed', { kind: e.kind });
      next = { config: null, reason: e.kind === 'not_configured' ? 'plugin_not_configured' : 'plugin_unreachable' };
    }
    probe = { at: now(), ...next };
    return probe;
  }

  /** The plugin's config for another bot (`?profile=<bot>`), cached per bot. {config, reason, unknown?} */
  async function probeBot(bot) {
    const hit = botProbes.get(bot);
    if (hit && now() - hit.at < cfg.probeTtlMs) return hit;
    let next;
    try {
      const { status, json } = await pluginGet(`/library/config?profile=${encodeURIComponent(bot)}`, { timeoutMs: cfg.probeTimeoutMs, maxBytes: 64 * 1024 });
      if (status === 200 && json && typeof json === 'object' && !Array.isArray(json)) next = { config: json, reason: null };
      else if (status === 404 && json?.error?.code === 'unknown_bot') next = { config: null, reason: 'unknown_bot', unknown: true };
      else next = { config: null, reason: status === 404 ? quickReason(json?.error?.reason, 'plugin_unsupported') : 'plugin_unreachable' };
    } catch (e) {
      if (e.kind !== 'not_configured') log.debug?.('library plugin probe failed', { kind: e.kind, bot });
      next = { config: null, reason: e.kind === 'not_configured' ? 'plugin_not_configured' : 'plugin_unreachable' };
    }
    botProbes.delete(bot);
    botProbes.set(bot, { at: now(), ...next });
    while (botProbes.size > BOT_PROBES_MAX) botProbes.delete(botProbes.keys().next().value);
    return botProbes.get(bot);
  }
  const forget = (bot) => {
    probe = { ...probe, at: 0 };
    if (bot) botProbes.delete(bot);
  };

  const pluginBotOf = (config) => (typeof config?.profile === 'string' && config.profile ? config.profile : DEFAULT_PROFILE);

  /**
   * Where a bot's library comes from: the plugin's own profile (`via: 'own'`), another profile read through the root
   * plugin (`via: 'profile'`, config of that bot) or nowhere (`other_bot`, plugin down).
   * @returns {Promise<{via: 'own'|'profile', config: any} | {via: null, reason: string, unknown?: boolean}>}
   */
  async function sourceOf(bot) {
    const p = await probePlugin();
    if (!p.config) return { via: null, reason: p.reason ?? 'plugin_unreachable' };
    const own = pluginBotOf(p.config);
    if (own === bot) return { via: 'own', config: p.config };
    // only the root profile's plugin reads others, and only when it says so (older plugins: no flag)
    if (p.config.profiles !== true || own !== DEFAULT_PROFILE) return { via: null, reason: 'other_bot' };
    const b = await probeBot(bot);
    if (b.unknown) return { via: null, reason: 'unknown_bot', unknown: true };
    if (!b.config) return { via: null, reason: b.reason ?? 'plugin_unreachable' };
    return { via: 'profile', config: b.config };
  }

  /** availability of one feature in a source: {ok:true} or {ok:false, reason} */
  function feature(src, name) {
    if (!src.via) return { ok: false, reason: src.reason };
    const f = src.config[name];
    if (f && typeof f === 'object' && f.available === true) return { ok: true };
    return { ok: false, reason: quickReason(f?.reason, 'unavailable') };
  }

  async function handle(req, res) {
    if (!authorized(req)) { req.resume(); return fail(req, res, 401, 'Invalid bridge token', 'invalid_api_key', { 'www-authenticate': 'Bearer' }); }
    if (req.method !== 'GET') { req.resume(); return fail(req, res, 405, 'method not allowed', 'method_not_allowed', { allow: 'GET' }); }
    const route = ROUTES[pathOf(req)];
    let q;
    try { q = new URL(req.url, 'http://x').searchParams; } catch { return fail(req, res, 400, 'invalid query', 'invalid_request'); }
    const bot = q.get('bot') || DEFAULT_PROFILE;
    const known = isProfileName(bot) && (bot === DEFAULT_PROFILE || (o.profiles?.allowed?.(bot) ?? false));
    if (!known) return fail(req, res, 404, 'Not found', 'unknown_profile');

    const src = await sourceOf(bot);
    if (src.via === null && src.unknown) return fail(req, res, 404, 'Not found', 'unknown_profile');
    if (route === 'config') {
      const one = (name) => { const f = feature(src, name); return f.ok ? { available: true } : { available: false, reason: f.reason }; };
      return send(req, res, 200, { skills: one('skills'), memory: one('memory'), bot });
    }
    const which = route === 'memory' ? 'memory' : 'skills';
    const f = feature(src, which);
    if (!f.ok) return featureOff(req, res, f.reason);

    let name = '';
    if (route === 'content') {
      name = q.get('name') ?? '';
      if (!name || name.length > LIMITS.name || CONTROL.test(name)) return fail(req, res, 400, 'invalid skill name', 'invalid_name');
    }
    const base = route === 'skills' ? '/library/skills' : route === 'memory' ? '/library/memory' : `/library/skills/content?name=${encodeURIComponent(name)}`;
    const other = src.via === 'profile' ? `profile=${encodeURIComponent(bot)}` : '';
    const path = other ? `${base}${base.includes('?') ? '&' : '?'}${other}` : base;
    const forgetBot = other ? bot : undefined;
    try {
      const { status, json } = await pluginGet(path, { timeoutMs: cfg.timeoutMs, maxBytes: route === 'content' ? CONTENT_BODY_MAX : BODY_MAX });
      if (status === 404) {
        if (json?.error?.code === 'feature_off') { forget(forgetBot); return featureOff(req, res, json.error.reason); }
        if (json?.error?.code === 'unknown_bot') { forget(forgetBot); return fail(req, res, 404, 'Not found', 'unknown_profile'); }
        if (route === 'content') return fail(req, res, 404, 'skill not found', 'skill_not_found');
      }
      if (status !== 200 || !json || typeof json !== 'object' || Array.isArray(json)) {
        return fail(req, res, 502, 'library upstream error', 'upstream_error');
      }
      return send(req, res, 200, route === 'skills' ? projectSkills(json) : route === 'memory' ? projectMemory(json) : projectContent(json, name));
    } catch (e) {
      forget(forgetBot);
      if (e.kind === 'not_configured') return featureOff(req, res, 'plugin_not_configured');
      if (e.kind === 'timeout') return fail(req, res, 504, 'library upstream timed out', 'timeout');
      return fail(req, res, 502, 'library upstream error', 'upstream_error');
    }
  }

  return { matches, handle, config: cfg };
}
