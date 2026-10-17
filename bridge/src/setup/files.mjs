// `hermes-ui-plus-bridge setup`, file half: the bridge env file (merge, serialize, write 0600) and the skill
// install with backup. Pure helpers + small fs wrappers (tested in test/setup.test.mjs).
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { parseEnv } from 'node:util';
import { BUNDLED_SKILL_DIR, REPO_SKILL_DIR } from '../config.mjs';
import { tempNameFor, writeFileAtomicSync } from '../atomic-write.mjs';

/** Default location of the env file the wizard writes. */
export function defaultEnvFile(env = process.env, home = homedir(), { root = false } = {}) {
  if (root) return '/etc/hermes-ui-plus-bridge/env';
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'hermes-ui-plus-bridge', 'env');
}

/** Keys whose values are secrets (never printed, masked in --dry-run / --json). */
export const SECRET_KEYS = new Set([
  'HERMES_API_KEY', 'BRIDGE_TOKEN', 'ANTHROPIC_API_KEY', 'TYPESAFE_API_KEY', 'NACE_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY',
  'DEEPGRAM_API_KEY', 'ELEVENLABS_API_KEY', 'SERPER_API_KEY', 'BRAVE_API_KEY', 'BRIDGE_PUSH_VAPID_PRIVATE_KEY',
  'BRIDGE_ROUTER_API_KEY', 'BRIDGE_PUSH_HOOK_SECRET',
]);

/** Credential-looking names that are NOT secrets (ids, public keys, file paths, switches). */
const NON_SECRET_KEYS = new Set(['BRIDGE_PUSH_VAPID_PUBLIC_KEY', 'BRIDGE_PUSH_APNS_KEY_ID', 'BRIDGE_ROUTER_MAX_TOKENS', 'BRIDGE_DEVICE_TOKENS', 'BRIDGE_ALLOW_NO_AUTH']);
const SECRET_LIKE = /(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|(^|_)KEY$|API_?KEY)/i;

/** GPT security M3 / Astra F14: known secrets plus every unknown credential-looking key are masked by default. */
export function isSecretKey(k) {
  if (SECRET_KEYS.has(k)) return true;
  if (NON_SECRET_KEYS.has(k) || /_FILE$/.test(k)) return false;
  return SECRET_LIKE.test(k);
}

/** Order of known keys in the written file (unknown keys follow, sorted). */
const ORDER = [
  'HERMES_BASE_URL', 'HERMES_API_KEY', 'BRIDGE_PUBLIC_URL', 'BRIDGE_NAME', 'BRIDGE_HOST', 'BRIDGE_PORT', 'BRIDGE_STATE_DIR',
  'BRIDGE_WEB_DIR', 'ROUTER_BACKEND', 'ANTHROPIC_API_KEY', 'TYPESAFE_API_KEY', 'NACE_API_KEY', 'SERPER_API_KEY', 'BRAVE_API_KEY',
  'GROQ_API_KEY', 'DEEPGRAM_API_KEY', 'BRIDGE_PUSH_VAPID_PUBLIC_KEY', 'BRIDGE_PUSH_VAPID_PRIVATE_KEY', 'BRIDGE_PUSH_VAPID_SUBJECT',
];

/** Parse an existing env file ({} when missing or unreadable). */
export function readEnvFile(file) {
  try { return existsSync(file) ? { ...parseEnv(readFileSync(file, 'utf8')) } : {}; } catch { return {}; }
}

/**
 * Merge wizard answers into an existing env map. `undefined` keeps the existing value, `''` / null removes it.
 * @returns {{env: Record<string,string>, changed: string[]}}  changed = keys whose value differs
 */
export function mergeEnv(existing, updates) {
  const env = { ...existing };
  const changed = [];
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) continue;
    if (v === '' || v === null) {
      if (k in env) { delete env[k]; changed.push(k); }
      continue;
    }
    if (env[k] !== String(v)) { env[k] = String(v); changed.push(k); }
  }
  return { env, changed };
}

/** One value in a form both node's parseEnv and systemd's EnvironmentFile read back identically. */
export function quoteEnvValue(v) {
  const s = String(v);
  if (/[\r\n\0]/.test(s)) throw new Error('env values must be single-line');
  if (/^[A-Za-z0-9_./:@+=,%~-]*$/.test(s)) return s;
  if (!s.includes("'")) return `'${s}'`;
  // node's parseEnv and systemd disagree on backslash escapes inside double quotes: only accept the safe case
  if (!/["\\]/.test(s)) return `"${s}"`;
  throw new Error('env value contains both quote types or a backslash; set it by hand');
}

/** Serialize an env map (stable order, header comment). */
export function serializeEnv(env, { header = 'Hermes UI+ Bridge settings, written by `hermes-ui-plus-bridge setup` (re-run it to update). Keep this file private (0600).' } = {}) {
  const keys = Object.keys(env).filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
  const known = ORDER.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !ORDER.includes(k)).sort();
  const lines = header ? header.split('\n').map((l) => `# ${l}`) : [];
  for (const k of [...known, ...rest]) lines.push(`${k}=${quoteEnvValue(env[k])}`);
  return `${lines.join('\n')}\n`;
}

/** Env map with secrets masked (for --dry-run / --json / logs). */
export function redactEnv(env) {
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, isSecretKey(k) && v ? `<set, ${String(v).length} chars>` : v]));
}

/** Atomic write with mode 0600 (directory 0700 when created). */
export function writeEnvFile(file, env) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileAtomicSync(file, serializeEnv(env), { mode: 0o600, beforeRename: (tmp) => chmodSync(tmp, 0o600) });
  chmodSync(file, 0o600);
  return file;
}

// ---------- skill ----------

/** Where the skill to install comes from: the source checkout, else the copy bundled in the npm package. */
export function findSkillSource(candidates = [join(REPO_SKILL_DIR, 'hermes-ui'), join(BUNDLED_SKILL_DIR, 'hermes-ui')]) {
  return candidates.find((d) => existsSync(join(d, 'SKILL.md'))) ?? null;
}

/** `version:` from SKILL.md frontmatter ('' when unknown). */
export function skillVersion(dir) {
  try {
    const m = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
    return m ? (/^version:\s*["']?([^"'\n]+)/m.exec(m[1])?.[1] ?? '').trim() : '';
  } catch { return ''; }
}

/** Content hash of a directory tree (relative paths + bytes); null when missing. */
export function treeHash(dir) {
  if (!existsSync(dir)) return null;
  const h = createHash('sha256');
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) { h.update(relative(dir, p)); h.update('\0'); h.update(readFileSync(p)); h.update('\0'); }
    }
  };
  walk(dir);
  return h.digest('hex');
}

/**
 * Plan a skill install into `<skillsDir>/hermes-ui`: 'install' (missing), 'update' (differs, backup first) or
 * 'current' (identical, nothing to do).
 */
export function planSkillInstall(src, skillsDir) {
  const dest = join(skillsDir, 'hermes-ui');
  const have = treeHash(dest);
  const want = treeHash(src);
  const action = have === null ? 'install' : have === want ? 'current' : 'update';
  return { src, dest, action, from: have === null ? '' : skillVersion(dest), to: skillVersion(src) };
}

/**
 * Execute a plan. Backups go OUTSIDE the skills dir (`<hermesHome>/skill-backups/hermes-ui-<stamp>`) so Hermes
 * never indexes them as a second skill.
 */
export function installSkill(plan, { backupRoot, now = () => new Date() } = {}) {
  if (plan.action === 'current') return { ...plan, backup: '' };
  let backup = '';
  if (plan.action === 'update') {
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    backup = join(backupRoot ?? join(dirname(dirname(plan.dest)), 'skill-backups'), `hermes-ui-${stamp}`);
    mkdirSync(dirname(backup), { recursive: true, mode: 0o700 });
    cpSync(plan.dest, backup, { recursive: true });
  }
  mkdirSync(dirname(plan.dest), { recursive: true });
  const tmp = tempNameFor(plan.dest);
  mkdirSync(tmp, { mode: 0o755 }); // not recursive: fails if anything already sits at the random name
  cpSync(plan.src, tmp, { recursive: true });
  rmSync(plan.dest, { recursive: true, force: true });
  renameSync(tmp, plan.dest);
  return { ...plan, backup };
}
