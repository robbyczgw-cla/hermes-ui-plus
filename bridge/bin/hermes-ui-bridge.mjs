#!/usr/bin/env node
// `npx hermes-ui-plus-bridge setup` (wizard) or `npx hermes-ui-plus-bridge [--env-file .env] [--pair]` (bin alias: hermes-ui-bridge) - see ../README.md
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nodeTooOld, nodeTooOldMessage } from '../src/node-version.mjs';

// Node check before anything else is loaded (static imports above are plain and work on old Node; cli.mjs does not)
if (nodeTooOld(process.versions.node)) {
  process.stderr.write(nodeTooOldMessage(process.versions.node, process.execPath));
  process.exit(1);
}
const { HELP, parseArgs, prepareEnv, preflight, featureSummary } = await import('../src/cli.mjs');

const here = dirname(fileURLToPath(import.meta.url));
const out = (s = '') => process.stdout.write(`${s}\n`);
const err = (s) => process.stderr.write(`${s}\n`);

/** `hermes-ui-bridge devices list|add <label>|revoke <id> [--env-file f] [--state-dir d]` (review M5). */
async function devicesCmd(argv) {
  const [sub, ...rest] = argv;
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
  const store = createDeviceStore({ dir });
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
  if (process.argv[2] === 'setup') return setupCmd(process.argv.slice(3));
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
    const results = await preflight(config);
    for (const r of results) out(`  [${r.level === 'ok' ? 'ok' : r.level === 'warn' ? '!!' : 'XX'}] ${r.message}`);
    if (results.some((r) => r.level === 'error' || (opts.strict && r.fatalWhenStrict))) process.exit(1);
  }
  out('  features:');
  for (const [k, v] of featureSummary(config, env, { pairing })) out(`    ${k.padEnd(8)} ${v}`);

  const stopServices = startServices(ctx); // uploads retention + push watcher, same as src/server.mjs (Astra F13)
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  out(`  listening on http://${config.host}:${server.address().port}`);
  logger.info('listening', { host: config.host, port: server.address().port, router: config.router.kind, auth: config.token ? 'token' : 'none' });

  if (opts.pair) {
    try {
      const uri = pairing.payload('paired via --pair');
      out(`\n  Scan with the Hermes UI+ app (Settings > Scan QR code). ${devices ? 'One-time pairing code: works once, expires in 1 hour.' : 'Contains a credential, keep it private.'}`);
      if (!pairing.config.publicUrl) out(`  note: BRIDGE_PUBLIC_URL is not set, the QR points to ${pairing.effectiveUrl()}`);
      out(await qrTerminal(uri));
    } catch (e) {
      err(`  pairing refused: ${e.message}`);
    }
  } else if (tokenInfo?.created) {
    out('\n  Pair the app: restart with --pair, or open http://127.0.0.1:' + server.address().port + '/bridge/pair on this machine.');
  }
  installShutdownHandlers(ctx, stopServices);
}

main().catch((e) => {
  err(`error: ${e.message}`);
  process.exit(e.code === 'EADDRINUSE' ? 3 : 1);
});
