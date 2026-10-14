// CLI logic for `hermes-ui-bridge` (bin/hermes-ui-bridge.mjs): argument parsing, env files, token state file,
// startup checks and the feature summary. Kept free of side effects at import time so it can be tested.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, accessSync, constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { metaEnabled } from './meta.mjs';
import { upstreamUrl } from './paths.mjs';

export const HELP = `hermes-ui-plus-bridge - optional UI bridge for the Hermes Interactive UI+ app

Usage: hermes-ui-plus-bridge [options]   (the old command name hermes-ui-bridge still works)
       hermes-ui-plus-bridge setup | devices ...

Options:
  --env-file <file>   load KEY=VALUE pairs from a file (repeatable; real environment variables win)
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

Required: HERMES_BASE_URL (e.g. http://127.0.0.1:8642). Usually also HERMES_API_KEY.
BRIDGE_TOKEN is generated on first run and stored in <state-dir>/state.json (mode 0600) if not set.
Docs: bridge/README.md`;

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
    if (!existsSync(p)) throw new Error(`env file not found: ${p}`);
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

/** Startup checks against Hermes. Never throws; returns {level: 'ok'|'warn'|'error', message}[]. */
export async function preflight(config, { fetch: doFetch = fetch, timeoutMs = 5000 } = {}) {
  const base = config.upstream.baseUrl;
  const out = [];
  const get = async (path, headers = {}) => {
    try {
      return await doFetch(upstreamUrl(base, path).href, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      return { error: e?.cause?.code || e?.cause?.errors?.[0]?.code || e?.name || 'error' };
    }
  };
  const h = await get('/health');
  if (h.error) {
    out.push({ level: 'warn', fatalWhenStrict: true, message: `Hermes not reachable at ${base} (${h.error}). Check HERMES_BASE_URL and that the Hermes API server is running.` });
    return out;
  }
  out.push(h.ok ? { level: 'ok', message: `Hermes reachable at ${base} (/health ${h.status})` }
    : { level: 'warn', message: `Hermes answered /health with HTTP ${h.status} (continuing)` });
  const m = await get('/v1/models', config.upstream.apiKey ? { authorization: `Bearer ${config.upstream.apiKey}` } : {});
  if (m.error) out.push({ level: 'warn', message: `/v1/models failed (${m.error})` });
  else if (m.status === 401 || m.status === 403) out.push({ level: 'error', message: `Hermes rejected the key (HTTP ${m.status}). Check HERMES_API_KEY (Hermes API_SERVER_KEY).` });
  else if (!m.ok) out.push({ level: 'warn', message: `/v1/models answered HTTP ${m.status}` });
  else out.push({ level: 'ok', message: config.upstream.apiKey ? 'API key accepted (/v1/models)' : 'Hermes accepts requests without a key' });
  return out;
}

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
export function featureSummary(config, env, { pairing } = {}) {
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
  lines.push(['skill', config.bootstrap ? 'bootstrap message on (the hermes-ui skill triggers for app chats)'
    : config.bootstrapMissing ? `bootstrap message MISSING (${config.bootstrapMissing}): no interactive components, see the warning above`
      : 'bootstrap message off (BRIDGE_BOOTSTRAP=off)']);
  lines.push(['pairing', pairing ? (pairing.isEnabled() ? 'remote pairing enabled (BRIDGE_PAIRING=1)' : 'local only') : 'n/a']);
  lines.push(['extras', directProvidersLine(direct)]);
  return lines;
}
