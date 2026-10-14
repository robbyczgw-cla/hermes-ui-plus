import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createDeviceStore, LOCK_WAIT_MS, withFileLock } from '../src/devices.mjs';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';

const temp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-lock-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('lock records a unique owner; losing ownership never unlinks a replacement', (t) => {
  const lock = path.join(temp(t), 'state.lock');
  let first;
  withFileLock(lock, () => {
    first = JSON.parse(fs.readFileSync(lock, 'utf8'));
    assert.equal(first.pid, process.pid);
    assert.equal(first.host, os.hostname());
    assert.ok(first.time > 0 && first.token);
    fs.writeFileSync(lock, JSON.stringify({ ...first, token: 'replacement-test-token' }));
  });
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).token, 'replacement-test-token');
});

test('server device writes fail fast and dirty last-use updates retry after contention', async (t) => {
  const dir = temp(t);
  let now = Date.now();
  const ctx = createServer({ HERMES_BASE_URL: 'http://localhost:9', BRIDGE_TOKEN: 'test-admin-token', BRIDGE_ROUTER: 'off', BRIDGE_STATE_DIR: dir }, { logger: silentLogger, now: () => now });
  t.after(() => ctx.devices.close());
  const issued = ctx.devices.issue('test');
  const device = ctx.devices.redeem(issued.code);
  now += 10_000;
  fs.writeFileSync(ctx.devices.lockFile, 'held by test');
  const start = performance.now();
  assert.ok(ctx.devices.authenticate(device.token));
  ctx.devices.flush();
  assert.throws(() => ctx.devices.issue('contended'), { code: 'ELOCKED' });
  // a synchronous wait would block for LOCK_WAIT_MS (5 s) per call: half of one wait is a load-proof bound
  assert.ok(performance.now() - start < LOCK_WAIT_MS / 2, 'server must never synchronously wait for a device lock');
  fs.unlinkSync(ctx.devices.lockFile);
  for (let i = 0; i < 100 && JSON.parse(fs.readFileSync(ctx.devices.file)).devices[0].lastUsedAt !== now; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(JSON.parse(fs.readFileSync(ctx.devices.file)).devices[0].lastUsedAt, now);
});

test('a store whose lock was replaced while preparing its write aborts before rename', (t) => {
  const dir = temp(t);
  let replace = false;
  const s = createDeviceStore({ dir, now: () => {
    if (replace) fs.writeFileSync(s.lockFile, JSON.stringify({ token: 'new-test-owner' }));
    return Date.now();
  } });
  s.issue('seed');
  const before = fs.readFileSync(s.file, 'utf8');
  replace = true;
  assert.throws(() => s.issue('lost'), { code: 'ELOCKLOST' });
  assert.equal(fs.readFileSync(s.file, 'utf8'), before);
  assert.equal(JSON.parse(fs.readFileSync(s.lockFile)).token, 'new-test-owner');
});

test('multiple processes racing to reclaim one stale lock preserve every update', async (t) => {
  const dir = temp(t);
  const s = createDeviceStore({ dir });
  s.issue('seed');
  fs.writeFileSync(s.lockFile, JSON.stringify({ token: 'stale-test-owner', pid: 0, host: 'example.com', time: 1 }));
  fs.utimesSync(s.lockFile, new Date(0), new Date(0));
  const script = `
    import { createDeviceStore } from ${JSON.stringify(new URL('../src/devices.mjs', import.meta.url).href)};
    process.send('ready');
    process.once('message', () => {
      const s = createDeviceStore({ dir: process.argv[1] });
      for (let i = 0; i < 10; i++) s.issue('worker');
      process.disconnect();
    });
  `;
  const children = Array.from({ length: 5 }, () => spawn(process.execPath, ['--input-type=module', '-e', script, dir], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
  t.after(() => children.forEach((c) => c.kill()));
  const exits = children.map((c) => { let err = ''; c.stderr.on('data', (d) => { err += d; }); return once(c, 'exit').then(([code]) => assert.equal(code, 0, err)); });
  await Promise.all(children.map((c) => once(c, 'message')));
  children.forEach((c) => c.send('go'));
  await Promise.all(exits);
  assert.equal(s.list().length, 51);
  assert.deepEqual(fs.readdirSync(dir), ['devices.json']);
});

test('a paused writer cannot overwrite changes after stale takeover', { skip: process.platform === 'win32' }, async (t) => {
  const dir = temp(t);
  const store = createDeviceStore({ dir });
  store.issue('seed');
  const script = `
    import { createDeviceStore } from ${JSON.stringify(new URL('../src/devices.mjs', import.meta.url).href)};
    let pause = true;
    const s = createDeviceStore({ dir: process.argv[1], now: () => {
      if (pause) {
        pause = false;
        process.send('locked');
        process.kill(process.pid, 'SIGSTOP');
      }
      return Date.now();
    } });
    try { s.issue('paused'); process.exitCode = 2; }
    catch (e) { if (e.code !== 'ELOCKLOST') throw e; }
    process.disconnect();
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, dir], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  t.after(() => child.kill('SIGKILL'));
  let err = ''; child.stderr.on('data', (d) => { err += d; });
  const exited = once(child, 'exit');
  await once(child, 'message');
  await new Promise((r) => setTimeout(r, 30));
  fs.utimesSync(store.lockFile, new Date(0), new Date(0));
  store.issue('successor');
  child.kill('SIGCONT');
  assert.equal((await exited)[0], 0, err);
  assert.deepEqual(store.list().map((d) => d.label), ['seed', 'successor']);
});

test('revoking a device still ends its already-open inbox SSE stream', async (t) => {
  const dir = temp(t);
  let now = Date.now();
  const ctx = createServer({ HERMES_BASE_URL: 'http://localhost:9', BRIDGE_TOKEN: 'test-admin-token', BRIDGE_ROUTER: 'off', BRIDGE_STATE_DIR: dir }, { logger: silentLogger, now: () => now });
  const device = ctx.devices.redeem(ctx.devices.issue('test').code);
  ctx.server.listen(0, 'localhost');
  await once(ctx.server, 'listening');
  t.after(() => { ctx.push.stop(); ctx.devices.close(); ctx.server.closeAllConnections(); ctx.server.close(); });
  t.mock.timers.enable({ apis: ['setInterval'] });
  const response = await fetch(`http://localhost:${ctx.server.address().port}/bridge/inbox/stream`, { headers: { authorization: `Bearer ${device.token}` } });
  assert.equal(response.status, 200);
  const ended = response.text();
  createDeviceStore({ dir }).revoke(device.id);
  // Authentication's 2-second cache and the stream's 30-second recheck both expire.
  now += 30_001;
  t.mock.timers.tick(30_001);
  await ended;
  assert.equal(ctx.devices.authenticate(device.token), null);
});

test('a transition in progress cannot be stolen even after the owner lock becomes stale', (t) => {
  const lock = path.join(temp(t), 'state.lock');
  withFileLock(lock, (commit) => {
    fs.utimesSync(lock, new Date(0), new Date(0));
    commit(() => {
      assert.throws(() => withFileLock(lock, () => assert.fail('second writer entered'), { waitMs: 0 }), { code: 'ELOCKED' });
    });
  });
  assert.equal(fs.existsSync(lock), false);
});

test('rebased cache tracking sees a revoke within the same mtime tick under the new lock', (t) => {
  const dir = temp(t);
  const file = path.join(dir, 'devices.json');
  const stat = fs.statSync;
  t.mock.method(fs, 'statSync', (...args) => {
    const value = stat(...args);
    if (args[0] === file) value.mtimeMs = 1; // simulate a coarse filesystem clock
    return value;
  });
  let now = Date.now();
  const running = createDeviceStore({ dir, now: () => now, lockWaitMs: 0 });
  t.after(() => running.close());
  const device = running.redeem(running.issue('test').code);
  assert.ok(running.authenticate(device.token));
  createDeviceStore({ dir }).revoke(device.id);
  now += 2001;
  assert.equal(running.authenticate(device.token), null, 'inode/size signature must invalidate the cached credential');
});
