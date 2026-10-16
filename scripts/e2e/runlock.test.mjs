// scripts/e2e/runlock.sh: `smoke.sh --wait MIN` also waits for another smoke run's lock instead of refusing at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = fileURLToPath(new URL('./runlock.sh', import.meta.url));
const hasFlock = spawnSync('flock', ['--version']).status === 0;

/** holds `file` for `ms`, resolves once the lock is taken */
function hold(file, ms) {
  const p = spawn('flock', [file, 'sh', '-c', `echo held; sleep ${ms / 1000}`]);
  return new Promise((resolve) => p.stdout.once('data', () => resolve(p)));
}

function runLock(file, waitS) {
  const t0 = Date.now();
  const r = spawnSync('bash', ['-c', `. "$1"; exec 9>"$2"; run_lock "$3" "$2"`, 'x', LIB, file, String(waitS)], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr, ms: Date.now() - t0 };
}

test('run_lock: free lock is taken at once; a held lock refuses at once without --wait', { skip: !hasFlock && 'no flock' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'runlock-test-'));
  const file = join(dir, 'lock');
  try {
    assert.equal(runLock(file, 0).status, 0);
    const holder = await hold(file, 3000);
    const r = runLock(file, 0);
    assert.equal(r.status, 3);
    assert.match(r.out, /another smoke run holds/);
    assert.ok(r.ms < 1500, `refused after ${r.ms} ms`);
    holder.kill();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('run_lock: with a wait it takes the lock once the other run ends, and gives up after the wait', { skip: !hasFlock && 'no flock' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'runlock-test-'));
  const file = join(dir, 'lock');
  try {
    let holder = await hold(file, 1500);
    const ok = runLock(file, 10);
    assert.equal(ok.status, 0, ok.out);
    assert.match(ok.out, /waiting up to 1 min/);
    assert.ok(ok.ms >= 800, `took the lock after ${ok.ms} ms, before the holder ended`);
    if (holder.exitCode === null) await new Promise((r) => holder.once('exit', r));
    holder = await hold(file, 4000);
    const late = runLock(file, 1);
    assert.equal(late.status, 3);
    assert.match(late.out, /still holds/);
    holder.kill();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
