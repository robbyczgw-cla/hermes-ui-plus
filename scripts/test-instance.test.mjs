// scripts/test-instance/: lock, session, host lookup, pid tracking and the watchdog of the throwaway Hermes test
// instance. No Hermes, Docker or network needed: every state lives in a temp dir.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('./test-instance/', import.meta.url));
const sh = (name) => join(DIR, name);

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'ti-test-'));
  const env = { ...process.env, TI_DIR: join(root, 'inst'), TI_LOCK_DIR: join(root, 'lock'), TI_WATCHDOG_S: '1', TI_FLOCK_FILE: join(root, 'flock') };
  delete env.TI_FLAVOR; delete env.TI_LOCK_OWNED; delete env.TI_MAC_LOCK_MINE;
  return { root, env, lock: env.TI_LOCK_DIR, done: () => rmSync(root, { recursive: true, force: true }) };
}
const run = (file, args, env, opts = {}) => spawnSync('bash', [sh(file), ...args], { env, encoding: 'utf8', ...opts });
/** bash snippet with lib.sh sourced */
const lib = (script, env, extra = {}) =>
  spawnSync('bash', ['-c', `. "${sh('lib.sh')}"; ${script}`], { env: { ...env, ...extra }, encoding: 'utf8' });

test('flavors: ports, directories and lock names differ so both instances can be tunneled at once', () => {
  const s = scratch();
  const env = { ...s.env }; delete env.TI_DIR; delete env.TI_LOCK_DIR;
  const read = (flavor) => lib('echo "$TI_FLAVOR $TI_NAME $TI_API_PORT $TI_PLUGIN_PORT $TI_BRIDGE_PORT $(basename "$TI_DIR") $TI_LOCK_DIR"', env, { TI_FLAVOR: flavor }).stdout.trim();
  assert.equal(read('docker'), 'docker linux 18642 18646 18790 hermes-test /tmp/hui-testinst-linux.lock');
  assert.equal(read('native'), 'native mac 28642 28646 28790 hermes-test-mac /tmp/hui-testinst-mac.lock');
  assert.notEqual(lib('true', env, { TI_FLAVOR: 'bogus' }).status, 0);
  s.done();
});

test('lock: a lease is exclusive, released on demand, expires, and a dead session is stale', () => {
  const s = scratch();
  assert.equal(run('lock.sh', ['status'], s.env).stdout.trim(), 'free');
  assert.equal(run('lock.sh', ['take', 'alice'], s.env).status, 0);
  assert.match(run('lock.sh', ['status'], s.env).stdout, /held by lease 'alice'/);
  const second = run('lock.sh', ['take', 'bob'], s.env);
  assert.equal(second.status, 3);
  assert.match(second.stderr, /held by lease 'alice'/);
  assert.equal(run('lock.sh', ['release'], s.env).status, 0);
  assert.equal(run('lock.sh', ['status'], s.env).stdout.trim(), 'free');

  // lease that ran out
  mkdirSync(s.lock);
  writeFileSync(join(s.lock, 'owner'), `0\n\nold\n${Math.floor(Date.now() / 1000) - 9000}\n${Math.floor(Date.now() / 1000) - 10}\n`);
  assert.equal(run('lock.sh', ['status'], s.env).stdout.trim(), 'free');
  assert.equal(run('lock.sh', ['take', 'carol'], s.env).status, 0);
  run('lock.sh', ['release'], s.env);

  // session whose process is gone
  mkdirSync(s.lock);
  writeFileSync(join(s.lock, 'owner'), `999999\nMon Jan  1 00:00:00 2001\nghost\n${Math.floor(Date.now() / 1000)}\n0\n`);
  assert.equal(run('lock.sh', ['status'], s.env).stdout.trim(), 'free');
  assert.equal(run('lock.sh', ['take', 'dave'], s.env).status, 0);
  assert.match(run('lock.sh', ['status'], s.env).stdout, /'dave'/);
  s.done();
});

/** a live session holding the lock for `sec` seconds; resolves once it is taken */
function holdSession(s, sec) {
  return new Promise((resolve, reject) => {
    const p = spawn('bash', ['-c', `. "${sh('lib.sh')}"; tilock_acquire holder 0 $$ 0 && echo held; sleep ${sec}`], { env: s.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (out.includes('held')) resolve(p); });
    p.on('error', reject);
    p.on('exit', () => resolve(null));
  });
}

test('lock: a live session blocks take, lock release and stop.sh; --force overrides', async () => {
  const s = scratch();
  const holder = await holdSession(s, 20);
  assert.ok(holder, 'holder did not take the lock');
  try {
    assert.match(run('lock.sh', ['status'], s.env).stdout, /held by session 'holder'/);
    assert.equal(run('lock.sh', ['take', 'x'], s.env).status, 3);
    const rel = run('lock.sh', ['release'], s.env);
    assert.notEqual(rel.status, 0);
    assert.match(rel.stderr, /a session holds the lock/);
    const stop = run('stop.sh', [], s.env);
    assert.notEqual(stop.status, 0);
    assert.match(stop.stderr, /a session holds the instance/);
    assert.equal(run('lock.sh', ['release', '--force'], s.env).status, 0);
  } finally { holder.kill(); }
  s.done();
});

function sessionRig(s) {
  const log = join(s.root, 'calls.log');
  const mk = (name, body) => { const f = join(s.root, name); writeFileSync(f, `#!/usr/bin/env bash\n${body}\n`); chmodSync(f, 0o755); return f; };
  const env = {
    ...s.env,
    TI_START_SCRIPT: mk('start.sh', `echo start >> "${log}"; [ -z "$FAIL_START" ]`),
    TI_STOP_SCRIPT: mk('stop.sh', `echo "stop owned=$TI_LOCK_OWNED" >> "${log}"`),
  };
  return { env, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []) };
}

test('session: start -> command -> stop under the lock, exit status of the command, lock free afterwards', () => {
  const s = scratch(); const r = sessionRig(s);
  const out = run('session.sh', ['--label', 'unit', '--', 'bash', '-c', `bash "${sh('lock.sh')}" status; exit 7`], r.env);
  assert.equal(out.status, 7);
  assert.match(out.stdout, /held by session 'unit'/);
  assert.deepEqual(r.calls(), ['start', 'stop owned=1']);
  assert.equal(run('lock.sh', ['status'], s.env).stdout.trim(), 'free');
  s.done();
});

test('session: a failed start exits 4, still stops and releases; a held lock exits 3 without starting', async () => {
  const s = scratch(); const r = sessionRig(s);
  const failed = run('session.sh', ['--', 'true'], { ...r.env, FAIL_START: '1' });
  assert.equal(failed.status, 4);
  assert.deepEqual(r.calls(), ['start', 'stop owned=1']);
  assert.equal(run('lock.sh', ['status'], s.env).stdout.trim(), 'free');

  const holder = await holdSession(s, 20);
  try {
    const busy = run('session.sh', ['--wait', '0', '--', 'true'], r.env);
    assert.equal(busy.status, 3);
    assert.deepEqual(r.calls(), ['start', 'stop owned=1'], 'start must not have run again');
  } finally { holder.kill(); }
  s.done();
});

test('session: the instance is stopped when the session is terminated', async () => {
  const s = scratch(); const r = sessionRig(s);
  const p = spawn('bash', [sh('session.sh'), '--', 'sleep', '30'], { env: r.env, stdio: 'ignore' });
  for (let i = 0; i < 50 && r.calls().length < 1; i++) await new Promise((res) => setTimeout(res, 100));
  assert.deepEqual(r.calls(), ['start']);
  p.kill('SIGTERM');
  await new Promise((res) => p.on('exit', res));
  assert.deepEqual(r.calls(), ['start', 'stop owned=1']);
  assert.equal(run('lock.sh', ['status'], s.env).stdout.trim(), 'free');
  s.done();
});

test('host lookup: mac and linux come from the environment or the private files, other names are ssh aliases', () => {
  const s = scratch();
  const priv = join(s.root, 'priv'); mkdirSync(priv);
  writeFileSync(join(priv, 'build.env'), 'MAC_HOST=mac-from-file\nLINUX_HOST=linux-from-build\n');
  const resolve = (name, env = {}) => spawnSync('bash', ['-c', `. "${sh('host.sh')}"; ti_resolve_host ${name}`],
    { env: { PATH: process.env.PATH, HUI_PRIVATE_DIR: priv, ...env }, encoding: 'utf8' });
  assert.equal(resolve('mac').stdout, 'mac-from-file');
  assert.equal(resolve('mac', { MAC_HOST: 'mac-env' }).stdout, 'mac-env');
  assert.equal(resolve('linux').stdout, 'linux-from-build');
  writeFileSync(join(priv, 'test-instance.env'), 'TI_HOST=ti-from-file\n');
  assert.equal(resolve('linux').stdout, 'ti-from-file');
  assert.equal(resolve('some-alias').stdout, 'some-alias');
  assert.notEqual(resolve('mac', { HUI_PRIVATE_DIR: join(s.root, 'none') }).status, 0);
  s.done();
});

/** a long sleep that is not our child (no zombie after a kill, like the daemons start.sh leaves behind) */
function orphanSleep() {
  const r = spawnSync('bash', ['-c', 'sleep 60 </dev/null >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' });
  return { pid: Number(r.stdout.trim()), kill: () => { try { process.kill(Number(r.stdout.trim())); } catch { /* gone */ } } };
}

test('pid tracking: only the recorded process is stopped, a reused pid is left alone', () => {
  const s = scratch();
  const a = orphanSleep(); const b = orphanSleep();
  try {
    const out = lib(`
      pid_record gateway ${a.pid}
      [ "$(pid_of gateway)" = "${a.pid}" ] && echo recorded
      printf '%s|%s\\n' ${b.pid} 'Mon Jan  1 00:00:00 2001' > "$TI_RUN/bridge.pid"
      [ -z "$(pid_of bridge)" ] && echo reused-pid-ignored
      stop_tracked bridge
      kill -0 ${b.pid} && echo other-survived
      stop_tracked gateway
      sleep 0.3
      kill -0 ${a.pid} 2>/dev/null || echo gateway-gone
      [ ! -e "$TI_RUN/gateway.pid" ] && echo pidfile-removed`, s.env);
    assert.equal(out.stdout.trim().split('\n').join(' '), 'recorded reused-pid-ignored other-survived gateway-gone pidfile-removed', out.stderr);
  } finally { a.kill(); b.kill(); s.done(); }
});

test('watchdog: a tracked tree over its cap is killed, one under it is not', async () => {
  const s = scratch();
  const big = spawn('node', ['-e', 'const b = Buffer.alloc(120 * 1024 * 1024, 1); setInterval(() => b[0]++, 1000)']);
  const small = spawn('sleep', ['60']);
  try {
    await new Promise((res) => setTimeout(res, 800));
    lib(`pid_record gateway ${big.pid}; pid_record bridge ${small.pid}`, s.env);
    const wd = spawn('bash', ['-c', `. "${sh('lib.sh')}"; watchdog_loop`], { env: { ...s.env, TI_GATEWAY_MAX_MB: '60', TI_BRIDGE_MAX_MB: '512' }, stdio: 'ignore' });
    try {
      for (let i = 0; i < 100 && big.exitCode === null && big.signalCode === null; i++) await new Promise((res) => setTimeout(res, 200));
      assert.ok(big.exitCode !== null || big.signalCode !== null, 'the tree over its cap was not killed');
      assert.equal(small.exitCode, null, 'the tree under its cap must survive');
      assert.match(readFileSync(join(s.env.TI_DIR, 'run', 'watchdog.log'), 'utf8'), /gateway tree \d+ kB over the cap of 61440 kB, killed/);
    } finally { wd.kill(); }
  } finally { big.kill(); small.kill(); s.done(); }
});

test('mac_heavy_check: refuses next to the lane lock (library or plain lock dir), allows when it is free', () => {
  const s = scratch();
  const lane = join(s.root, 'maclock'); mkdirSync(lane);
  const env = { ...s.env, TI_FLAVOR: 'native', HUI_MAC_LOCK_DIR: lane, TI_MAC_LOCK_LIB: join(s.root, 'absent.sh') };
  const check = (e) => lib('mac_heavy_check && echo ok', e);
  // plain lock dir with a live owner (this very test process)
  writeFileSync(join(lane, 'owner'), `${process.pid}\n\nandroid-build\n${Math.floor(Date.now() / 1000)}\n`);
  const held = check(env);
  assert.notEqual(held.status, 0);
  assert.match(held.stderr, /heavy-job lock/);
  // the session itself holds it: the lock is not the reason to refuse (an emulator or Gradle on this machine still is)
  const mine = check({ ...env, TI_MAC_LOCK_MINE: '1' });
  assert.doesNotMatch(mine.stderr, /heavy-job lock/);
  // owner gone: free
  writeFileSync(join(lane, 'owner'), `999999\n\nandroid-build\n${Math.floor(Date.now() / 1000)}\n`);
  const free = check(env);
  assert.doesNotMatch(free.stderr, /heavy-job lock/);
  s.done();
});

test('session: on the Linux host a plain flock user and a session exclude each other', { skip: spawnSync('bash', ['-c', 'command -v flock']).status !== 0 }, () => {
  const s = scratch(); const r = sessionRig(s);
  const env = { ...r.env, TI_FLAVOR: 'docker' };
  // someone holds the classic flock (a background flock that sleeps)
  const holder = spawn('flock', [s.env.TI_FLOCK_FILE, 'sleep', '20'], { stdio: 'ignore', detached: true });
  try {
    for (let i = 0; i < 40 && !existsSync(s.env.TI_FLOCK_FILE); i++) spawnSync('sleep', ['0.1']);
    spawnSync('sleep', ['0.3']);
    const busy = run('session.sh', ['--', 'true'], env);
    assert.equal(busy.status, 3);
    assert.match(busy.stderr, /flock .* is held by someone else/);
    assert.deepEqual(r.calls(), [], 'start must not have run');
  } finally { process.kill(-holder.pid); }
  const ok = run('session.sh', ['--wait', '5', '--', 'true'], env);
  assert.equal(ok.status, 0, ok.stderr);
  s.done();
});

function holdRig(s) {
  const r = sessionRig(s);
  const inst = s.env.TI_DIR;
  mkdirSync(join(inst, 'data', 'sessions'), { recursive: true });
  writeFileSync(join(inst, 'data', 'state.db'), 'original state');
  writeFileSync(join(inst, 'data', 'sessions', 'a.json'), '{"a":1}');
  writeFileSync(join(inst, 'secret.env'), 'K=1\n');
  chmodSync(join(inst, 'secret.env'), 0o600);
  return { ...r, inst, env: { ...r.env, TI_FLOCK_FILE: '' } };
}
const proofOf = (dir) => spawnSync('python3', [sh('tree-proof.py'), 'digest', dir], { encoding: 'utf8' }).stdout.trim();

test('hold: whatever CMD does to the instance directory, it is back exactly as before (proved), exit status of CMD, lock free', () => {
  const s = scratch(); const r = holdRig(s);
  const before = proofOf(r.inst);
  const cmd = `echo changed > "${r.inst}/data/state.db"; rm "${r.inst}/data/sessions/a.json"; echo new > "${r.inst}/data/new.log"; chmod 644 "${r.inst}/secret.env"; exit 9`;
  const out = run('hold.sh', ['--label', 'unit', '--', 'bash', '-c', cmd], r.env);
  assert.equal(out.status, 9, out.stderr);
  assert.match(out.stderr, /restored: .*identical to the backup/);
  assert.equal(proofOf(r.inst), before);
  assert.equal(readFileSync(join(r.inst, 'data', 'state.db'), 'utf8'), 'original state');
  assert.equal(existsSync(`${r.inst}.hold-backup`) || existsSync(`${r.inst}.hold-after`), false, 'no leftovers');
  assert.equal(run('lock.sh', ['status'], s.env).stdout.trim(), 'free');
  assert.deepEqual(r.calls(), ['stop owned=1', 'stop owned=1'], 'stopped before the backup and before the restore');
  s.done();
});

test('hold: a restore that does not match the backup exits 6 and keeps both trees', () => {
  const s = scratch(); const r = holdRig(s);
  // the backup is damaged while CMD runs: the restored tree (= backup) cannot match its own manifest
  const out = run('hold.sh', ['--', 'bash', '-c', `echo damaged > "${r.inst}.hold-backup/data/state.db"`], r.env);
  assert.equal(out.status, 6);
  assert.match(out.stderr, /restored tree differs/);
  assert.match(out.stderr, /changed data\/state\.db/);
  assert.equal(existsSync(`${r.inst}.hold-after`), true);
  assert.equal(run('lock.sh', ['status'], s.env).stdout.trim(), 'free');
  s.done();
});

test('hold: refuses a stale backup directory and a held lock without touching the instance', async () => {
  const s = scratch(); const r = holdRig(s);
  mkdirSync(`${r.inst}.hold-backup`);
  const stale = run('hold.sh', ['--', 'true'], r.env);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /exists from an earlier run/);
  rmSync(`${r.inst}.hold-backup`, { recursive: true });
  const holder = await holdSession(s, 20);
  try {
    const busy = run('hold.sh', ['--wait', '0', '--', 'true'], r.env);
    assert.equal(busy.status, 3);
    assert.equal(existsSync(`${r.inst}.hold-backup`), false);
  } finally { holder.kill(); }
  s.done();
});

test('tree-proof: content, mode and names count; mtimes do not', () => {
  const s = scratch(); const r = holdRig(s);
  const base = proofOf(r.inst);
  const later = new Date(Date.now() + 5000);
  spawnSync('touch', ['-d', later.toISOString(), join(r.inst, 'data', 'state.db'), join(r.inst, 'data')]);
  assert.equal(proofOf(r.inst), base, 'mtime only');
  writeFileSync(join(r.inst, 'data', 'state.db'), 'original statf'); // same size, other content
  assert.notEqual(proofOf(r.inst), base);
  writeFileSync(join(r.inst, 'data', 'state.db'), 'original state');
  assert.equal(proofOf(r.inst), base);
  chmodSync(join(r.inst, 'secret.env'), 0o644);
  assert.notEqual(proofOf(r.inst), base, 'mode');
  s.done();
});
