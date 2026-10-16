// CLI entry (bin/hermes-ui-bridge.mjs): refuses too-old Node with an actionable message instead of a SyntaxError from a
// missing `node:util` export, and `devices` finds the wizard's env file on its own. Findings of the first-install test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIN_NODE_MAJOR, nodeTooOld, nodeTooOldMessage } from '../src/node-version.mjs';

test('nodeTooOld: below 22 (Ubuntu 24.04 ships 18) is too old; 22+ is fine', () => {
  assert.equal(MIN_NODE_MAJOR, 22);
  for (const v of ['18.19.1', 'v20.12.0', '21.7.3', 'garbage', '']) assert.equal(nodeTooOld(v), true, v);
  for (const v of ['22.0.0', 'v22.23.3', '24.1.0', '26.7.0']) assert.equal(nodeTooOld(v), false, v);
  const m = nodeTooOldMessage('18.19.1', '/usr/bin/node');
  assert.match(m, /needs Node\.js 22 or newer, but this is Node v18\.19\.1 \(\/usr\/bin\/node\)/);
  assert.match(m, /nodejs\.org/);
});

test('bin checks the Node version before it loads modules that need Node 22', () => {
  const bin = readFileSync(new URL('../bin/hermes-ui-bridge.mjs', import.meta.url), 'utf8');
  const staticImports = [...bin.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(staticImports.filter((s) => !s.startsWith('node:')), ['../src/node-version.mjs']);
  assert.ok(bin.indexOf('nodeTooOld(') < bin.indexOf("await import('../src/cli.mjs')"));
  const src = readFileSync(new URL('../src/node-version.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m, 'the gate itself must not import anything');
});

test('devices add without --env-file uses the env file the setup wizard wrote (public URL, web dir)', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const root = mkdtempSync(join(tmpdir(), 'hub-devices-'));
  const cfg = join(root, 'config', 'hermes-ui-plus-bridge');
  mkdirSync(cfg, { recursive: true });
  mkdirSync(join(root, 'web'));
  writeFileSync(join(cfg, 'env'), `BRIDGE_PUBLIC_URL=https://box.example.ts.net:8790\nBRIDGE_STATE_DIR=${join(root, 'state')}\nBRIDGE_WEB_DIR=${join(root, 'web')}\n`, { mode: 0o600 });
  const env = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: join(root, 'config') };
  const r = spawnSync(process.execPath, [new URL('../bin/hermes-ui-bridge.mjs', import.meta.url).pathname, 'devices', 'add', 'Laptop'], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /settings from .*hermes-ui-plus-bridge\/env/);
  assert.match(r.stdout, /hermesuiplus:\/\/pair\?u=https%3A%2F%2Fbox\.example\.ts\.net%3A8790&c=/);
  assert.match(r.stdout, /Web app:\nhttps:\/\/box\.example\.ts\.net:8790\/#pair\?/);
  rmSync(root, { recursive: true });
});

// ---- fresh-user test of 0.1.0-alpha.1: help links, missing env file, --strict reason, pair hint ----
test('--help points to GitHub docs URLs (npx has no checkout), and says the --env-file must exist', async () => {
  const { HELP } = await import('../src/cli.mjs');
  assert.doesNotMatch(HELP, /Docs: bridge\/README\.md/);
  for (const f of ['bridge/README.md', 'docs/SELF-HOSTING.md', 'docs/WEB-APP.md']) assert.ok(HELP.includes(`https://github.com/robbyczgw-cla/hermes-ui-plus/blob/main/${f}`), f);
  assert.match(HELP, /must exist/);
});

test('docUrl: blob for files, tree for directories, anchors kept', async () => {
  const { docUrl, REPO_URL } = await import('../src/links.mjs');
  assert.equal(docUrl('docs/WEB-APP.md#troubleshooting'), `${REPO_URL}/blob/main/docs/WEB-APP.md#troubleshooting`);
  assert.equal(docUrl('bridge/'), `${REPO_URL}/tree/main/bridge/`);
});

test('a missing --env-file is a friendly error that says how to create it', async () => {
  const { loadEnvFiles } = await import('../src/cli.mjs');
  assert.throws(() => loadEnvFiles(['/nonexistent-test-dir/bridge.env'], {}), (e) => /env file not found: \/nonexistent-test-dir\/bridge\.env/.test(e.message)
    && /install -m 600 \/dev\/null/.test(e.message) && /setup/.test(e.message));
});

test('fetchErrorReason / preflight: the real cause instead of "(TypeError)"', async () => {
  const { fetchErrorReason, preflight } = await import('../src/cli.mjs');
  const wrap = (cause) => Object.assign(new TypeError('fetch failed'), { cause });
  assert.equal(fetchErrorReason(wrap(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))), 'ECONNREFUSED');
  assert.equal(fetchErrorReason(wrap(new AggregateError([Object.assign(new Error('x'), { code: 'EHOSTUNREACH' })]))), 'EHOSTUNREACH');
  assert.match(fetchErrorReason(wrap(new Error('bad port'))), /bad port.*another port/);
  assert.equal(fetchErrorReason(wrap(new Error('something odd'))), 'something odd');
  assert.equal(fetchErrorReason(Object.assign(new Error('t'), { name: 'TimeoutError' })), 'timed out');
  assert.equal(fetchErrorReason(new TypeError('fetch failed')), 'fetch failed');
  // a real request to a port fetch refuses (the report's example: port 1)
  const config = { upstream: { baseUrl: 'http://127.0.0.1:1', apiKey: '' } };
  const [r] = await preflight(config);
  assert.equal(r.fatalWhenStrict, true);
  assert.doesNotMatch(r.message, /\(TypeError\)/);
  assert.match(r.message, /bad port/);
});

test('bin --strict with an unreachable Hermes: exit 1 with a reason', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'hui-strict-'));
  try {
    const r = spawnSync(process.execPath, [new URL('../bin/hermes-ui-bridge.mjs', import.meta.url).pathname, '--strict', '--port', '0', '--state-dir', dir],
      { env: { PATH: process.env.PATH, HERMES_BASE_URL: 'http://127.0.0.1:1' }, encoding: 'utf8', timeout: 20_000 });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /Hermes not reachable at http:\/\/127\.0\.0\.1:1 \(port blocked/);
    assert.match(r.stderr, /stopping \(--strict: Hermes must be reachable at start/);
    assert.doesNotMatch(r.stdout + r.stderr, /\(TypeError\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('pairHint: BRIDGE_PAIRING=1 points to /bridge/pair?code=..., Docker to devices add via compose exec', async () => {
  const { pairHint } = await import('../src/cli.mjs');
  const plain = pairHint({ port: 8790 });
  assert.match(plain, /restart with --pair/); assert.match(plain, /http:\/\/127\.0\.0\.1:8790\/bridge\/pair on this machine/);
  const pairing = pairHint({ port: 8790, pairingEnabled: true, inContainer: true });
  assert.match(pairing, /\/bridge\/pair\?code=/);
  assert.match(pairing, /docker compose exec bridge node bin\/hermes-ui-bridge\.mjs devices add "Phone"/);
  assert.doesNotMatch(pairing, /127\.0\.0\.1/);
  const docker = pairHint({ port: 8790, inContainer: true });
  assert.match(docker, /docker compose exec/); assert.doesNotMatch(docker, /on this machine/);
});
