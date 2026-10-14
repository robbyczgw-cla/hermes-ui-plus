// Review finding (medium): uploads need an aggregate quota for the upload dir and in-flight limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import { loadUploadConfig, uploadDirUsage, DEFAULT_QUOTA_MB } from '../src/uploads.mjs';

const TOKEN = 'bridge-token-upload-quota';
const KB = 1024;

async function start(extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hui-upq-'));
  const dir = join(root, 'uploads');
  const ctx = createServer({
    HERMES_BASE_URL: 'http://127.0.0.1:1', BRIDGE_TOKEN: TOKEN, BRIDGE_ROUTER: 'off', BRIDGE_UPLOAD_DIR: dir,
    BRIDGE_UPLOAD_MAX_BYTES: String(64 * KB), BRIDGE_STATE_DIR: join(root, 'state'), ...extra,
  }, { logger: silentLogger });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  const port = ctx.server.address().port;
  const stop = async () => { ctx.server.close(); ctx.server.closeAllConnections(); await rm(root, { recursive: true, force: true }); };
  return { ctx, dir, port, stop };
}

const send = (port, size, token = TOKEN) => fetch(`http://127.0.0.1:${port}/bridge/uploads`, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain', 'x-filename': 'a.txt' }, body: Buffer.alloc(size, 0x61),
});

/** An upload that sends its headers and a first chunk, then stalls until finish() is called. */
function stalled(port, token = TOKEN) {
  const req = http.request({ host: '127.0.0.1', port, path: '/bridge/uploads', method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain', 'x-filename': 's.txt', 'content-length': '10' } });
  const done = new Promise((resolve) => {
    req.on('response', (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', () => resolve(0));
  });
  req.write('12345');
  return { finish: () => { req.end('67890'); return done; } };
}

test('quota config: BRIDGE_UPLOAD_QUOTA_MB (default 500, 0 = off), in-flight limits', () => {
  const d = loadUploadConfig({});
  assert.equal(d.quotaBytes, DEFAULT_QUOTA_MB * 1024 * 1024);
  assert.equal(d.maxInFlight, 2);
  assert.equal(d.maxInFlightTotal, 6);
  assert.equal(loadUploadConfig({ BRIDGE_UPLOAD_QUOTA_MB: '0' }).quotaBytes, 0);
  assert.equal(loadUploadConfig({ BRIDGE_UPLOAD_QUOTA_MB: '1.5' }).quotaBytes, 1.5 * 1024 * 1024);
});

test('quota: expired files are evicted first; when the dir is still full → 507, nothing stored', async () => {
  const s = await start({ BRIDGE_UPLOAD_QUOTA_MB: String(100 / 1024), BRIDGE_UPLOAD_RETENTION_DAYS: '7' }); // 100 KB
  try {
    // 90 KB of expired uploads from last month
    const old = join(s.dir, '2026-09-01');
    await mkdir(old, { recursive: true });
    await writeFile(join(old, 'aaaa-old.txt'), Buffer.alloc(90 * KB));
    const past = new Date(Date.now() - 30 * 86400_000);
    await utimes(join(old, 'aaaa-old.txt'), past, past);
    const a = await send(s.port, 40 * KB);
    assert.equal(a.status, 201, 'old file evicted to make room');
    assert.equal(await uploadDirUsage(s.dir), 40 * KB);
    assert.equal((await send(s.port, 40 * KB)).status, 201);
    const full = await send(s.port, 40 * KB);
    assert.equal(full.status, 507);
    assert.equal((await full.json()).error.code, 'quota_exceeded');
    assert.equal(await uploadDirUsage(s.dir), 80 * KB);
    assert.equal((await send(s.port, 10 * KB)).status, 201, 'what still fits is accepted');
  } finally {
    await s.stop();
  }
});

test('in flight: 2 per credential, 6 in total → 429; slots are freed when an upload ends', async () => {
  const s = await start({ BRIDGE_UPLOAD_MAX_INFLIGHT_TOTAL: '3' });
  try {
    const dev = s.ctx.devices.redeem(s.ctx.devices.issue('phone').code).token;
    const a = stalled(s.port);
    const b = stalled(s.port);
    await new Promise((r) => setTimeout(r, 150));
    const third = await send(s.port, 100);
    assert.equal(third.status, 429);
    assert.equal(third.headers.get('retry-after'), '5');
    const c = stalled(s.port, dev); // another credential: own budget, total now 3
    await new Promise((r) => setTimeout(r, 150));
    assert.equal((await send(s.port, 100, dev)).status, 429, 'global limit');
    assert.deepEqual(await Promise.all([a.finish(), b.finish(), c.finish()]), [201, 201, 201]);
    assert.equal((await send(s.port, 100)).status, 201);
    assert.equal((await send(s.port, 100, dev)).status, 201);
  } finally {
    await s.stop();
  }
});

test('quota counts an active upload reservation once, including its bytes already on disk', async () => {
  const s = await start({ BRIDGE_UPLOAD_QUOTA_MB: String(20 / (1024 * 1024)) });
  const a = stalled(s.port);
  try {
    for (let i = 0; await uploadDirUsage(s.dir) < 5 && i < 100; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(await uploadDirUsage(s.dir), 5, 'first upload has written half its reservation');
    assert.equal((await send(s.port, 10)).status, 201, '10 reserved + 10 new fits the 20-byte quota');
    assert.equal(await a.finish(), 201);
    assert.equal(await uploadDirUsage(s.dir), 20);
    assert.equal((await send(s.port, 1)).status, 507);
  } finally {
    await a.finish();
    await s.stop();
  }
});
