// `hermes-ui-plus-bridge setup`, detection half: Hermes home, API server settings, health, profiles, Tailscale
// and LAN addresses. Pure parsing functions plus thin readers with injectable fs/fetch/exec (tested in
// test/setup.test.mjs). Secrets (the Hermes API key) are returned in memory only and never formatted for output.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { upstreamUrl } from '../paths.mjs';

export const DEFAULT_HERMES_PORT = 8642;

/** HERMES_HOME, else ~/.hermes. */
export function hermesHome(env = process.env, home = homedir()) {
  return env.HERMES_HOME ? resolve(env.HERMES_HOME) : join(home, '.hermes');
}

const unquote = (v) => {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"') && t.length >= 2) || (t.startsWith("'") && t.endsWith("'") && t.length >= 2)) return t.slice(1, -1);
  return t;
};
const stripComment = (v) => {
  // a ` #` outside quotes starts a comment
  let q = '';
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (q) { if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(v[i - 1]))) return v.slice(0, i);
  }
  return v;
};

/**
 * Minimal YAML reader for the parts of Hermes' config.yaml we need: nested block mappings with scalar values.
 * Lists, flow collections and block scalars are skipped (their key maps to null). Not a general YAML parser.
 * @param {string} text
 * @returns {Record<string, any>}
 */
export function parseYamlSubset(text) {
  const root = {};
  /** @type {{indent: number, obj: any}[]} */
  const stack = [{ indent: -1, obj: root }];
  let skipIndent = -1; // inside a block scalar / list below this indentation
  for (const rawLine of String(text).split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    if (skipIndent >= 0) {
      if (indent > skipIndent) continue;
      skipIndent = -1;
    }
    const line = rawLine.trim();
    if (line.startsWith('- ') || line === '-' || line === '---' || line === '...') continue;
    const m = /^("[^"]*"|'[^']*'|[^:#][^:]*?)\s*:(?:\s+(.*))?$/.exec(line);
    if (!m) continue;
    const key = unquote(m[1]);
    const rest = stripComment(m[2] ?? '').trim();
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (rest === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else if (/^[|>][-+0-9]*$/.test(rest)) {
      parent[key] = null;
      skipIndent = indent;
    } else if (rest.startsWith('[') || rest.startsWith('{')) {
      parent[key] = null;
    } else {
      const v = unquote(rest);
      parent[key] = /^(true|yes|on)$/i.test(v) ? true : /^(false|no|off)$/i.test(v) ? false : /^(null|~)$/i.test(v) ? null : /^-?\d+$/.test(v) ? Number(v) : v;
    }
  }
  return root;
}

const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');
const truthy = (v) => v === true || /^(1|true|yes|on)$/i.test(String(v ?? ''));

/**
 * API server settings from config.yaml (`platforms.api_server`, values also accepted under `.extra`) and the
 * Hermes .env (`API_SERVER_*`). The key is returned as `key` (memory only); `hasKey` is what may be shown.
 * @param {Record<string, any>} yaml  parsed config.yaml ({} when missing)
 * @param {Record<string, string>} hermesEnv  parsed HERMES_HOME/.env ({} when missing)
 */
export function apiServerSettings(yaml, hermesEnv = {}) {
  const block = yaml?.platforms?.api_server ?? yaml?.api_server ?? null;
  const b = block && typeof block === 'object' ? block : {};
  const extra = b.extra && typeof b.extra === 'object' ? b.extra : {};
  const enabledRaw = pick(b.enabled, extra.enabled, hermesEnv.API_SERVER_ENABLED);
  const key = String(pick(extra.key, b.key, extra.api_key, b.api_key, hermesEnv.API_SERVER_KEY) ?? '');
  const host = String(pick(extra.host, b.host, hermesEnv.API_SERVER_HOST) ?? '127.0.0.1');
  const portRaw = Number(pick(extra.port, b.port, hermesEnv.API_SERVER_PORT));
  const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw < 65536 ? portRaw : DEFAULT_HERMES_PORT;
  // A block without `enabled:` counts as on when it exists at all (Hermes' platform blocks are opt-in).
  const enabled = enabledRaw === undefined ? Boolean(block) : truthy(enabledRaw);
  return { configured: Boolean(block) || hermesEnv.API_SERVER_ENABLED !== undefined, enabled, host, port, hasKey: key.length > 0, key };
}

/** Address the bridge should use to reach Hermes (wildcard listeners are reached over loopback). */
export function hermesBaseUrl({ host, port }) {
  let h = host;
  if (!h || h === '0.0.0.0' || h === '::' || h === '[::]') h = '127.0.0.1';
  if (h.includes(':') && !h.startsWith('[')) h = `[${h}]`;
  return `http://${h}:${port}`;
}

/** Read and parse everything about the Hermes install (no network). */
export function readHermes(home, { fs = { existsSync, readFileSync } } = {}) {
  const configFile = join(home, 'config.yaml');
  const envFile = join(home, '.env');
  const read = (f) => { try { return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; } catch { return null; } };
  const yamlText = read(configFile);
  const envText = read(envFile);
  let hermesEnv = {};
  try { hermesEnv = envText ? parseEnv(envText) : {}; } catch { hermesEnv = {}; }
  const yaml = yamlText ? parseYamlSubset(yamlText) : {};
  const api = apiServerSettings(yaml, hermesEnv);
  return { home, exists: fs.existsSync(home), configFile, configExists: yamlText !== null, configText: yamlText ?? '', api, envDuplicates: duplicateEnvKeys(envText ?? '') };
}

/**
 * API_SERVER_* keys set more than once in Hermes' .env (an appended snippet next to a key Hermes' own setup wrote).
 * The last line wins, for Hermes and for this wizard; a user who copies the first key gets a 401.
 */
export function duplicateEnvKeys(text) {
  const seen = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?(API_SERVER_[A-Z_]+)\s*=/.exec(line);
    if (m) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([k]) => k);
}

/** Hermes profiles (`HERMES_HOME/profiles/<name>/`), the targets of `/p/<profile>/` multiplexing. */
export function listProfiles(home, { fs = { existsSync, readdirSync, statSync } } = {}) {
  const dir = join(home, 'profiles');
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((n) => /^[A-Za-z0-9._-]{1,64}$/.test(n) && !n.startsWith('.'))
      .filter((n) => { try { return fs.statSync(join(dir, n)).isDirectory(); } catch { return false; } })
      .sort()
      .map((name) => ({ name, dir: join(dir, name), skillsDir: join(dir, name, 'skills') }));
  } catch { return []; }
}

/** GET <base>/health → {reachable, status, version, platform}. Never throws. */
export async function probeHealth(base, { fetch: doFetch = fetch, timeoutMs = 4000 } = {}) {
  try {
    const r = await doFetch(upstreamUrl(base, '/health').href, { signal: AbortSignal.timeout(timeoutMs) });
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    return { reachable: true, ok: r.ok, status: r.status, version: typeof body?.version === 'string' ? body.version : '', platform: typeof body?.platform === 'string' ? body.platform : '', headers: r.headers };
  } catch (e) {
    return { reachable: false, ok: false, status: 0, version: '', platform: '', error: e?.cause?.code || e?.name || 'error' };
  }
}

/** Parse `tailscale status --json`. */
export function parseTailscaleStatus(json) {
  let s;
  try { s = typeof json === 'string' ? JSON.parse(json) : json; } catch { return { running: false, dnsName: '' }; }
  const dnsName = String(s?.Self?.DNSName ?? '').replace(/\.$/, '').toLowerCase();
  const running = s?.BackendState === 'Running';
  return { running, dnsName, magicDns: Boolean(s?.CurrentTailnet?.MagicDNSEnabled ?? dnsName), tailnet: String(s?.CurrentTailnet?.Name ?? '') };
}

/** Public tailnet URL for `tailscale serve --https=<httpsPort>`. */
export function tailnetUrl(dnsName, httpsPort) {
  if (!dnsName) return '';
  return `https://${dnsName}${Number(httpsPort) === 443 ? '' : `:${httpsPort}`}`;
}

/** The exact `tailscale serve` command line (array) for the bridge. */
export function tailscaleServeArgs(httpsPort, bridgePort) {
  return ['serve', '--bg', `--https=${httpsPort}`, `http://127.0.0.1:${bridgePort}`];
}

/** Non-internal IPv4 addresses from os.networkInterfaces() output (Tailscale CGNAT addresses excluded). */
export function lanAddresses(ifaces) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces ?? {})) {
    if (/^(tailscale|utun|docker|br-|veth|virbr|lo)/.test(name)) continue;
    for (const a of list ?? []) {
      if (a.internal || (a.family !== 'IPv4' && a.family !== 4)) continue;
      const [x, y] = a.address.split('.').map(Number);
      if (x === 100 && y >= 64 && y <= 127) continue; // CGNAT / tailnet
      if (x === 169 && y === 254) continue; // link local
      out.push(a.address);
    }
  }
  return out;
}

/** The config.yaml snippet that turns the API server on (key shown as a placeholder only). */
export function apiServerSnippet({ host = '127.0.0.1', port = DEFAULT_HERMES_PORT } = {}) {
  return [
    'platforms:',
    '  api_server:',
    '    enabled: true',
    '    extra:',
    `      host: ${host}`,
    `      port: ${port}`,
    '      key: <long random key, e.g. openssl rand -hex 32>',
  ].join('\n');
}

export const HERMES_RESTART_HINT = 'restart the Hermes gateway: `hermes gateway restart` for the service (or `sudo systemctl restart hermes-gateway`); if it runs in a terminal (`hermes gateway run`), stop it with Ctrl+C and start it again; in Docker restart its container';

/**
 * Add an api_server block to config.yaml text. Only safe, unambiguous edits: no api_server key may exist yet.
 * Inserts below an existing top-level `platforms:` (matching its child indentation) or appends a new block.
 * @returns {{ok: true, text: string} | {ok: false, reason: string}}
 */
export function addApiServerBlock(text, { host = '127.0.0.1', port = DEFAULT_HERMES_PORT, key }) {
  if (!key || !/^[A-Za-z0-9_-]{32,}$/.test(key)) return { ok: false, reason: 'key must be 32+ url-safe characters' };
  const src = String(text ?? '');
  if (/^\s*api_server\s*:/m.test(src)) return { ok: false, reason: 'config.yaml already has an api_server block; edit it by hand' };
  const lines = src.split('\n');
  const pIdx = lines.findIndex((l) => /^platforms\s*:\s*(#.*)?$/.test(l));
  if (pIdx === -1) {
    if (/^platforms\s*:/m.test(src)) return { ok: false, reason: 'unusual platforms: syntax; edit config.yaml by hand' };
    const block = ['platforms:', '  api_server:', '    enabled: true', '    extra:', `      host: ${host}`, `      port: ${port}`, `      key: ${key}`].join('\n');
    return { ok: true, text: `${src}${src && !src.endsWith('\n') ? '\n' : ''}${block}\n` };
  }
  const next = lines.slice(pIdx + 1).find((l) => l.trim() && !l.trimStart().startsWith('#'));
  const ind = next && /^\s+/.test(next) ? next.match(/^\s+/)[0] : '  ';
  const add = [`${ind}api_server:`, `${ind}${ind}enabled: true`, `${ind}${ind}extra:`, `${ind}${ind}${ind}host: ${host}`, `${ind}${ind}${ind}port: ${port}`, `${ind}${ind}${ind}key: ${key}`];
  lines.splice(pIdx + 1, 0, ...add);
  return { ok: true, text: lines.join('\n') };
}
