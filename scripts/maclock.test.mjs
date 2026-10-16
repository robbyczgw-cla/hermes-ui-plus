// scripts/lib/maclock.sh: the one lock the build Mac uses so that iOS/macOS builds and the Android build/emulator never overlap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = fileURLToPath(new URL('./lib/maclock.sh', import.meta.url));

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'maclock-test-'));
  return { dir, lock: join(dir, 'lock') };
}

/** runs a bash snippet with the lib sourced and HUI_MAC_LOCK_DIR set */
function sh(lock, script, env = {}) {
  const t0 = Date.now();
  const r = spawnSync('bash', ['-c', `. "${LIB}"; ${script}`], {
    encoding: 'utf8',
    env: { ...process.env, HUI_MAC_LOCK_DIR: lock, ...env },
  });
  return { status: r.status, out: r.stdout + r.stderr, ms: Date.now() - t0 };
}

/** a shell that holds the lock for `s` seconds; resolves once it is taken */
function hold(lock, kind, s) {
  const p = spawn('bash', ['-c', `. "${LIB}"; maclock_acquire ${kind} 0 >/dev/null && echo held; sleep ${s}`], {
    env: { ...process.env, HUI_MAC_LOCK_DIR: lock },
  });
  return new Promise((resolve) => p.stdout.once('data', () => resolve(p)));
}

test('acquire on a free lock, status, release', () => {
  const { dir, lock } = tmp();
  try {
    const r = sh(lock, 'maclock_status; maclock_acquire ios 0; maclock_status; maclock_release; maclock_status; [ ! -d "$HUI_MAC_LOCK_DIR" ] && echo gone');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /^free$/m);
    assert.match(r.out, /mac lock taken \(ios/);
    assert.match(r.out, /held by ios \(pid \d+/);
    assert.match(r.out, /mac lock released/);
    assert.match(r.out, /^gone$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a live holder makes a second job refuse at once (WAIT_S=0) with a message naming the holder', async () => {
  const { dir, lock } = tmp();
  try {
    const holder = await hold(lock, 'android-emu', 5);
    const r = sh(lock, 'maclock_acquire desktop 0');
    assert.equal(r.status, 3);
    assert.match(r.out, /held by android-emu/);
    assert.match(r.out, /never run together/);
    assert.ok(r.ms < 2000, `refused after ${r.ms} ms`);
    holder.kill();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('waiting takes the lock when the holder ends, and gives up after the wait', async () => {
  const { dir, lock } = tmp();
  try {
    const holder = await hold(lock, 'ios', 2);
    const ok = sh(lock, 'maclock_acquire android-build 20; maclock_release');
    assert.equal(ok.status, 0, ok.out);
    assert.match(ok.out, /waiting up to/);
    assert.ok(ok.ms >= 1000, `took the lock after ${ok.ms} ms, before the holder ended`);
    if (holder.exitCode === null) await new Promise((r) => holder.once('exit', r));
    const h2 = await hold(lock, 'ios', 8);
    const late = sh(lock, 'maclock_acquire android-build 4');
    assert.equal(late.status, 3);
    assert.match(late.out, /held by ios/);
    h2.kill();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stale locks are taken over: dead pid, and a pid reused by another process', () => {
  const { dir, lock } = tmp();
  try {
    mkdirSync(lock);
    writeFileSync(join(lock, 'owner'), '999999\nMon Jan  1 00:00:00 2001\nios\n1\n');
    const dead = sh(lock, 'maclock_acquire desktop 0; maclock_release');
    assert.equal(dead.status, 0, dead.out);
    assert.match(dead.out, /removed a stale lock/);
    // pid of this very test process, but with a start time that is not its own
    mkdirSync(lock);
    writeFileSync(join(lock, 'owner'), `${process.pid}\nMon Jan  1 00:00:00 2001\nios\n1\n`);
    const reused = sh(lock, 'maclock_acquire desktop 0; maclock_release');
    assert.equal(reused.status, 0, reused.out);
    assert.match(reused.out, /removed a stale lock/);
    assert.ok(!existsSync(lock));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a lock directory without owner file is respected while fresh', () => {
  const { dir, lock } = tmp();
  try {
    mkdirSync(lock);
    const r = sh(lock, 'maclock_acquire ios 0');
    assert.equal(r.status, 3);
    assert.match(r.out, /taken \(starting\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI run: passes the exit status through and releases the lock; refuses while held', async () => {
  const { dir, lock } = tmp();
  try {
    const env = { ...process.env, HUI_MAC_LOCK_DIR: lock };
    const ok = spawnSync('bash', [LIB, 'run', 'ios', '0', '--', 'bash', '-c', 'exit 7'], { encoding: 'utf8', env });
    assert.equal(ok.status, 7, ok.stdout + ok.stderr);
    assert.ok(!existsSync(lock), 'lock must be released after the command');
    const holder = await hold(lock, 'desktop', 5);
    assert.match(spawnSync('bash', [LIB, 'status'], { encoding: 'utf8', env }).stdout, /held by desktop/);
    const busy = spawnSync('bash', [LIB, 'run', 'android-build', '0', '--', 'true'], { encoding: 'utf8', env });
    assert.equal(busy.status, 3);
    holder.kill();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
