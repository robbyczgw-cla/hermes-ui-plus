// Bots made in the app (Bots v2 slice 3, docs/BOTS-SERVER.md "Creating bots from the app"): the bridge is the gate in
// front of the hermes-ui-plus plugin, which creates the Hermes profile inside the gateway process (POST /bots there).
//
// Who may create and edit bots (`bots.manage`), same pattern as the routines rights (src/routines-rights.mjs):
//   1. BRIDGE_BOTS_CREATE=off is a hard off; `on` switches it on; unset = the owner's switch in <state-dir>/devices.json
//      (`hermes-ui-plus-bridge bots enable|disable`, PUT /bridge/bots/rights). Default: off.
//   2. Credential: BRIDGE_TOKEN (admin) and open mode may; a paired device only with an explicit grant
//      (`bots grant <device-id>`). A device never gets it by default.
//   3. The plugin must be configured, reachable, run in the default profile of a multiplexing gateway and stay under
//      its limit (50 bots).
// The bridge adds its own HERMES_API_KEY as the new profile's API_SERVER_KEY (a fresh profile has none and answers
// 401 on /p/<name>/), so the key never travels through the app.
//
// Routes (device auth like every /bridge route; the plugin's answers are projected onto known fields):
//   GET   /bridge/bots               -> {create: {allowed, reason?}, manage: {allowed, reason?}, admin, limit, count,
//                                        archived: [{name, label?, color?}]}  (archived: only with manage or admin)
//   POST  /bridge/bots               {title, job, how, template?, lang?, may?, color?} -> 201 {bot}
//   GET   /bridge/bots/<name>        -> {bot: {name, title, job, how, template, lang, may, app}} (edit form)
//   PATCH /bridge/bots/<name>        {title, job, how, lang?} -> {bot}
//   GET   /bridge/bots/<name>/allowlist         any credential, <name> may be `default`
//                                    -> {entries: [{pattern}], omitted?: n, manage: {allowed, reason?}}
//                                       (omitted: entries left out by the 200 x 200 caps; plugin 0.3: root profile only)
//   POST  /bridge/bots/<name>/allowlist/revoke  bots.manage {pattern} -> like GET (404 not_found: not in the list)
//   POST  /bridge/bots/<name>/archive | restore bots.manage, never default (403 default_bot)
//                                    -> {bot: {name, label?, description?, color?, template?, parked, archived}}
//                                       (409 parked_elsewhere: restore of a marker the plugin did not write)
//   GET   /bridge/bots/rights        admin only -> {setting, enabled, devices: [{id, label, status, manage}]}
//   PUT   /bridge/bots/rights        admin only {enabled?: bool|null, devices?: {"<id>": bool}} -> like GET
// `manage` = the same gate as create, except that the 50-bot limit does not close it (editing, archiving, revoking).
// GET /bridge/bots/activity is src/bots-activity.mjs (wired before this module in server.mjs).
// It also keeps the plugin's bot list (GET /bots, every 30 s on demand) in profiles.mjs, so a sandboxed bridge that
// cannot read the Hermes home still lists every bot and serves /p/<new bot>/ right after it was made.
import { readFileSync } from 'node:fs';
import { silentLogger } from './log.mjs';
import { BOT_TEMPLATES, DEFAULT_PROFILE, isProfileName } from './profiles.mjs';
import { loadQuickConfig } from './quick.mjs';
import { corsHeaders } from './cors.mjs';

export const BOTS_PATH = '/bridge/bots';
export const BOTS_RIGHTS_PATH = '/bridge/bots/rights';
const BODY_MAX = 16 * 1024;
const LIST_TTL_MS = 30_000;
const LIMIT_DEFAULT = 50;
const MAY_KEYS = ['web', 'memory', 'routines', 'commands'];
const CREATE_KEYS = ['title', 'job', 'how', 'template', 'lang', 'may', 'color'];
const PATCH_KEYS = ['title', 'job', 'how', 'lang'];
const LIMITS = { title: 40, job: 160, how: 2000 };
/** reasons the plugin may give for "cannot create here" (anything else: plugin_unsupported) */
const PLUGIN_REASONS = new Set(['disabled_by_config', 'not_root_profile', 'multiplex_off', 'hermes_unsupported', 'limit']);
const FIELDS = new Set(['title', 'job', 'how', 'template', 'lang', 'may', 'color', 'pattern']);
/** `/bridge/bots/<name>/<sub>`: '' = the bot itself (edit form) */
const SUBS = { '': ['GET', 'PATCH'], allowlist: ['GET'], 'allowlist/revoke': ['POST'], archive: ['POST'], restore: ['POST'] };
const PATTERN_MAX = 200;
const ALLOWLIST_MAX = 200;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** BRIDGE_BOTS_CREATE → 'on' | 'off' | '' (the owner's switch in devices.json decides). Throws on anything else. */
export function parseBotsCreate(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return '';
  if (/^(on|1|true|yes)$/.test(v)) return 'on';
  if (/^(off|0|false|no)$/.test(v)) return 'off';
  throw new Error('BRIDGE_BOTS_CREATE must be on or off (unset: `hermes-ui-plus-bridge bots enable` decides)');
}

const line = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** One bot of the plugin's list / answers: display fields only. Exported for tests. */
export function projectBot(r) {
  if (!plain(r) || !isProfileName(r.name) || r.name === DEFAULT_PROFILE) return null;
  const title = line(r.title, LIMITS.title);
  const description = line(r.description, LIMITS.job);
  const color = typeof r.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color.toLowerCase() : '';
  return {
    name: r.name,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(color ? { color } : {}),
    ...(r.pinned === true ? { pinned: true } : {}),
    ...(r.hidden === true ? { hidden: true } : {}),
    ...(r.parked === true ? { parked: true } : {}),
    ...(r.archived === true ? { archived: true } : {}),
    ...(r.app === true ? { app: true } : {}),
    ...(BOT_TEMPLATES.includes(r.template) ? { template: r.template } : {}),
  };
}

/**
 * "Always allowed" rules of a plugin answer → {entries: [{pattern, description?}], omitted}: strings only, at most 200,
 * each at most 200 chars; `omitted` = the plugin's count of entries it left out (caps) + what is dropped here.
 * The plugin sends {pattern} only (the pattern text is what the app shows); a description is kept if one ever comes.
 * Exported for tests.
 */
export function projectAllowlist(j) {
  const entries = [];
  let omitted = Number.isInteger(j?.omitted) && j.omitted > 0 ? Math.min(j.omitted, 1_000_000) : 0;
  for (const e of Array.isArray(j?.entries) ? j.entries : []) {
    const pattern = typeof e === 'string' ? e : plain(e) && typeof e.pattern === 'string' ? e.pattern : '';
    // a cut pattern could not be revoked any more: an oversized or odd one is left out (counted), never shortened
    if (!pattern || pattern.length > PATTERN_MAX || CONTROL.test(pattern) || entries.length >= ALLOWLIST_MAX) { omitted++; continue; }
    const description = plain(e) ? line(e.description, PATTERN_MAX) : '';
    entries.push({ pattern, ...(description ? { description } : {}) });
  }
  return { entries, omitted };
}

/** A bot as the app gets it after create / edit (and archive / restore with the flags). */
const botView = (bot, flags = false) => ({
  name: bot.name,
  ...(bot.title ? { label: bot.title } : {}),
  ...(bot.description ? { description: bot.description } : {}),
  ...(bot.color ? { color: bot.color } : {}),
  ...(bot.template ? { template: bot.template } : {}),
  ...(flags ? { parked: bot.parked === true, archived: bot.archived === true } : {}),
});

/** The edit form's fields of GET /bots/<name>. Exported for tests. */
export function projectFields(r) {
  if (!plain(r) || !isProfileName(r.name)) return null;
  const may = plain(r.may) ? Object.fromEntries(MAY_KEYS.map((k) => [k, r.may[k] === true])) : null;
  return {
    name: r.name,
    title: line(r.title, LIMITS.title) || r.name,
    job: line(r.job, LIMITS.job),
    how: typeof r.how === 'string' ? r.how.slice(0, LIMITS.how) : '',
    template: BOT_TEMPLATES.includes(r.template) ? r.template : null,
    lang: ['de', 'en', 'es'].includes(r.lang) ? r.lang : null,
    may,
    app: r.app === true,
  };
}

/**
 * Only the known fields with the right types, sizes checked again by the plugin. Exported for tests.
 * @returns {{ok: true, value: Record<string, unknown>} | {ok: false, field: string, message: string}}
 */
export function checkBody(body, keys) {
  if (!plain(body)) return { ok: false, field: 'body', message: 'Body must be a JSON object' };
  const unknown = Object.keys(body).find((k) => !keys.includes(k));
  if (unknown) return { ok: false, field: unknown.slice(0, 40), message: `Unsupported field ${unknown.slice(0, 40)}` };
  for (const k of ['title', 'job', 'how']) {
    if (keys.includes(k) && typeof body[k] !== 'string') return { ok: false, field: k, message: `${k} is required` };
    if (typeof body[k] === 'string' && body[k].length > LIMITS[k] * 2) return { ok: false, field: k, message: `${k} is too long` };
  }
  if (body.template !== undefined && !BOT_TEMPLATES.includes(body.template)) return { ok: false, field: 'template', message: 'Unknown template' };
  if (body.lang !== undefined && (typeof body.lang !== 'string' || body.lang.length > 12)) return { ok: false, field: 'lang', message: 'lang must be a language code' };
  if (body.color !== undefined && (typeof body.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body.color))) return { ok: false, field: 'color', message: 'color must be #rrggbb' };
  if (body.may !== undefined) {
    if (!plain(body.may) || Object.entries(body.may).some(([k, v]) => !MAY_KEYS.includes(k) || typeof v !== 'boolean')) {
      return { ok: false, field: 'may', message: `may must be {${MAY_KEYS.join(', ')}: true|false}` };
    }
  }
  return { ok: true, value: Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, body[k]])) };
}

/**
 * @param {{auth: ReturnType<typeof import('./auth.mjs').createAuth>, corsOrigins?: string[], upstream?: {apiKey?: string}}} config
 * @param {{env?: Record<string, string|undefined>, devices?: ReturnType<typeof import('./devices.mjs').createDeviceStore>|null,
 *   profiles: ReturnType<typeof import('./profiles.mjs').createProfiles>, fetch?: typeof fetch, logger?: any, now?: () => number}} o
 */
export function createBotsManage(config, o) {
  const env = o.env ?? process.env;
  const q = loadQuickConfig(env);
  const setting = parseBotsCreate(env.BRIDGE_BOTS_CREATE);
  const devices = o.devices ?? null;
  const profiles = o.profiles;
  const log = o.logger ?? silentLogger;
  const doFetch = o.fetch ?? ((...a) => fetch(...a));
  const now = o.now ?? Date.now;
  const corsOrigins = config.corsOrigins ?? [];
  const timeoutMs = Number(env.BRIDGE_BOTS_TIMEOUT_MS) > 0 ? Number(env.BRIDGE_BOTS_TIMEOUT_MS) : 60_000;
  const listTimeoutMs = 3000;

  /** last plugin GET /bots: {at, ok, create, limit, count, reason, archived} */
  let state = { at: -Infinity, ok: false, create: /** @type {{available: boolean, reason?: string}|null} */ (null), limit: LIMIT_DEFAULT, count: 0, reason: 'plugin_unreachable', archived: /** @type {{name: string, label?: string, color?: string}[]} */ ([]) };
  /** @type {Promise<void>|null} */ let inflight = null;

  const pathOf = (req) => (req.url ?? '').split('?')[0];
  const matches = (req) => {
    if (req.method === 'OPTIONS') return false;
    const p = pathOf(req);
    return p === BOTS_PATH || p.startsWith(`${BOTS_PATH}/`);
  };

  function secret() {
    if (!q.secretFile) return '';
    try { return readFileSync(q.secretFile, 'utf8').trim(); } catch { return ''; }
  }

  /** Owner's switch: env first, then devices.json (default off). */
  function enabledByOwner() {
    if (setting === 'off') return false;
    if (setting === 'on') return true;
    return devices?.botsPolicy().create === true;
  }

  /** @param {null|undefined|{kind: string, id?: string}} who */
  function credentialAllows(who) {
    if (!who || who.kind === 'admin' || who.kind === 'open') return true;
    if (who.kind === 'device' && who.id) return devices?.deviceBotsManage(who.id) === true;
    return false;
  }
  const isAdmin = (who) => !who || who.kind === 'admin' || who.kind === 'open';

  /** One plugin call. Resolves {status, json}; throws Error with .kind not_configured | timeout | unreachable | bad. */
  async function plugin(method, path, body, ms) {
    const s = secret();
    if (!s) throw Object.assign(new Error('no secret'), { kind: 'not_configured' });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await doFetch(`${q.pluginUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${s}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: ctl.signal,
      });
      const text = await r.text();
      if (text.length > 512 * 1024) throw Object.assign(new Error('too large'), { kind: 'bad' });
      let json = null;
      try { json = JSON.parse(text); } catch { throw Object.assign(new Error('not json'), { kind: 'bad', status: r.status }); }
      return { status: r.status, json };
    } catch (e) {
      if (e.kind) throw e;
      throw Object.assign(new Error('plugin call failed'), { kind: ctl.signal.aborted ? 'timeout' : 'unreachable' });
    } finally { clearTimeout(timer); }
  }

  /** Refresh the plugin's bot list into profiles.mjs (single flight). Never throws. */
  function refresh(force = false) {
    if (!force && now() - state.at < LIST_TTL_MS) return Promise.resolve();
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const { status, json } = await plugin('GET', '/bots', null, listTimeoutMs);
        if (status === 200 && plain(json) && Array.isArray(json.data)) {
          const rows = json.data.map(projectBot).filter(Boolean);
          profiles.setExternal?.(rows);
          const create = plain(json.create) ? { available: json.create.available === true, ...(json.create.reason ? { reason: String(json.create.reason) } : {}) } : null;
          const limit = Number.isInteger(json.limit) && json.limit > 0 ? json.limit : LIMIT_DEFAULT;
          const archived = rows.filter((b) => b.archived).map((b) => ({ name: b.name, ...(b.title ? { label: b.title } : {}), ...(b.color ? { color: b.color } : {}) }));
          state = { at: now(), ok: true, create, limit, count: rows.length, reason: '', archived };
        } else {
          const r = json?.error?.reason;
          state = { ...state, at: now(), ok: false, archived: [], reason: status === 404 ? (PLUGIN_REASONS.has(r) ? r : 'plugin_unsupported') : 'plugin_unreachable' };
        }
      } catch (e) {
        state = { ...state, at: now(), ok: false, archived: [], reason: e.kind === 'not_configured' ? 'plugin_not_configured' : 'plugin_unreachable' };
        if (e.kind !== 'not_configured') log.debug?.('bots: plugin list failed', { kind: e.kind });
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  /**
   * May this credential create bots right now? Reasons in order: bridge_off (env), owner_off, device_forbidden,
   * no_api_key, then the plugin's (plugin_not_configured, plugin_unreachable, plugin_unsupported, disabled_by_config,
   * not_root_profile, multiplex_off, hermes_unsupported, limit).
   */
  async function access(who) {
    if (setting === 'off') return { allowed: false, reason: 'bridge_off' };
    if (!enabledByOwner()) return { allowed: false, reason: 'owner_off' };
    if (!credentialAllows(who)) return { allowed: false, reason: 'device_forbidden' };
    if (!config.upstream?.apiKey) return { allowed: false, reason: 'no_api_key' };
    await refresh();
    if (!state.ok) return { allowed: false, reason: state.reason || 'plugin_unreachable' };
    if (state.create && !state.create.available) {
      const r = state.create.reason ?? '';
      return { allowed: false, reason: PLUGIN_REASONS.has(r) ? r : 'plugin_unsupported' };
    }
    return { allowed: true };
  }
  /** bots.manage (edit, archive / restore, revoke): the create gate, but the bot limit does not close it */
  const manageOf = (a) => (a.allowed || a.reason === 'limit' ? { allowed: true } : { allowed: false, reason: a.reason });

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
  const fail = (req, res, status, message, code, more = {}, extra = {}) =>
    send(req, res, status, { error: { message, type: status < 500 ? 'invalid_request_error' : 'bridge_error', code, ...more } }, extra);

  async function readJson(req, res) {
    if (Number(req.headers['content-length']) > BODY_MAX) {
      req.resume();
      res.setHeader('connection', 'close');
      fail(req, res, 413, 'Request body too large', 'payload_too_large');
      return undefined;
    }
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > BODY_MAX) {
        res.setHeader('connection', 'close');
        fail(req, res, 413, 'Request body too large', 'payload_too_large');
        return undefined;
      }
      chunks.push(c);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch {
      fail(req, res, 400, 'Body must be JSON', 'invalid_json');
      return undefined;
    }
  }

  /** Map a plugin error answer onto the bridge's (never the plugin's free text). */
  function pluginError(req, res, status, json) {
    const code = json?.error?.code;
    const reason = typeof json?.error?.reason === 'string' ? json.error.reason : '';
    if (status === 400 && code === 'invalid_field') {
      const field = FIELDS.has(reason) ? reason : 'body';
      return fail(req, res, 400, `Invalid ${field}`, 'invalid_field', { field });
    }
    if (status === 409 && (code === 'exists' || code === 'limit')) {
      return fail(req, res, 409, code === 'exists' ? 'A bot with this name exists' : `At most ${state.limit} bots`, code, code === 'limit' ? { limit: state.limit } : {});
    }
    if (status === 404 && code === 'unknown_bot') return fail(req, res, 404, 'Unknown bot', 'unknown_bot');
    if (status === 404 && code === 'not_found') return fail(req, res, 404, 'Not in the list', 'not_found');
    if (status === 409 && code === 'parked_elsewhere') return fail(req, res, 409, 'This bot was parked outside the app; restore it on the server', 'parked_elsewhere');
    if (status === 403 && code === 'default_bot') return fail(req, res, 403, 'The default bot is edited on the server', 'default_bot');
    if (status === 404 && code === 'feature_off') {
      state = { ...state, at: -Infinity };
      return fail(req, res, 404, 'Bots cannot be created on this server', 'bots_unavailable', { reason: PLUGIN_REASONS.has(reason) ? reason : 'plugin_unsupported' });
    }
    if (code === 'create_failed') return fail(req, res, 502, 'Hermes could not set the bot up', 'create_failed');
    return fail(req, res, 502, 'Bots upstream error', 'upstream_error');
  }
  const transportError = (req, res, e) => {
    state = { ...state, at: -Infinity };
    if (e.kind === 'not_configured') return fail(req, res, 404, 'Bots cannot be created on this server', 'bots_unavailable', { reason: 'plugin_not_configured' });
    if (e.kind === 'timeout') return fail(req, res, 504, 'Bots upstream timed out', 'timeout');
    return fail(req, res, 502, 'Bots upstream error', 'upstream_error');
  };

  async function rights(req, res, who) {
    if (!isAdmin(who)) { req.resume(); return fail(req, res, 403, 'Device tokens cannot manage bots rights (use BRIDGE_TOKEN)', 'admin_required'); }
    const view = () => {
      const v = devices ? devices.botsView() : { policy: {}, devices: [] };
      return { setting: setting || 'file', enabled: enabledByOwner(), devices: v.devices };
    };
    if (req.method === 'GET') { req.resume(); return send(req, res, 200, view()); }
    if (req.method !== 'PUT') { req.resume(); return fail(req, res, 405, 'Method not allowed', 'method_not_allowed', {}, { allow: 'GET, PUT' }); }
    const body = await readJson(req, res);
    if (body === undefined) return;
    if (!plain(body) || Object.keys(body).some((k) => k !== 'enabled' && k !== 'devices')) return fail(req, res, 400, 'Body must be {enabled?, devices?}', 'invalid_request');
    if (body.enabled !== undefined && body.enabled !== null && typeof body.enabled !== 'boolean') return fail(req, res, 400, 'enabled must be true, false or null', 'invalid_request');
    if (body.devices !== undefined && (!plain(body.devices) || Object.entries(body.devices).some(([id, v]) => !/^d_[a-z0-9]{10}$/.test(id) || typeof v !== 'boolean'))) {
      return fail(req, res, 400, 'devices must be {"<id>": true|false}', 'invalid_request');
    }
    if (body.enabled === undefined && body.devices === undefined) return send(req, res, 200, view());
    if (!devices) return fail(req, res, 409, 'Bots rights need a state directory (BRIDGE_STATE_DIR); without one only BRIDGE_BOTS_CREATE applies', 'state_dir_required');
    try {
      devices.setBots({ ...(body.enabled !== undefined ? { create: body.enabled } : {}), ...(body.devices ? { devices: body.devices } : {}) });
    } catch (e) {
      if (e?.code === 'unknown_device') return fail(req, res, 400, `Unknown device ${String(e.id).slice(0, 40)}`, 'unknown_device');
      if (e?.code === 'ELOCKED') return fail(req, res, 503, 'The device registry is busy, try again', 'busy', {}, { 'retry-after': '1' });
      throw e;
    }
    return send(req, res, 200, view());
  }

  /** Old plugin without the route (404 without a code, or not JSON): the feature is not there. */
  const oldPlugin = (status, json, notFoundToo) => status === 404 && (!json?.error?.code || (notFoundToo && json.error.code === 'not_found'));
  const unsupported = (req, res) => fail(req, res, 404, 'Not available on this server', 'bots_unavailable', { reason: 'plugin_unsupported' });

  /** GET /bots/<name>/allowlist or POST …/revoke on the plugin → {entries, manage}. */
  async function allowlist(req, res, name, method, body, manage) {
    try {
      const path = `/bots/${name}/allowlist${method === 'POST' ? '/revoke' : ''}`;
      const { status, json } = await plugin(method, path, body, method === 'POST' ? timeoutMs : listTimeoutMs * 2);
      // an older plugin answers 404 not_found for routes it does not know (on revoke, not_found = not in the list)
      if (status !== 200) return oldPlugin(status, json, method === 'GET') ? unsupported(req, res) : pluginError(req, res, status, json);
      if (!plain(json)) return fail(req, res, 502, 'Bots upstream error', 'upstream_error');
      const { entries, omitted } = projectAllowlist(json);
      if (method === 'POST') log.info?.('bots: allowlist entry revoked', { bot: name, entries: entries.length });
      return send(req, res, 200, { entries, ...(omitted ? { omitted } : {}), manage });
    } catch (e) {
      if (e.kind === 'bad' && e.status === 404) return unsupported(req, res);
      return transportError(req, res, e);
    }
  }

  /** POST /bots/<name>/archive | restore on the plugin → {bot}; the profiles list follows right away. */
  async function archive(req, res, name, what, who) {
    try {
      const { status, json } = await plugin('POST', `/bots/${name}/${what}`, {}, timeoutMs);
      if (status !== 200) return oldPlugin(status, json, true) ? unsupported(req, res) : pluginError(req, res, status, json);
      const bot = projectBot(plain(json) ? json.bot : null);
      if (!bot || bot.name !== name) return fail(req, res, 502, 'Bots upstream error', 'upstream_error');
      profiles.invalidate?.();
      await refresh(true); // archived bots leave /bridge/profiles, restored ones come back
      const listed = profiles.names().includes(name);
      // the plugin list did not answer (or lags): apply this answer directly
      if (bot.parked ? listed : !listed) profiles.addExternal?.(bot);
      log.info?.(what === 'archive' ? 'bots: archived' : 'bots: restored', { bot: name, by: who.kind });
      return send(req, res, 200, { bot: botView(bot, true) });
    } catch (e) {
      if (e.kind === 'bad' && e.status === 404) return unsupported(req, res);
      return transportError(req, res, e);
    }
  }

  async function handle(req, res) {
    const who = config.auth.check(req);
    if (!who) { req.resume(); return fail(req, res, 401, 'Invalid bridge token', 'invalid_api_key', {}, { 'www-authenticate': 'Bearer' }); }
    const path = pathOf(req);
    if (path === BOTS_RIGHTS_PATH) return rights(req, res, who);
    let name = null;
    let sub = '';
    if (path !== BOTS_PATH) {
      const rest = path.slice(BOTS_PATH.length + 1);
      const at = rest.indexOf('/');
      try { name = decodeURIComponent(at === -1 ? rest : rest.slice(0, at)); } catch { name = ''; }
      sub = at === -1 ? '' : rest.slice(at + 1);
      if (!Object.hasOwn(SUBS, sub)) { req.resume(); return fail(req, res, 404, 'Not found', 'not_found'); }
    }
    // the allowlist of the default bot is readable and revocable; editing and archiving it is not
    const defaultOk = sub === 'allowlist' || sub === 'allowlist/revoke';
    if (name !== null && (!isProfileName(name) || (name === DEFAULT_PROFILE && !defaultOk))) {
      req.resume();
      return fail(req, res, name === DEFAULT_PROFILE ? 403 : 404, name === DEFAULT_PROFILE ? 'The default bot is edited on the server' : 'Unknown bot', name === DEFAULT_PROFILE ? 'default_bot' : 'unknown_bot');
    }
    const methods = name === null ? ['GET', 'POST'] : SUBS[sub];
    if (!methods.includes(req.method)) { req.resume(); return fail(req, res, 405, 'Method not allowed', 'method_not_allowed', {}, { allow: methods.join(', ') }); }

    const a = await access(who);
    if (name === null && req.method === 'GET') {
      req.resume();
      await refresh(); // limit / count also for a credential that may not create
      const manage = manageOf(a);
      return send(req, res, 200, {
        create: a.allowed ? { allowed: true } : { allowed: false, reason: a.reason },
        manage,
        admin: isAdmin(who),
        limit: state.limit,
        count: state.count,
        archived: manage.allowed || isAdmin(who) ? state.archived : [],
      });
    }
    if (sub === 'allowlist') { req.resume(); return allowlist(req, res, name, 'GET', null, manageOf(a)); }
    // editing keeps working at the limit; every other reason closes create and edit alike
    if (!a.allowed && !(a.reason === 'limit' && name !== null)) {
      req.resume();
      if (a.reason === 'device_forbidden') return fail(req, res, 403, 'This device may not create or edit bots', 'bots_forbidden', { reason: a.reason });
      if (a.reason === 'limit') return fail(req, res, 409, `At most ${state.limit} bots`, 'limit', { limit: state.limit });
      return fail(req, res, 404, 'Bots cannot be created on this server', 'bots_unavailable', { reason: a.reason });
    }
    if (sub === 'allowlist/revoke') {
      const body = await readJson(req, res);
      if (body === undefined) return;
      if (!plain(body) || Object.keys(body).some((k) => k !== 'pattern')) return fail(req, res, 400, 'Body must be {pattern}', 'invalid_field', { field: 'body' });
      const pattern = body.pattern;
      if (typeof pattern !== 'string' || !pattern || pattern.length > PATTERN_MAX || CONTROL.test(pattern)) {
        return fail(req, res, 400, `pattern must be a string of 1..${PATTERN_MAX} characters`, 'invalid_field', { field: 'pattern' });
      }
      return allowlist(req, res, name, 'POST', { pattern }, { allowed: true });
    }
    if (sub === 'archive' || sub === 'restore') { req.resume(); return archive(req, res, name, sub, who); }

    if (req.method === 'GET') {
      req.resume();
      try {
        const { status, json } = await plugin('GET', `/bots/${name}`, null, listTimeoutMs * 2);
        if (status !== 200) return pluginError(req, res, status, json);
        const bot = projectFields(json);
        return bot ? send(req, res, 200, { bot }) : fail(req, res, 502, 'Bots upstream error', 'upstream_error');
      } catch (e) { return transportError(req, res, e); }
    }

    const body = await readJson(req, res);
    if (body === undefined) return;
    const checked = checkBody(body, name === null ? CREATE_KEYS : PATCH_KEYS);
    if (!checked.ok) return fail(req, res, 400, checked.message, 'invalid_field', { field: checked.field });
    try {
      const { status, json } = name === null
        ? await plugin('POST', '/bots', { ...checked.value, api_key: config.upstream?.apiKey }, timeoutMs)
        : await plugin('PATCH', `/bots/${name}`, checked.value, timeoutMs);
      if (status !== 200 && status !== 201) return pluginError(req, res, status, json);
      const bot = projectBot(json);
      if (!bot) return fail(req, res, 502, 'Bots upstream error', 'upstream_error');
      profiles.invalidate?.();
      await refresh(true); // the new bot is listed and served under /p/<name>/ from now on
      if (!profiles.names().includes(bot.name)) profiles.addExternal?.(bot); // plugin list not answering right now
      log.info?.(name === null ? 'bots: created' : 'bots: edited', { bot: bot.name, by: who.kind });
      return send(req, res, name === null ? 201 : 200, { bot: botView(bot) });
    } catch (e) { return transportError(req, res, e); }
  }

  /** GET /bridge/profiles, or `/p/<name>/` of a bot the bridge does not know yet: refresh the plugin's list first. */
  function wantsList(req) {
    if (!q.secretFile || typeof profiles.setExternal !== 'function') return false;
    const p = pathOf(req);
    if (p === '/bridge/profiles') return true;
    const m = /^\/p\/([^/]+)\//.exec(p);
    return !!m && isProfileName(m[1]) && !profiles.allowed(m[1]) && now() - state.at >= LIST_TTL_MS;
  }

  return { matches, handle, refresh, access, enabledByOwner, wantsList };
}

/**
 * `hermes-ui-plus-bridge bots status | enable | disable | grant <device-id> | revoke <device-id>`.
 * @param {string|undefined} sub
 * @param {string[]} args
 * @param {{env: Record<string, string|undefined>, store: ReturnType<typeof import('./devices.mjs').createDeviceStore>}} o
 * @returns {string[]}
 */
export function botsManageCli(sub, args, { env, store }) {
  const usage = 'usage: hermes-ui-plus-bridge bots status | enable | disable | grant <device-id> | revoke <device-id>';
  if (!sub || sub === 'status') {
    let setting;
    try { setting = parseBotsCreate(env.BRIDGE_BOTS_CREATE); } catch (e) { setting = `invalid (${e.message})`; }
    const v = store.botsView();
    const file = v.policy.create === undefined ? 'not set (off)' : v.policy.create ? 'on' : 'off';
    const lines = [
      `creating bots from the app: ${setting === 'on' ? 'on (BRIDGE_BOTS_CREATE=on)' : setting === 'off' ? 'off (BRIDGE_BOTS_CREATE=off)' : `${file} (${store.file})`}`,
      'admin token: may create and edit bots; paired devices: only with a grant',
    ];
    const granted = v.devices.filter((d) => d.manage);
    if (!granted.length) lines.push('no device has a grant');
    for (const d of granted) lines.push(`${d.id}  ${d.status.padEnd(8)}  may create and edit bots  ${d.label}`);
    return lines;
  }
  if (sub === 'enable' || sub === 'disable') {
    store.setBots({ create: sub === 'enable' });
    const note = parseBotsCreate(env.BRIDGE_BOTS_CREATE) ? ` (BRIDGE_BOTS_CREATE=${env.BRIDGE_BOTS_CREATE} still overrides this)` : '';
    return [`creating bots from the app ${sub}d${note}; a running bridge picks this up within 2 s`];
  }
  if (sub === 'grant' || sub === 'revoke') {
    const id = args[0];
    if (!id) throw new Error(usage);
    try {
      store.setBots({ devices: { [id]: sub === 'grant' } });
    } catch (e) {
      if (e?.code === 'unknown_device') throw new Error(`unknown device ${id}`);
      throw e;
    }
    return [`${id}: ${sub === 'grant' ? 'may create and edit bots' : 'may no longer create or edit bots'}`];
  }
  throw new Error(usage);
}
