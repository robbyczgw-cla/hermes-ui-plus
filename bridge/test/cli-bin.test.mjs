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
