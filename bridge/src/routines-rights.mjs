// Routines rights (slice 2): the effective right of a request for one bot is `manage` | `read` | `none`.
//   1. BRIDGE_ROUTINES=control|read|off is the server-wide ceiling (off: none everywhere, read: at most read).
//   2. The owner enables bots: BRIDGE_ROUTINES_BOTS (comma list, `*` = every bot the bridge serves, `default` = the
//      unprefixed profile) OR `routines.bots` in <state-dir>/devices.json (PUT /bridge/routines/rights, CLI). Either
//      one enables a bot; a bot that is not enabled has no routines at all (404 routines_off).
//   3. Credential: BRIDGE_TOKEN (admin) and open mode are the owner (manage); a paired device gets its per-bot
//      override from devices.json, else `read`. A device never gets manage without an explicit grant.
//   4. Effective right = min(ceiling, credential right) on enabled bots.
// Admin endpoints (BRIDGE_TOKEN only; device tokens 403 admin_required):
//   GET /bridge/routines/rights  -> {mode, envBots, bots, defaultRight, devices: [{id, label, status, routines}]}
//   PUT /bridge/routines/rights  {bots?: {"<bot>": bool}, devices?: {"<id>": {"<bot>": right|null}}} -> like GET
// docs/ROUTER.md, "Hermes routines (cron jobs)".
import { DEFAULT_PROFILE, isProfileName } from './profiles.mjs';
import { ROUTINE_RIGHTS } from './devices.mjs';

export const RIGHTS_PATH = '/bridge/routines/rights';
export const DEFAULT_DEVICE_RIGHT = 'read';
const RANK = { none: 0, read: 1, manage: 2 };
const CEILING = { control: 'manage', read: 'read', off: 'none' };
const BODY_MAX = 8 * 1024;
const MAX_CHANGES = 100;

/** `default` or a valid Hermes profile name. */
export const isBotName = (name) => name === DEFAULT_PROFILE || isProfileName(name);

/** The lower of two rights. */
export const minRight = (a, b) => (RANK[a] <= RANK[b] ? a : b);

/** BRIDGE_ROUTINES_BOTS → {all, names}. Throws on an invalid name (config error at start). */
export function parseRoutinesBots(raw) {
  const parts = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const names = [];
  let all = false;
  for (const p of parts) {
    if (p === '*') { all = true; continue; }
    if (!isBotName(p)) throw new Error(`BRIDGE_ROUTINES_BOTS: invalid bot name "${p.slice(0, 64)}" (default, a profile name or *)`);
    if (!names.includes(p)) names.push(p);
  }
  return { all, names };
}

/**
 * @param {{mode: 'control'|'read'|'off', bots: {all: boolean, names: string[]},
 *   devices?: ReturnType<typeof import('./devices.mjs').createDeviceStore>|null,
 *   profiles: {allowed: (name: string) => boolean, names: () => string[]}}} o
 */
export function createRoutinesRights({ mode, bots, devices = null, profiles }) {
  const ceiling = CEILING[mode] ?? 'none';
  /** The bridge serves this bot: the default profile or an allowed `/p/<name>/` profile. */
  const served = (bot) => bot === DEFAULT_PROFILE || profiles.allowed(bot);
  const fileBots = () => (devices ? devices.routinesPolicy().bots : {});

  /** Enabled by the owner (env or file) and served; the ceiling is not part of this. */
  function enabledByOwner(bot) {
    if (!isBotName(bot) || !served(bot)) return false;
    return bots.all || bots.names.includes(bot) || fileBots()[bot] === true;
  }

  /** Does the bridge offer routines for this bot at all (ceiling not off and enabled)? */
  const isEnabled = (bot) => mode !== 'off' && enabledByOwner(bot);

  /**
   * Credential right before the ceiling. `who` = auth.check(req) result; null/undefined = no auth layer (handlers
   * constructed directly in tests) → owner.
   * @param {null|undefined|{kind: 'admin'|'device'|'open', id?: string}} who
   */
  function credentialRight(who, bot) {
    if (!who || who.kind === 'admin' || who.kind === 'open') return 'manage';
    if (who.kind === 'device' && who.id) {
      const r = devices?.deviceRoutines(who.id)?.[bot];
      return ROUTINE_RIGHTS.includes(r) ? r : DEFAULT_DEVICE_RIGHT;
    }
    return 'none';
  }

  /**
   * Access decision for one request.
   * @returns {{right: 'manage'|'read'|'none', status?: number, code?: 'routines_off'|'routines_forbidden', reasons: string[]}}
   */
  function access(who, bot) {
    const reasons = [];
    if (mode === 'off') reasons.push('routines_off');
    else if (!enabledByOwner(bot)) reasons.push('bot_not_enabled');
    if (reasons.length) return { right: 'none', status: 404, code: 'routines_off', reasons };
    const cred = credentialRight(who, bot);
    if (cred === 'none') return { right: 'none', status: 403, code: 'routines_forbidden', reasons: ['device_forbidden'] };
    if (mode === 'read') reasons.push('read_only_server');
    if (cred === 'read') reasons.push('read_only_device');
    return { right: /** @type {'manage'|'read'} */ (minRight(ceiling, cred)), reasons };
  }

  /**
   * Right of a stored credential id (push registrations: `admin_…`, `open`, `dev_<id>`). Validity of the credential
   * itself is checked by the push notifier (auth.credentialValid).
   */
  function rightOfCredential(cred, bot) {
    if (typeof cred !== 'string') return 'none';
    const who = cred === 'open' ? { kind: 'open' } : cred.startsWith('admin_') ? { kind: 'admin' }
      : cred.startsWith('dev_') ? { kind: 'device', id: cred.slice(4) } : null;
    if (!who) return 'none';
    return access(/** @type {any} */ (who), bot).right;
  }

  /** Bots the reconciler polls: enabled and served, default first. Capped by the caller. */
  function enabledBots() {
    if (mode === 'off') return [];
    const out = [];
    const add = (b) => { if (!out.includes(b) && enabledByOwner(b)) out.push(b); };
    add(DEFAULT_PROFILE);
    if (bots.all) for (const n of profiles.names()) add(n);
    for (const n of bots.names) add(n);
    for (const [n, on] of Object.entries(fileBots())) if (on) add(n);
    return out;
  }

  return { mode, ceiling, envBots: bots, isEnabled, access, credentialRight, rightOfCredential, enabledBots, served };
}

/**
 * GET/PUT /bridge/routines/rights.
 * @param {{auth: ReturnType<typeof import('./auth.mjs').createAuth>, rights: ReturnType<typeof createRoutinesRights>,
 *   devices: ReturnType<typeof import('./devices.mjs').createDeviceStore>|null, corsOrigins?: string[]}} o
 */
export function createRoutinesAdmin({ auth, rights, devices, corsOrigins = [] }) {
  const json = (res, status, body) => {
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': buf.length, 'cache-control': 'no-store', 'x-hermes-ui-bridge': '1' });
    res.end(buf);
  };
  const err = (res, status, message, code, type = 'invalid_request_error') => json(res, status, { error: { message, type, code } });
  const pathOf = (req) => (req.url ?? '').split('?')[0];

  function view() {
    const v = devices ? devices.routinesView() : { bots: {}, devices: [] };
    return {
      mode: rights.mode,
      envBots: rights.envBots.all ? ['*', ...rights.envBots.names] : [...rights.envBots.names],
      bots: v.bots,
      defaultRight: DEFAULT_DEVICE_RIGHT,
      devices: v.devices,
    };
  }

  /** @returns {{ok: true, value: {bots?: Record<string, boolean>, devices?: Record<string, Record<string, string|null>>}} | {ok: false, message: string, code: string}} */
  function parseChange(body) {
    const bad = (message, code = 'invalid_request') => ({ ok: /** @type {const} */ (false), message, code });
    if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('Body must be a JSON object', 'invalid_json');
    const unknown = Object.keys(body).find((k) => k !== 'bots' && k !== 'devices');
    if (unknown) return bad(`Unsupported field ${unknown.slice(0, 40)}`, 'unsupported_field');
    /** @type {{bots?: Record<string, boolean>, devices?: Record<string, Record<string, string|null>>}} */
    const value = {};
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    if (body.bots !== undefined) {
      if (!isObj(body.bots)) return bad('bots must be an object {"<bot>": true|false}');
      const entries = Object.entries(body.bots);
      if (entries.length > MAX_CHANGES) return bad('Too many bots');
      for (const [bot, on] of entries) {
        if (!isBotName(bot)) return bad(`Invalid bot name ${bot.slice(0, 64)}`, 'invalid_bot');
        if (typeof on !== 'boolean') return bad('bots values must be true or false');
      }
      value.bots = Object.fromEntries(entries);
    }
    if (body.devices !== undefined) {
      if (!isObj(body.devices)) return bad('devices must be an object {"<id>": {"<bot>": "manage"|"read"|"none"|null}}');
      const entries = Object.entries(body.devices);
      if (entries.length > MAX_CHANGES) return bad('Too many devices');
      value.devices = {};
      for (const [id, change] of entries) {
        if (!/^d_[a-z0-9]{10}$/.test(id)) return bad(`Unknown device ${id.slice(0, 40)}`, 'unknown_device');
        if (!isObj(change)) return bad('Each device needs an object {"<bot>": right|null}');
        for (const [bot, right] of Object.entries(change)) {
          if (!isBotName(bot)) return bad(`Invalid bot name ${bot.slice(0, 64)}`, 'invalid_bot');
          if (right !== null && !ROUTINE_RIGHTS.includes(right)) return bad('Rights must be manage, read, none or null', 'invalid_right');
        }
        value.devices[id] = change;
      }
    }
    return { ok: true, value };
  }

  return {
    matches: (req) => req.method !== 'OPTIONS' && pathOf(req) === RIGHTS_PATH,
    async handle(req, res) {
      const origin = req.headers.origin;
      if (origin && corsOrigins.length && (corsOrigins.includes('*') || corsOrigins.includes(origin))) {
        res.setHeader('access-control-allow-origin', corsOrigins.includes('*') ? '*' : origin);
        res.setHeader('vary', 'Origin');
      }
      const who = auth.check(req);
      if (!who) {
        req.resume();
        return err(res, 401, 'Invalid bridge token', 'invalid_api_key');
      }
      if (who.kind === 'device') {
        req.resume();
        return err(res, 403, 'Device tokens cannot manage routines rights (use BRIDGE_TOKEN)', 'admin_required');
      }
      if (req.method === 'GET') {
        req.resume();
        return json(res, 200, view());
      }
      if (req.method !== 'PUT') {
        req.resume();
        res.setHeader('allow', 'GET, PUT');
        return err(res, 405, 'Method not allowed', 'method_not_allowed');
      }
      if (Number(req.headers['content-length']) > BODY_MAX) {
        req.resume();
        res.setHeader('connection', 'close');
        return err(res, 413, 'Request body too large', 'payload_too_large');
      }
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > BODY_MAX) {
          res.setHeader('connection', 'close');
          return err(res, 413, 'Request body too large', 'payload_too_large');
        }
        chunks.push(c);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return err(res, 400, 'Body must be JSON', 'invalid_json'); }
      const parsed = parseChange(body);
      if (!parsed.ok) return err(res, 400, parsed.message, parsed.code);
      const { bots, devices: devChanges } = parsed.value;
      if (!bots && !devChanges) return json(res, 200, view());
      if (!devices) return err(res, 409, 'Routines rights need a state directory (BRIDGE_STATE_DIR); without one only BRIDGE_ROUTINES_BOTS applies', 'state_dir_required');
      try {
        devices.setRoutines({ bots, devices: devChanges });
      } catch (e) {
        if (e?.code === 'unknown_device') return err(res, 400, `Unknown device ${String(e.id).slice(0, 40)}`, 'unknown_device');
        if (e?.code === 'ELOCKED') {
          res.setHeader('retry-after', '1');
          return err(res, 503, 'The device registry is busy, try again', 'busy', 'bridge_error');
        }
        throw e;
      }
      return json(res, 200, view());
    },
  };
}

/**
 * `hermes-ui-bridge routines status | enable <bot> | disable <bot> | grant <device-id> <bot> manage|read|none|default`.
 * Works on the state directory like `devices`; a running bridge picks changes up within 2 s.
 * @param {string|undefined} sub
 * @param {string[]} args
 * @param {{env: Record<string, string|undefined>, store: ReturnType<typeof import('./devices.mjs').createDeviceStore>}} o
 * @returns {string[]} output lines
 */
export function routinesCli(sub, args, { env, store }) {
  const usage = 'usage: hermes-ui-bridge routines status | enable <bot> | disable <bot> | grant <device-id> <bot> manage|read|none|default';
  const botArg = (b) => {
    if (!b || !isBotName(b)) throw new Error(`invalid bot name ${String(b ?? '').slice(0, 64)} (default or a profile name)\n${usage}`);
    return b;
  };
  if (!sub || sub === 'status') {
    const mode = (env.BRIDGE_ROUTINES || 'control').toLowerCase();
    let envBots = '-';
    try {
      const b = parseRoutinesBots(env.BRIDGE_ROUTINES_BOTS);
      envBots = [...(b.all ? ['*'] : []), ...b.names].join(',') || '-';
    } catch (e) { envBots = `invalid (${e.message})`; }
    const v = store.routinesView();
    const fileBots = Object.entries(v.bots).map(([b, on]) => `${b}=${on ? 'on' : 'off'}`).join(', ') || '-';
    const lines = [`mode ${mode} (BRIDGE_ROUTINES)`, `bots from BRIDGE_ROUTINES_BOTS: ${envBots}`, `bots from ${store.file}: ${fileBots}`, `device default: ${DEFAULT_DEVICE_RIGHT}`];
    const grants = v.devices.filter((d) => Object.keys(d.routines).length);
    if (!grants.length) lines.push('no device overrides');
    for (const d of grants) lines.push(`${d.id}  ${d.status.padEnd(8)}  ${Object.entries(d.routines).map(([b, r]) => `${b}=${r}`).join(', ')}  ${d.label}`);
    return lines;
  }
  if (sub === 'enable' || sub === 'disable') {
    const bot = botArg(args[0]);
    store.setRoutines({ bots: { [bot]: sub === 'enable' } });
    return [`routines ${sub}d for ${bot} (a running bridge picks this up within 2 s)`];
  }
  if (sub === 'grant') {
    const [id, b, right] = args;
    if (!id) throw new Error(usage);
    const bot = botArg(b);
    if (![...ROUTINE_RIGHTS, 'default'].includes(right)) throw new Error(usage);
    try {
      store.setRoutines({ devices: { [id]: { [bot]: right === 'default' ? null : right } } });
    } catch (e) {
      if (e?.code === 'unknown_device') throw new Error(`unknown device ${id}`);
      throw e;
    }
    return [`${id}: routines on ${bot} = ${right === 'default' ? `${DEFAULT_DEVICE_RIGHT} (default)` : right}`];
  }
  throw new Error(usage);
}
