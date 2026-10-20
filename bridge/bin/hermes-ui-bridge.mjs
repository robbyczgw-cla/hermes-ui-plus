#!/usr/bin/env node
// `npx hermes-ui-plus-bridge setup` (wizard) or `npx hermes-ui-plus-bridge [--env-file .env] [--pair]` (bin alias: hermes-ui-bridge) - see ../README.md
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nodeTooOld, nodeTooOldMessage } from '../src/node-version.mjs';

// Node check before anything else is loaded (static imports above are plain and work on old Node; cli.mjs does not)
if (nodeTooOld(process.versions.node)) {
  process.stderr.write(nodeTooOldMessage(process.versions.node, process.execPath));
  process.exit(1);
}
const { HELP, parseArgs, prepareEnv, loadEnvFiles, preflight, featureSummary, pairHint, inBridgeImage, recheckUntilReachable, checkMark } = await import('../src/cli.mjs');

const here = dirname(fileURLToPath(import.meta.url));
const out = (s = '') => process.stdout.write(`${s}\n`);
const err = (s) => process.stderr.write(`${s}\n`);

/** Shared by `devices` and `routines`: flags, the setup wizard's env file, the device store of the state dir. */
async function deviceStoreFromArgs(rest) {
  const positional = [];
  const flags = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--env-file' || rest[i] === '--state-dir') flags.push(rest[i], rest[++i]);
    else if (rest[i].startsWith('--')) flags.push(rest[i]);
    else positional.push(rest[i]);
  }
  const opts = parseArgs(flags);
  // no --env-file: use the settings the setup wizard wrote (public URL, web dir, state dir), so a new pair link
  // points to the right address instead of 127.0.0.1
  if (!opts.envFiles.length) {
    const { defaultEnvFile } = await import('../src/setup/files.mjs');
    const file = defaultEnvFile(process.env, undefined, { root: process.getuid?.() === 0 });
    if (existsSync(file)) { opts.envFiles.push(file); err(`(settings from ${file})`); }
  }
  const { env } = prepareEnv(opts);
  const { deviceStateDir } = await import('../src/server.mjs');
  const { createDeviceStore } = await import('../src/devices.mjs');
  const dir = deviceStateDir(env);
  if (!dir) {
    err('device tokens are off (BRIDGE_DEVICE_TOKENS=0) or no state directory');
    process.exit(2);
  }
  return { env, positional, store: createDeviceStore({ dir }) };
}

/** `hermes-ui-bridge devices list|add <label>|revoke <id> [--env-file f] [--state-dir d]` (review M5). */
async function devicesCmd(argv) {
  const [sub, ...rest] = argv;
  const { env, positional, store } = await deviceStoreFromArgs(rest);
  if (sub === 'list' || !sub) {
    const list = store.list();
    if (!list.length) return out(`no device tokens in ${store.file}`);
    for (const d of list) out(`${d.id}  ${d.status.padEnd(8)}  last used ${d.lastUsedAt ? new Date(d.lastUsedAt).toISOString().slice(0, 16) : '-'.padEnd(16)}  ${d.label}`);
    return;
  }
  if (sub === 'revoke') {
    if (!positional[0]) throw new Error('usage: hermes-ui-bridge devices revoke <id>');
    if (!store.revoke(positional[0])) throw new Error(`unknown device ${positional[0]}`);
    return out(`revoked ${positional[0]} (a running bridge picks this up within 2 s)`);
  }
  if (sub === 'add') {
    const { loadConfig } = await import('../src/config.mjs');
    const { createPairing, qrTerminal } = await import('../src/pair.mjs');
    const pairing = createPairing(loadConfig({ HERMES_BASE_URL: 'http://127.0.0.1:8642', ...env }), { env: { ...env, BRIDGE_PAIRING: '' }, devices: store });
    const d = pairing.issue(positional.join(' ') || 'added via CLI');
    out(`device ${d.id}: one-time pairing code, works once, expires in 1 hour. Scan with the app:`);
    out(await qrTerminal(d.uri));
    out(`Or paste this link in the app ("Paste a link"):\n${d.uri}`);
    if (d.webUri) out(`Web app:\n${d.webUri}`);
    return;
  }
  throw new Error('usage: hermes-ui-bridge devices list|add [label]|revoke <id> [--env-file f] [--state-dir d]');
}

/** `hermes-ui-bridge routines status|enable <bot>|disable <bot>|grant <device-id> <bot> <right>` (src/routines-rights.mjs). */
async function routinesCmd(argv) {
  const [sub, ...rest] = argv;
  const { env, positional, store } = await deviceStoreFromArgs(rest);
  const { routinesCli } = await import('../src/routines-rights.mjs');
  for (const line of routinesCli(sub, positional, { env, store })) out(line);
}

/**
 * `hermes-ui-plus-bridge doctor bots` / `bots backup|rollback` (src/bots-doctor.mjs, docs/BOTS-SERVER.md): read-only
 * checks of the Hermes home for bots, and the owner's backup / rollback around the one-time server steps.
 */
async function botsCmd(sub, argv) {
  const flags = [];
  const rest = [];
  let home;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--hermes-home') home = argv[++i];
    else if (argv[i] === '--env-file') flags.push(argv[i], argv[++i]);
    else rest.push(argv[i]);
  }
  const opts = parseArgs(flags);
  if (!opts.envFiles.length) {
    const { defaultEnvFile } = await import('../src/setup/files.mjs');
    const file = defaultEnvFile(process.env, undefined, { root: process.getuid?.() === 0 });
    if (existsSync(file)) { opts.envFiles.push(file); err(`(settings from ${file})`); }
  }
  // read-only: no prepareEnv (it would generate and store a BRIDGE_TOKEN)
  const env = loadEnvFiles(opts.envFiles, process.env, process.cwd());
  const { hermesHome } = await import('../src/setup/detect.mjs');
  const { botsCli } = await import('../src/bots-doctor.mjs');
  const r = botsCli(sub, rest, { home: home ? resolve(home) : hermesHome(env), env });
  for (const line of r.lines) out(line);
  process.exitCode = r.code;
}

/** `hermes-ui-plus-bridge bots status|enable|disable|grant <device-id>|revoke <device-id>` (src/bots-manage.mjs). */
async function botsManageCmd(argv) {
  const [sub, ...rest] = argv;
  const { env, positional, store } = await deviceStoreFromArgs(rest);
  const { botsManageCli } = await import('../src/bots-manage.mjs');
  for (const line of botsManageCli(sub, positional, { env, store })) out(line);
}

/** `hermes-ui-plus-bridge setup [--yes] [--dry-run] [--json] ...` (src/setup/wizard.mjs). */
async function setupCmd(argv) {
  const { parseSetupArgs, runSetup, SETUP_HELP } = await import('../src/setup/wizard.mjs');
  const opts = parseSetupArgs(argv);
  if (opts.help) return out(SETUP_HELP);
  const report = await runSetup(opts);
  if (opts.json) out(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

async function main() {
  if (process.argv[2] === 'devices') return devicesCmd(process.argv.slice(3));
  if (process.argv[2] === 'routines') return routinesCmd(process.argv.slice(3));
  if (process.argv[2] === 'setup') return setupCmd(process.argv.slice(3));
  if (process.argv[2] === 'doctor' && process.argv[3] === 'bots') return botsCmd('doctor', process.argv.slice(4));
  if (process.argv[2] === 'bots' && ['status', 'enable', 'disable', 'grant', 'revoke'].includes(process.argv[3])) return botsManageCmd(process.argv.slice(3));
  if (process.argv[2] === 'bots') return botsCmd(process.argv[3], process.argv.slice(4));
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return out(HELP);
  if (opts.version) return out(JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')).version);

  const { env, tokenInfo } = prepareEnv(opts);
  if (!env.HERMES_BASE_URL) {
    err('HERMES_BASE_URL is not set. Set it in the environment or an env file (--env-file .env), e.g.\n  HERMES_BASE_URL=http://127.0.0.1:8642\n  HERMES_API_KEY=<your Hermes API_SERVER_KEY>');
    process.exit(2);
  }
  const { createServer, startServices, installShutdownHandlers } = await import('../src/server.mjs');
  const { qrTerminal } = await import('../src/pair.mjs');
  const ctx = createServer(env);
  const { server, config, logger, pairing, devices } = ctx;

  out('hermes-ui-plus-bridge');
  if (tokenInfo?.created) out(`  generated a new BRIDGE_TOKEN, stored in ${tokenInfo.file} (mode 0600)`);
  else if (tokenInfo) out(`  using the BRIDGE_TOKEN stored in ${tokenInfo.file}`);
  if (opts.check) {
    const { hermesHome } = await import('../src/setup/detect.mjs');
    const check = () => preflight(config, { hermesHome: hermesHome(env), hermesHomeExplicit: Boolean(env.HERMES_HOME) });
    const results = await check();
    for (const r of results) out(`  [${checkMark(r.level)}] ${r.message}`);
    const fatal = results.filter((r) => r.level === 'error' || (opts.strict && r.fatalWhenStrict));
    if (fatal.length) {
      err(fatal.some((r) => r.level === 'error') ? '  stopping: see the error above'
        : '  stopping (--strict: Hermes must be reachable at start; leave --strict out to start anyway and retry later)');
      process.exit(1);
    }
    // not reachable yet (Docker compose starts Hermes and the bridge together): report key and skill once it answers
    if (results[0]?.fatalWhenStrict) {
      recheckUntilReachable(check, (lines, ms) => {
        out(`  startup checks, ${Math.round(ms / 1000)} s after start:`);
        for (const r of lines) out(`  [${checkMark(r.level)}] ${r.message}`);
      }, { intervalMs: Number(process.env.HUI_TEST_RECHECK_MS) || 5000 });
    }
  }
  out('  features:');
  for (const [k, v] of featureSummary(config, env, { pairing, profiles: ctx.profiles })) out(`    ${k.padEnd(8)} ${v}`);

  const stopServices = startServices(ctx); // uploads retention + push watcher, same as src/server.mjs (Astra F13)
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  out(`  listening on http://${config.host}:${server.address().port}`);
  logger.info('listening', { host: config.host, port: server.address().port, router: config.router.kind, auth: config.token ? 'token' : 'none' });

  if (opts.pair) {
    try {
      const uri = pairing.payload('paired via --pair');
      out(`\n  Scan with the HUI+ app (Settings > Scan QR code). ${devices ? 'One-time pairing code: works once, expires in 1 hour.' : 'Contains a credential, keep it private.'}`);
      if (!pairing.config.publicUrl) out(`  note: BRIDGE_PUBLIC_URL is not set, the QR points to ${pairing.effectiveUrl()}`);
      out(await qrTerminal(uri));
    } catch (e) {
      err(`  pairing refused: ${e.message}`);
    }
  } else if (tokenInfo?.created) {
    const { inContainer, cliName, BIN_PATH } = await import('../src/setup/wizard.mjs');
    const { isNpxCachePath } = await import('../src/setup/service.mjs');
    out(`\n  ${pairHint({
      port: server.address().port, pairingEnabled: pairing.isEnabled(), inImage: inBridgeImage(env), inContainer: inContainer(),
      cli: cliName(isNpxCachePath(BIN_PATH)), envFile: opts.envFiles.length === 1 ? resolve(opts.envFiles[0]) : '',
    })}`);
  }
  installShutdownHandlers(ctx, stopServices);
}

main().catch((e) => {
  err(`error: ${e.message}`);
  process.exit(e.code === 'EADDRINUSE' ? 3 : 1);
});
