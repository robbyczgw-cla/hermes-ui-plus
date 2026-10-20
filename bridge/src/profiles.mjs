// Hermes profiles ("bots"): one gateway serves every profile and mirrors each API path under `/p/<profile>/…`
// (gateway.multiplex_profiles). The bridge accepts exactly the same allow-list under that prefix, keeps the prefix
// when it forwards, and lists the profiles at GET /bridge/profiles (docs/HERMES-API.md "Profiles (bots)").
//
// BRIDGE_PROFILES
//   unset      auto when the Hermes home (HERMES_HOME, else ~/.hermes) is readable, else `any`
//   auto       profiles = directories in HERMES_HOME/profiles/ (re-scanned at most every 30 s)
//   a,b=Label  exactly these profiles (optional display label after `=`)
//   off        no `/p/` prefix at all (404), GET /bridge/profiles lists the default only
//   (any)      internal: no Hermes home to look at → every syntactically valid name passes, Hermes answers 404
// Names: Hermes' rule (lowercase letter/digit first, then lowercase letters, digits, `-`, `_`; max 64). Anything else
// (dots, `%`, upper case, empty) never reaches Hermes.
//
// Bots the hermes-ui-plus plugin reports (src/bots-manage.mjs, `setExternal`) are merged in: `auto` adds them to the
// directory scan, `any` (a sandboxed bridge that cannot read the Hermes home) lists exactly them, `list` adds the bots
// made in the app (an explicit list stays the owner's choice for every other profile), `off` ignores them. Parked bots
// (Hermes does not serve them) are never listed.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { hermesHome, listProfiles, parseYamlSubset } from './setup/detect.mjs';

export const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Name the API uses for the unprefixed profile (never sent as a prefix by the app). */
export const DEFAULT_PROFILE = 'default';
export const PROFILES_PATH = '/bridge/profiles';
const SCAN_TTL_MS = 30_000;
const CONFIG_MAX_BYTES = 256 * 1024;
const LABEL_MAX = 40;
const MODEL_MAX = 120;
const DESCRIPTION_MAX = 160;
/** Role templates of the app's create flow (bots-manage.mjs); anything else is not passed on. */
export const BOT_TEMPLATES = ['research', 'deals', 'travel', 'briefing', 'code', 'own', 'blank'];

export function isProfileName(name) {
  return typeof name === 'string' && PROFILE_NAME.test(name);
}

/**
 * Split a DECODED, already checked request path (paths.mjs) into the profile prefix and the rest.
 * `/p/writer/v1/models` → {profile: 'writer', path: '/v1/models'}; `/v1/models` → {profile: null, path: '/v1/models'}.
 * A `/p/` path with an invalid name or without a rest → {error}.
 * @param {string} path
 * @returns {{profile: string|null, path: string} | {error: string}}
 */
export function splitProfilePath(path) {
  if (!path.startsWith('/p/')) return { profile: null, path };
  const at = path.indexOf('/', 3);
  const name = at === -1 ? path.slice(3) : path.slice(3, at);
  if (!isProfileName(name)) return { error: 'invalid profile name' };
  const rest = at === -1 ? '' : path.slice(at);
  if (!rest || rest === '/') return { error: 'no path after profile' };
  if (rest.startsWith('/p/')) return { error: 'nested profile prefix' };
  return { profile: name, path: rest };
}

/** `/p/<name>` prefix for upstream calls of the bridge itself ('' for the default profile). */
export function profilePrefix(profile) {
  return profile && profile !== DEFAULT_PROFILE && isProfileName(profile) ? `/p/${profile}` : '';
}

/** BRIDGE_PROFILES → {mode, names, labels}. Throws on invalid explicit names (config error at start). */
export function parseProfilesSetting(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return { mode: 'default', names: [], labels: {} };
  if (/^(off|0|false|no|none)$/i.test(v)) return { mode: 'off', names: [], labels: {} };
  if (/^auto$/i.test(v)) return { mode: 'auto', names: [], labels: {} };
  /** @type {string[]} */ const names = [];
  /** @type {Record<string, string>} */ const labels = {};
  for (const part of v.split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf('=');
    const name = (eq === -1 ? part : part.slice(0, eq)).trim();
    const label = eq === -1 ? '' : part.slice(eq + 1).trim().slice(0, LABEL_MAX);
    if (!isProfileName(name)) throw new Error(`BRIDGE_PROFILES: invalid profile name "${name.slice(0, 64)}" (lowercase letters, digits, - and _)`);
    if (name === DEFAULT_PROFILE) {
      if (label) labels[name] = label;
      continue;
    }
    if (!names.includes(name)) names.push(name);
    if (label) labels[name] = label;
  }
  return { mode: 'list', names, labels };
}

/** Model name from a Hermes config.yaml (`model: <id>` or `model: {default: <id>}`); never anything else. */
export function modelFromConfig(text) {
  let y;
  try { y = parseYamlSubset(text); } catch { return undefined; }
  const m = y?.model;
  const id = typeof m === 'string' ? m : m && typeof m === 'object' ? (typeof m.default === 'string' ? m.default : typeof m.model === 'string' ? m.model : undefined) : undefined;
  const s = typeof id === 'string' ? id.trim() : '';
  return s && s.length <= MODEL_MAX && !/\s/.test(s) ? s : undefined;
}

/**
 * Hermes Desktop's bot metadata from a profile.yaml (`ui_meta['hermes-bots']`, falling back to the profile's
 * `description`): display title, one-line description, colour, pinned / hidden. Plain text only, clipped; never anything
 * else from the file.
 */
export function botMetaFromProfileYaml(text) {
  let y;
  try { y = parseYamlSubset(text); } catch { return {}; }
  const meta = y?.ui_meta?.['hermes-bots'];
  const m = meta && typeof meta === 'object' ? meta : {};
  const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');
  const title = clean(m.title, LABEL_MAX);
  const description = clean(m.description, DESCRIPTION_MAX) || clean(y?.description, DESCRIPTION_MAX);
  const color = typeof m.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(m.color.trim()) ? m.color.trim().toLowerCase() : '';
  const flag = (v) => v === true || /^(true|yes|on|1)$/i.test(String(v ?? ''));
  const app = y?.ui_meta?.['hermes-ui-plus'];
  const template = app && typeof app === 'object' && BOT_TEMPLATES.includes(app.template) ? app.template : '';
  return {
    ...(title ? { title } : {}),
    ...(template ? { template } : {}),
    ...(description ? { description } : {}),
    ...(color ? { color } : {}),
    ...(flag(m.pinned) ? { pinned: true } : {}),
    ...(flag(m.hidden) ? { hidden: true } : {}),
  };
}

/**
 * @param {Record<string, string|undefined>} env
 * @param {{fs?: {existsSync: Function, readFileSync: Function, readdirSync: Function, statSync: Function}, now?: () => number, home?: string}} [o]
 */
export function createProfiles(env = process.env, o = {}) {
  const fs = o.fs ?? { existsSync, readFileSync, readdirSync, statSync };
  const now = o.now ?? Date.now;
  const setting = parseProfilesSetting(env.BRIDGE_PROFILES);
  const home = o.home ?? hermesHome(env);
  const homeReadable = (() => { try { return fs.existsSync(home) && fs.statSync(home).isDirectory(); } catch { return false; } })();
  /** @type {'auto'|'list'|'off'|'any'} */
  const mode = setting.mode === 'default' ? (homeReadable ? 'auto' : 'any') : setting.mode;

  let scan = { at: -Infinity, names: /** @type {string[]} */ ([]) };
  function scanned() {
    if (now() - scan.at < SCAN_TTL_MS) return scan.names;
    const names = listProfiles(home, { fs }).map((p) => p.name).filter(isProfileName).filter((n) => n !== DEFAULT_PROFILE);
    scan = { at: now(), names };
    return names;
  }

  /** @type {{name: string, title?: string, description?: string, color?: string, pinned?: boolean, hidden?: boolean, parked?: boolean, template?: string, app?: boolean}[]} */
  let external = [];
  const served = () => external.filter((b) => !b.parked);

  /** Non-default profile names known to the bridge (`any`: only what the plugin reports). */
  function names() {
    if (mode === 'off') return [];
    const add = (base, more) => [...base, ...more.map((b) => b.name).filter((n) => !base.includes(n))];
    if (mode === 'list') return add(setting.names, served().filter((b) => b.app));
    if (mode === 'auto') return add(scanned(), served());
    return served().map((b) => b.name);
  }

  /** Bots the plugin reports (GET /bots of hermes-ui-plus, already projected); the next list() is rebuilt. */
  function setExternal(rows) {
    external = (Array.isArray(rows) ? rows : []).filter((b) => b && isProfileName(b.name) && b.name !== DEFAULT_PROFILE);
    listCache = { at: -Infinity, list: [] };
  }

  /** One bot the plugin just made (its list did not answer yet). */
  function addExternal(row) {
    if (!row || !isProfileName(row.name) || row.name === DEFAULT_PROFILE) return;
    external = [...external.filter((b) => b.name !== row.name), row];
    listCache = { at: -Infinity, list: [] };
  }

  /** Forget the directory scan and the list (a bot was just created or edited). */
  function invalidate() {
    scan = { at: -Infinity, names: [] };
    listCache = { at: -Infinity, list: [] };
  }

  /** May `/p/<name>/…` be forwarded? */
  function allowed(name) {
    if (!isProfileName(name) || mode === 'off') return false;
    if (mode === 'any') return true;
    return names().includes(name);
  }

  function readModel(dir) {
    const f = join(dir, 'config.yaml');
    try {
      if (!fs.existsSync(f)) return undefined;
      const size = fs.statSync(f).size;
      if (size > CONFIG_MAX_BYTES) return undefined;
      return modelFromConfig(fs.readFileSync(f, 'utf8'));
    } catch {
      return undefined;
    }
  }

  function readMeta(dir) {
    const f = join(dir, 'profile.yaml');
    try {
      if (!fs.existsSync(f) || fs.statSync(f).size > CONFIG_MAX_BYTES) return {};
      return botMetaFromProfileYaml(fs.readFileSync(f, 'utf8'));
    } catch {
      return {};
    }
  }

  let listCache = { at: -Infinity, list: /** @type {any[]} */ ([]) };
  /**
   * GET /bridge/profiles body: default first, then the known profiles (name, label?, model?, description?, color?,
   * pinned?). Label: BRIDGE_PROFILES `name=Label`, else Hermes Desktop's bot title. Bots Desktop hides are not listed
   * (still reachable under /p/<name>/). No secrets.
   */
  function list() {
    if (now() - listCache.at < SCAN_TTL_MS) return listCache.list;
    const withFiles = homeReadable && mode !== 'off';
    const entry = (name, isDefault) => {
      const dir = isDefault ? home : join(home, 'profiles', name);
      const ext = isDefault ? undefined : external.find((b) => b.name === name);
      const file = withFiles ? readMeta(dir) : {};
      // the plugin reads the same profile.yaml inside the gateway; the files win when the bridge can read them
      const meta = { ...(ext ? { title: ext.title, description: ext.description, color: ext.color, pinned: ext.pinned, hidden: ext.hidden, template: ext.template } : {}), ...file };
      const label = setting.labels[name] ?? meta.title;
      const model = withFiles ? readModel(dir) : undefined;
      return {
        name, default: isDefault, ...(label ? { label } : {}), ...(model ? { model } : {}),
        ...(meta.description ? { description: meta.description } : {}), ...(meta.color ? { color: meta.color } : {}),
        ...(meta.pinned ? { pinned: true } : {}), ...(meta.hidden ? { hidden: true } : {}),
        ...(meta.template ? { template: meta.template } : {}),
      };
    };
    const out = [entry(DEFAULT_PROFILE, true), ...names().map((n) => entry(n, false))]
      .filter((e) => e.default || !e.hidden)
      .map(({ hidden: _h, ...e }) => e);
    listCache = { at: now(), list: out };
    return out;
  }

  return { mode, allowed, names, list, setExternal, addExternal, invalidate };
}
