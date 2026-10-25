// `hermes-ui-plus-bridge setup`: interactive (or --yes) setup on the Hermes host. Orchestration only; the pieces
// live in detect.mjs, files.mjs and service.mjs. Every side effect goes through `deps` (fs writes via the helpers,
// commands via deps.exec, HTTP via deps.fetch), so tests can run the whole flow against temp dirs and fakes.
//
// Rules: never print secrets; never edit Hermes' config without an explicit interactive "y"; never restart
// Hermes; --dry-run changes nothing (reads and read-only probes only); re-running updates in place.
import { chmodSync, chownSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir, networkInterfaces } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hermesHome, readHermes, listProfiles, probeHealth, hermesBaseUrl, apiServerSnippet, addApiServerBlock, HERMES_RESTART_HINT,
  parseTailscaleStatus, tailnetUrl, tailscaleServeArgs, lanAddresses,
} from './detect.mjs';
import { buildWebPairLink } from '../pair.mjs';
import { writeFileAtomicSync } from '../atomic-write.mjs';
import { directProviders, directProvidersLine } from '../cli.mjs';
import { loadConfig } from '../config.mjs';
import { corsOriginsFromEnv, describeOrigins } from '../cors.mjs';
import { defaultEnvFile, readEnvFile, mergeEnv, writeEnvFile, redactEnv, serializeEnv, findSkillSource, planSkillInstall, installSkill } from './files.mjs';
import {
  SERVICE_NAME, LAUNCHD_LABEL, assertNoControl, execArgv, isNpxCachePath, systemdUnit, systemdUnitPath, systemdCommands, systemServiceProblem,
  launchdPlist, launchdPlistPath, launchdCommands, composeSnippet,
} from './service.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const BIN_PATH = resolve(here, '../../bin/hermes-ui-bridge.mjs');

export const SETUP_HELP = `hermes-ui-plus-bridge setup - set up the bridge on the Hermes host (re-run to update)

Usage: hermes-ui-plus-bridge setup [options]

  --yes                 non-interactive, take the defaults (keys from the environment are used if set)
  --dry-run             show what would happen, change nothing
  --json                machine-readable report on stdout (implies --yes; progress goes to stderr)
  --env-file <file>     bridge env file (default ~/.config/hermes-ui-plus-bridge/env, root: /etc/hermes-ui-plus-bridge/env)
  --hermes-home <dir>   Hermes home (default $HERMES_HOME or ~/.hermes)
  --port <n>            bridge port (default 8790)
  --https-port <n>      tailnet HTTPS port for tailscale serve (default 8790; 443 gives a URL without port)
  --name <label>        name shown in the app (default Hermes)
  --service <kind>      auto | systemd | launchd | docker | none (default auto)
  --no-tailscale        do not use tailscale serve
  --public-url <url>    the address your devices use (BRIDGE_PUBLIC_URL), e.g. when the detected LAN address is wrong
                        (a container IP); skips the Tailscale / LAN detection. A plain http:// address on another host
                        also makes the bridge listen on all interfaces (BRIDGE_HOST=0.0.0.0): trusted LAN only
  --web-dir <dir>       serve a built web app (BRIDGE_WEB_DIR) from the bridge
  --profiles <list>     also install the skill into these Hermes profiles (comma separated, or "all")
  --no-skill            do not install or update the hermes-ui skill
  --no-pair             do not create a device token / pair link at the end
  --extras              also configure the optional direct-provider extras (LLM router, chat titles and follow-ups,
                        image search, voice). Off by default: the bridge is a pure pass-through to Hermes and
                        everything "thinking" happens in your Hermes. These extras call providers directly from the
                        bridge, outside Hermes, with keys stored in the bridge env file. Interactive runs ask once
                        (default No); with --yes they are skipped unless --extras is given.

With --extras the keys can be passed as environment variables (never as arguments): SERPER_API_KEY or BRAVE_API_KEY
(image search), GROQ_API_KEY (speech-to-text), DEEPGRAM_API_KEY (text-to-speech), ANTHROPIC_API_KEY,
TYPESAFE_API_KEY or NACE_API_KEY (LLM router, titles). Web Push contact: BRIDGE_PUSH_VAPID_SUBJECT (mailto: or https:). Without --extras those variables are ignored, and values already in the env
file are kept untouched. Router default: heuristic (rule based, no external call). Push (Web Push) is always offered.
Hermes' own config is never changed without an interactive "y".`;

/** @param {string[]} argv */
export function parseSetupArgs(argv) {
  const o = { yes: false, dryRun: false, json: false, envFile: '', hermesHome: '', port: 8790, httpsPort: 8790, name: '', service: 'auto', tailscale: true, publicUrl: '', webDir: '', profiles: '', skill: true, pair: true, extras: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let inline;
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    if (eq > 0) { inline = a.slice(eq + 1); a = a.slice(0, eq); }
    const take = () => {
      if (inline !== undefined) return assertNoControl(inline, a);
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`${a} needs a value`);
      return assertNoControl(argv[++i], a); // GPT security L1: values end up in service files
    };
    const port = (v) => { const p = Number(v); if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`${a} must be 1-65535`); return p; };
    switch (a) {
      case '--yes': case '-y': o.yes = true; break;
      case '--dry-run': o.dryRun = true; break;
      case '--json': o.json = true; o.yes = true; break;
      case '--env-file': o.envFile = take(); break;
      case '--hermes-home': o.hermesHome = take(); break;
      case '--port': o.port = port(take()); break;
      case '--https-port': o.httpsPort = port(take()); break;
      case '--name': o.name = take().slice(0, 64); break;
      case '--service': {
        const v = take();
        if (!['auto', 'systemd', 'launchd', 'docker', 'none'].includes(v)) throw new Error('--service must be auto|systemd|launchd|docker|none');
        o.service = v; break;
      }
      case '--no-tailscale': o.tailscale = false; break;
      case '--public-url': o.publicUrl = publicUrlArg(take()); break;
      case '--web-dir': o.webDir = take(); break;
      case '--profiles': o.profiles = take(); break;
      case '--no-skill': o.skill = false; break;
      case '--no-pair': o.pair = false; break;
      case '--extras': o.extras = true; break;
      case '-h': case '--help': o.help = true; break;
      default: throw new Error(`unknown setup option: ${a} (see setup --help)`);
    }
  }
  return o;
}

/** Real command runner (no shell). */
export function realExec(argv, { timeoutMs = 30_000 } = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.error ? -1 : r.status ?? -1, stdout: r.stdout ?? '', stderr: r.error ? String(r.error.message) : r.stderr ?? '' };
}

/** Readline-based prompts; `yes` mode answers every question with its default. */
export async function createPrompter({ yes, input = process.stdin, output = process.stderr }) {
  if (yes) {
    return { ask: async (_q, d = '') => d, confirm: async (_q, d = false) => d, secret: async () => '', close() {} };
  }
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input, output, terminal: Boolean(input.isTTY) });
  let muted = false;
  const orig = rl._writeToOutput?.bind(rl);
  if (orig) rl._writeToOutput = (s) => { if (!muted) orig(s); };
  // stdin ended (`</dev/null`, a pipe without answers, an agent without a terminal): take the defaults instead of
  // failing with "readline was closed". EOF declines confirmations; only explicit --yes accepts defaults.
  let ended = false;
  let noted = false;
  rl.on('close', () => { ended = true; });
  const fallback = (text, shown) => {
    if (!noted) { noted = true; output.write(`${shown ? '' : text}\n  (no input on stdin: using text defaults and declining confirmations)\n`); }
    return null;
  };
  const question = (text) => new Promise((resolve, reject) => {
    if (ended) return resolve(fallback(text, false));
    const onClose = () => resolve(fallback(text, true)); // a pending question never settles when stdin ends
    rl.once('close', onClose);
    rl.question(text).then((a) => { rl.off('close', onClose); resolve(a); }, (e) => {
      rl.off('close', onClose);
      if (ended || e?.code === 'ERR_USE_AFTER_CLOSE') resolve(fallback(text, false)); else reject(e);
    });
  });
  return {
    async ask(q, d = '') { const a = ((await question(`${q}${d ? ` [${d}]` : ''}: `)) ?? '').trim(); return a || d; },
    async confirm(q, d = false) {
      const answer = await question(`${q} ${d ? '[Y/n]' : '[y/N]'} `);
      if (answer === null) return false;
      const a = answer.trim().toLowerCase();
      return a ? /^y(es)?$|^j(a)?$/.test(a) : d;
    },
    async secret(q) {
      output.write(`${q}: `);
      muted = Boolean(input.isTTY);
      try { return ((await question('')) ?? '').trim(); } finally { muted = false; if (input.isTTY) output.write('\n'); }
    },
    close() { rl.close(); },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mask = (s) => (s ? `<set, ${s.length} chars>` : '<not set>');

/** Poll the local bridge until it answers (any HTTP response counts; it does not depend on Hermes). */
export async function waitForBridge(port, { fetch: doFetch = fetch, tries = 20, delayMs = 500 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await doFetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
      return { up: true, bridge: r.headers?.get?.('x-hermes-ui-bridge') === '1', hermesStatus: r.status };
    } catch { /* not up yet */ }
    if (i < tries - 1) await sleep(delayMs);
  }
  return { up: false, bridge: false, hermesStatus: 0 };
}

/** `https://<bridge>/#pair?u=...&c=<one-time code>&n=...` for a web app served by the bridge itself (same origin). */
export function webPairLink(publicUrl, code, name) {
  return buildWebPairLink({ url: publicUrl, code, name });
}

/**
 * Run the wizard.
 * @param {ReturnType<typeof parseSetupArgs>} opts
 * @param {object} [deps]  injectable: env, home, platform, isRoot, uid, fetch, exec, prompter, log, interfaces, now, version
 */
export async function runSetup(opts, deps = {}) {
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();
  const platform = deps.platform ?? process.platform;
  const uid = deps.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 1000);
  const isRoot = deps.isRoot ?? uid === 0;
  const doFetch = deps.fetch ?? fetch;
  const exec = deps.exec ?? realExec;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((s = '') => process.stderr.write(`${s}\n`));
  const p = deps.prompter ?? await createPrompter({ yes: opts.yes });
  const dry = opts.dryRun;
  const version = deps.version ?? JSON.parse(readFileSync(resolve(here, '../../package.json'), 'utf8')).version;
  const report = { ok: true, dryRun: dry, version, hermes: {}, skill: [], envFile: {}, service: {}, network: {}, pair: null, warnings: [], nextSteps: [], extras: { requested: false, directProviders: {} } };
  const warn = (m) => { report.warnings.push(m); log(`  !! ${m}`); };
  const step = (t) => log(`\n== ${t}`);
  const run = (argv, { ignoreFailure = false } = {}) => {
    if (dry) { log(`  (dry-run) would run: ${argv.join(' ')}`); return { code: 0, stdout: '', stderr: '', dry: true }; }
    const r = exec(argv);
    if (r.code !== 0 && !ignoreFailure) warn(`\`${argv.join(' ')}\` failed (${r.code}): ${(r.stderr || r.stdout).trim().split('\n').slice(-1)[0] ?? ''}`);
    return r;
  };

  try {
    log(`Hermes UI+ Bridge setup ${version}${dry ? ' (dry run: nothing is changed)' : ''}`);

    const envFile = resolve(opts.envFile || defaultEnvFile(env, home, { root: isRoot }));
    const existing = readEnvFile(envFile);

    // ---------- 1. Hermes ----------
    step('Hermes');
    const hHome = opts.hermesHome ? resolve(opts.hermesHome) : hermesHome(env, home);
    let hermes = readHermes(hHome);
    const describeApi = (h) => ({ configured: h.api.configured, enabled: h.api.enabled, host: h.api.host, port: h.api.port, hasKey: h.api.hasKey });
    log(`  home: ${hHome}${hermes.exists ? '' : ' (not found)'}`);
    if (!hermes.exists) warn(`no Hermes home at ${hHome}; set HERMES_HOME or --hermes-home if Hermes lives elsewhere`);
    log(`  config: ${hermes.configExists ? hermes.configFile : 'config.yaml not found'}`);
    log(`  API server: ${hermes.api.enabled ? 'enabled' : 'not enabled'}, ${hermes.api.host}:${hermes.api.port}, key ${hermes.api.hasKey ? 'present' : 'missing'}`);
    for (const k of hermes.envDuplicates ?? []) {
      warn(`${join(hHome, '.env')} sets ${k} more than once; the last line counts (for Hermes and for this setup). Delete the other lines so nobody copies a stale value (a stale key gives HTTP 401)`);
    }

    if (!hermes.api.enabled || !hermes.api.hasKey) {
      log('\n  The bridge needs the Hermes API server. Add this to config.yaml (or set API_SERVER_ENABLED=true and');
      log('  API_SERVER_KEY in the Hermes .env), then ' + HERMES_RESTART_HINT + ':\n');
      log(apiServerSnippet({ port: hermes.api.port }).split('\n').map((l) => `    ${l}`).join('\n'));
      const canEdit = hermes.configExists && !hermes.api.configured;
      if (canEdit && !opts.yes && !dry && await p.confirm(`\n  Add this block to ${hermes.configFile} now (a backup is made, a random key is generated)?`, false)) {
        const key = randomBytes(32).toString('hex');
        const r = addApiServerBlock(hermes.configText, { port: hermes.api.port, key });
        if (!r.ok) warn(r.reason);
        else if (lstatSync(hermes.configFile).isSymbolicLink()) warn(`${hermes.configFile} is a symlink; add the api_server block by hand`);
        else {
          const backup = `${hermes.configFile}.bak-${now().toISOString().replace(/[:.]/g, '-')}`;
          // GPT security M4: backup created private + exclusive (no-follow); the config that now holds an API key
          // loses world access before the key is written (atomic tmp + rename, owner/group bits kept)
          writeFileSync(backup, readFileSync(hermes.configFile), { mode: 0o600, flag: 'wx' });
          const mode = statSync(hermes.configFile).mode & 0o660;
          writeFileAtomicSync(hermes.configFile, r.text, { mode, beforeRename: (tmp) => chmodSync(tmp, mode) });
          log(`  updated ${hermes.configFile} (backup: ${backup}). Hermes was NOT restarted.`);
          report.hermes.configEdited = { backup };
          hermes = readHermes(hHome);
        }
      }
      report.nextSteps.push(`Enable the Hermes API server if not done yet, then ${HERMES_RESTART_HINT}.`);
    }
    // a Hermes found on this machine wins; otherwise keep a HERMES_BASE_URL set by hand (Docker, another host)
    const keepUrl = !hermes.api.configured && existing.HERMES_BASE_URL;
    const hermesUrl = keepUrl ? existing.HERMES_BASE_URL.replace(/\/+$/, '').replace(/\/v1$/, '') : hermesBaseUrl(hermes.api);
    const health = await probeHealth(hermesUrl, { fetch: doFetch });
    log(`  ${hermesUrl}/health: ${health.reachable ? `HTTP ${health.status}${health.version ? `, Hermes ${health.version}` : ''}` : `not reachable (${health.error})`}`);
    if (!health.reachable) warn('Hermes API server is not reachable. The bridge is set up anyway; it starts working once Hermes answers.');
    report.hermes = { ...report.hermes, home: hHome, configFile: hermes.configExists ? hermes.configFile : '', apiServer: describeApi(hermes), url: hermesUrl, reachable: health.reachable, version: health.version };

    // ---------- 2. Skill ----------
    step('hermes-ui skill');
    const profiles = listProfiles(hHome);
    report.hermes.profiles = profiles.map((x) => x.name);
    if (!opts.skill) log('  skipped (--no-skill)');
    else if (!hermes.exists) {
      // never create ~/.hermes/skills/... for a Hermes that is not there: a later Hermes install would find a stray
      // directory, and the skill would sit in the wrong place if Hermes lives elsewhere
      log(`  not installed: there is no Hermes home at ${hHome}.`);
      log('  Install Hermes first (or point --hermes-home / HERMES_HOME at it), then re-run setup to install the skill.');
      report.skill.push({ target: 'main', dest: '', action: 'skipped', reason: 'no-hermes-home' });
      report.nextSteps.push(`Install the hermes-ui skill: re-run setup once Hermes is installed (no Hermes home at ${hHome}).`);
    } else {
      const src = findSkillSource();
      if (!src) warn('skill files not found in this package (expected skill/hermes-ui); install it by hand, see hermes-skill/INSTALL.md');
      else {
        const targets = [{ label: 'main', skillsDir: join(hHome, 'skills') }];
        if (profiles.length) {
          log(`  Hermes profiles (/p/<profile>/): ${profiles.map((x) => x.name).join(', ')}`);
          let chosen = [];
          if (opts.profiles === 'all') chosen = profiles;
          else if (opts.profiles) {
            const want = opts.profiles.split(',').map((s) => s.trim()).filter(Boolean);
            for (const w of want) if (!profiles.some((x) => x.name === w)) warn(`unknown profile ${w}`);
            chosen = profiles.filter((x) => want.includes(x.name));
          } else if (await p.confirm('  Install the skill into these profiles too?', false)) chosen = profiles;
          for (const pr of chosen) targets.push({ label: `profile ${pr.name}`, skillsDir: pr.skillsDir });
        }
        for (const t of targets) {
          const plan = planSkillInstall(src, t.skillsDir);
          const entry = { target: t.label, dest: plan.dest, action: plan.action, from: plan.from, to: plan.to, backup: '' };
          if (plan.action === 'current') log(`  ${t.label}: up to date (${plan.to || 'unknown version'})`);
          else if (dry) log(`  ${t.label}: would ${plan.action} ${plan.dest}${plan.from ? ` (${plan.from} -> ${plan.to})` : ''}`);
          else if (await p.confirm(`  ${t.label}: ${plan.action} ${plan.dest}${plan.from ? ` (${plan.from} -> ${plan.to}, old version backed up)` : ''}?`, true)) {
            const r = installSkill(plan, { backupRoot: join(hHome, 'skill-backups'), now });
            entry.backup = r.backup;
            log(`  ${t.label}: ${plan.action === 'install' ? 'installed' : 'updated'}${r.backup ? `, backup ${r.backup}` : ''}`);
          } else entry.action = 'skipped';
          report.skill.push(entry);
        }
        log('  No Hermes restart needed: new conversations load the skill within about 30 seconds.');
      }
    }

    // ---------- 3. Env file + optional features ----------
    step('Bridge settings');
    log(`  env file: ${envFile}${Object.keys(existing).length ? ' (exists, updating in place)' : ' (new)'}`);
    const stateDir = existing.BRIDGE_STATE_DIR || (isRoot ? '/var/lib/hermes-ui-bridge' : join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'hermes-ui-bridge'));
    const updates = {
      HERMES_BASE_URL: keepUrl ? undefined : hermesUrl,
      HERMES_API_KEY: hermes.api.key || undefined,
      BRIDGE_NAME: opts.name || existing.BRIDGE_NAME || 'Hermes',
      BRIDGE_PORT: String(opts.port),
      BRIDGE_STATE_DIR: stateDir,
      BRIDGE_WEB_DIR: opts.webDir ? resolve(opts.webDir) : undefined,
    };
    if (!hermes.api.key && !existing.HERMES_API_KEY) warn('no Hermes API key found; HERMES_API_KEY stays empty until the API server has a key (re-run setup then)');

    // A root install becomes a hardened system unit (DynamicUser, ProtectHome): it reads neither the Hermes home
    // (profile list) nor files in it (plugin secret). So it gets the profile list written out and the plugin secret as
    // a systemd credential (LoadCredential, see the Service step) instead of a path.
    const hardened = isRoot && platform === 'linux';
    if (hardened && profiles.length && !existing.BRIDGE_PROFILES) {
      updates.BRIDGE_PROFILES = profiles.map((x) => x.name).join(',');
      log(`  BRIDGE_PROFILES=${updates.BRIDGE_PROFILES} (the system service cannot list the Hermes home itself; re-run setup after adding a profile)`);
    }
    // Schnellfrage (⚡): the hermes-ui-plus plugin's secret (hermes-plugin/install.py). The bridge has no default path.
    const pluginSecret = hermes.exists ? join(hHome, 'hermes-ui-plus', 'secret') : '';
    const hasPlugin = Boolean(pluginSecret) && existsSync(pluginSecret);
    report.hermes.quickPlugin = hasPlugin;
    if (hasPlugin && !hardened && !existing.BRIDGE_HERMES_PLUGIN_SECRET_FILE) {
      updates.BRIDGE_HERMES_PLUGIN_SECRET_FILE = pluginSecret;
      log(`  Schnellfrage: hermes-ui-plus plugin found, BRIDGE_HERMES_PLUGIN_SECRET_FILE=${pluginSecret}`);
    } else if (hasPlugin && hardened && /^\/(root|home)(\/|$)/.test(existing.BRIDGE_HERMES_PLUGIN_SECRET_FILE || '')) {
      warn(`BRIDGE_HERMES_PLUGIN_SECRET_FILE in ${envFile} points into a home directory, which the system service cannot read; remove that line, the unit passes the secret as a credential`);
    }

    const has = (k) => Boolean(existing[k]);
    const fromEnv = (k) => env[k] || undefined;
    // Optional direct-provider extras (router, titles, image search, voice): the bridge calls these providers itself,
    // outside Hermes. Off unless --extras or an interactive "y"; --yes alone never takes them. Values already in the
    // env file are never removed or changed by this wizard (mergeEnv only applies the updates set below).
    const extras = opts.extras || (!opts.yes && await p.confirm('  Configure optional direct-provider extras (router, titles, image search, voice)? These call providers directly from the bridge, outside Hermes.', false));
    report.extras.requested = Boolean(extras);
    if (!extras) {
      log('  Direct-provider extras: skipped (pure Hermes pass-through; re-run with --extras to add router, titles, image search or voice).');
      if (!existing.ROUTER_BACKEND) updates.ROUTER_BACKEND = 'heuristic'; // rule based, no external call
    } else {
      // image search
      if (!has('SERPER_API_KEY') && !has('BRAVE_API_KEY')) {
        const k = fromEnv('SERPER_API_KEY') || fromEnv('BRAVE_API_KEY') ? undefined : await p.secret('  Image search: Serper or Brave Search API key (Enter = skip)');
        if (fromEnv('SERPER_API_KEY')) updates.SERPER_API_KEY = fromEnv('SERPER_API_KEY');
        if (fromEnv('BRAVE_API_KEY')) updates.BRAVE_API_KEY = fromEnv('BRAVE_API_KEY');
        if (k) updates[/^BSA/.test(k) ? 'BRAVE_API_KEY' : 'SERPER_API_KEY'] = k;
      }
      // voice
      for (const [k, label] of [['GROQ_API_KEY', 'Voice input (speech-to-text): Groq API key'], ['DEEPGRAM_API_KEY', 'Voice output (text-to-speech): Deepgram API key']]) {
        if (has(k)) continue;
        updates[k] = fromEnv(k) || (await p.secret(`  ${label} (Enter = skip)`)) || undefined;
      }
      // router
      if (!existing.ROUTER_BACKEND || !opts.yes) {
        const preset = existing.ROUTER_BACKEND || (fromEnv('ANTHROPIC_API_KEY') ? 'claude' : fromEnv('TYPESAFE_API_KEY') ? 'jev' : fromEnv('NACE_API_KEY') ? 'nace' : 'heuristic');
        const choice = (await p.ask('  Router: heuristic (free, rule based) | claude (Anthropic key) | jev (Jev key) | nace (Nace Drex key)', preset)).toLowerCase();
        if (existing.ROUTER_BACKEND && choice === existing.ROUTER_BACKEND.toLowerCase()) { /* unchanged, keep as is */ } else if (choice.startsWith('c')) {
          const k = existing.ANTHROPIC_API_KEY || fromEnv('ANTHROPIC_API_KEY') || await p.secret('  Anthropic API key');
          if (k) { updates.ANTHROPIC_API_KEY = existing.ANTHROPIC_API_KEY ? undefined : k; updates.ROUTER_BACKEND = 'claude'; } else warn('no Anthropic key given, keeping the heuristic router');
        } else if (choice.startsWith('j')) {
          const k = existing.TYPESAFE_API_KEY || fromEnv('TYPESAFE_API_KEY') || await p.secret('  Jev (Typesafe) API key');
          if (k) { updates.TYPESAFE_API_KEY = existing.TYPESAFE_API_KEY ? undefined : k; updates.ROUTER_BACKEND = 'jev'; } else warn('no Jev key given, keeping the heuristic router');
        } else if (choice === 'nace' || choice.startsWith('drex')) {
          const k = existing.NACE_API_KEY || fromEnv('NACE_API_KEY') || await p.secret('  Nace (Drex) API key');
          if (k) { updates.NACE_API_KEY = existing.NACE_API_KEY ? undefined : k; updates.ROUTER_BACKEND = 'nace'; } else warn('no Nace key given, keeping the heuristic router');
        } else updates.ROUTER_BACKEND = 'heuristic';
      }
      if (!existing.ROUTER_BACKEND && !updates.ROUTER_BACKEND) updates.ROUTER_BACKEND = 'heuristic';
      // titles and follow-ups use the Anthropic key; say so explicitly in the env file (BRIDGE_META=on|off)
      if (!existing.BRIDGE_META && (existing.ANTHROPIC_API_KEY || updates.ANTHROPIC_API_KEY)) updates.BRIDGE_META = 'on';
    }
    // web push (VAPID): free, no account; the private key goes into the 0600 env file (readable by the service)
    let vapid = has('BRIDGE_PUSH_VAPID_PUBLIC_KEY');
    if (!vapid) {
      if (await p.confirm('  Generate Web Push (VAPID) keys for notifications in the web app?', true)) {
        const { generateVapidKeys } = await import('../push/webpush.mjs');
        const v = generateVapidKeys();
        Object.assign(updates, { BRIDGE_PUSH_VAPID_PUBLIC_KEY: v.publicKey, BRIDGE_PUSH_VAPID_PRIVATE_KEY: v.privateKey });
        vapid = true;
      }
    }

    // ---------- 4. Network (decides BRIDGE_PUBLIC_URL / BRIDGE_HOST before the env file is written) ----------
    step('Network');
    let publicUrl = opts.publicUrl || existing.BRIDGE_PUBLIC_URL || '';
    let serveArgs = null;
    const lan = lanAddresses(deps.interfaces ?? networkInterfaces());
    const ts = opts.tailscale && !opts.publicUrl ? exec(['tailscale', 'status', '--json']) : { code: -1, stdout: '' };
    const tsInfo = ts.code === 0 ? parseTailscaleStatus(ts.stdout) : { running: false, dnsName: '' };
    report.network.tailscale = { found: ts.code === 0, running: tsInfo.running, dnsName: tsInfo.dnsName };
    if (opts.publicUrl) {
      log(`  BRIDGE_PUBLIC_URL=${publicUrl} (--public-url; no Tailscale / LAN detection)`);
      report.network.mode = 'custom';
      // plain HTTP to another machine's address: a phone can only connect when the bridge listens beyond loopback
      const host = new URL(publicUrl).hostname;
      if (/^http:$/i.test(new URL(publicUrl).protocol) && !LOOPBACK_NAMES.has(host) && !['0.0.0.0', '::'].includes(existing.BRIDGE_HOST || '')) {
        updates.BRIDGE_HOST = '0.0.0.0';
        log('  plain http:// address on another host: the bridge listens on all interfaces (BRIDGE_HOST=0.0.0.0). Unencrypted:');
        log('  trusted home network only, never forward the port.');
      }
    } else if (tsInfo.running && tsInfo.dnsName) {
      const url = tailnetUrl(tsInfo.dnsName, opts.httpsPort);
      const args = tailscaleServeArgs(opts.httpsPort, opts.port);
      log(`  Tailscale is running (${tsInfo.dnsName}).`);
      const keepCustom = publicUrl && publicUrl !== url;
      if (keepCustom) log(`  BRIDGE_PUBLIC_URL is already ${publicUrl}; keeping it unless you switch to Tailscale.`);
      if (await p.confirm(`  Publish the bridge on your tailnet only (tailscale serve --bg --https=${opts.httpsPort} http://127.0.0.1:${opts.port}) -> ${url}?`, !keepCustom)) {
        serveArgs = args;
        publicUrl = url;
        log(`  will publish ${url} (tailnet only) after the service is up`);
      }
      report.network.mode = serveArgs ? 'tailscale' : keepCustom ? 'custom' : 'none';
    } else {
      log(`  Tailscale ${ts.code === 0 ? 'is installed but not running' : 'not found'} (recommended: https://tailscale.com/download).`);
      if (publicUrl) { log(`  keeping BRIDGE_PUBLIC_URL ${publicUrl}`); report.network.mode = 'custom'; }
      else if (lan.length) {
        log(`  LAN address: http://${lan[0]}:${opts.port}`);
        log('  WARNING: plain HTTP on the LAN is unencrypted (the token travels in clear text). The web app then only runs in a');
        log('  browser tab: installing it, offline use and push need HTTPS (tailscale serve or a TLS proxy).');
        if (await p.confirm('  Listen on the LAN anyway (trusted home network only, never forward the port)?', false)) {
          updates.BRIDGE_HOST = '0.0.0.0';
          publicUrl = `http://${lan[0]}:${opts.port}`;
          report.network.mode = 'lan';
        } else report.network.mode = 'none';
      } else report.network.mode = 'none';
      if (!publicUrl) report.nextSteps.push(`Give the bridge an address your phone can reach: set BRIDGE_PUBLIC_URL in ${envFile} (Tailscale: re-run setup once \`tailscale up\` ran; LAN test: BRIDGE_HOST=0.0.0.0 + BRIDGE_PUBLIC_URL=http://${lan[0] || '<lan-ip>'}:${opts.port}), restart the bridge, then create a pair link with \`devices add "Phone"\`.`);
    }
    updates.BRIDGE_PUBLIC_URL = publicUrl || undefined;
    report.network.publicUrl = publicUrl;

    // Web Push contact (VAPID "sub", RFC 8292): push services use it to reach the operator. A contact set in the env file
    // stays; the placeholder older versions wrote (mailto:admin@localhost) is replaced.
    const subjectNow = existing.BRIDGE_PUSH_VAPID_SUBJECT || '';
    if (vapid && (!subjectNow || subjectNow === PLACEHOLDER_VAPID_SUBJECT)) {
      const fallback = /^https:/i.test(publicUrl) ? publicUrl : '';
      let subject = vapidContact(env.BRIDGE_PUSH_VAPID_SUBJECT);
      if (!subject && !opts.yes) {
        const a = await p.ask(`  Web Push contact for the push services (your e-mail address or an https URL; Enter = ${fallback || 'none'})`, '');
        subject = a ? vapidContact(a) : fallback;
        if (a && !subject) warn(`"${a}" is neither an e-mail address nor an https URL; ${fallback ? `using ${fallback}` : 'no Web Push contact set'}`);
        if (a && !subject) subject = fallback;
      } else if (!subject) subject = fallback;
      if (subject) { updates.BRIDGE_PUSH_VAPID_SUBJECT = subject; log(`  Web Push contact: ${subject}`); }
      else {
        if (subjectNow) updates.BRIDGE_PUSH_VAPID_SUBJECT = '';
        log('  Web Push contact: none. Set BRIDGE_PUSH_VAPID_SUBJECT=mailto:<your address> in the env file (push services use');
        log('  it to reach you about problems with your pushes).');
        report.nextSteps.push(`Web Push: set BRIDGE_PUSH_VAPID_SUBJECT=mailto:<your address> in ${envFile}, then restart the bridge.`);
      }
    }

    step('Env file');
    const { env: newEnv, changed } = mergeEnv(existing, updates);
    report.envFile = { path: envFile, changed, keys: redactEnv(newEnv) };
    let routerKind = 'heuristic';
    try { routerKind = loadConfig({ ...newEnv, HERMES_BASE_URL: 'http://127.0.0.1', BRIDGE_ALLOW_NO_AUTH: '1', BRIDGE_BOOTSTRAP: 'off' }).router.kind; } catch { /* invalid hand-set value: the bridge reports it at start */ }
    report.extras.directProviders = directProviders(newEnv, routerKind);
    log(`  ${directProvidersLine(report.extras.directProviders)}`);
    if (dry) {
      log(`  (dry-run) would write ${envFile} (0600), changed: ${changed.join(', ') || 'nothing'}`);
      log(serializeEnv(redactEnv(newEnv)).split('\n').map((l) => `    ${l}`).join('\n'));
    } else if (changed.length || !existsSync(envFile)) {
      writeEnvFile(envFile, newEnv);
      log(`  wrote ${envFile} (0600), changed: ${changed.join(', ') || 'nothing'}`);
    } else log(`  ${envFile} unchanged`);
    log(`  Hermes key: ${mask(newEnv.HERMES_API_KEY)} (never printed)`);
    // the bridge creates its token at first start unless open mode is set by hand: the desktop app's origin is then
    // allowed without a BRIDGE_CORS_ORIGINS entry (src/cors.mjs)
    const authenticated = Boolean(newEnv.BRIDGE_TOKEN) || !/^(1|true|yes|on)$/i.test(newEnv.BRIDGE_ALLOW_NO_AUTH ?? '');
    const cors = corsOriginsFromEnv(newEnv, { authenticated });
    report.network.corsOrigins = cors.origins;
    report.network.desktopApp = cors.desktop;
    log(`  Browser origins: ${describeOrigins(cors, { authenticated })}`);
    if (cors.desktop) log('  The desktop app (macOS, Linux, Windows) pairs with the same https:// link as the phone, no extra setting needed.');

    // ---------- 5. Service ----------
    step('Service');
    let kind = opts.service;
    if (kind === 'auto') {
      // inside a container (Hermes itself runs in Docker/Podman): no service manager here, and a compose file for a
      // second container would be wrong, since Hermes is on 127.0.0.1 of THIS container. Run the bridge right here.
      if (deps.inContainer ?? inContainer()) {
        kind = 'none';
        log('  Running inside a container: the bridge runs right here, next to Hermes (start it from the container\'s entrypoint');
        log('  or supervisor to keep it running). `--service docker` prints a compose service for a separate bridge container instead.');
      } else if (platform === 'darwin') kind = 'launchd';
      else if (platform === 'linux' && exec(['systemctl', '--version']).code === 0) kind = 'systemd';
      else kind = 'none';
    }
    const fromNpxCache = deps.fromNpxCache ?? isNpxCachePath(BIN_PATH);
    report.service.cli = cliName(fromNpxCache);
    const nodeDir = dirname(deps.nodePath ?? process.execPath);
    const argv = execArgv({ nodePath: deps.nodePath ?? process.execPath, binPath: deps.binPath ?? BIN_PATH, npxPath: existsSync(join(nodeDir, 'npx')) ? join(nodeDir, 'npx') : 'npx', version, envFile: kind === 'systemd' ? null : envFile, fromNpxCache });
    report.service = { ...report.service, kind, argv };
    if (hasPlugin && hardened && kind !== 'systemd' && !existing.BRIDGE_HERMES_PLUGIN_SECRET_FILE) {
      report.nextSteps.push(`Schnellfrage: set BRIDGE_HERMES_PLUGIN_SECRET_FILE=${pluginSecret} in ${envFile} (the file must be readable by the user that runs the bridge).`);
    }
    let started = false;
    if (kind === 'systemd') {
      const system = isRoot;
      const problem = system ? systemServiceProblem(argv, { fromNpxCache }) : '';
      if (problem) { warn(problem); report.service.skipped = problem; }
      else {
        const unitPath = systemdUnitPath({ system, home, env });
        // the plugin secret lives in the Hermes home: a system unit gets it as a credential ($CREDENTIALS_DIRECTORY)
        const credentials = system && hasPlugin ? [{ name: 'hui-plugin-secret', path: pluginSecret, env: 'BRIDGE_HERMES_PLUGIN_SECRET_FILE' }] : [];
        const unit = systemdUnit({ argv, envFile, system, port: opts.port, credentials });
        if (credentials.length) log(`  Schnellfrage: plugin secret passed as systemd credential (LoadCredential=hui-plugin-secret:${pluginSecret})`);
        const same = existsSync(unitPath) && readFileSync(unitPath, 'utf8') === unit;
        report.service.path = unitPath;
        if (dry) log(`  (dry-run) would write ${unitPath}:\n${unit.split('\n').map((l) => `    ${l}`).join('\n')}`);
        else if (!same) { writeFileRaw(unitPath, unit); log(`  wrote ${unitPath}`); } else log(`  ${unitPath} unchanged`);
        const results = systemdCommands({ system }).map((c) => run(c));
        started = !dry && results.every((r) => r.code === 0);
        if (!system) {
          const linger = dry ? { stdout: '' } : exec(['loginctl', 'show-user', String(env.USER || ''), '-p', 'Linger']);
          if (/Linger=no/.test(linger.stdout)) report.nextSteps.push(`Keep the bridge running after you log out: loginctl enable-linger ${env.USER || '$USER'}`);
        }
        report.nextSteps.push(`Logs: journalctl ${system ? '' : '--user '}-u ${SERVICE_NAME} -f`);
      }
    } else if (kind === 'launchd') {
      const plistPath = launchdPlistPath(home);
      const plist = launchdPlist({ argv, home, port: opts.port });
      report.service.path = plistPath;
      if (dry) log(`  (dry-run) would write ${plistPath}`);
      else { writeFileRaw(plistPath, plist, 0o644); log(`  wrote ${plistPath}`); }
      const results = launchdCommands({ uid, plistPath }).map((c) => run(c.argv, { ignoreFailure: c.ignoreFailure }));
      started = !dry && results[results.length - 1].code === 0;
      report.nextSteps.push(`Logs: ~/Library/Logs/${SERVICE_NAME}.log`);
    } else if (kind === 'docker') {
      const snippet = composeSnippet({ envFile, port: opts.port, hermesPort: hermes.api.port, webDir: newEnv.BRIDGE_WEB_DIR || '', hermesHome: hermes.exists ? hHome : '' });
      report.service.compose = snippet;
      log('  Docker: use this compose service (the env file above is reused):\n');
      log(snippet.split('\n').map((l) => `    ${l}`).join('\n'));
      log('  Note: Hermes must listen on an address the container can reach (127.0.0.1 on the host is not).');
      report.nextSteps.push('Start the container: docker compose up -d --build');
    } else {
      log('  No service manager used. Start the bridge yourself:');
      log(`    ${argv.join(' ')}`);
      report.nextSteps.push(`Start the bridge: ${argv.join(' ')}`);
    }

    if (started) {
      const h = await waitForBridge(opts.port, { fetch: doFetch, tries: deps.healthTries ?? 20, delayMs: deps.healthDelayMs ?? 500 });
      report.service.health = h;
      if (!h.up) warn(`the bridge did not answer on http://127.0.0.1:${opts.port} (see the logs)`);
      else log(`  bridge is up on http://127.0.0.1:${opts.port}${h.hermesStatus === 200 ? ', Hermes reachable through it' : `, Hermes answered ${h.hermesStatus} through it`}`);
    }

    // ---------- 6. tailscale serve ----------
    if (serveArgs) {
      step('Tailscale');
      const r = run(['tailscale', ...serveArgs]);
      report.network.serve = { command: `tailscale ${serveArgs.join(' ')}`, ok: r.code === 0, ran: !dry };
      if (r.code !== 0 && !dry) report.nextSteps.push(`Run it yourself (may need sudo or \`tailscale set --operator=$USER\`): tailscale ${serveArgs.join(' ')}`);
      else log(`  ${publicUrl} -> http://127.0.0.1:${opts.port} (tailnet only; never use tailscale funnel for this)`);
    }

    // ---------- 7. Pair ----------
    if (opts.pair) {
      step('Pair your device');
      if (kind === 'docker') log('  Docker: pair with `docker compose exec bridge node bin/hermes-ui-bridge.mjs devices add "Phone"`.');
      else if (dry) log('  (dry-run) would create a one-time pairing code and print the pair QR code');
      else {
        const { createDeviceStore } = await import('../devices.mjs');
        const { buildPairUri, loadPairConfig, qrTerminal } = await import('../pair.mjs');
        const store = createDeviceStore({ dir: stateDir });
        // a re-run replaces the unused link of the previous run instead of piling up pending devices
        const d = store.issue(`${SETUP_LABEL}${now().toISOString().slice(0, 16).replace('T', ' ')}`, { replacePending: (l) => l.startsWith(SETUP_LABEL) });
        fixOwnership(store.file, stateDir, isRoot);
        if (d.replaced) log(`  (replaces the unused pair link${d.replaced > 1 ? 's' : ''} of an earlier setup run)`);
        const pc = loadPairConfig({ ...newEnv, BRIDGE_PUBLIC_URL: publicUrl });
        const url = pc.publicUrl || `http://127.0.0.1:${opts.port}`;
        const link = buildPairUri({ url, code: d.code, name: pc.name, scheme: pc.scheme });
        const web = newEnv.BRIDGE_WEB_DIR && publicUrl ? webPairLink(pc.publicUrl, d.code, pc.name) : '';
        // no HTTPS address yet: browsers treat http://127.0.0.1 as a secure origin, so the full web app (offline shell,
        // install) works there for a first test on the bridge machine itself. Same one-time code: whichever link is used first.
        const local = newEnv.BRIDGE_WEB_DIR && !/^https:/i.test(publicUrl || '') ? webPairLink(`http://127.0.0.1:${opts.port}`, d.code, pc.name) : '';
        report.pair = { deviceId: d.id, link, webLink: web, localWebLink: local, expiresInMinutes: 60, oneTime: true, localOnly: !publicUrl };
        if (publicUrl) {
          if (!opts.json) {
            log('  Scan with the HUI+ app (Scan QR code). One-time pairing code: works once, expires in 1 hour.');
            log(await qrTerminal(link));
          }
          log(`  Pair link: ${opts.json ? '(in the JSON report)' : link}`);
        } else {
          // a QR code for 127.0.0.1 looks usable but a phone would connect to itself: print no QR, say what to do
          warn('no address a phone can reach yet: the pair link points to 127.0.0.1 (this machine only), so no QR code is shown');
          // the desktop app connects to https:// servers only (its CSP), so this link is for tools on this machine
          log(`  Pair link for this machine only: ${opts.json ? '(in the JSON report)' : link}`);
          log('  The desktop app needs an https:// address (Tailscale, or --public-url https://…); this link does not work there.');
        }
        if (web) log(`  Web app: ${opts.json ? '(in the JSON report)' : web}`);
        if (local) log(`  Web app, in a browser on this machine: ${opts.json ? '(in the JSON report)' : local}`);
        if (!publicUrl) for (const l of phoneAddressHelp({ envFile, port: opts.port, httpsPort: opts.httpsPort, lanIp: lan[0], cli: report.service.cli, kind, system: isRoot })) log(l);
        log(`  New pair link later: ${report.service.cli} devices add "Phone" --env-file ${envFile}`);
        log(`  Revoke later: ${report.service.cli} devices revoke ${d.id} --env-file ${envFile}`);
      }
    }
  } catch (e) {
    report.ok = false;
    report.error = e.message;
    log(`  XX ${e.message}`);
  } finally {
    p.close();
  }
  if (report.nextSteps.length) { log('\nNext steps:'); for (const s of report.nextSteps) log(`  - ${s}`); }
  return report;
}

/**
 * What to do when the bridge has no address a phone can reach (no Tailscale, no BRIDGE_PUBLIC_URL): where the setting
 * lives, the two usual values, and how to get a fresh pair link afterwards.
 */
export function phoneAddressHelp({ envFile, port = 8790, httpsPort = 8790, lanIp = '', cli = SERVICE_NAME, kind = 'none', system = false }) {
  const restart = kind === 'systemd' ? `systemctl ${system ? '' : '--user '}restart ${SERVICE_NAME}`
    : kind === 'launchd' ? `launchctl kickstart -k gui/$(id -u)/${LAUNCHD_LABEL}`
      : 'stop the bridge and start it again';
  return [
    '',
    '  To pair a phone, give the bridge an address the phone can reach. Edit BRIDGE_PUBLIC_URL in',
    `    ${envFile}`,
    '  and pick one of:',
    `    a) Tailscale (recommended, HTTPS, works for the app and the installable web app): install Tailscale on this`,
    `       machine and the phone, run \`tailscale up\`, then simply re-run setup; it runs`,
    `       tailscale serve --bg --https=${httpsPort} http://127.0.0.1:${port}`,
    `       and sets BRIDGE_PUBLIC_URL=https://<machine>.<tailnet>.ts.net${httpsPort === 443 ? '' : `:${httpsPort}`} for you.`,
    '    b) LAN test over plain HTTP (Android app only, trusted home network, never forward the port): put these two',
    '       lines into the env file:',
    '         BRIDGE_HOST=0.0.0.0',
    `         BRIDGE_PUBLIC_URL=http://${lanIp || '<lan-ip-of-this-machine>'}:${port}`,
    `  After b), restart the bridge (${restart}) and create a new pair link:`,
    `    ${cli} devices add "Phone" --env-file ${envFile}`,
    '',
  ];
}

/** Docker (`/.dockerenv`) or Podman (`/run/.containerenv`) container? */
export function inContainer(exists = existsSync) {
  return exists('/.dockerenv') || exists('/run/.containerenv');
}

/** How the user runs the CLI again: from the npx cache there is no `hermes-ui-plus-bridge` on PATH. */
export function cliName(fromNpxCache) {
  return fromNpxCache ? `npx ${SERVICE_NAME}` : SERVICE_NAME;
}

/** Plain file write (unit/plist), creating the directory. */
function writeFileRaw(file, text, mode = 0o644) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, { mode });
}

/** Root wrote devices.json into a service's state dir: hand it to the dir owner (systemd DynamicUser). */
function fixOwnership(file, dir, isRoot) {
  if (!isRoot) return;
  try {
    const st = statSync(dir);
    if (st.uid !== 0) chownSync(file, st.uid, st.gid);
  } catch { /* best effort */ }
}

/** Label prefix of the pending device a setup run creates (a re-run replaces its own unused one). */
export const SETUP_LABEL = 'setup ';
/** VAPID subject older setup versions wrote: not a contact anybody reads. */
export const PLACEHOLDER_VAPID_SUBJECT = 'mailto:admin@localhost';
const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** `--public-url`: an absolute http(s) URL without path, query or trailing slash. */
export function publicUrlArg(v) {
  let u;
  try { u = new URL(String(v).trim()); } catch { throw new Error('--public-url must be an absolute http(s) URL, e.g. http://192.0.2.10:8790'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('--public-url must be an absolute http(s) URL, e.g. http://192.0.2.10:8790');
  if (u.username || u.password || u.search || u.hash) throw new Error('--public-url must not contain credentials, a query or a fragment');
  return u.toString().replace(/\/+$/, '');
}

/** A Web Push contact: `mailto:` + address, a bare address (gets `mailto:`) or an https URL. '' when not usable. */
export function vapidContact(v) {
  const t = String(v ?? '').trim();
  if (!t || t === PLACEHOLDER_VAPID_SUBJECT) return '';
  const mail = /^(?:mailto:)?([^\s@:/]+@[^\s@/]+\.[^\s@/]+)$/i.exec(t);
  if (mail) return `mailto:${mail[1]}`;
  if (/^https:\/\//i.test(t)) {
    try { const u = new URL(t); return /\S/.test(u.hostname) && !LOOPBACK_NAMES.has(u.hostname) ? u.toString().replace(/\/+$/, '') : ''; } catch { return ''; }
  }
  return '';
}
