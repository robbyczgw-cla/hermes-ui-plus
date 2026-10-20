// CLI logic for `hermes-ui-bridge` (bin/hermes-ui-bridge.mjs): argument parsing, env files, token state file,
// startup checks and the feature summary. Kept free of side effects at import time so it can be tested.
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, accessSync, constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { metaEnabled } from './meta.mjs';
import { upstreamUrl } from './paths.mjs';
import { docUrl } from './links.mjs';

export const HELP = `hermes-ui-plus-bridge - optional UI bridge for the Hermes Interactive UI+ app

Usage: hermes-ui-plus-bridge [options]   (the old command name hermes-ui-bridge still works)
       hermes-ui-plus-bridge setup | devices ... | routines ... | doctor bots | bots ...

Options:
  --env-file <file>   load KEY=VALUE pairs from a file (repeatable; real environment variables win). The file
                      must exist: Node.js itself checks --env-file and stops with "node: <file>: not found"
                      before the bridge starts. Create it first (install -m 600 /dev/null <file>) or run setup.
  --pair              print a pairing QR code in the terminal on startup
  --port <n>          listen port (BRIDGE_PORT, default 8790)
  --host <addr>       listen address (BRIDGE_HOST, default 127.0.0.1)
  --state-dir <dir>   where the generated token and uploads live (BRIDGE_STATE_DIR)
  --no-check          skip the startup checks against Hermes
  --strict            exit when Hermes is unreachable (default: warn and keep running)
  -v, --version       print the version
  -h, --help          show this help

Setup wizard (run on the Hermes host; re-run to update):
  hermes-ui-plus-bridge setup [--yes] [--dry-run] [--json]   (setup --help for all options)

Device tokens (each paired app gets its own, revocable token; BRIDGE_TOKEN stays the admin token):
  hermes-ui-plus-bridge devices list | add [label] | revoke <id>   [--env-file f] [--state-dir d]
  (without --env-file, the env file written by setup is used if it exists)

Routines (Hermes cron jobs): which bots offer them, and what each paired device may do (default: view only):
  hermes-ui-plus-bridge routines status | enable <bot> | disable <bot>
  hermes-ui-plus-bridge routines grant <device-id> <bot> manage|read|none|default   [--env-file f] [--state-dir d]

Bots (Hermes profiles) on this server, read-only checks and the owner's safety net (docs/BOTS-SERVER.md):
  hermes-ui-plus-bridge doctor bots [--json] | bots backup [--to dir] | bots rollback <backup-dir> [--yes]
  [--hermes-home dir] [--env-file f]
Creating bots from the app (off until you enable it; admin token yes, paired devices only with a grant):
  hermes-ui-plus-bridge bots status | enable | disable | grant <device-id> | revoke <device-id>   [--env-file f] [--state-dir d]

Required: HERMES_BASE_URL (e.g. http://127.0.0.1:8642). Usually also HERMES_API_KEY.
BRIDGE_TOKEN is generated on first run and stored in <state-dir>/state.json (mode 0600) if not set.
Docs:
  Bridge reference   ${docUrl('bridge/README.md')}
  Self-hosting       ${docUrl('docs/SELF-HOSTING.md')}
  Web app            ${docUrl('docs/WEB-APP.md')}`;

/** @param {string[]} argv */
export function parseArgs(argv) {
  const o = { envFiles: [], pair: false, check: true, strict: false, help: false, version: false, port: undefined, host: undefined, stateDir: undefined };
  const val = (i, flag) => {
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline;
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    if (eq > 0) { inline = a.slice(eq + 1); a = a.slice(0, eq); }
    const take = () => { if (inline !== undefined) return inline; const v = val(i, a); i++; return v; };
    switch (a) {
      case '--env-file': o.envFiles.push(take()); break;
      case '--port': {
        const p = Number(take());
        if (!Number.isInteger(p) || p < 0 || p > 65535) throw new Error('--port must be 0-65535');
        o.port = p; break;
      }
      case '--host': o.host = take(); break;
      case '--state-dir': o.stateDir = take(); break;
      case '--pair': o.pair = true; break;
      case '--no-check': o.check = false; break;
      case '--strict': o.strict = true; break;
      case '-h': case '--help': o.help = true; break;
      case '-v': case '--version': o.version = true; break;
      default: throw new Error(`unknown option: ${a} (see --help)`);
    }
  }
  return o;
}

/** Real environment wins over env files; later files win over earlier ones. */
export function loadEnvFiles(files, baseEnv = process.env, cwd = process.cwd()) {
  const fromFiles = {};
  for (const f of files) {
    const p = resolve(cwd, f);
    if (!existsSync(p)) throw new Error(`env file not found: ${p}. Create it first (install -m 600 /dev/null ${p}), or let \`hermes-ui-plus-bridge setup\` write one.`);
    Object.assign(fromFiles, parseEnv(readFileSync(p, 'utf8')));
  }
  return { ...fromFiles, ...Object.fromEntries(Object.entries(baseEnv).filter(([, v]) => v !== undefined)) };
}

export function defaultStateDir(env = process.env) {
  if (env.BRIDGE_STATE_DIR) return resolve(env.BRIDGE_STATE_DIR);
  if (env.XDG_STATE_HOME) return join(env.XDG_STATE_HOME, 'hermes-ui-bridge');
  return join(homedir(), '.local', 'state', 'hermes-ui-bridge');
}

/** Read the token from state.json or create one (file mode 0600, directory 0700). */
export function ensureToken(stateDir) {
  const file = join(stateDir, 'state.json');
  if (existsSync(file)) {
    try {
      const s = JSON.parse(readFileSync(file, 'utf8'));
      if (typeof s.token === 'string' && s.token.length >= 16) return { token: s.token, created: false, file };
    } catch { /* regenerate below */ }
  }
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const token = randomBytes(24).toString('base64url');
  writeFileSync(file, `${JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return { token, created: true, file };
}

/**
 * Apply CLI options and defaults to an env map. Returns the effective env plus info about what was generated.
 * @returns {{env: Record<string,string>, stateDir: string, tokenInfo: null | {created: boolean, file: string}}}
 */
export function prepareEnv(opts, baseEnv = process.env, cwd = process.cwd()) {
  const env = loadEnvFiles(opts.envFiles, baseEnv, cwd);
  if (opts.port !== undefined) env.BRIDGE_PORT = String(opts.port);
  if (opts.host) env.BRIDGE_HOST = opts.host;
  if (opts.stateDir) env.BRIDGE_STATE_DIR = opts.stateDir;
  const stateDir = defaultStateDir(env);
  let tokenInfo = null;
  if (!env.BRIDGE_TOKEN && !/^(1|true|yes|on)$/i.test(env.BRIDGE_ALLOW_NO_AUTH ?? '')) {
    tokenInfo = ensureToken(stateDir);
    env.BRIDGE_TOKEN = tokenInfo.token;
  }
  if (!env.BRIDGE_UPLOAD_DIR) env.BRIDGE_UPLOAD_DIR = join(stateDir, 'uploads');
  if (!env.BRIDGE_STATE_DIR) env.BRIDGE_STATE_DIR = stateDir; // push registrations + watcher cursors (src/push-hermes.mjs)
  return { env, stateDir, tokenInfo };
}

/** Name of the skill the app's answers need in Hermes (hermes-skill/hermes-ui). */
export const UI_SKILL = 'hermes-ui';

/**
 * Startup checks against Hermes. Never throws; returns {level: 'ok'|'info'|'warn'|'error', message}[].
 * `hermesHome`: Hermes home on this machine, only used to look for the skill on disk when `GET /v1/skills` cannot
 * answer (HTTP 500 on Hermes 0.21.5 to 0.22.2) and either HERMES_BASE_URL is a loopback address (same machine) or the
 * home was set explicitly (`hermesHomeExplicit`: HERMES_HOME, e.g. Hermes' data folder mounted read-only into the
 * bridge container).
 */
export async function preflight(config, { fetch: doFetch = fetch, timeoutMs = 5000, hermesHome = '', hermesHomeExplicit = false } = {}) {
  const base = config.upstream.baseUrl;
  const out = [];
  const get = async (path, headers = {}) => {
    try {
      return await doFetch(upstreamUrl(base, path).href, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      return { error: fetchErrorReason(e) };
    }
  };
  const h = await get('/health');
  if (h.error) {
    out.push({ level: 'warn', fatalWhenStrict: true, message: `Hermes not reachable at ${base} (${h.error}). Check HERMES_BASE_URL and that the Hermes gateway runs: \`hermes gateway status\` (started with \`hermes gateway run\` in a terminal? It must still run there; \`hermes gateway restart\` only manages the service).` });
    return out;
  }
  out.push(h.ok ? { level: 'ok', message: `Hermes reachable at ${base} (/health ${h.status})` }
    : { level: 'warn', message: `Hermes answered /health with HTTP ${h.status} (continuing)` });
  const auth = config.upstream.apiKey ? { authorization: `Bearer ${config.upstream.apiKey}` } : {};
  const m = await get('/v1/models', auth);
  if (m.error) out.push({ level: 'warn', message: `/v1/models failed (${m.error})` });
  else if (m.status === 401 || m.status === 403) {
    out.push({ level: 'error', message: `Hermes rejected the key (HTTP ${m.status}). HERMES_API_KEY must equal Hermes' API_SERVER_KEY. `
      + 'If Hermes\' .env has more than one API_SERVER_KEY line, the last one counts (check: grep -c \'^API_SERVER_KEY=\' ~/.hermes/.env).' });
  } else if (!m.ok) out.push({ level: 'warn', message: `/v1/models answered HTTP ${m.status}` });
  else out.push({ level: 'ok', message: config.upstream.apiKey ? 'API key accepted (/v1/models)' : 'Hermes accepts requests without a key' });
  if (m.ok) out.push(await skillCheck(get, auth, { base, hermesHome, explicit: hermesHomeExplicit }));
  return out;
}

/** Is the hermes-ui skill installed in Hermes? Without it every app answer stays plain text (a "Skill not found" tool error). */
async function skillCheck(get, auth, { base, hermesHome, explicit }) {
  const missing = `${UI_SKILL} skill is NOT installed in Hermes: app answers stay plain text (Hermes logs "Skill '${UI_SKILL}' not found"). `
    + 'Install it on the Hermes host with `npx hermes-ui-plus-bridge setup`, or copy hermes-skill/hermes-ui into Hermes\' skills folder '
    + '(Hermes in Docker: docker cp, see docs/SELF-HOSTING.md "With Docker"). No Hermes restart needed; start a new chat.';
  const r = await get('/v1/skills', auth);
  let listed = null;
  if (!r.error && r.ok) {
    try { listed = listedSkill(await r.json()); } catch { listed = null; }
  }
  if (listed === 'enabled') return { level: 'ok', message: `${UI_SKILL} skill installed in Hermes` };
  if (listed === 'disabled') return { level: 'warn', message: `${UI_SKILL} skill is installed in Hermes but disabled: enable it (hermes skills list), else app answers stay plain text.` };
  if (listed === 'missing') return { level: 'warn', message: missing };
  // the list is not available: Hermes 0.21.5 to 0.22.2 answer 500 (upstream issue #120831). Same machine or an
  // explicitly given Hermes home: look on disk.
  const why = r.error ? r.error : `HTTP ${r.status}`;
  const onDisk = isLoopbackUrl(base) || explicit ? skillOnDisk(hermesHome) : null;
  if (onDisk === true) return { level: 'ok', message: `${UI_SKILL} skill found in ${hermesHome}/skills (GET /v1/skills: ${why})` };
  if (onDisk === false) return { level: 'warn', message: missing };
  return { level: 'info', message: `could not check whether the ${UI_SKILL} skill is installed (GET /v1/skills: ${why}); if app answers stay plain text, run \`hermes skills list\` on the Hermes host (bridge in Docker: mount Hermes' data folder read-only and set HERMES_HOME, see docs/SELF-HOSTING.md)` };
}

/**
 * Hermes was not reachable at start (in Docker compose the bridge usually starts before Hermes' gateway is up): check
 * again every `intervalMs` for up to `maxMs` and report the remaining checks (key, skill) once Hermes answers. Never
 * throws; returns a stop function. Timers are unref'd, so they never keep the process alive.
 * @param {() => Promise<{level: string, message: string, fatalWhenStrict?: boolean}[]>} check
 * @param {(lines: {level: string, message: string}[], afterMs: number) => void} report
 */
export function recheckUntilReachable(check, report, { intervalMs = 5000, maxMs = 180_000, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const start = now();
  let timer = null;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    let results = [];
    try { results = await check(); } catch { results = []; }
    if (stopped) return;
    const up = results.length && !results[0].fatalWhenStrict;
    if (up) return report(results, now() - start);
    if (now() - start + intervalMs > maxMs) {
      return report([{ level: 'warn', message: `Hermes is still not reachable after ${Math.round((now() - start) / 1000)} s; the bridge keeps running, and requests reach Hermes as soon as it answers` }], now() - start);
    }
    timer = setTimer(tick, intervalMs);
    timer?.unref?.();
  };
  timer = setTimer(tick, intervalMs);
  timer?.unref?.();
  return () => { stopped = true; if (timer) clearTimer(timer); };
}

/** `[ok]` / `[--]` / `[!!]` / `[XX]` prefix of a startup check line. */
export const checkMark = (level) => ({ ok: 'ok', info: '--', warn: '!!' }[level] ?? 'XX');

/** `GET /v1/skills` body → 'enabled' | 'disabled' | 'missing', or null for an unknown shape. */
export function listedSkill(body) {
  const list = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : Array.isArray(body?.skills) ? body.skills : null;
  if (!list) return null;
  const entry = list.find((s) => (typeof s === 'string' ? s : s?.name ?? s?.id) === UI_SKILL);
  if (!entry) return 'missing';
  return entry?.enabled === false || entry?.disabled === true ? 'disabled' : 'enabled';
}

/**
 * The skill on disk: `<home>/skills/hermes-ui/SKILL.md` or one category level deeper. null = cannot tell (no
 * readable skills folder here, e.g. the bridge runs in its own container or as another user).
 */
export function skillOnDisk(home, { exists = existsSync, readdir = readdirSync } = {}) {
  if (!home) return null;
  const skills = join(home, 'skills');
  if (!exists(skills)) return null;
  if (exists(join(skills, UI_SKILL, 'SKILL.md'))) return true;
  try {
    for (const d of readdir(skills, { withFileTypes: true })) {
      if (d.isDirectory() && exists(join(skills, d.name, UI_SKILL, 'SKILL.md'))) return true;
    }
  } catch { return null; }
  return false;
}

const isLoopbackUrl = (u) => {
  try { return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(u).hostname); } catch { return false; }
};

/**
 * Short, meaningful reason for a failed fetch: undici throws a bare `TypeError: fetch failed` and hides the real cause
 * (ECONNREFUSED, ENOTFOUND, "bad port", an invalid URL) in `cause`, so `e.name` alone printed "(TypeError)".
 */
export function fetchErrorReason(e) {
  const c = e?.cause;
  const code = c?.code || c?.errors?.[0]?.code || e?.code;
  if (code && code !== 'UND_ERR') return String(code);
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'timed out';
  const msg = [c?.message, e?.message].find((m) => m && m !== 'fetch failed');
  // fetch refuses some ports outright (1, 9, 25, 6000, ... "bad port"): Hermes is fine, the port is not usable
  if (msg === 'bad port') return 'port blocked by the fetch API ("bad port"), pick another port for the Hermes API server';
  if (msg) return String(msg).slice(0, 160);
  return e?.message || e?.name || 'error';
}

/**
 * Startup hint how to pair, when no --pair QR was printed. Behind Docker's port mapping the request to /bridge/pair
 * does not arrive from loopback, so "open it on this machine" does not work there; with BRIDGE_PAIRING=1 the page
 * needs the one-time page code from the log line above (`/bridge/pair?code=…`). The `docker compose exec` form only
 * fits the official image (HUI_BRIDGE_IMAGE=1, set in bridge/Dockerfile); npx inside any other container gets the
 * npx command.
 * @param {{port: number, pairingEnabled?: boolean, inImage?: boolean, inContainer?: boolean, cli?: string, envFile?: string}} o
 */
export function pairHint({ port, pairingEnabled = false, inImage = false, inContainer = false, cli = 'npx hermes-ui-plus-bridge', envFile = '' }) {
  const add = inImage
    ? 'docker compose exec bridge node bin/hermes-ui-bridge.mjs devices add "Phone"'
    : `${cli} devices add "Phone"${envFile ? ` --env-file ${envFile}` : ''}`;
  if (pairingEnabled) {
    return `Pair the app: open the /bridge/pair?code=... path from the "pairing enabled" log line above on the bridge URL `
      + `(that page code works once within 10 minutes; the pair link the page shows works once within 1 hour), or run: ${add}`;
  }
  if (inImage || inContainer) return `Pair the app: run ${add} (a one-time pair link, valid 1 hour)`;
  return `Pair the app: restart with --pair, run ${add}, or open http://127.0.0.1:${port}/bridge/pair on this machine.`;
}

/** Official bridge image (bridge/Dockerfile sets HUI_BRIDGE_IMAGE=1). */
export const inBridgeImage = (env = process.env) => env.HUI_BRIDGE_IMAGE === '1';

const writable = (dir) => { try { accessSync(dir, constants.W_OK); return true; } catch { return false; } };

/**
 * Which optional extras call a provider DIRECTLY from the bridge (outside Hermes), by provider name. Names only, never
 * keys. Empty object = pure Hermes pass-through. Push is not listed (it is a normal feature, not a thinking extra).
 * @param {Record<string,string|undefined>} env
 * @param {string} routerKind  effective router kind (config.router.kind), e.g. "anthropic", "jev,anthropic", "heuristic"
 * @returns {{router?: string, meta?: string, images?: string, voice?: string}}
 */
export function directProviders(env, routerKind = 'heuristic') {
  const out = {};
  const router = [];
  for (const k of String(routerKind).split(',')) {
    if (k === 'anthropic' && env.ANTHROPIC_API_KEY) router.push('claude');
    else if (k === 'jev' && env.TYPESAFE_API_KEY) router.push('jev');
    else if (k === 'nace' && env.NACE_API_KEY) router.push('nace');
    else if (k === 'openai' && env.BRIDGE_ROUTER_BASE_URL) router.push('openai-compatible');
  }
  if (router.length) out.router = router.join('>');
  if (metaEnabled(env)) out.meta = 'claude';
  const images = (env.BRIDGE_IMAGE_PROVIDERS || 'serper,brave').toLowerCase().split(/[,\s>]+/)
    .filter((p) => (p === 'serper' && env.SERPER_API_KEY) || (p === 'brave' && env.BRAVE_API_KEY));
  if (images.length) out.images = images.join('>');
  const stt = (env.BRIDGE_STT_PROVIDER || 'groq').toLowerCase();
  const sttKey = { groq: env.GROQ_API_KEY, openai: env.OPENAI_API_KEY }[stt];
  const ttsKeyed = { deepgram: env.DEEPGRAM_API_KEY, elevenlabs: env.ELEVENLABS_API_KEY, openai: env.OPENAI_API_KEY };
  const ttsPick = (env.BRIDGE_TTS_PROVIDER || '').toLowerCase().replace('deepgram-aura', 'deepgram');
  const tts = ttsPick ? (ttsKeyed[ttsPick] ? ttsPick : '') : ['deepgram', 'elevenlabs', 'openai'].find((p) => ttsKeyed[p]) ?? '';
  const voice = [sttKey ? stt : '', tts].filter(Boolean);
  if (voice.length) out.voice = [...new Set(voice)].join('/');
  return out;
}

/** One line for the startup log and the setup report. */
export function directProvidersLine(providers) {
  const parts = Object.entries(providers).map(([k, v]) => `${k}=${v}`);
  return parts.length ? `direct providers: ${parts.join(', ')} (called from the bridge, outside Hermes)` : 'direct providers: none (pure Hermes pass-through)';
}

/** Which optional features are active (one line each). */
export function featureSummary(config, env, { pairing, profiles } = {}) {
  const lines = [];
  const r = config.router;
  const direct = directProviders(env, r.kind);
  lines.push(['router', r.kind === 'off' ? 'off (plain pass-through)' : `${r.kind}${r.kind === 'heuristic' ? ' (no model, rule based)' : ''}`]);
  const up = env.BRIDGE_UPLOAD_DIR;
  lines.push(['uploads', up ? `on, ${up}${existsSync(up) ? (writable(up) ? '' : ' (NOT writable)') : ' (created on first upload)'}` : 'on']);
  const stt = (env.BRIDGE_STT_PROVIDER || 'groq').toLowerCase();
  const sttKey = { groq: env.GROQ_API_KEY, openai: env.OPENAI_API_KEY }[stt];
  const ttsKeys = ['DEEPGRAM_API_KEY', 'ELEVENLABS_API_KEY', 'OPENAI_API_KEY'].filter((k) => env[k]);
  lines.push(['voice', `${sttKey ? `speech-to-text via ${stt}` : 'speech-to-text off (no key)'}, ${ttsKeys.length ? 'text-to-speech on' : 'text-to-speech off (no key)'}`]);
  const metaOn = /^(on|1|true|yes)$/i.test((env.BRIDGE_META ?? '').trim());
  lines.push(['meta', direct.meta ? 'on (titles & follow-ups via Claude)' : metaOn ? 'off (BRIDGE_META=on needs ANTHROPIC_API_KEY)' : 'off (opt-in: BRIDGE_META=on + ANTHROPIC_API_KEY)']);
  // not a provider: no key, no model; it only fetches pictures that Hermes' own tools returned (src/image-proxy.mjs)
  lines.push(['images', /^(off|0|false|no)$/i.test((env.BRIDGE_IMAGE_PROXY ?? '').trim()) ? 'proxy off (BRIDGE_IMAGE_PROXY=off)' : 'proxy on (pictures from Hermes answers, fetched by the bridge)']);
  const inline = config.skillInline ? ' + skill core inline' : config.skillInlineMissing ? ` (skill core inline MISSING: ${config.skillInlineMissing})` : ' (skill core inline off)';
  const caps = config.caps ? `, caps ${Object.entries(config.caps).map(([k, v]) => `${k}=${v}`).join(' ')}` : '';
  lines.push(['skill', config.bootstrap ? `bootstrap message on${inline}${caps} (the hermes-ui skill triggers for app chats)`
    : config.bootstrapMissing ? `bootstrap message MISSING (${config.bootstrapMissing}): no interactive components, see the warning above`
      : 'bootstrap message off (BRIDGE_BOOTSTRAP=off)']);
  lines.push(['pairing', pairing ? (pairing.isEnabled() ? 'remote pairing enabled (BRIDGE_PAIRING=1)' : 'local only') : 'n/a']);
  lines.push(['extras', directProvidersLine(direct)]);
  // routines (src/routines-rights.mjs): bots are opt-in; the device registry can enable more than the env lists
  const rb = config.routinesBots ?? { all: false, names: [] };
  const bots = [...(rb.all ? ['*'] : []), ...rb.names].join(',');
  lines.push(['routines', config.routines === 'off' ? 'off (BRIDGE_ROUTINES=off)'
    : `${config.routines ?? 'control'}, bots ${bots || 'none from BRIDGE_ROUTINES_BOTS'} (more: \`routines enable <bot>\`)`]);
  if (profiles) {
    const n = profiles.names().length;
    const desc = { off: 'off (BRIDGE_PROFILES=off)', any: 'any /p/<name>/ (Hermes home not readable; Hermes decides)', auto: `auto, ${n} besides default`, list: `${n} besides default (BRIDGE_PROFILES)` };
    lines.push(['bots', desc[profiles.mode] ?? profiles.mode]);
  }
  return lines;
}
