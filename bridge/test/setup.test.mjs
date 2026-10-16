// `hermes-ui-plus-bridge setup`: pure detection/parsing/env/unit helpers and the whole wizard against temp dirs
// and fakes (no real Hermes, systemctl or tailscale is ever called).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, readdirSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import {
  parseYamlSubset, apiServerSettings, hermesBaseUrl, readHermes, listProfiles, addApiServerBlock, apiServerSnippet,
  parseTailscaleStatus, tailnetUrl, tailscaleServeArgs, lanAddresses, probeHealth,
} from '../src/setup/detect.mjs';
import { mergeEnv, quoteEnvValue, serializeEnv, writeEnvFile, readEnvFile, redactEnv, defaultEnvFile, planSkillInstall, installSkill, findSkillSource } from '../src/setup/files.mjs';
import { systemdUnit, systemdUnitPath, systemdCommands, systemServiceProblem, execArgv, isNpxCachePath, launchdPlist, launchdCommands, composeSnippet } from '../src/setup/service.mjs';
import { parseSetupArgs, runSetup, webPairLink, inContainer, cliName, createPrompter, phoneAddressHelp } from '../src/setup/wizard.mjs';
import { Readable, Writable } from 'node:stream';

const tmp = () => mkdtempSync(join(tmpdir(), 'hub-setup-'));
const KEY = 'k'.repeat(48);

const CONFIG = `# Hermes config
model:
  default: some-model   # comment
platforms:
  telegram:
    enabled: true
    token: "abc:def"
  api_server:
    enabled: true
    extra:
      host: 0.0.0.0
      port: 8645
      key: '${KEY}'
      cors_origins: [a, b]
      model_routes:
        - name: x
          provider: y
agent:
  system_prompt: |
    platforms:
      api_server:
        enabled: false
  max_turns: 30
`;

// ---------- detection ----------
test('parseYamlSubset: nesting, comments, quotes, lists and block scalars', () => {
  const y = parseYamlSubset(CONFIG);
  assert.equal(y.model.default, 'some-model');
  assert.equal(y.platforms.telegram.token, 'abc:def');
  assert.equal(y.platforms.api_server.enabled, true);
  assert.equal(y.platforms.api_server.extra.port, 8645);
  assert.equal(y.platforms.api_server.extra.key, KEY);
  assert.equal(y.platforms.api_server.extra.cors_origins, null);
  assert.equal(y.agent.system_prompt, null); // block scalar content must not leak into the tree
  assert.equal(y.agent.max_turns, 30);
  assert.deepEqual(parseYamlSubset(''), {});
  assert.equal(parseYamlSubset('a: "x # y"').a, 'x # y');
});

test('apiServerSettings: config extra, flat keys, .env fallback, defaults; key only in memory', () => {
  const a = apiServerSettings(parseYamlSubset(CONFIG));
  assert.deepEqual({ ...a, key: undefined }, { configured: true, enabled: true, host: '0.0.0.0', port: 8645, hasKey: true, key: undefined });
  assert.equal(a.key, KEY);
  const b = apiServerSettings({}, { API_SERVER_ENABLED: 'true', API_SERVER_KEY: 'x'.repeat(40), API_SERVER_PORT: '9000' });
  assert.equal(b.enabled, true); assert.equal(b.port, 9000); assert.equal(b.hasKey, true); assert.equal(b.host, '127.0.0.1');
  const c = apiServerSettings({ platforms: { api_server: { enabled: false } } });
  assert.equal(c.enabled, false); assert.equal(c.hasKey, false); assert.equal(c.port, 8642);
  const d = apiServerSettings({});
  assert.equal(d.configured, false); assert.equal(d.enabled, false);
  assert.equal(hermesBaseUrl({ host: '0.0.0.0', port: 8645 }), 'http://127.0.0.1:8645');
  assert.equal(hermesBaseUrl({ host: '::1', port: 1 }), 'http://[::1]:1');
});

test('readHermes + listProfiles on a temp HERMES_HOME', () => {
  const h = tmp();
  writeFileSync(join(h, 'config.yaml'), CONFIG);
  mkdirSync(join(h, 'profiles', 'work'), { recursive: true });
  mkdirSync(join(h, 'profiles', 'family'), { recursive: true });
  mkdirSync(join(h, 'profiles', '.hidden'), { recursive: true });
  writeFileSync(join(h, 'profiles', 'notadir'), '');
  const r = readHermes(h);
  assert.equal(r.configExists, true);
  assert.equal(r.api.port, 8645);
  assert.deepEqual(listProfiles(h).map((p) => p.name), ['family', 'work']);
  assert.deepEqual(listProfiles(join(h, 'nope')), []);
  rmSync(h, { recursive: true });
});

test('addApiServerBlock: append, insert under platforms, refuse existing block or weak key', () => {
  const appended = addApiServerBlock('model:\n  default: x\n', { key: KEY, port: 8642 });
  assert.equal(appended.ok, true);
  assert.equal(apiServerSettings(parseYamlSubset(appended.text)).key, KEY);
  const under = addApiServerBlock('platforms:\n    telegram:\n        enabled: true\nother: 1\n', { key: KEY });
  assert.equal(under.ok, true);
  const y = parseYamlSubset(under.text);
  assert.equal(y.platforms.telegram.enabled, true);
  assert.equal(y.platforms.api_server.extra.key, KEY);
  assert.equal(y.other, 1);
  assert.equal(addApiServerBlock(CONFIG, { key: KEY }).ok, false);
  assert.equal(addApiServerBlock('', { key: 'short' }).ok, false);
  assert.doesNotMatch(apiServerSnippet(), /[0-9a-f]{32}/); // placeholder only
});

test('probeHealth: version, unreachable', async () => {
  const ok = await probeHealth('http://h', { fetch: async () => new Response('{"status":"ok","platform":"hermes-agent","version":"0.21.4"}') });
  assert.equal(ok.reachable, true); assert.equal(ok.version, '0.21.4');
  const down = await probeHealth('http://h', { fetch: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); } });
  assert.equal(down.reachable, false); assert.equal(down.error, 'ECONNREFUSED');
});

test('tailscale status, serve command, tailnet URL, LAN addresses', () => {
  const s = parseTailscaleStatus(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'box.example.ts.net.' }, CurrentTailnet: { Name: 'example', MagicDNSEnabled: true } }));
  assert.deepEqual([s.running, s.dnsName], [true, 'box.example.ts.net']);
  assert.equal(parseTailscaleStatus('not json').running, false);
  assert.equal(parseTailscaleStatus({ BackendState: 'Stopped', Self: {} }).running, false);
  assert.equal(tailnetUrl('box.example.ts.net', 8790), 'https://box.example.ts.net:8790');
  assert.equal(tailnetUrl('box.example.ts.net', 443), 'https://box.example.ts.net');
  assert.deepEqual(tailscaleServeArgs(8790, 8791), ['serve', '--bg', '--https=8790', 'http://127.0.0.1:8791']);
  const lan = lanAddresses({
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    eth0: [{ address: '192.0.2.10', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
    tailscale0: [{ address: '100.100.1.1', family: 'IPv4', internal: false }], // leak-guard:allow synthetic CGNAT address (filter test)
    wlan0: [{ address: '100.64.0.5', family: 'IPv4', internal: false }, { address: '169.254.1.1', family: 'IPv4', internal: false }], // leak-guard:allow synthetic CGNAT address (filter test)
    docker0: [{ address: '198.51.100.1', family: 'IPv4', internal: false }],
  });
  assert.deepEqual(lan, ['192.0.2.10']);
});

// ---------- env file ----------
test('env: merge keeps unknown keys, quoting round-trips through parseEnv, 0600 write, redaction', () => {
  const { env, changed } = mergeEnv({ CUSTOM: 'keep', BRIDGE_NAME: 'Old', GONE: 'x' }, { BRIDGE_NAME: 'New Name', GONE: '', HERMES_API_KEY: KEY, SKIP: undefined });
  assert.deepEqual(changed.sort(), ['BRIDGE_NAME', 'GONE', 'HERMES_API_KEY']);
  assert.equal(env.CUSTOM, 'keep'); assert.equal('GONE' in env, false); assert.equal('SKIP' in env, false);
  for (const v of ['plain', 'with space', 'a#b', "it's", '$HOME', 'x=y', '']) assert.equal(parseEnv(`K=${quoteEnvValue(v)}`).K, v, v);
  assert.throws(() => quoteEnvValue('a\nb'), /single-line/);
  const text = serializeEnv({ ZED: '1', HERMES_API_KEY: KEY, HERMES_BASE_URL: 'http://127.0.0.1:8642' });
  assert.ok(text.indexOf('HERMES_BASE_URL') < text.indexOf('HERMES_API_KEY') && text.indexOf('HERMES_API_KEY') < text.indexOf('ZED'));
  assert.match(text, /^# /);
  const d = tmp();
  const f = join(d, 'sub', 'env');
  writeEnvFile(f, env);
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.equal(statSync(join(d, 'sub')).mode & 0o777, 0o700);
  assert.deepEqual(readEnvFile(f), env);
  assert.deepEqual(readEnvFile(join(d, 'missing')), {});
  assert.equal(redactEnv(env).HERMES_API_KEY, '<set, 48 chars>');
  assert.equal(redactEnv(env).BRIDGE_NAME, 'New Name');
  assert.equal(defaultEnvFile({}, '/home/u'), '/home/u/.config/hermes-ui-plus-bridge/env');
  assert.equal(defaultEnvFile({ XDG_CONFIG_HOME: '/x' }, '/home/u'), '/x/hermes-ui-plus-bridge/env');
  assert.equal(defaultEnvFile({}, '/root', { root: true }), '/etc/hermes-ui-plus-bridge/env');
  rmSync(d, { recursive: true });
});

// ---------- skill ----------
test('skill: install, current, update with backup outside the skills dir', () => {
  const src = findSkillSource();
  assert.ok(src, 'skill source found (bundled or repo)');
  const h = tmp();
  const skills = join(h, 'skills');
  let plan = planSkillInstall(src, skills);
  assert.equal(plan.action, 'install');
  installSkill(plan);
  assert.ok(existsSync(join(skills, 'hermes-ui', 'SKILL.md')));
  assert.equal(planSkillInstall(src, skills).action, 'current');
  writeFileSync(join(skills, 'hermes-ui', 'SKILL.md'), '---\nversion: 0.0.1\n---\nold');
  plan = planSkillInstall(src, skills);
  assert.equal(plan.action, 'update'); assert.equal(plan.from, '0.0.1'); assert.ok(plan.to);
  const r = installSkill(plan, { backupRoot: join(h, 'skill-backups'), now: () => new Date('2026-01-02T03:04:05Z') });
  assert.equal(readFileSync(join(r.backup, 'SKILL.md'), 'utf8').endsWith('old'), true);
  assert.ok(!r.backup.startsWith(skills));
  assert.deepEqual(readdirSync(skills), ['hermes-ui']); // no temp or backup dirs left in skills/
  assert.equal(planSkillInstall(src, skills).action, 'current');
  rmSync(h, { recursive: true });
});

// ---------- service ----------
test('systemd units: user vs system hardening, commands, problems', () => {
  const argv = ['/usr/bin/node', '/usr/lib/node_modules/hermes-ui-plus-bridge/bin/hermes-ui-bridge.mjs', '--env-file', '/etc/hermes-ui-plus-bridge/env'];
  const sys = systemdUnit({ argv: argv.slice(0, 2), envFile: '/etc/hermes-ui-plus-bridge/env', system: true, port: 8790 });
  for (const l of ['DynamicUser=yes', 'ProtectSystem=strict', 'ProtectHome=yes', 'NoNewPrivileges=yes', 'PrivateTmp=yes', 'StateDirectory=hermes-ui-bridge', 'MemoryMax=256M', 'WantedBy=multi-user.target', 'EnvironmentFile=/etc/hermes-ui-plus-bridge/env']) assert.ok(sys.includes(l), l);
  assert.match(sys, /^ExecStart=\/usr\/bin\/node \/usr\/lib\/node_modules\/hermes-ui-plus-bridge\/bin\/hermes-ui-bridge.mjs$/m);
  const user = systemdUnit({ argv: ['/home/u/n/node', '/home/u/my dir/bin.mjs'], envFile: '/home/u/.config/x/env' });
  assert.ok(!user.includes('DynamicUser') && !user.includes('ProtectSystem'));
  assert.ok(user.includes('NoNewPrivileges=yes') && user.includes('WantedBy=default.target'));
  assert.match(user, /ExecStart=\/home\/u\/n\/node "\/home\/u\/my dir\/bin.mjs"/);
  assert.equal(systemdUnitPath({ system: false, home: '/home/u' }), '/home/u/.config/systemd/user/hermes-ui-plus-bridge.service');
  assert.equal(systemdUnitPath({ system: true, home: '/root' }), '/etc/systemd/system/hermes-ui-plus-bridge.service');
  assert.deepEqual(systemdCommands({ system: false })[0], ['systemctl', '--user', 'daemon-reload']);
  assert.equal(systemServiceProblem(argv), '');
  assert.match(systemServiceProblem(['/root/.nvm/node', '/x']), /home directory/);
  assert.match(systemServiceProblem(argv, { fromNpxCache: true }), /npm i -g/);
  assert.equal(isNpxCachePath('/home/u/.npm/_npx/abc/node_modules/x/bin/a.mjs'), true);
  assert.deepEqual(execArgv({ fromNpxCache: true, npxPath: '/usr/bin/npx', version: '1.2.3', envFile: '/e' }), ['/usr/bin/npx', '-y', 'hermes-ui-plus-bridge@1.2.3', '--env-file', '/e']);
  assert.deepEqual(execArgv({ nodePath: '/n', binPath: '/b', envFile: '/e' }), ['/n', '/b', '--env-file', '/e']);
  assert.deepEqual(execArgv({ nodePath: '/n', binPath: '/b', envFile: null }), ['/n', '/b']); // systemd: EnvironmentFile= only
});

test('launchd plist, compose snippet', () => {
  const pl = launchdPlist({ argv: ['/opt/node', '/x/a&b.mjs'], home: '/Users/u' });
  assert.match(pl, /<string>\/x\/a&amp;b.mjs<\/string>/);
  assert.match(pl, /<key>Label<\/key><string>xyz.hermesui.bridge<\/string>/);
  assert.match(pl, /\/Users\/u\/Library\/Logs\/hermes-ui-plus-bridge.log/);
  const cmds = launchdCommands({ uid: 501, plistPath: '/p.plist' });
  assert.equal(cmds[0].ignoreFailure, true); assert.deepEqual(cmds[1].argv, ['launchctl', 'bootstrap', 'gui/501', '/p.plist']);
  const c = composeSnippet({ envFile: '/home/u/.config/hermes-ui-plus-bridge/env', hermesPort: 8645 });
  assert.match(c, /env_file: \["\/home\/u\/.config\/hermes-ui-plus-bridge\/env"\]/);
  assert.match(c, /127\.0\.0\.1:8790:8790/);
  assert.match(c, /host.docker.internal:8645/);
});

test('parseSetupArgs', () => {
  const o = parseSetupArgs(['--json', '--dry-run', '--port=9000', '--https-port', '443', '--service', 'none', '--no-tailscale', '--profiles', 'all']);
  assert.equal(o.yes, true); assert.equal(o.json, true); assert.equal(o.dryRun, true);
  assert.equal(o.extras, false); assert.equal(parseSetupArgs(['--extras']).extras, true);
  assert.equal(o.port, 9000); assert.equal(o.httpsPort, 443); assert.equal(o.service, 'none'); assert.equal(o.tailscale, false); assert.equal(o.profiles, 'all');
  assert.throws(() => parseSetupArgs(['--service', 'pm2']), /--service/);
  assert.throws(() => parseSetupArgs(['--port', '0']), /--port/);
  assert.throws(() => parseSetupArgs(['--anthropic-key', 'x']), /unknown setup option/);
  assert.equal(webPairLink('https://b.example.ts.net:8790', 'c_1-x', 'My H'), 'https://b.example.ts.net:8790/#pair?u=https%3A%2F%2Fb.example.ts.net%3A8790&c=c_1-x&n=My%20H');
});

// ---------- whole wizard with fakes ----------
function fixture({ config = CONFIG } = {}) {
  const root = tmp();
  const home = join(root, 'home');
  const hermes = join(home, '.hermes');
  mkdirSync(join(hermes, 'profiles', 'work'), { recursive: true });
  if (config !== null) writeFileSync(join(hermes, 'config.yaml'), config);
  const calls = [];
  const exec = (argv) => {
    calls.push(argv.join(' '));
    if (argv[0] === 'tailscale' && argv[1] === 'status') return { code: 0, stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'box.example.ts.net.' } }), stderr: '' };
    if (argv[0] === 'loginctl') return { code: 0, stdout: 'Linger=no\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const fetches = [];
  const fakeFetch = async (url) => {
    fetches.push(String(url));
    if (String(url).startsWith('http://127.0.0.1:8645/health')) return new Response('{"status":"ok","platform":"hermes-agent","version":"0.21.4"}');
    if (String(url).startsWith('http://127.0.0.1:8790/health')) return new Response('{}', { headers: { 'x-hermes-ui-bridge': '1' } });
    throw new TypeError('fetch failed');
  };
  const lines = [];
  const deps = {
    env: { XDG_CONFIG_HOME: join(home, '.config'), XDG_STATE_HOME: join(home, '.local', 'state'), USER: 'u' },
    home, platform: 'linux', uid: 1000, isRoot: false, exec, fetch: fakeFetch, log: (s = '') => lines.push(s),
    interfaces: {}, nodePath: '/usr/bin/node', binPath: '/usr/lib/node_modules/hermes-ui-plus-bridge/bin/hermes-ui-bridge.mjs',
    healthTries: 1, healthDelayMs: 0, version: '9.9.9', now: () => new Date('2026-10-12T10:00:00Z'), inContainer: false, fromNpxCache: false,
  };
  return { root, home, hermes, calls, fetches, lines, deps };
}

test('wizard --yes --json: env, skill, unit, tailscale serve, pair link; no secret in the output; idempotent', async () => {
  const f = fixture();
  const opts = parseSetupArgs(['--json', '--service', 'systemd']);
  const r = await runSetup(opts, f.deps);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.hermes.version, '0.21.4');
  assert.deepEqual(r.hermes.apiServer, { configured: true, enabled: true, host: '0.0.0.0', port: 8645, hasKey: true });
  assert.deepEqual(r.hermes.profiles, ['work']);
  assert.deepEqual(r.skill.map((s) => [s.target, s.action]), [['main', 'install']]); // profiles need --profiles in --yes mode
  assert.ok(existsSync(join(f.hermes, 'skills', 'hermes-ui', 'SKILL.md')));
  // env file
  const envFile = join(f.home, '.config', 'hermes-ui-plus-bridge', 'env');
  assert.equal(r.envFile.path, envFile);
  assert.equal(statSync(envFile).mode & 0o777, 0o600);
  const env = readEnvFile(envFile);
  assert.equal(env.HERMES_BASE_URL, 'http://127.0.0.1:8645');
  assert.equal(env.HERMES_API_KEY, KEY);
  assert.equal(env.BRIDGE_PUBLIC_URL, 'https://box.example.ts.net:8790');
  assert.equal(env.ROUTER_BACKEND, 'heuristic');
  assert.ok(env.BRIDGE_PUSH_VAPID_PUBLIC_KEY && env.BRIDGE_PUSH_VAPID_PRIVATE_KEY);
  assert.equal(env.BRIDGE_STATE_DIR, join(f.home, '.local', 'state', 'hermes-ui-bridge'));
  // unit + commands
  const unit = readFileSync(join(f.home, '.config', 'systemd', 'user', 'hermes-ui-plus-bridge.service'), 'utf8');
  assert.match(unit, new RegExp(`EnvironmentFile=${envFile}`));
  // Astra F05: systemd loads the env file itself; the app must not re-read it (a DynamicUser cannot read root's 0600 file)
  assert.doesNotMatch(unit.split('\n').find((l) => l.startsWith('ExecStart=')), /--env-file/);
  assert.ok(f.calls.includes('systemctl --user restart hermes-ui-plus-bridge.service'));
  assert.ok(f.calls.includes('tailscale serve --bg --https=8790 http://127.0.0.1:8790'));
  assert.equal(r.service.health.up, true);
  // pair
  // one-time pair code, never a token (the device token only exists after the app redeemed the code)
  assert.match(r.pair.link, /^hermesuiplus:\/\/pair\?u=https%3A%2F%2Fbox\.example\.ts\.net%3A8790&c=[A-Za-z0-9_-]{43}&n=Hermes$/);
  assert.doesNotMatch(r.pair.link, /[?&]t=/);
  assert.equal(r.pair.oneTime, true);
  assert.equal(r.pair.webLink, '');
  const devicesFile = readFileSync(join(env.BRIDGE_STATE_DIR, 'devices.json'), 'utf8');
  const pairCode = new URL(r.pair.link.replace('hermesuiplus://pair', 'https://x/')).searchParams.get('c');
  assert.ok(!devicesFile.includes(pairCode), 'plaintext pair code stored');
  const { createDeviceStore } = await import('../src/devices.mjs');
  const redeemed = createDeviceStore({ dir: env.BRIDGE_STATE_DIR }).redeem(pairCode);
  assert.match(redeemed.token, /^hbd_/);
  assert.equal(createDeviceStore({ dir: env.BRIDGE_STATE_DIR }).redeem(pairCode), null, 'works once');
  assert.ok(r.nextSteps.some((s) => s.includes('loginctl enable-linger')));
  // no secret anywhere in human output or report
  const human = f.lines.join('\n');
  const reportText = JSON.stringify({ ...r, pair: null });
  for (const secret of [KEY, env.BRIDGE_PUSH_VAPID_PRIVATE_KEY]) {
    assert.ok(!human.includes(secret), 'secret in log');
    assert.ok(!reportText.includes(secret), 'secret in report');
  }
  assert.ok(!human.includes(pairCode), 'pair code in --json log');
  // Hermes config untouched
  assert.equal(readFileSync(join(f.hermes, 'config.yaml'), 'utf8'), CONFIG);

  // second run: nothing changes, skill current, VAPID kept
  f.calls.length = 0;
  const r2 = await runSetup(opts, f.deps);
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.envFile.changed, []);
  assert.equal(r2.skill[0].action, 'current');
  assert.equal(readEnvFile(envFile).BRIDGE_PUSH_VAPID_PRIVATE_KEY, env.BRIDGE_PUSH_VAPID_PRIVATE_KEY);
  rmSync(f.root, { recursive: true });
});

test('wizard --dry-run writes nothing and runs no mutating command', async () => {
  const f = fixture();
  const r = await runSetup(parseSetupArgs(['--yes', '--dry-run', '--service', 'systemd', '--profiles', 'all']), f.deps);
  assert.equal(r.ok, true, r.error);
  assert.equal(existsSync(join(f.home, '.config')), false);
  assert.equal(existsSync(join(f.hermes, 'skills')), false);
  assert.deepEqual(r.skill.map((s) => s.action), ['install', 'install']);
  assert.deepEqual(f.calls.filter((c) => !/^tailscale status|^systemctl --version/.test(c)), []);
  assert.ok(f.lines.some((l) => l.includes('(dry-run) would run: systemctl --user restart')));
  assert.ok(!f.lines.join('\n').includes(KEY));
  assert.equal(r.pair, null);
  rmSync(f.root, { recursive: true });
});

test('wizard: API server off -> snippet + restart hint; --yes never edits; interactive "y" edits with backup', async () => {
  const f = fixture({ config: 'model:\n  default: x\n' });
  const r = await runSetup(parseSetupArgs(['--yes', '--service', 'none', '--no-tailscale', '--no-pair']), f.deps);
  assert.equal(r.hermes.apiServer.enabled, false);
  assert.ok(f.lines.some((l) => l.includes('api_server:')));
  assert.ok(r.nextSteps.some((s) => s.includes('restart the Hermes gateway')));
  assert.equal(readFileSync(join(f.hermes, 'config.yaml'), 'utf8'), 'model:\n  default: x\n');

  const answers = [];
  const prompter = {
    confirm: async (q, d) => { answers.push(q); return /config\.yaml now/.test(q) ? true : d; },
    ask: async (_q, d) => d, secret: async () => '', close() {},
  };
  chmodSync(join(f.hermes, 'config.yaml'), 0o644); // world-readable before the key is added (GPT security M4)
  const r2 = await runSetup(parseSetupArgs(['--service', 'none', '--no-tailscale', '--no-pair']), { ...f.deps, prompter });
  assert.ok(r2.hermes.configEdited?.backup);
  assert.equal(statSync(join(f.hermes, 'config.yaml')).mode & 0o007, 0, 'config with the API key is not world-readable');
  assert.equal(statSync(r2.hermes.configEdited.backup).mode & 0o077, 0, 'backup is private');
  assert.equal(readFileSync(r2.hermes.configEdited.backup, 'utf8'), 'model:\n  default: x\n');
  const y = parseYamlSubset(readFileSync(join(f.hermes, 'config.yaml'), 'utf8'));
  assert.equal(y.platforms.api_server.enabled, true);
  const env = readEnvFile(r2.envFile.path);
  assert.equal(env.HERMES_API_KEY, y.platforms.api_server.extra.key); // generated key reaches the bridge env, never the log
  assert.ok(!f.lines.join('\n').includes(env.HERMES_API_KEY));
  assert.ok(!f.calls.some((c) => /hermes|gateway/.test(c)), 'Hermes is never restarted');
  rmSync(f.root, { recursive: true });
});

test('wizard: keys from the environment, profiles, web dir, LAN fallback without tailscale', async () => {
  const f = fixture();
  f.deps.env = { ...f.deps.env, SERPER_API_KEY: 's'.repeat(40), GROQ_API_KEY: 'gsk_test', ANTHROPIC_API_KEY: 'sk-ant-test' };
  f.deps.exec = (argv) => { f.calls.push(argv.join(' ')); return argv[0] === 'tailscale' ? { code: -1, stdout: '', stderr: 'not found' } : { code: 0, stdout: '', stderr: '' }; };
  f.deps.interfaces = { eth0: [{ address: '192.0.2.7', family: 'IPv4', internal: false }] };
  const web = join(f.root, 'web');
  mkdirSync(web);
  const r = await runSetup(parseSetupArgs(['--yes', '--extras', '--service', 'none', '--profiles', 'work', '--web-dir', web]), f.deps);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.skill.map((s) => s.target), ['main', 'profile work']);
  assert.ok(existsSync(join(f.hermes, 'profiles', 'work', 'skills', 'hermes-ui', 'SKILL.md')));
  const env = readEnvFile(r.envFile.path);
  assert.equal(env.SERPER_API_KEY, 's'.repeat(40)); assert.equal(env.GROQ_API_KEY, 'gsk_test');
  assert.equal(env.ROUTER_BACKEND, 'claude'); assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-test'); assert.equal(env.BRIDGE_META, 'on');
  assert.equal(r.extras.requested, true);
  assert.deepEqual(r.extras.directProviders, { router: 'claude', meta: 'claude', images: 'serper', voice: 'groq' });
  assert.ok(!JSON.stringify(r).includes('sk-ant-test') && !f.lines.join('\n').includes('sk-ant-test'));
  assert.equal(env.BRIDGE_WEB_DIR, web);
  assert.equal(r.network.mode, 'none'); // LAN needs an explicit yes
  assert.equal(env.BRIDGE_HOST, undefined);
  assert.ok(f.lines.some((l) => l.includes('http://192.0.2.7:8790')));
  assert.ok(r.warnings.some((w) => w.includes('127.0.0.1')));
  assert.ok(r.nextSteps.some((s) => s.startsWith('Start the bridge: /usr/bin/node')));
  rmSync(f.root, { recursive: true });
});

test('wizard keeps a hand-set HERMES_BASE_URL and key when no local Hermes config exists', async () => {
  const f = fixture({ config: null });
  const envFile = join(f.home, '.config', 'hermes-ui-plus-bridge', 'env');
  writeEnvFile(envFile, { HERMES_BASE_URL: 'http://127.0.0.1:8645/v1', HERMES_API_KEY: KEY, CUSTOM_X: '1' });
  const r = await runSetup(parseSetupArgs(['--yes', '--service', 'none', '--no-tailscale', '--no-pair', '--no-skill']), f.deps);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.hermes.reachable, true); // probed the hand-set URL
  const env = readEnvFile(envFile);
  assert.equal(env.HERMES_BASE_URL, 'http://127.0.0.1:8645/v1');
  assert.equal(env.HERMES_API_KEY, KEY);
  assert.equal(env.CUSTOM_X, '1');
  assert.ok(!r.envFile.changed.includes('HERMES_BASE_URL') && !r.envFile.changed.includes('HERMES_API_KEY'));
  rmSync(f.root, { recursive: true });
});

test('GPT security M3 / Astra F14: redaction masks the push hook secret and unknown credential-like keys', () => {
  const fake = 'fake-hook-secret-not-real-0000';
  const r = redactEnv({ BRIDGE_PUSH_HOOK_SECRET: fake, SOME_FUTURE_TOKEN: 'abc-not-real', MY_PRIVATE_KEY: 'xyz', BRIDGE_PUSH_VAPID_PUBLIC_KEY: 'BPub', BRIDGE_PUSH_APNS_KEY_FILE: '/k.p8', BRIDGE_NAME: 'n' });
  assert.equal(r.BRIDGE_PUSH_HOOK_SECRET, `<set, ${fake.length} chars>`);
  assert.doesNotMatch(JSON.stringify(r), /fake-hook-secret|abc-not-real|xyz/);
  assert.equal(r.BRIDGE_PUSH_VAPID_PUBLIC_KEY, 'BPub');
  assert.equal(r.BRIDGE_PUSH_APNS_KEY_FILE, '/k.p8');
  assert.equal(r.BRIDGE_NAME, 'n');
});

test('GPT security L1: systemd directives cannot be injected through paths/arguments; specifiers are escaped', () => {
  const argv = ['/usr/bin/node', '/opt/b/bin.mjs'];
  assert.throws(() => systemdUnit({ argv, envFile: '/etc/x/env\nExecStartPre=/bin/evil', system: true }), /control/);
  assert.throws(() => systemdUnit({ argv: [...argv, 'x\nType=forking'], envFile: '/etc/x/env' }), /control/);
  const u = systemdUnit({ argv: ['/opt/100%/node', '/opt/$HOME/b.mjs'], envFile: '/etc/50%/env' });
  assert.ok(u.includes('EnvironmentFile=/etc/50%%/env'));
  assert.match(u, /^ExecStart="\/opt\/100%%\/node" "\/opt\/\$\$HOME\/b.mjs"$/m);
  assert.throws(() => parseSetupArgs(['--env-file', '/tmp/a\nb']), /control/);
  assert.throws(() => parseSetupArgs(['--web-dir', '/tmp/a\rb']), /control/);
});

const EXTRA_KEYS = ['SERPER_API_KEY', 'BRAVE_API_KEY', 'GROQ_API_KEY', 'DEEPGRAM_API_KEY', 'ANTHROPIC_API_KEY', 'TYPESAFE_API_KEY'];

test('wizard default: no extras prompts, provider keys in the environment are ignored, router stays heuristic', async () => {
  const f = fixture();
  f.deps.env = { ...f.deps.env, SERPER_API_KEY: 's'.repeat(40), GROQ_API_KEY: 'gsk_test', DEEPGRAM_API_KEY: 'dg_test', ANTHROPIC_API_KEY: 'sk-ant-test', TYPESAFE_API_KEY: 'ts_test' };
  const r = await runSetup(parseSetupArgs(['--yes', '--service', 'none', '--no-tailscale', '--no-pair']), f.deps);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.extras.requested, false);
  assert.deepEqual(r.extras.directProviders, {});
  const env = readEnvFile(r.envFile.path);
  for (const k of EXTRA_KEYS) assert.equal(env[k], undefined, k);
  assert.equal(env.BRIDGE_META, undefined);
  assert.equal(env.ROUTER_BACKEND, 'heuristic');
  assert.ok(f.lines.some((l) => l.includes('direct providers: none (pure Hermes pass-through)')));
  rmSync(f.root, { recursive: true });
});

function recordingPrompter({ extras }) {
  const asked = [];
  return {
    asked,
    confirm: async (q, d) => { asked.push(['confirm', q]); return /direct-provider extras/.test(q) ? extras : d; },
    ask: async (q, d) => { asked.push(['ask', q]); return d; },
    secret: async (q) => { asked.push(['secret', q]); return ''; },
    close() {},
  };
}
const EXTRAS_QUESTIONS = /Router:|Image search|Voice input|Voice output|Anthropic API key/;

test('wizard interactive: the extras question defaults to No and then asks nothing about router/images/voice', async () => {
  const f = fixture();
  const prompter = recordingPrompter({ extras: false });
  const q = prompter.confirm;
  let defaultSeen;
  prompter.confirm = async (text, d) => { if (/direct-provider extras/.test(text)) defaultSeen = d; return q(text, d); };
  const r = await runSetup(parseSetupArgs(['--service', 'none', '--no-tailscale', '--no-pair', '--no-skill']), { ...f.deps, prompter });
  assert.equal(r.ok, true, r.error);
  assert.equal(defaultSeen, false);
  assert.match(prompter.asked.find(([, t]) => /direct-provider extras/.test(t))[1], /router, titles, image search, voice/);
  assert.deepEqual(prompter.asked.filter(([, t]) => EXTRAS_QUESTIONS.test(t)), []);
  assert.equal(readEnvFile(r.envFile.path).ROUTER_BACKEND, 'heuristic');
  rmSync(f.root, { recursive: true });
});

test('wizard interactive "y" and --extras ask for router, image and voice keys', async () => {
  for (const argv of [[], ['--extras']]) {
    const f = fixture();
    const prompter = recordingPrompter({ extras: true });
    const r = await runSetup(parseSetupArgs([...argv, '--service', 'none', '--no-tailscale', '--no-pair', '--no-skill']), { ...f.deps, prompter });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.extras.requested, true);
    const texts = prompter.asked.map(([, t]) => t).join('\n');
    assert.match(texts, /Router:/); assert.match(texts, /Image search/); assert.match(texts, /Voice input/); assert.match(texts, /Voice output/);
    // the explicit flag skips the yes/no question
    assert.equal(prompter.asked.some(([, t]) => /direct-provider extras/.test(t)), argv.length === 0);
    assert.equal(readEnvFile(r.envFile.path).ROUTER_BACKEND, 'heuristic'); // nothing typed -> still rule based
    rmSync(f.root, { recursive: true });
  }
});

test('wizard --extras with keys typed interactively stores them but never prints them', async () => {
  const f = fixture();
  const prompter = {
    confirm: async (_q, d) => d, ask: async () => 'claude',
    secret: async (q) => (/Anthropic/.test(q) ? 'sk-ant-typed-test' : /Image/.test(q) ? 'typed-serper-test-key' : ''), close() {},
  };
  const r = await runSetup(parseSetupArgs(['--extras', '--service', 'none', '--no-tailscale', '--no-pair', '--no-skill']), { ...f.deps, prompter });
  const env = readEnvFile(r.envFile.path);
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-typed-test'); assert.equal(env.ROUTER_BACKEND, 'claude'); assert.equal(env.SERPER_API_KEY, 'typed-serper-test-key');
  assert.deepEqual(r.extras.directProviders, { router: 'claude', meta: 'claude', images: 'serper' });
  const out = f.lines.join('\n') + JSON.stringify(r);
  assert.ok(!out.includes('sk-ant-typed-test') && !out.includes('typed-serper-test-key'));
  rmSync(f.root, { recursive: true });
});

test('wizard re-run on a configured install keeps every key and ROUTER_BACKEND (default, --yes and interactive)', async () => {
  const f = fixture();
  const envFile = join(f.home, '.config', 'hermes-ui-plus-bridge', 'env');
  const configured = {
    HERMES_BASE_URL: 'http://127.0.0.1:8645', HERMES_API_KEY: KEY, ROUTER_BACKEND: 'jev,claude', ANTHROPIC_API_KEY: 'sk-ant-old-test', TYPESAFE_API_KEY: 'ts_old_test',
    SERPER_API_KEY: 'serper_old_test', GROQ_API_KEY: 'gsk_old_test', DEEPGRAM_API_KEY: 'dg_old_test', CUSTOM_X: '1',
  };
  writeEnvFile(envFile, configured);
  const check = (label) => {
    const env = readEnvFile(envFile);
    for (const [k, v] of Object.entries(configured)) assert.equal(env[k], v, `${label}: ${k}`);
    assert.equal(env.BRIDGE_META, undefined, `${label}: BRIDGE_META not forced`);
  };
  const base = ['--service', 'none', '--no-tailscale', '--no-pair', '--no-skill'];
  let r = await runSetup(parseSetupArgs(['--yes', ...base]), f.deps);
  assert.equal(r.ok, true, r.error); check('--yes');
  // still reported, nothing removed; titles/follow-ups stay off: this env file never opted in with BRIDGE_META=on
  assert.deepEqual(r.extras.directProviders, { router: 'jev>claude', images: 'serper', voice: 'groq/deepgram' });
  r = await runSetup(parseSetupArgs(base), { ...f.deps, prompter: recordingPrompter({ extras: false }) });
  check('interactive No');
  const prompter = recordingPrompter({ extras: true });
  r = await runSetup(parseSetupArgs(base), { ...f.deps, prompter }); // interactive Yes, Enter on every question
  assert.equal(r.ok, true, r.error);
  assert.equal(readEnvFile(envFile).ROUTER_BACKEND, 'jev,claude'); // Enter keeps the router
  for (const [k, v] of Object.entries(configured)) assert.equal(readEnvFile(envFile)[k], v, k);
  rmSync(f.root, { recursive: true });
});

test('wizard --dry-run reports the extras decision and writes nothing', async () => {
  const f = fixture();
  const r = await runSetup(parseSetupArgs(['--yes', '--dry-run', '--service', 'none', '--no-tailscale']), f.deps);
  assert.equal(r.extras.requested, false);
  assert.equal(existsSync(join(f.home, '.config')), false);
  assert.ok(f.lines.some((l) => l.includes('Direct-provider extras: skipped')));
  assert.ok(f.lines.some((l) => l.includes('direct providers: none')));
  rmSync(f.root, { recursive: true });
});

// ---------- first-install findings (fresh Ubuntu container, 2026-10-13) ----------
test('inContainer: Docker and Podman markers; cliName: npx prefix when run from the npx cache', () => {
  assert.equal(inContainer((f) => f === '/.dockerenv'), true);
  assert.equal(inContainer((f) => f === '/run/.containerenv'), true);
  assert.equal(inContainer(() => false), false);
  assert.equal(cliName(true), 'npx hermes-ui-plus-bridge');
  assert.equal(cliName(false), 'hermes-ui-plus-bridge');
});

test('wizard inside a container (Hermes in Docker): auto runs the bridge right here and still pairs', async () => {
  const f = fixture();
  f.deps.inContainer = true;
  f.deps.fromNpxCache = true;
  f.deps.exec = (argv) => { f.calls.push(argv.join(' ')); return argv[0] === 'tailscale' ? { code: -1, stdout: '', stderr: 'not found' } : { code: 0, stdout: '', stderr: '' }; };
  const web = join(f.root, 'web');
  mkdirSync(web);
  const r = await runSetup(parseSetupArgs(['--yes', '--web-dir', web]), f.deps);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.service.kind, 'none'); // not a compose file for a second container: Hermes is on 127.0.0.1 here
  assert.equal(r.service.compose, undefined);
  assert.ok(r.nextSteps.some((s) => /^Start the bridge: (\S*\/)?npx -y hermes-ui-plus-bridge@9\.9\.9 --env-file /.test(s)), r.nextSteps.join('; '));
  assert.ok(f.lines.some((l) => l.includes('Running inside a container')));
  assert.ok(r.pair && r.pair.oneTime, 'pair link printed');
  // no HTTPS address: a web pair link for a browser on this machine (http://127.0.0.1 is a secure origin)
  assert.match(r.pair.localWebLink, /^http:\/\/127\.0\.0\.1:8790\/#pair\?u=http%3A%2F%2F127\.0\.0\.1%3A8790&c=[A-Za-z0-9_-]{43}&n=Hermes$/);
  assert.equal(r.pair.webLink, '');
  const human = f.lines.join('\n');
  assert.match(human, /New pair link later: npx hermes-ui-plus-bridge devices add "Phone" --env-file /);
  assert.match(human, /Revoke later: npx hermes-ui-plus-bridge devices revoke d_/);
  assert.ok(!f.calls.some((c) => c.startsWith('systemctl') || c.startsWith('docker')));
  // an explicit --service docker still prints the compose service
  const r2 = await runSetup(parseSetupArgs(['--yes', '--service', 'docker', '--no-pair']), f.deps);
  assert.equal(r2.service.kind, 'docker');
  assert.match(r2.service.compose, /host\.docker\.internal/);
  rmSync(f.root, { recursive: true });
});

test('wizard: no local web link once the bridge has an HTTPS address', async () => {
  const f = fixture();
  const web = join(f.root, 'web');
  mkdirSync(web);
  const r = await runSetup(parseSetupArgs(['--yes', '--service', 'none', '--web-dir', web]), f.deps); // fake tailscale is running
  assert.equal(r.ok, true, r.error);
  assert.match(r.pair.webLink, /^https:\/\/box\.example\.ts\.net:8790\/#pair\?/);
  assert.equal(r.pair.localWebLink, '');
  assert.match(f.lines.join('\n'), /Revoke later: hermes-ui-plus-bridge devices revoke/); // global install: no npx prefix
  rmSync(f.root, { recursive: true });
});

test('prompter: EOF declines confirmations even when their interactive default is yes', async () => {
  const sink = () => { const chunks = []; return { chunks, stream: new Writable({ write(c, _e, cb) { chunks.push(String(c)); cb(); } }) }; };
  const o1 = sink();
  const p1 = await createPrompter({ yes: false, input: Readable.from([]), output: o1.stream });
  await new Promise((r) => setImmediate(r));
  assert.equal(await p1.confirm('Q1?', true), false);
  assert.equal(await p1.confirm('Q2?', false), false);
  assert.equal(await p1.ask('Q3', 'dflt'), 'dflt');
  p1.close();
  assert.equal(o1.chunks.join('').split('no input on stdin').length - 1, 1, 'noted once');
  // a pending question when stdin ends must settle too (it used to hang forever)
  const input = new Readable({ read() {} });
  const p2 = await createPrompter({ yes: false, input, output: sink().stream });
  const pending = p2.confirm('Q?', true);
  input.push(null);
  assert.equal(await pending, false);
  p2.close();
});

test('prompter: explicit --yes retains confirmation defaults', async () => {
  const p = await createPrompter({ yes: true });
  assert.equal(await p.confirm('Publish?', true), true);
  assert.equal(await p.confirm('Listen on LAN?', false), false);
  p.close();
});

// ---- fresh-user test of 0.1.0-alpha.1 ----
const QR_BLOCKS = /[▀▄█]/; // qrcode's terminal output (half blocks)

test('wizard without a Hermes home: no ~/.hermes/skills is created, the skill step says why', async () => {
  const f = fixture();
  rmSync(f.hermes, { recursive: true });
  const r = await runSetup(parseSetupArgs(['--yes', '--service', 'none', '--no-tailscale', '--no-pair']), f.deps);
  assert.equal(r.ok, true, r.error);
  assert.equal(existsSync(f.hermes), false, 'no stray Hermes home');
  assert.deepEqual(r.skill.map((s) => [s.action, s.reason]), [['skipped', 'no-hermes-home']]);
  const human = f.lines.join('\n');
  assert.match(human, /not installed: there is no Hermes home at /);
  assert.ok(r.nextSteps.some((s) => /re-run setup once Hermes is installed/.test(s)));
  rmSync(f.root, { recursive: true });
});

test('wizard without a reachable address: no 127.0.0.1 QR code, but where and how to set BRIDGE_PUBLIC_URL', async () => {
  const f = fixture();
  f.deps.exec = (argv) => { f.calls.push(argv.join(' ')); return argv[0] === 'tailscale' ? { code: -1, stdout: '', stderr: 'not found' } : { code: 0, stdout: '', stderr: '' }; };
  f.deps.interfaces = { eth0: [{ address: '192.0.2.7', family: 'IPv4', internal: false }] };
  const r = await runSetup(parseSetupArgs(['--yes', '--service', 'systemd']), f.deps); // --yes declines LAN listening
  assert.equal(r.ok, true, r.error);
  assert.equal(r.network.publicUrl, '');
  assert.equal(r.pair.localOnly, true);
  assert.match(r.pair.link, /u=http%3A%2F%2F127\.0\.0\.1%3A8790/);
  const human = f.lines.join('\n');
  assert.doesNotMatch(human, QR_BLOCKS, 'no QR code for a loopback address');
  assert.doesNotMatch(human, /Scan with the Hermes UI\+ app/);
  assert.match(human, /Pair link for an app on this machine/);
  assert.ok(r.warnings.some((w) => /127\.0\.0\.1/.test(w) && /no QR code/.test(w)));
  assert.ok(human.includes(`Edit BRIDGE_PUBLIC_URL in\n    ${r.envFile.path}`), 'names the env file');
  assert.match(human, /tailscale serve --bg --https=8790 http:\/\/127\.0\.0\.1:8790/);
  assert.match(human, /BRIDGE_HOST=0\.0\.0\.0\n\s+BRIDGE_PUBLIC_URL=http:\/\/192\.0\.2\.7:8790/);
  assert.match(human, /systemctl --user restart hermes-ui-plus-bridge/);
  assert.match(human, /devices add "Phone" --env-file /);
  assert.ok(r.nextSteps.some((s) => s.includes(r.envFile.path) && s.includes('BRIDGE_PUBLIC_URL=http://192.0.2.7:8790')));
  rmSync(f.root, { recursive: true });
});

test('wizard with a tailnet address still prints the QR code', async () => {
  const f = fixture();
  const r = await runSetup(parseSetupArgs(['--yes', '--service', 'none']), f.deps);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.pair.localOnly, false);
  const human = f.lines.join('\n');
  assert.match(human, QR_BLOCKS);
  assert.doesNotMatch(human, /Edit BRIDGE_PUBLIC_URL/);
  rmSync(f.root, { recursive: true });
});

test('phoneAddressHelp: placeholder without a LAN address, port-less URL for 443, launchd restart', () => {
  const t = phoneAddressHelp({ envFile: '/e', httpsPort: 443, kind: 'launchd' }).join('\n');
  assert.match(t, /BRIDGE_PUBLIC_URL=http:\/\/<lan-ip-of-this-machine>:8790/);
  assert.match(t, /https:\/\/<machine>\.<tailnet>\.ts\.net for you/);
  assert.match(t, /launchctl kickstart -k gui\/\$\(id -u\)\/xyz\.hermesui\.bridge/);
  assert.match(phoneAddressHelp({ envFile: '/e', kind: 'systemd', system: true }).join('\n'), /systemctl restart hermes-ui-plus-bridge/);
});

// ---- live test of profiles + the hermes-ui-plus plugin (Hermes v0.22, 2026-10-15) ----
test('systemdUnit: credentials become LoadCredential + an env var pointing into %d', () => {
  const u = systemdUnit({ argv: ['/usr/bin/node', '/usr/lib/b.mjs'], envFile: '/etc/x/env', system: true,
    credentials: [{ name: 'hui-plugin-secret', path: '/root/.hermes/hermes-ui-plus/secret', env: 'BRIDGE_HERMES_PLUGIN_SECRET_FILE' }] });
  assert.match(u, /^LoadCredential=hui-plugin-secret:\/root\/\.hermes\/hermes-ui-plus\/secret$/m);
  assert.match(u, /^Environment=BRIDGE_HERMES_PLUGIN_SECRET_FILE=%d\/hui-plugin-secret$/m);
  assert.match(systemdUnit({ argv: ['/n', '/b'], envFile: '/e', credentials: [{ name: 'c', path: '/a%b', env: 'X' }] }), /^LoadCredential=c:\/a%%b$/m);
  assert.doesNotMatch(systemdUnit({ argv: ['/n', '/b'], envFile: '/e' }), /LoadCredential/);
  for (const bad of [{ name: 'a b', path: '/p', env: 'X' }, { name: 'c', path: '/p', env: 'x=y' }, { name: 'c', path: '/p\nExecStartPre=/bin/evil', env: 'X' }]) {
    assert.throws(() => systemdUnit({ argv: ['/n', '/b'], envFile: '/e', credentials: [bad] }));
  }
});

function withPluginSecret(f) {
  mkdirSync(join(f.hermes, 'hermes-ui-plus'), { recursive: true, mode: 0o700 });
  writeFileSync(join(f.hermes, 'hermes-ui-plus', 'secret'), 'x'.repeat(64), { mode: 0o600 });
  return join(f.hermes, 'hermes-ui-plus', 'secret');
}

test('wizard (user install) points the bridge at the plugin secret; profiles stay auto', async () => {
  const f = fixture();
  const secret = withPluginSecret(f);
  const r = await runSetup(parseSetupArgs(['--yes', '--service', 'systemd']), f.deps);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.hermes.quickPlugin, true);
  const env = readEnvFile(join(f.home, '.config', 'hermes-ui-plus-bridge', 'env'));
  assert.equal(env.BRIDGE_HERMES_PLUGIN_SECRET_FILE, secret);
  assert.equal(env.BRIDGE_PROFILES, undefined); // a user service reads HERMES_HOME/profiles itself
  const unit = readFileSync(join(f.home, '.config', 'systemd', 'user', 'hermes-ui-plus-bridge.service'), 'utf8');
  assert.doesNotMatch(unit, /LoadCredential/);
  assert.doesNotMatch(f.lines.join('\n'), /x{64}/);
  rmSync(f.root, { recursive: true });
});

test('wizard (root, hardened system unit): explicit BRIDGE_PROFILES and the plugin secret as a credential', async () => {
  // live: a ProtectHome unit could not read /root/.hermes, so ⚡ stayed off and profiles fell back to "any"
  const f = fixture();
  const secret = withPluginSecret(f);
  const r = await runSetup(parseSetupArgs(['--yes', '--dry-run', '--service', 'systemd']), { ...f.deps, uid: 0, isRoot: true });
  assert.equal(r.ok, true, r.error);
  const human = f.lines.join('\n');
  assert.match(human, /BRIDGE_PROFILES=work/);
  assert.match(human, new RegExp(`LoadCredential=hui-plugin-secret:${secret.replace(/[.]/g, '\\.')}`));
  assert.match(human, /Environment=BRIDGE_HERMES_PLUGIN_SECRET_FILE=%d\/hui-plugin-secret/);
  assert.match(human, /^\s+BRIDGE_PROFILES=work$/m); // in the env file written
  assert.doesNotMatch(human, /^\s+BRIDGE_HERMES_PLUGIN_SECRET_FILE=/m); // EnvironmentFile= would override the unit's value
  rmSync(f.root, { recursive: true });
});
