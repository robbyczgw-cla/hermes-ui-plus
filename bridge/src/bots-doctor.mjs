// Bots on the Hermes server (Hermes profiles as bots, docs/BOTS-SERVER.md): `hermes-ui-plus-bridge doctor bots`
// (read-only checks) and `bots backup` / `bots rollback` (the owner's safety net around the one-time server steps).
//
// The app never changes the server here. Turning on `gateway.multiplex_profiles` and enabling plugins stay owner steps
// with a gateway restart; on Hermes v0.22 such a restart can let Hermes' package manager pick a new dependency env
// (`installs/<key>/facts.json`) without aiohttp, which takes the API server down. The doctor shows exactly the facts that
// decide this (multiplex switch, per-profile API_SERVER_KEY, the gateway's venv, facts.json files); backup / rollback
// cover `installs/*/facts.json`, which a plain config backup misses.
//
// Pure functions with injectable fs / proc readers (test/bots-doctor.test.mjs). Secrets are compared, never printed.
import { copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';
import { listProfiles, parseYamlSubset } from './setup/detect.mjs';

const CONFIG_MAX = 512 * 1024;
/** per-profile files a bot is made of (backup / rollback scope next to the root config) */
export const PROFILE_FILES = ['config.yaml', '.env', 'profile.yaml', 'SOUL.md'];
export const ROOT_FILES = ['config.yaml', '.env'];
const BACKUP_MANIFEST = 'manifest.json';

const realFs = { existsSync, readFileSync, readdirSync, statSync };

function readText(fs, file) {
  try {
    if (!fs.existsSync(file)) return null;
    if (fs.statSync(file).size > CONFIG_MAX) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function envOf(text) {
  if (!text) return {};
  try { return parseEnv(text); } catch { return {}; }
}

const truthy = (v) => v === true || /^(1|true|yes|on)$/i.test(String(v ?? ''));

/** `gateway.multiplex_profiles` of a config.yaml text: true / false / undefined (not set). */
export function multiplexSetting(yamlText) {
  if (!yamlText) return undefined;
  const v = parseYamlSubset(yamlText)?.gateway?.multiplex_profiles;
  if (v === undefined || v === null) return undefined;
  return truthy(v);
}

/** Is a plugin listed under `plugins.enabled` (block list `- name` or flow list `[a, b]`)? Line-based, YAML subset. */
export function pluginEnabled(yamlText, name) {
  if (!yamlText) return false;
  const lines = String(yamlText).split(/\r?\n/);
  let inPlugins = -1;
  let inEnabled = -1;
  for (const raw of lines) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (inEnabled >= 0 && indent <= inEnabled && !line.startsWith('- ')) inEnabled = -1;
    if (inPlugins >= 0 && indent <= inPlugins) { inPlugins = -1; inEnabled = -1; }
    if (indent === 0 && /^plugins\s*:\s*$/.test(line)) { inPlugins = indent; continue; }
    if (inPlugins >= 0) {
      const m = /^enabled\s*:\s*(.*)$/.exec(line);
      if (m) {
        const flow = m[1].trim();
        if (flow.startsWith('[')) return flow.replace(/[[\]'"]/g, '').split(',').map((s) => s.trim()).includes(name);
        inEnabled = indent;
        continue;
      }
      if (inEnabled >= 0 && line.startsWith('- ') && line.slice(2).trim().replace(/['"]/g, '') === name) return true;
    }
  }
  return false;
}

/** `ui_meta['hermes-bots']` of a profile.yaml (Hermes Desktop's bot mode): title / description, or null. */
export function desktopBotMeta(profileYaml) {
  if (!profileYaml) return null;
  const y = parseYamlSubset(profileYaml);
  const meta = y?.ui_meta?.['hermes-bots'];
  if (!meta || typeof meta !== 'object') return null;
  const title = typeof meta.title === 'string' ? meta.title.slice(0, 60) : undefined;
  return { ...(title ? { title } : {}), hidden: truthy(meta.hidden) };
}

/**
 * Is this `/proc/<pid>/cmdline` a Hermes gateway? A Python interpreter or the `hermes` launcher with `gateway run` in its
 * arguments (`python -m hermes_cli.main gateway run`, `hermes [-p name] gateway run`, `.../hermes_cli/main.py gateway run`).
 * Not a shell, editor or log viewer that merely names it (`tail -f ~/.hermes/logs/gateway.log`,
 * `journalctl -u hermes-gateway -f`, `bash -c "systemctl restart hermes-gateway"`), and never this tool itself.
 */
export function isGatewayCmdline(cmdline) {
  const argv = String(cmdline ?? '').trim().split(/\s+/);
  const exe = (argv[0] ?? '').split('/').pop() ?? '';
  if (!/^(python[\d.]*|hermes)$/.test(exe) || !/hermes/i.test(cmdline)) return false;
  for (let i = 1; i < argv.length - 1; i++) if (argv[i] === 'gateway' && argv[i + 1] === 'run') return true;
  return false;
}

/** Hermes gateway processes from a `/proc` listing (isGatewayCmdline). */
export function findGatewayPids(procs) {
  return procs.filter((p) => isGatewayCmdline(p.cmdline)).map((p) => p.pid);
}

/**
 * What a gateway's `/proc/<pid>/maps` says: the Python environments it loaded (prefix before `/lib/python3.x/`),
 * whether aiohttp is loaded (the API server needs it) and whether anything comes from `<hermesHome>/installs/`
 * (a package-manager env: the 2026-10-15 trap).
 */
export function analyzeMaps(maps, hermesHome) {
  const envs = new Set();
  let aiohttp = false;
  let fromInstalls = 0;
  const installs = `${hermesHome.replace(/\/+$/, '')}/installs/`;
  for (const line of String(maps).split('\n')) {
    const at = line.indexOf('/');
    if (at < 0) continue;
    const path = line.slice(at).trim();
    const m = /^(.*?)\/lib\/python3[.\d]*\//.exec(path);
    if (m) envs.add(m[1]);
    if (/\/aiohttp\//.test(path)) aiohttp = true;
    if (path.startsWith(installs)) fromInstalls++;
  }
  return { envs: [...envs].sort(), aiohttp, fromInstalls };
}

/** `installs/<key>/facts.json` files below the Hermes home (package-manager env selectors). */
export function factsFiles(home, fs = realFs) {
  const dir = join(home, 'installs');
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((k) => /^[A-Za-z0-9._-]{1,128}$/.test(k))
      .map((k) => join(dir, k, 'facts.json'))
      .filter((f) => { try { return fs.existsSync(f); } catch { return false; } })
      .sort();
  } catch {
    return [];
  }
}

/** Real `/proc` reader (Linux). Unreadable entries are skipped; `maps` returns null when not permitted. */
export const realProc = {
  available: () => existsSync('/proc/self/maps'),
  list() {
    const out = [];
    let names = [];
    try { names = readdirSync('/proc'); } catch { return out; }
    for (const n of names) {
      if (!/^\d+$/.test(n)) continue;
      try {
        const cmdline = readFileSync(`/proc/${n}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
        if (cmdline) out.push({ pid: Number(n), cmdline });
      } catch { /* gone / not permitted */ }
    }
    return out;
  },
  maps(pid) {
    try { return readFileSync(`/proc/${pid}/maps`, 'utf8'); } catch { return null; }
  },
};

/**
 * All checks. Each result: {level: 'ok'|'warn'|'error'|'info', id, message}. `bridgeKey` = the bridge's HERMES_API_KEY
 * (only compared). `bridgeProfiles` = BRIDGE_PROFILES of the bridge env (how the bridge lists bots).
 * @param {{home: string, bridgeKey?: string, bridgeProfiles?: string, fs?: typeof realFs, proc?: typeof realProc}} o
 */
export function botsDoctor(o) {
  const fs = o.fs ?? realFs;
  const proc = o.proc ?? realProc;
  const home = o.home;
  /** @type {{level: string, id: string, message: string}[]} */
  const out = [];
  const add = (level, id, message) => out.push({ level, id, message });
  let homeOk = false;
  try { homeOk = fs.existsSync(home) && fs.statSync(home).isDirectory(); } catch { homeOk = false; }
  if (!homeOk) {
    add('error', 'home', `Hermes home ${home} is not readable here. Run this on the Hermes host as the Hermes user (or root), or pass --hermes-home <dir>.`);
    return { results: out, profiles: [] };
  }
  const configText = readText(fs, join(home, 'config.yaml'));
  const rootEnv = envOf(readText(fs, join(home, '.env')));
  const multiplex = multiplexSetting(configText);
  if (configText === null) add('error', 'config', `${join(home, 'config.yaml')} is missing or unreadable.`);
  if (multiplex === true) add('ok', 'multiplex', 'gateway.multiplex_profiles: true (the gateway serves every profile under /p/<name>/).');
  else if (multiplex === false) add('warn', 'multiplex', 'gateway.multiplex_profiles is false: older Hermes versions serve no bots then. Hermes v0.22.2 ignores false (retired) and multiplexes anyway as soon as a second profile exists. Set true at a quiet moment (docs/BOTS-SERVER.md, step 3).');
  else add('warn', 'multiplex', 'gateway.multiplex_profiles is not set: with only the default profile the gateway serves no bots, and the app cannot create the first one. Hermes v0.22 turns multiplexing on by itself at the first start with a second profile (and writes true into config.yaml). Setting it is a one-time owner step with a gateway restart (docs/BOTS-SERVER.md, step 3).');
  // what the running gateway decided (Hermes writes it at every start): the truth when config and runtime disagree
  const state = (() => { try { return JSON.parse(readText(fs, join(home, 'gateway_state.json')) ?? 'null'); } catch { return null; } })();
  if (state && Array.isArray(state.served_profiles)) {
    const served = state.served_profiles.filter((n) => typeof n === 'string').slice(0, 50);
    const why = typeof state.multiplex_standalone_reason === 'string' ? ` (standalone: ${state.multiplex_standalone_reason.slice(0, 120)})` : '';
    add('info', 'served', `gateway_state.json: the last gateway start serves ${served.length ? served.join(', ') : 'the default profile only'}${why}.`);
  }

  const profiles = listProfiles(home, { fs }).filter((p) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(p.name) && p.name !== 'default');
  const rows = [];
  if (!profiles.length) add('info', 'profiles', 'No profiles besides the default: the app shows no Bots tab (exactly like 0.1).');
  for (const p of profiles) {
    const env = envOf(readText(fs, join(p.dir, '.env')));
    const key = env.API_SERVER_KEY ?? '';
    const desktop = desktopBotMeta(readText(fs, join(p.dir, 'profile.yaml')));
    let parked = false;
    try { parked = fs.existsSync(join(p.dir, 'gateway.parked')); } catch { parked = false; }
    const keyState = !key ? 'missing' : o.bridgeKey ? (key === o.bridgeKey ? 'matches' : 'differs') : 'set';
    rows.push({ name: p.name, key: keyState, desktop: !!desktop, hidden: !!desktop?.hidden, parked, ...(desktop?.title ? { title: desktop.title } : {}) });
    const label = `profile ${p.name}${desktop?.title ? ` ("${desktop.title}")` : ''}`;
    if (keyState === 'missing') add('error', `key:${p.name}`, `${label}: no API_SERVER_KEY in ${join(p.dir, '.env')} → /p/${p.name}/ answers 401. Add the bridge's HERMES_API_KEY there (no restart needed).`);
    else if (keyState === 'differs') add('error', `key:${p.name}`, `${label}: API_SERVER_KEY differs from the bridge's HERMES_API_KEY → 401 for this bot. Use the same key.`);
    else add('ok', `key:${p.name}`, `${label}: API_SERVER_KEY ${keyState === 'matches' ? "matches the bridge's key" : 'is set (bridge key not known here, not compared)'}.`);
    if (parked) add('info', `parked:${p.name}`, `${label}: gateway.parked marker present (archived, not served).`);
  }
  if (profiles.length) {
    const desktopCount = rows.filter((r) => r.desktop).length;
    add('info', 'desktop', desktopCount ? `${desktopCount} of ${rows.length} profiles carry Hermes Desktop bot metadata (ui_meta 'hermes-bots').` : 'No profile carries Hermes Desktop bot metadata; the app shows them by profile name.');
  }

  // how the bridge lists the bots (it cannot read ~/.hermes under systemd ProtectHome)
  const bp = String(o.bridgeProfiles ?? '').trim();
  if (profiles.length) {
    if (/^(off|0|false|no|none)$/i.test(bp)) add('warn', 'bridge-profiles', 'BRIDGE_PROFILES=off: the app sees no bots. Set BRIDGE_PROFILES=auto (bridge can read the Hermes home) or a list.');
    else if (!bp || /^auto$/i.test(bp)) add('info', 'bridge-profiles', `BRIDGE_PROFILES=${bp || '(unset)'}: the bridge scans ${join(home, 'profiles')} itself. If the bridge runs sandboxed (ProtectHome / DynamicUser) it cannot, then set BRIDGE_PROFILES=${profiles.map((p) => p.name).join(',')}.`);
    else {
      const listed = bp.split(',').map((s) => s.split('=')[0].trim()).filter(Boolean);
      const missing = profiles.map((p) => p.name).filter((n) => !listed.includes(n));
      const unknown = listed.filter((n) => n !== 'default' && !profiles.some((p) => p.name === n));
      add(missing.length || unknown.length ? 'warn' : 'ok', 'bridge-profiles', `BRIDGE_PROFILES lists ${listed.join(', ') || 'nothing'}${missing.length ? `; not listed: ${missing.join(', ')}` : ''}${unknown.length ? `; no such profile: ${unknown.join(', ')}` : ''}.`);
    }
  }

  // the package-manager trap: facts.json files and the gateway's environment
  const facts = factsFiles(home, fs);
  if (facts.length) add('warn', 'facts', `Package-manager env selectors present: ${facts.join(', ')}. A gateway restart may switch to that env. Back them up before any server step (bots backup).`);
  else add('ok', 'facts', `No ${join(home, 'installs')}/*/facts.json (the gateway keeps its own venv on restart).`);
  if (!proc.available()) add('info', 'gateway', 'No /proc here (not Linux): check the gateway venv by hand (docs/BOTS-SERVER.md).');
  else {
    const pids = findGatewayPids(proc.list());
    if (!pids.length) add('warn', 'gateway', 'No running Hermes gateway process found (or not visible to this user).');
    for (const pid of pids) {
      const maps = proc.maps(pid);
      if (maps === null) {
        add('info', `gateway:${pid}`, `gateway pid ${pid}: memory maps not readable (run as the Hermes user or root to check the venv).`);
        continue;
      }
      const a = analyzeMaps(maps, home);
      const envText = a.envs.length ? a.envs.join(', ') : 'unknown';
      if (a.fromInstalls > 0) add('error', `gateway:${pid}`, `gateway pid ${pid} runs from a package-manager env under ${join(home, 'installs')} (${envText}). This is the 2026-10 outage pattern: see "Rollback" in docs/BOTS-SERVER.md.`);
      else add('ok', `gateway:${pid}`, `gateway pid ${pid} runs on ${envText}.`);
      if (!a.aiohttp) add('warn', `aiohttp:${pid}`, `gateway pid ${pid}: aiohttp is not loaded, the API server may be down.`);
    }
  }
  const plugin = pluginEnabled(configText, 'hermes-ui-plus');
  add('info', 'plugin', `Plugin hermes-ui-plus is ${plugin ? '' : 'not '}listed under plugins.enabled in config.yaml${plugin ? '' : ' (only needed to create bots from the app, a later step)'}.`);
  return { results: out, profiles: rows, multiplex: multiplex ?? null, facts };
}

const MARK = { ok: 'ok', warn: '!!', error: 'XX', info: '--' };

/** Text report for the terminal. */
export function formatDoctor(report, home) {
  const lines = [`Bots on this Hermes server (${home}):`];
  for (const r of report.results) lines.push(`  [${MARK[r.level] ?? '--'}] ${r.message}`);
  const errors = report.results.filter((r) => r.level === 'error').length;
  const warns = report.results.filter((r) => r.level === 'warn').length;
  lines.push('');
  lines.push(errors ? `${errors} problem(s), ${warns} warning(s). Runbook: docs/BOTS-SERVER.md` : warns ? `${warns} warning(s). Runbook: docs/BOTS-SERVER.md` : 'Everything the app needs for bots is in place.');
  return lines;
}

// ------------------------------------------------------------------ backup / rollback

const stamp = (now) => new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** Files a backup copies (relative to the Hermes home), only those that exist. */
export function backupPlan(home, fs = realFs) {
  const rel = [];
  for (const f of ROOT_FILES) if (fs.existsSync(join(home, f))) rel.push(f);
  for (const p of listProfiles(home, { fs })) {
    for (const f of PROFILE_FILES) if (fs.existsSync(join(p.dir, f))) rel.push(join('profiles', p.name, f));
  }
  for (const f of factsFiles(home, fs)) rel.push(f.slice(home.replace(/\/+$/, '').length + 1));
  return rel;
}

/**
 * `bots backup`: copy the plan into `<dest>/hermes-bots-<stamp>/` (secrets stay mode 0600, the directory 0700) plus a
 * manifest with the facts.json files that existed. Returns the directory.
 */
export function writeBackup(home, dest, { now = Date.now(), fsw = { copyFileSync, mkdirSync, writeFileSync, chmodSync }, fs = realFs } = {}) {
  const dir = join(dest, `hermes-bots-${stamp(now)}`);
  fsw.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const files = backupPlan(home, fs);
  for (const rel of files) {
    const to = join(dir, 'files', rel);
    fsw.mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
    fsw.copyFileSync(join(home, rel), to);
    fsw.chmodSync(to, 0o600);
  }
  const facts = files.filter((f) => /^installs\/[^/]+\/facts\.json$/.test(f));
  fsw.writeFileSync(join(dir, BACKUP_MANIFEST), JSON.stringify({ v: 1, home, at: new Date(now).toISOString(), files, facts }, null, 2) + '\n', { mode: 0o600 });
  return { dir, files };
}

/**
 * `bots rollback <backup>`: what it would do. Restores every backed-up file, and moves each facts.json that is NOT in the
 * backup aside (renamed, never deleted): that is what brought the gateway back on 2026-10-15. Profiles created after the
 * backup are left alone (listed only).
 */
export function rollbackPlan(home, backupDir, fs = realFs) {
  const manifest = JSON.parse(fs.readFileSync(join(backupDir, BACKUP_MANIFEST), 'utf8'));
  if (manifest?.v !== 1 || !Array.isArray(manifest.files)) throw new Error('not a hermes-bots backup (manifest.json missing or unknown)');
  const restore = manifest.files.filter((f) => typeof f === 'string' && !f.includes('..') && fs.existsSync(join(backupDir, 'files', f)));
  const keep = new Set(manifest.facts ?? []);
  const aside = factsFiles(home, fs).map((f) => f.slice(home.replace(/\/+$/, '').length + 1)).filter((f) => !keep.has(f));
  const before = new Set(listProfiles(home, { fs }).map((p) => p.name));
  const known = new Set(restore.filter((f) => f.startsWith('profiles/')).map((f) => f.split('/')[1]));
  const newProfiles = [...before].filter((n) => !known.has(n));
  return { restore, aside, newProfiles, manifest };
}

/** Apply a rollback plan: current files go to `<backup>/before-rollback-<stamp>/` first. */
export function applyRollback(home, backupDir, plan, { now = Date.now(), fsw = { copyFileSync, mkdirSync, renameSync, chmodSync }, fs = realFs } = {}) {
  const safety = join(backupDir, `before-rollback-${stamp(now)}`);
  fsw.mkdirSync(safety, { recursive: true, mode: 0o700 });
  for (const rel of plan.restore) {
    const cur = join(home, rel);
    if (fs.existsSync(cur)) {
      const keep = join(safety, rel);
      fsw.mkdirSync(dirname(keep), { recursive: true, mode: 0o700 });
      fsw.copyFileSync(cur, keep);
      fsw.chmodSync(keep, 0o600);
    }
    fsw.mkdirSync(dirname(cur), { recursive: true });
    fsw.copyFileSync(join(backupDir, 'files', rel), cur);
  }
  const moved = [];
  for (const rel of plan.aside) {
    const from = join(home, rel);
    const to = `${from}.hui-aside-${stamp(now)}`;
    fsw.renameSync(from, to);
    moved.push(to);
  }
  return { safety, moved };
}

/** CLI: `doctor bots` / `bots backup|rollback|doctor`. Returns {lines, code}. */
export function botsCli(sub, args, { home, env = {}, now = Date.now(), fs = realFs, proc = realProc, fsw } = {}) {
  const json = args.includes('--json');
  if (!sub || sub === 'doctor') {
    const report = botsDoctor({ home, bridgeKey: env.HERMES_API_KEY, bridgeProfiles: env.BRIDGE_PROFILES, fs, proc });
    const code = report.results.some((r) => r.level === 'error') ? 1 : 0;
    return { lines: json ? [JSON.stringify(report, null, 2)] : formatDoctor(report, home), code };
  }
  if (sub === 'backup') {
    const i = args.indexOf('--to');
    const dest = i >= 0 && args[i + 1] ? args[i + 1] : join(home, '..', 'hermes-backups');
    const { dir, files } = writeBackup(home, dest, { now, fs, ...(fsw ? { fsw } : {}) });
    return { lines: [`backup written: ${dir} (${files.length} files, mode 0600)`, ...files.map((f) => `  ${f}`), '', `Roll back with: hermes-ui-plus-bridge bots rollback ${dir}`], code: 0 };
  }
  if (sub === 'rollback') {
    const dir = args.find((a) => !a.startsWith('--'));
    if (!dir) throw new Error('usage: hermes-ui-plus-bridge bots rollback <backup-dir> [--yes]');
    const plan = rollbackPlan(home, dir, fs);
    const lines = [`Rollback from ${dir} (backup of ${plan.manifest.at}):`];
    for (const f of plan.restore) lines.push(`  restore ${f}`);
    for (const f of plan.aside) lines.push(`  move aside ${f} (package-manager env selector created after the backup)`);
    for (const n of plan.newProfiles) lines.push(`  leave profile ${n} alone (created after the backup; delete it with hermes profile delete if unwanted)`);
    if (plan.newProfiles.length) {
      lines.push('  NOTE: this restores files only. While more than one profile exists, Hermes v0.22 keeps multiplexing (it writes');
      lines.push('  gateway.multiplex_profiles: true back at the next start; false is retired in v0.22.2) and the bots stay served.');
      lines.push('  To undo the bots step completely, move the profiles listed above out of profiles/ before the restart.');
    }
    if (!args.includes('--yes')) {
      lines.push('', 'Nothing changed yet. Run again with --yes to apply, then restart the gateway and run doctor bots.');
      return { lines, code: 0 };
    }
    const done = applyRollback(home, dir, plan, { now, fs, ...(fsw ? { fsw } : {}) });
    lines.push('', `Done. Previous files kept in ${done.safety}.`, 'Now restart the Hermes gateway (owner step), then run: hermes-ui-plus-bridge doctor bots');
    return { lines, code: 0 };
  }
  throw new Error('usage: hermes-ui-plus-bridge doctor bots [--json] | bots backup [--to dir] | bots rollback <backup-dir> [--yes]   [--hermes-home dir]');
}
