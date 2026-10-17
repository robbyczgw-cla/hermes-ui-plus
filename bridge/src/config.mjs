// Environment -> config. All secrets stay server-side; nothing here is ever logged verbatim.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkillInline } from './skillInline.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// Source checkout: ../hermes-skill (wins, it is the source of truth); npm package: skill/ bundled by scripts/bundle-skill.mjs (prepack).
export const BUNDLED_SKILL_DIR = resolve(here, '../skill');
export const REPO_SKILL_DIR = resolve(here, '../../hermes-skill');
export const DEFAULT_BOOTSTRAP_FILE = [REPO_SKILL_DIR, BUNDLED_SKILL_DIR]
  .map((d) => resolve(d, 'bootstrap-system-message.txt'))
  .find((f) => existsSync(f)) ?? resolve(REPO_SKILL_DIR, 'bootstrap-system-message.txt');

// SKILL.md for the inline skill core when it is not next to the bootstrap message: repo checkout, then npm bundle.
export const DEFAULT_SKILL_FILES = [REPO_SKILL_DIR, BUNDLED_SKILL_DIR].map((d) => resolve(d, 'hermes-ui', 'SKILL.md'));

const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

/** Strip a trailing /v1 so we can map /v1/* and /health 1:1 onto the upstream origin. */
export function normalizeBaseUrl(u) {
  const url = new URL(u);
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

/**
 * @param {Record<string, string|undefined>} env
 * @param {{defaultBootstrapFile?: string, skillFiles?: string[]}} [o]  tests: override where the bundled bootstrap
 *   message / SKILL.md are expected
 */
export function loadConfig(env = process.env, o = {}) {
  if (!env.HERMES_BASE_URL) throw new Error('HERMES_BASE_URL is required');
  const allowNoAuth = bool(env.BRIDGE_ALLOW_NO_AUTH, false);
  if (!env.BRIDGE_TOKEN && !allowNoAuth) throw new Error('BRIDGE_TOKEN is required (or BRIDGE_ALLOW_NO_AUTH=1 for local dev)');

  // ROUTER_BACKEND: one backend or a fallback chain, e.g. "jev,claude" or "nace,claude". The heuristic is always
  // the final fallback. Aliases: claude = anthropic. BRIDGE_ROUTER is accepted as a synonym.
  // Model routers are a direct-provider extra and only run when ROUTER_BACKEND names them: a provider key that merely
  // exists in the environment (e.g. ANTHROPIC_API_KEY exported in the user's shell) never turns one on.
  let routerKind = (env.ROUTER_BACKEND || env.BRIDGE_ROUTER || '').toLowerCase().replace(/\s+/g, '');
  if (!routerKind) routerKind = 'heuristic';
  const chain = routerKind.split(/[,>]/).filter(Boolean).map((k) => (k === 'claude' ? 'anthropic' : k));
  for (const k of chain) {
    if (!['anthropic', 'openai', 'heuristic', 'jev', 'nace', 'off'].includes(k)) throw new Error(`ROUTER_BACKEND entries must be jev|nace|claude|openai|heuristic|off, got ${k}`);
  }
  // `heuristic` leading a chain = heuristic-first mode ("heuristic,jev"): the model is only asked when no heuristic
  // rule fired or the language is not de/en/es. Anywhere else heuristic/off make no sense (heuristic is always last).
  const heuristicFirst = chain.length > 1 && chain[0] === 'heuristic';
  if (chain.length > 1 && chain.slice(heuristicFirst ? 1 : 0).some((k) => k === 'off' || k === 'heuristic')) throw new Error('ROUTER_BACKEND chain may only contain jev|nace|claude|openai, optionally led by heuristic (heuristic-first)');
  routerKind = chain.join(',');
  const effort = (env.ROUTER_EFFORT || env.BRIDGE_ROUTER_EFFORT || 'low').toLowerCase();
  if (!['low', 'medium', 'high'].includes(effort)) throw new Error('ROUTER_EFFORT must be low|medium|high');
  const thinking = (env.BRIDGE_ROUTER_THINKING || 'adaptive').toLowerCase();
  if (!['adaptive', 'disabled', 'between_tools'].includes(thinking)) throw new Error('BRIDGE_ROUTER_THINKING must be adaptive|disabled|between_tools');

  let extraBody;
  if (env.BRIDGE_ROUTER_EXTRA_BODY) {
    try { extraBody = JSON.parse(env.BRIDGE_ROUTER_EXTRA_BODY); } catch { throw new Error('BRIDGE_ROUTER_EXTRA_BODY must be JSON'); }
  }

  let bootstrap = null;
  // Path of the expected but missing default bootstrap file ('' = found or switched off). Without it the skill never
  // triggers on bridge connections (the app sends no bootstrap itself there), so the server warns loudly at startup.
  let bootstrapMissing = '';
  let bootstrapFile = '';
  const bootstrapSetting = env.BRIDGE_BOOTSTRAP ?? '';
  if (!/^(0|off|false|no)$/i.test(bootstrapSetting)) {
    const file = env.BRIDGE_BOOTSTRAP_FILE || o.defaultBootstrapFile || DEFAULT_BOOTSTRAP_FILE;
    if (existsSync(file)) { bootstrap = readFileSync(file, 'utf8').trim(); bootstrapFile = file; }
    else if (env.BRIDGE_BOOTSTRAP_FILE) throw new Error(`BRIDGE_BOOTSTRAP_FILE not found: ${file}`);
    else bootstrapMissing = file;
  }

  return {
    host: env.BRIDGE_HOST || '127.0.0.1',
    port: num(env.BRIDGE_PORT, 8790),
    token: env.BRIDGE_TOKEN || '',
    allowNoAuth,
    corsOrigins: (env.BRIDGE_CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    upstream: { baseUrl: normalizeBaseUrl(env.HERMES_BASE_URL), apiKey: env.HERMES_API_KEY || '' },
    maxBodyBytes: num(env.BRIDGE_MAX_BODY_BYTES, 25 * 1024 * 1024),
    // GPT security M5: concurrent chat turns per credential and in total (a turn counts until Hermes finished it, also
    // after the app disconnected); unauthenticated health passthroughs in flight
    limits: {
      chatHeaderTimeoutMs: Math.max(1, num(env.BRIDGE_CHAT_HEADER_TIMEOUT_MS, 60_000)),
      turnMaxMs: Math.max(1, num(env.BRIDGE_TURN_MAX_MS, 2 * 3600_000)),
      maxConcurrentTurns: Math.max(1, num(env.BRIDGE_MAX_CONCURRENT_TURNS, 8)),
      maxTurnsTotal: Math.max(1, num(env.BRIDGE_MAX_TURNS_TOTAL, 16)),
      maxHealthInFlight: Math.max(1, num(env.BRIDGE_MAX_HEALTH_INFLIGHT, 4)),
      // non-streaming pass-through routes (/health, sessions, models, run status, approval answers)
      apiTimeoutMs: Math.max(1000, num(env.BRIDGE_UPSTREAM_TIMEOUT_MS, 30_000)),
    },
    // idempotent send + stream resume for chat turns with an Idempotency-Key (src/replay.mjs); BRIDGE_RESUME=off disables it
    resume: {
      enabled: bool(env.BRIDGE_RESUME, true),
      maxTurnBytes: Math.max(64 * 1024, num(env.BRIDGE_RESUME_TURN_KB, 2048) * 1024),
      maxTotalBytes: Math.max(1024 * 1024, num(env.BRIDGE_RESUME_TOTAL_MB, 32) * 1024 * 1024),
      retainMs: Math.max(0, num(env.BRIDGE_RESUME_RETAIN_MS, 10 * 60_000)),
    },
    drainMs: Math.max(1, num(env.BRIDGE_DRAIN_MS, 120_000)),
    logLevel: env.BRIDGE_LOG_LEVEL || 'info',
    router: {
      kind: routerKind,
      chain,
      mode: /** @type {'model-first'|'heuristic-first'} */ (heuristicFirst ? 'heuristic-first' : 'model-first'),
      baseUrl: env.BRIDGE_ROUTER_BASE_URL || '',
      apiKey: env.BRIDGE_ROUTER_API_KEY || '',
      model: env.BRIDGE_ROUTER_MODEL || '',
      anthropicApiKey: env.ANTHROPIC_API_KEY || '',
      anthropicModel: env.ROUTER_CLAUDE_MODEL || (chain.includes('openai') ? '' : env.BRIDGE_ROUTER_MODEL) || 'claude-haiku-5-5',
      effort: /** @type {'low'|'medium'|'high'} */ (effort),
      thinking: /** @type {'adaptive'|'disabled'|'between_tools'} */ (thinking),
      maxTokens: env.BRIDGE_ROUTER_MAX_TOKENS ? num(env.BRIDGE_ROUTER_MAX_TOKENS, 0) : undefined,
      jsonMode: /** @type {'schema'|'json'|'none'} */ (env.BRIDGE_ROUTER_JSON_MODE || 'schema'),
      extraBody,
      timeoutMs: num(env.BRIDGE_ROUTER_TIMEOUT_MS, 2000),
      fastPathMin: /^(off|0|false)$/i.test(env.BRIDGE_ROUTER_FASTPATH_MIN ?? '') ? 0 : num(env.BRIDGE_ROUTER_FASTPATH_MIN, 0.85),
      fallback: /** @type {'heuristic'|'neutral'} */ (env.BRIDGE_ROUTER_FALLBACK === 'neutral' ? 'neutral' : 'heuristic'),
      jevApiKey: env.TYPESAFE_API_KEY || '',
      jevModel: env.JEV_MODEL || 'jev-latest',
      jevBaseUrl: env.JEV_BASE_URL || '',
      naceApiKey: env.NACE_API_KEY || '',
      naceModel: env.NACE_MODEL || 'drex-v2.0',
      naceBaseUrl: env.NACE_BASE_URL || '',
      cacheSize: num(env.BRIDGE_ROUTER_CACHE_SIZE, 2000),
      cacheTtlMs: num(env.BRIDGE_ROUTER_CACHE_TTL_MS, 3600_000),
      contextMaxChars: num(env.BRIDGE_CONTEXT_MAX_CHARS, 2000),
      routeNonStream: bool(env.BRIDGE_ROUTE_NONSTREAM, true),
    },
    hint: {
      mode: /** @type {'auto'|'on'|'off'} */ ((env.BRIDGE_HINT || 'auto').toLowerCase()),
      minConfidence: num(env.BRIDGE_HINT_MIN_CONFIDENCE, 0.5),
      textMinConfidence: num(env.BRIDGE_HINT_TEXT_MIN_CONFIDENCE, 0.75),
      includeReason: bool(env.BRIDGE_HINT_REASON, false),
    },
    bootstrap,
    bootstrapMissing,
    // skill core inline after the bootstrap on app turns (src/skillInline.mjs): skillInline, skillInlineFile, skillInlineMissing
    ...loadSkillInline(env, { bootstrap, bootstrapFile, candidates: o.skillFiles ?? DEFAULT_SKILL_FILES }),
    memory: {
      enabled: bool(env.BRIDGE_CONTEXT_MEMORY, true),
      maxSessions: num(env.BRIDGE_CONTEXT_MAX_SESSIONS, 500),
      ttlMs: num(env.BRIDGE_CONTEXT_TTL_MS, 24 * 3600_000),
    },
  };
}
