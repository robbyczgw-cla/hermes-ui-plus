// Per-device bridge tokens (security review M5): store, auth, pairing, admin endpoints.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createDeviceStore, newPairCode, withFileLock, PENDING_TTL_MS, PAIR_CODE_TTL_MS, DEVICES_FILE } from '../src/devices.mjs';
import { createAuth } from '../src/auth.mjs';
import { createServer, deviceStateDir } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-dev-'));
const req = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });

const writeLegacy = (dir, entries) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, DEVICES_FILE), JSON.stringify({ v: 1, devices: entries }));
};
const sha = (s) => createHash('sha256').update(s).digest('hex');

test('store: issue → one-time code (no token yet); redeem → token once; hashes only, file 0600', () => {
  const dir = tmp();
  let t = 1_000_000;
  const s = createDeviceStore({ dir, now: () => t });
  const a = s.issue('Alice iPhone');
  assert.match(a.code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(a.token, undefined, 'issue never creates a token');
  assert.equal(a.expiresAt, t + PAIR_CODE_TTL_MS);
  assert.equal(s.list()[0].status, 'pending');
  assert.equal(s.authenticate(a.code), null, 'a code is not a bearer token');
  const raw0 = fs.readFileSync(path.join(dir, DEVICES_FILE), 'utf8');
  assert.ok(!raw0.includes(a.code), 'plaintext code must not be stored');
  assert.ok(!/"sha256": "[0-9a-f]{64}"/.test(raw0), 'no token hash before redeem');
  const r = s.redeem(a.code);
  assert.equal(r.id, a.id);
  assert.match(r.token, /^hbd_[A-Za-z0-9_-]{43}$/);
  assert.equal(s.redeem(a.code), null, 'single use');
  assert.equal(createDeviceStore({ dir, now: () => t }).redeem(a.code), null, 'single use across processes');
  assert.equal(s.list()[0].status, 'active');
  assert.equal(s.authenticate(r.token)?.id, a.id);
  const raw = fs.readFileSync(path.join(dir, DEVICES_FILE), 'utf8');
  assert.ok(!raw.includes(r.token) && !raw.includes(a.code), 'plaintext token / code must not be stored');
  assert.equal(fs.statSync(path.join(dir, DEVICES_FILE)).mode & 0o777, 0o600);
  assert.equal(s.authenticate('hbd_wrong-token-xxxxxxxxxxxxxxxx'), null);
  assert.equal(s.revoke(a.id), true);
  assert.equal(s.authenticate(r.token), null);
  assert.equal(s.list()[0].status, 'revoked');
  assert.equal(s.revoke('d_0000000000'), false);
  assert.ok(!fs.existsSync(s.lockFile), 'lock released');
});

test('store: redeem refuses malformed, unknown, expired and revoked codes; expired pending devices are pruned', () => {
  const dir = tmp();
  let t = 5_000_000;
  const s = createDeviceStore({ dir, now: () => t });
  for (const bad of [undefined, '', 'short', 'x'.repeat(200), 'has space'.padEnd(43, 'a'), 42]) assert.equal(s.redeem(bad), null);
  assert.equal(s.redeem(newPairCode()), null, 'unknown');
  const late = s.issue('screenshot');
  const revoked = s.issue('lost');
  s.revoke(revoked.id);
  assert.equal(s.redeem(revoked.code), null, 'revoked');
  t += PAIR_CODE_TTL_MS;
  assert.equal(s.list().find((d) => d.id === late.id).status, 'expired');
  assert.equal(s.redeem(late.code), null, 'expired');
  // the expired pending device is gone after the next write; the revoked one stays listed
  assert.deepEqual(s.list().map((d) => [d.id, d.status]), [[revoked.id, 'revoked']]);
  s.issue('next');
  assert.equal(s.list().length, 2);
});

test('store: legacy t= tokens of already paired devices keep working; a never-used legacy token still expires', () => {
  const dir = tmp();
  let t = 50_000_000;
  const used = 'hbd_legacy-used-token-0000000000000000000000';
  const unused = 'hbd_legacy-unused-token-00000000000000000000';
  writeLegacy(dir, [
    { id: 'd_aaaaaaaaaa', label: 'old phone', sha256: sha(used), createdAt: t - 30 * 86400_000, activatedAt: t - 30 * 86400_000, lastUsedAt: null, revokedAt: null },
    { id: 'd_bbbbbbbbbb', label: 'old qr', sha256: sha(unused), createdAt: t - 1000, activatedAt: null, lastUsedAt: null, revokedAt: null },
  ]);
  const s = createDeviceStore({ dir, now: () => t });
  assert.equal(s.authenticate(used)?.id, 'd_aaaaaaaaaa');
  t += PENDING_TTL_MS;
  assert.equal(s.authenticate(unused), null);
  assert.equal(s.authenticate(used)?.id, 'd_aaaaaaaaaa');
});

test('store: revocation by another process (CLI) is picked up by a running bridge within 2 s', () => {
  const dir = tmp();
  let t = 9_000_000;
  const running = createDeviceStore({ dir, now: () => t });
  const d = running.redeem(running.issue('tablet').code);
  assert.ok(running.authenticate(d.token));
  const cli = createDeviceStore({ dir });
  assert.ok(cli.revoke(d.id));
  t += 2001;
  assert.equal(running.authenticate(d.token), null);
  // a later last-use flush of the running bridge must not resurrect the device
  running.flush();
  assert.equal(createDeviceStore({ dir }).list()[0].status, 'revoked');
});

test('lock: exclusive, waits for the holder, removes a stale lock, times out on a live one', () => {
  const dir = tmp();
  const lock = path.join(dir, 'x.lock');
  assert.equal(withFileLock(lock, () => 42), 42);
  assert.ok(!fs.existsSync(lock));
  // live lock held by "another process": times out without running fn
  fs.writeFileSync(lock, '1');
  let ran = false;
  assert.throws(() => withFileLock(lock, () => { ran = true; }, { waitMs: 100 }), (e) => e.code === 'ELOCKED');
  assert.equal(ran, false);
  // stale lock (crashed holder): removed, fn runs
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  assert.equal(withFileLock(lock, () => 'ok', { staleMs: 10_000 }), 'ok');
  assert.ok(!fs.existsSync(lock));
  // fn throws: lock still released
  assert.throws(() => withFileLock(lock, () => { throw new Error('boom'); }), /boom/);
  assert.ok(!fs.existsSync(lock));
});

// Review finding (medium): CLI and bridge are separate processes doing read-modify-write on devices.json.
test('lock: concurrent writers in separate processes never lose an update', async () => {
  const dir = tmp();
  const seed = createDeviceStore({ dir });
  const victim = seed.redeem(seed.issue('victim').code);
  const worker = `
    const { createDeviceStore } = await import(${JSON.stringify(new URL('../src/devices.mjs', import.meta.url).href)});
    const s = createDeviceStore({ dir: process.argv[1] });
    const [mode] = process.argv.slice(2);
    if (mode === 'revoke') { s.revoke(${JSON.stringify(victim.id)}); }
    else for (let i = 0; i < 15; i++) { s.issue('w' + process.pid + '-' + i); }
  `;
  const run = (mode) => new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', worker, dir, mode], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(0, 500)))));
  });
  await Promise.all([run('issue'), run('issue'), run('revoke'), run('issue'), run('issue')]);
  const list = createDeviceStore({ dir }).list();
  assert.equal(list.filter((d) => d.label.startsWith('w')).length, 60, 'every issue() survived');
  assert.equal(list.find((d) => d.id === victim.id).status, 'revoked', 'the revoke survived');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp') || f.endsWith('.lock')), [], 'no temp / lock files left');
});

test('auth: admin token and device tokens; no state dir → BRIDGE_TOKEN only', () => {
  const dir = tmp();
  const store = createDeviceStore({ dir });
  const auth = createAuth({ token: 'admin-token-123456' }, store);
  const d = store.redeem(store.issue('x').code);
  assert.deepEqual(auth.check(req('admin-token-123456')), { kind: 'admin' });
  assert.deepEqual(auth.check(req(d.token)), { kind: 'device', id: d.id });
  assert.equal(auth.check(req('nope-nope-nope-nope')), null);
  assert.equal(auth.check(req()), null);
  assert.equal(auth.isAdmin(req(d.token)), false);
  assert.equal(createAuth({ token: 'admin-token-123456' }).check(req(d.token)), null);
  assert.equal(deviceStateDir({ STATE_DIRECTORY: '/var/lib/hermes-ui-bridge:/x' }), '/var/lib/hermes-ui-bridge');
  assert.equal(deviceStateDir({ BRIDGE_STATE_DIR: '/s', BRIDGE_DEVICE_TOKENS: '0' }), '');
});

// ---- integration ----
const ADMIN = 'admin-bridge-token-0123';
let upstream; let ctx; let base;
before(async () => {
  upstream = http.createServer((q, r) => { q.resume(); r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"data":[]}'); });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  ctx = createServer({
    HERMES_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, BRIDGE_TOKEN: ADMIN, BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'off',
    BRIDGE_STATE_DIR: tmp(), BRIDGE_PUBLIC_URL: 'https://hermes-host.example.ts.net',
  }, { logger: silentLogger });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  base = `http://127.0.0.1:${ctx.server.address().port}`;
});
after(() => { for (const s of [ctx.server, upstream]) { s.close(); s.closeAllConnections(); } });

const call = (p, { method = 'GET', token, body } = {}) =>
  fetch(base + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body });

const redeem = (code, { headers = {} } = {}) => fetch(`${base}/bridge/pair/redeem`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ code }) });
const codeOf = (uri) => new URL(uri.replace(/^hermes[a-z]*:\/\/pair/, 'https://x/')).searchParams.get('c');

test('integration: pairing page → one-time code → POST /bridge/pair/redeem → device token (once); it works and can be revoked', async () => {
  const html = (await (await call('/bridge/pair')).text()).replaceAll('&amp;', '&');
  assert.ok(!html.includes(ADMIN), 'admin token must not be on the pair page');
  const m = /hermesuiplus:\/\/pair\?[^"]*/.exec(html);
  assert.ok(m, 'pair URI on the page');
  assert.doesNotMatch(m[0], /[?&]t=/, 'no token in the link');
  const code = codeOf(m[0]);
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  const r = await redeem(code);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const j = await r.json();
  assert.deepEqual(Object.keys(j).sort(), ['deviceId', 'name', 'token']);
  assert.match(j.token, /^hbd_/);
  assert.match(j.deviceId, /^d_/);
  assert.equal(j.name, 'Hermes');
  // works exactly once; the second answer is the same generic error as for an unknown code (no oracle)
  const again = await redeem(code);
  const unknown = await redeem(newPairCode());
  assert.equal(again.status, 410);
  assert.equal(unknown.status, 410);
  assert.equal(await again.text(), await unknown.text());
  const device = j.token;
  assert.equal((await call('/v1/models', { token: device })).status, 200);
  assert.equal((await call('/bridge/status', { token: device })).status, 200);
  assert.equal((await call('/bridge/images/config', { token: device })).status !== 401, true);
  // device tokens cannot manage devices
  assert.equal((await call('/bridge/devices', { token: device })).status, 403);
  assert.equal((await call('/bridge/devices')).status, 401);
  const list = await (await call('/bridge/devices', { token: ADMIN })).json();
  assert.equal(list.devices.length, 1);
  assert.equal(list.devices[0].status, 'active');
  assert.ok(!JSON.stringify(list).includes('sha256'));
  assert.equal((await call(`/bridge/devices/${list.devices[0].id}`, { method: 'DELETE', token: ADMIN })).status, 204);
  assert.equal((await call('/v1/models', { token: device })).status, 401);
  assert.equal((await call('/v1/models', { token: ADMIN })).status, 200); // admin keeps working
});

test('integration: POST /bridge/devices issues a labelled pending device with a code link, no token', async () => {
  const r = await call('/bridge/devices', { method: 'POST', token: ADMIN, body: JSON.stringify({ label: 'Pip tablet' }) });
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.match(j.id, /^d_/);
  assert.equal(j.token, undefined);
  assert.match(j.pairUri, /^hermesuiplus:\/\/pair\?u=https%3A%2F%2Fhermes-host\.example\.ts\.net&c=[A-Za-z0-9_-]{43}&n=Hermes$/);
  assert.ok(j.expiresAt > Date.now());
  let list = await (await call('/bridge/devices', { token: ADMIN })).json();
  assert.equal(list.devices.find((d) => d.label === 'Pip tablet').status, 'pending');
  const tok = (await (await redeem(codeOf(j.pairUri))).json()).token;
  assert.equal((await call('/v1/models', { token: tok })).status, 200);
  list = await (await call('/bridge/devices', { token: ADMIN })).json();
  assert.equal(list.devices.find((d) => d.label === 'Pip tablet').status, 'active');
  assert.equal((await call('/bridge/devices/d_zzzzzzzzzz', { method: 'DELETE', token: ADMIN })).status, 404);
  assert.equal((await call('/bridge/devices', { method: 'PUT', token: ADMIN })).status, 405);
});

test('redeem: body limits and JSON; only POST', async () => {
  const big = await fetch(`${base}/bridge/pair/redeem`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'x'.repeat(2000) }) });
  assert.equal(big.status, 413);
  const bad = await fetch(`${base}/bridge/pair/redeem`, { method: 'POST', body: 'nope' });
  assert.equal(bad.status, 400);
  const noCode = await fetch(`${base}/bridge/pair/redeem`, { method: 'POST', body: '{}' });
  assert.equal(noCode.status, 400);
  const get = await fetch(`${base}/bridge/pair/redeem`);
  assert.notEqual(get.status, 200);
});

test('redeem: rate limited per remote address (10/min) and globally; codes and tokens never logged', async () => {
  const lines = [];
  const logger = { debug() {}, info: (m, o) => lines.push(JSON.stringify([m, o])), warn: (m, o) => lines.push(JSON.stringify([m, o])), error: (m, o) => lines.push(JSON.stringify([m, o])) };
  let t = 1_000_000;
  const c = createServer({ HERMES_BASE_URL: 'http://127.0.0.1:9', BRIDGE_TOKEN: ADMIN, BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'off', BRIDGE_STATE_DIR: tmp() }, { logger, now: () => t });
  c.server.listen(0, '127.0.0.1');
  await once(c.server, 'listening');
  const b = `http://127.0.0.1:${c.server.address().port}`;
  const post = (code) => fetch(`${b}/bridge/pair/redeem`, { method: 'POST', body: JSON.stringify({ code }) });
  try {
    const good = c.pairing.issue('rate');
    for (let i = 0; i < 10; i++) assert.equal((await post(newPairCode())).status, 410);
    const limited = await post(newPairCode());
    assert.equal(limited.status, 429, 'failed attempts have their own budget');
    assert.equal(limited.headers.get('retry-after'), '60');
    const ok = await post(good.code);
    assert.equal(ok.status, 200);
    const { token } = await ok.json();
    const all = lines.join('\n');
    assert.ok(!all.includes(good.code), 'code in log');
    assert.ok(!all.includes(token), 'token in log');
  } finally {
    c.server.close();
    c.server.closeAllConnections();
  }
});

test('GPT security H3: revoking a device drops its push registrations; admin registration keeps working', async () => {
  const calls = [];
  const fcm = { kind: 'fcm', send: async (token) => (calls.push(token), { ok: true, status: 200 }) };
  const c = createServer({
    HERMES_BASE_URL: 'http://127.0.0.1:9', BRIDGE_TOKEN: ADMIN, BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'off', BRIDGE_STATE_DIR: tmp(),
  }, { logger: silentLogger, pushSenders: { fcm } });
  c.server.listen(0, '127.0.0.1');
  await once(c.server, 'listening');
  const b = `http://127.0.0.1:${c.server.address().port}`;
  const post = (p, token, body) => fetch(b + p, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const issued = await (await post('/bridge/devices', ADMIN, { label: 'phone' })).json();
    const code = new URL(issued.pairUri.replace('hermesuiplus://pair', 'https://x/')).searchParams.get('c');
    const r0 = await fetch(`${b}/bridge/pair/redeem`, { method: 'POST', body: JSON.stringify({ code }) });
    const { token, deviceId } = await r0.json();
    const dev = { id: deviceId, token };
    const FCM = 'f'.repeat(40) + ':APA91b' + 'x'.repeat(100);
    assert.equal((await post('/bridge/push/register', dev.token, { platform: 'fcm', token: FCM, profileId: 'p-phone', preview: 'on' })).status, 200);
    assert.equal((await post('/bridge/push/register', ADMIN, { platform: 'fcm', token: FCM + 'A', profileId: 'p-admin' })).status, 200);
    assert.equal((await fetch(`${b}/bridge/devices/${dev.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${ADMIN}` } })).status, 204);
    const r = await (await post('/bridge/push/test', ADMIN, {})).json();
    assert.equal(r.results.length, 1);
    assert.deepEqual(calls, [FCM + 'A']);
  } finally {
    c.server.close();
    c.server.closeAllConnections();
  }
});
