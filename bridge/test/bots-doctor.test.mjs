// `doctor bots` / `bots backup|rollback` (src/bots-doctor.mjs) against temp Hermes homes and a fake /proc. Nothing here
// touches a real Hermes, reads the real /proc of other processes or restarts anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  analyzeMaps, backupPlan, botsCli, botsDoctor, desktopBotMeta, factsFiles, findGatewayPids, isGatewayCmdline, multiplexSetting, pluginEnabled, rollbackPlan,
} from '../src/bots-doctor.mjs';

const KEY = 'test_key_' + 'k'.repeat(40);
const OTHER = 'test_key_' + 'z'.repeat(40);
const tmp = () => mkdtempSync(join(tmpdir(), 'hui-bots-doctor-'));

/** a Hermes home: default + `writer` (key ok, Desktop meta) + `scout` (no key) */
function home({ multiplex = true, facts = false, plugin = false } = {}) {
  const h = join(tmp(), '.hermes');
  mkdirSync(join(h, 'profiles', 'writer'), { recursive: true });
  mkdirSync(join(h, 'profiles', 'scout'), { recursive: true });
  writeFileSync(join(h, 'config.yaml'), `model:\n  default: m1\ngateway:\n  multiplex_profiles: ${multiplex}\n${plugin ? 'plugins:\n  enabled:\n    - hermes-ui-plus\n' : ''}`);
  writeFileSync(join(h, '.env'), `API_SERVER_KEY=${KEY}\n`);
  writeFileSync(join(h, 'profiles', 'writer', '.env'), `API_SERVER_KEY=${KEY}\nOTHER=1\n`);
  writeFileSync(join(h, 'profiles', 'writer', 'config.yaml'), 'model: m2\n');
  writeFileSync(join(h, 'profiles', 'writer', 'profile.yaml'), "description: x\nui_meta:\n  hermes-bots:\n    title: Quill\n    color: '#aa0000'\n");
  writeFileSync(join(h, 'profiles', 'writer', 'SOUL.md'), 'Du bist Quill.\n');
  writeFileSync(join(h, 'profiles', 'scout', '.env'), '# channel credentials stripped\n');
  if (facts) {
    mkdirSync(join(h, 'installs', 'abc123'), { recursive: true });
    writeFileSync(join(h, 'installs', 'abc123', 'facts.json'), '{"extras":["telegram"]}');
  }
  return h;
}

const fakeProc = (maps, cmd = '/opt/hermes/venv/bin/python -m hermes_cli.main gateway run') => ({
  available: () => true,
  list: () => [{ pid: 11, cmdline: 'node hermes-ui-plus-bridge doctor bots' }, { pid: 42, cmdline: cmd }, { pid: 7, cmdline: 'bash' }],
  maps: (pid) => (pid === 42 ? maps : null),
});
const GOOD_MAPS = [
  '7f00-7f01 r-xp 00000000 08:01 1 /opt/hermes/venv/lib/python3.11/site-packages/aiohttp/_http_parser.cpython-311-x86_64-linux-gnu.so',
  '7f02-7f03 r-xp 00000000 08:01 2 /usr/lib/x86_64-linux-gnu/libc.so.6',
].join('\n');

test('multiplex, plugin list, Desktop meta parsers', () => {
  assert.equal(multiplexSetting('gateway:\n  multiplex_profiles: true\n'), true);
  assert.equal(multiplexSetting('gateway:\n  multiplex_profiles: no\n'), false);
  assert.equal(multiplexSetting('gateway:\n  other: 1\n'), undefined);
  assert.equal(multiplexSetting(null), undefined);
  assert.equal(pluginEnabled('plugins:\n  enabled:\n    - a\n    - hermes-ui-plus\n', 'hermes-ui-plus'), true);
  assert.equal(pluginEnabled('plugins:\n  enabled: [a, "hermes-ui-plus"]\n', 'hermes-ui-plus'), true);
  assert.equal(pluginEnabled('plugins:\n  disabled:\n    - hermes-ui-plus\n', 'hermes-ui-plus'), false);
  assert.equal(pluginEnabled('other:\n  enabled:\n    - hermes-ui-plus\n', 'hermes-ui-plus'), false);
  assert.deepEqual(desktopBotMeta("ui_meta:\n  hermes-bots:\n    title: Quill\n    hidden: true\n"), { title: 'Quill', hidden: true });
  assert.equal(desktopBotMeta('description: x\n'), null);
});

test('gateway processes and their maps: venv, aiohttp, package-manager env', () => {
  assert.deepEqual(findGatewayPids(fakeProc('').list()), [42]);
  const a = analyzeMaps(GOOD_MAPS, '/root/.hermes');
  assert.deepEqual(a, { envs: ['/opt/hermes/venv'], aiohttp: true, fromInstalls: 0 });
  const bad = analyzeMaps('7f00 r-xp 0 0 1 /root/.hermes/installs/abc/env/lib/python3.12/site-packages/telegram/x.so', '/root/.hermes/');
  assert.equal(bad.fromInstalls, 1);
  assert.equal(bad.aiohttp, false);
  assert.deepEqual(bad.envs, ['/root/.hermes/installs/abc/env']);
});

test('gateway processes: real gateway command lines only, not shells or log viewers that name it (rollout rehearsal)', () => {
  for (const c of [
    '/opt/hermes/venv/bin/python -m hermes_cli.main gateway run',
    '/opt/hermes/venv/bin/python3.14 /opt/hermes/hermes_cli/main.py gateway run',
    '/usr/local/bin/hermes -p writer gateway run',
    '/opt/hermes/.venv/bin/python /opt/hermes/.venv/bin/hermes gateway run',
  ]) assert.equal(isGatewayCmdline(c), true, c);
  for (const c of [
    'tail -f /root/.hermes/logs/gateway.log',
    'journalctl -u hermes-gateway -f',
    'bash -c systemctl restart hermes-gateway && hermes gateway run',
    'less /root/.hermes/logs/gateway.log',
    'node /opt/hermes-ui-bridge/bin/hermes-ui-bridge.mjs doctor bots',
    '/opt/hermes/venv/bin/python -m hermes_cli.main gateway status',
    '/opt/hermes/venv/bin/python -m gateway.cgroup_cleanup',
    '',
  ]) assert.equal(isGatewayCmdline(c), false, c);
  const procs = [{ pid: 5, cmdline: 'tail -f /root/.hermes/logs/gateway.log' }, { pid: 6, cmdline: 'journalctl -u hermes-gateway -f' }, ...fakeProc('').list()];
  assert.deepEqual(findGatewayPids(procs), [42]);
});

test('doctor: multiplex unset explains the v0.22 default; gateway_state.json shows what the gateway serves', () => {
  const h = home();
  writeFileSync(join(h, 'config.yaml'), 'model:\n  default: m1\n');
  writeFileSync(join(h, 'gateway_state.json'), JSON.stringify({ served_profiles: ['default', 'writer'], multiplex_standalone_reason: null }));
  const r = botsDoctor({ home: h, bridgeKey: KEY, proc: fakeProc(GOOD_MAPS) });
  const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
  assert.equal(by.multiplex.level, 'warn');
  assert.match(by.multiplex.message, /second profile/);
  assert.match(by.served.message, /default, writer/);
  writeFileSync(join(h, 'gateway_state.json'), JSON.stringify({ served_profiles: [], multiplex_standalone_reason: 'only one profile exists (nothing to multiplex)' }));
  const one = Object.fromEntries(botsDoctor({ home: h, proc: fakeProc(GOOD_MAPS) }).results.map((x) => [x.id, x]));
  assert.match(one.served.message, /default profile only \(standalone: only one profile/);
  writeFileSync(join(h, 'gateway_state.json'), '{broken');
  assert.ok(!botsDoctor({ home: h, proc: fakeProc(GOOD_MAPS) }).results.some((x) => x.id === 'served'));
});

test('doctor: healthy server with one bot missing its key', () => {
  const h = home();
  const r = botsDoctor({ home: h, bridgeKey: KEY, bridgeProfiles: 'writer,scout', proc: fakeProc(GOOD_MAPS) });
  const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
  assert.equal(by.multiplex.level, 'ok');
  assert.equal(by['key:writer'].level, 'ok');
  assert.match(by['key:writer'].message, /Quill/);
  assert.equal(by['key:scout'].level, 'error');
  assert.match(by['key:scout'].message, /401/);
  assert.equal(by.facts.level, 'ok');
  assert.equal(by['gateway:42'].level, 'ok');
  assert.match(by['gateway:42'].message, /\/opt\/hermes\/venv/);
  assert.equal(by['bridge-profiles'].level, 'ok');
  assert.deepEqual(r.profiles.map((p) => [p.name, p.key, p.desktop]), [['scout', 'missing', false], ['writer', 'matches', true]]);
  // never prints a key
  assert.doesNotMatch(JSON.stringify(r), new RegExp(KEY));
});

test('doctor: the 2026-10 trap pattern is an error, a different key too; multiplex off is a warning', () => {
  const h = home({ multiplex: false, facts: true });
  writeFileSync(join(h, 'profiles', 'scout', '.env'), `API_SERVER_KEY=${OTHER}\n`);
  const maps = `7f00 r-xp 0 0 1 ${h}/installs/abc123/env/lib/python3.12/site-packages/telegram/a.so`;
  const r = botsDoctor({ home: h, bridgeKey: KEY, proc: fakeProc(maps) });
  const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
  assert.equal(by.multiplex.level, 'warn');
  assert.equal(by['key:scout'].level, 'error');
  assert.match(by['key:scout'].message, /differs/);
  assert.equal(by.facts.level, 'warn');
  assert.equal(by['gateway:42'].level, 'error');
  assert.equal(by['aiohttp:42'].level, 'warn');
  assert.equal(by['bridge-profiles'].level, 'info', 'unset BRIDGE_PROFILES: explains auto + sandbox');
  const cli = botsCli('doctor', [], { home: h, env: { HERMES_API_KEY: KEY }, proc: fakeProc(maps) });
  assert.equal(cli.code, 1);
  assert.match(cli.lines.join('\n'), /docs\/BOTS-SERVER\.md/);
});

test('doctor: no profiles → the app stays like 0.1; unreadable home → one clear error', () => {
  const h = join(tmp(), '.hermes');
  mkdirSync(h);
  writeFileSync(join(h, 'config.yaml'), 'model: m\n');
  const r = botsDoctor({ home: h, proc: { available: () => false, list: () => [], maps: () => null } });
  assert.ok(r.results.some((x) => x.id === 'profiles' && /no Bots tab/.test(x.message)));
  assert.ok(!r.results.some((x) => x.level === 'error'));
  const gone = botsDoctor({ home: join(h, 'nope') });
  assert.equal(gone.results.length, 1);
  assert.equal(gone.results[0].level, 'error');
});

test('backup copies configs, profile files and facts.json (0600); rollback restores and moves new facts.json aside', () => {
  const h = home();
  const dest = tmp();
  const b = botsCli('backup', ['--to', dest], { home: h, now: Date.UTC(2026, 9, 20, 8, 0, 0) });
  assert.equal(b.code, 0);
  const dir = join(dest, 'hermes-bots-20261020T080000Z');
  assert.ok(existsSync(join(dir, 'manifest.json')));
  assert.equal(statSync(join(dir, 'files', 'profiles', 'writer', '.env')).mode & 0o777, 0o600);
  assert.deepEqual(backupPlan(h).sort(), ['.env', 'config.yaml', 'profiles/scout/.env', 'profiles/writer/.env', 'profiles/writer/SOUL.md', 'profiles/writer/config.yaml', 'profiles/writer/profile.yaml'].sort());

  // the risky step happened: multiplex flipped, the package manager wrote a facts.json
  writeFileSync(join(h, 'config.yaml'), 'model: broken\n');
  mkdirSync(join(h, 'installs', 'newenv'), { recursive: true });
  writeFileSync(join(h, 'installs', 'newenv', 'facts.json'), '{}');
  mkdirSync(join(h, 'profiles', 'later'));
  const plan = rollbackPlan(h, dir);
  assert.deepEqual(plan.aside, ['installs/newenv/facts.json']);
  assert.deepEqual(plan.newProfiles, ['later']);
  const dry = botsCli('rollback', [dir], { home: h });
  assert.match(dry.lines.join('\n'), /Nothing changed yet/);
  assert.match(dry.lines.join('\n'), /keeps multiplexing[\s\S]*move the profiles listed above/, 'a new profile keeps the bots served after a file rollback');
  assert.match(readFileSync(join(h, 'config.yaml'), 'utf8'), /broken/, 'dry run changes nothing');

  const done = botsCli('rollback', [dir, '--yes'], { home: h, now: Date.UTC(2026, 9, 20, 9, 0, 0) });
  assert.equal(done.code, 0);
  assert.match(readFileSync(join(h, 'config.yaml'), 'utf8'), /multiplex_profiles: true/);
  assert.equal(factsFiles(h).length, 0, 'the new selector is moved aside');
  assert.ok(readdirSync(join(h, 'installs', 'newenv')).some((f) => f.startsWith('facts.json.hui-aside-')));
  assert.match(readFileSync(join(dir, 'before-rollback-20261020T090000Z', 'config.yaml'), 'utf8'), /broken/, 'the replaced file is kept');
});

test('backup keeps facts.json that existed before; rollback leaves them', () => {
  const h = home({ facts: true });
  const dest = tmp();
  botsCli('backup', ['--to', dest], { home: h, now: 1 });
  const dir = join(dest, readdirSync(dest)[0]);
  assert.ok(existsSync(join(dir, 'files', 'installs', 'abc123', 'facts.json')));
  assert.deepEqual(rollbackPlan(h, dir).aside, []);
});

test('CLI entry: doctor bots runs read-only with --hermes-home and writes no token', () => {
  const h = home();
  const state = tmp();
  const bin = fileURLToPath(new URL('../bin/hermes-ui-bridge.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [bin, 'doctor', 'bots', '--hermes-home', h], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: state, BRIDGE_STATE_DIR: state, HERMES_API_KEY: KEY } });
  assert.equal(r.status, 1, r.stderr); // scout has no key
  assert.match(r.stdout, /Bots on this Hermes server/);
  assert.match(r.stdout, /profile scout: no API_SERVER_KEY/);
  assert.equal(existsSync(join(state, 'state.json')), false, 'no BRIDGE_TOKEN generated');
});
