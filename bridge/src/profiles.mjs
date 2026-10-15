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

  /** Non-default profile names known to the bridge (`any`: none, it cannot know). */
  function names() {
    if (mode === 'list') return setting.names;
    if (mode === 'auto') return scanned();
    return [];
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

  let listCache = { at: -Infinity, list: /** @type {any[]} */ ([]) };
  /** GET /bridge/profiles body: default first, then the known profiles (name, label?, model?). No secrets. */
  function list() {
    if (now() - listCache.at < SCAN_TTL_MS) return listCache.list;
    const withModel = homeReadable && mode !== 'off';
    const entry = (name, isDefault) => {
      const label = setting.labels[name];
      const model = withModel ? readModel(isDefault ? home : join(home, 'profiles', name)) : undefined;
      return { name, default: isDefault, ...(label ? { label } : {}), ...(model ? { model } : {}) };
    };
    const out = [entry(DEFAULT_PROFILE, true), ...names().map((n) => entry(n, false))];
    listCache = { at: now(), list: out };
    return out;
  }

  return { mode, allowed, names, list };
}
