// Routines rights (slice 2): resolution matrix, persistence in devices.json, enforcement on /api/jobs and
// /p/<bot>/api/jobs, admin endpoints, CLI. Real bridge in front of a fake Hermes job API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import { createDeviceStore, parseDevices, parseRoutinesPolicy } from '../src/devices.mjs';
import { createRoutinesRights, minRight, parseRoutinesBots, routinesCli } from '../src/routines-rights.mjs';
import { loadConfig } from '../src/config.mjs';

const TOKEN = 'test-token-0000000000000000';
const ID = 'aaaaaaaaaaaa';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

// ---------- resolution matrix (unit) ----------

function fakeRights({ mode = 'control', env = '', file = {}, overrides = {}, served = ['writer', 'reader'] } = {}) {
  const devices = { routinesPolicy: () => ({ bots: file }), deviceRoutines: (id) => overrides[id] ?? {} };
  const profiles = { allowed: (n) => served.includes(n), names: () => served };
  return createRoutinesRights({ mode, bots: parseRoutinesBots(env), devices: /** @type {any} */ (devices), profiles });
}
const admin = { kind: 'admin' };
const open = { kind: 'open' };
const dev = (id) => ({ kind: 'device', id });

test('parseRoutinesBots: comma list, * and default; invalid names throw; config wires it', () => {
  assert.deepEqual(parseRoutinesBots(''), { all: false, names: [] });
  assert.deepEqual(parseRoutinesBots(' default , writer,writer,* '), { all: true, names: ['default', 'writer'] });
  assert.throws(() => parseRoutinesBots('Writer'), /BRIDGE_ROUTINES_BOTS/);
  assert.throws(() => parseRoutinesBots('a/b'), /BRIDGE_ROUTINES_BOTS/);
  const env = { HERMES_BASE_URL: 'http://127.0.0.1:1/v1', BRIDGE_TOKEN: TOKEN, BRIDGE_BOOTSTRAP: 'off' };
  assert.deepEqual(loadConfig({ ...env, BRIDGE_ROUTINES_BOTS: 'writer' }).routinesBots, { all: false, names: ['writer'] });
  assert.throws(() => loadConfig({ ...env, BRIDGE_ROUTINES_BOTS: '../x' }), /BRIDGE_ROUTINES_BOTS/);
  const c = loadConfig({ ...env, BRIDGE_ROUTINES_POLL_MS: '5', BRIDGE_ROUTINES_INBOX_DAYS: '7', BRIDGE_ROUTINES_INBOX_MAX: '9' }).routinesInbox;
  assert.deepEqual(c, { pollMs: 10_000, retentionDays: 7, maxItems: 9 });
  assert.equal(minRight('manage', 'read'), 'read');
  assert.equal(minRight('none', 'manage'), 'none');
});

test('matrix: ceiling × enabled × admin / open / device default / override', () => {
  const ov = { d_aaaaaaaaaa: { default: 'manage', writer: 'none' }, d_bbbbbbbbbb: { default: 'read' } };
  // control ceiling, default enabled via env
  let r = fakeRights({ env: 'default', overrides: ov });
  assert.equal(r.access(admin, 'default').right, 'manage');
  assert.equal(r.access(open, 'default').right, 'manage');
  assert.equal(r.access(null, 'default').right, 'manage', 'no auth layer = owner');
  assert.equal(r.access(dev('d_cccccccccc'), 'default').right, 'read', 'default read, never silent manage');
  assert.deepEqual(r.access(dev('d_cccccccccc'), 'default').reasons, ['read_only_device']);
  assert.equal(r.access(dev('d_aaaaaaaaaa'), 'default').right, 'manage');
  assert.equal(r.access(dev('d_bbbbbbbbbb'), 'default').right, 'read');
  // not enabled → none + 404 routines_off, whoever asks
  for (const who of [admin, dev('d_aaaaaaaaaa')]) {
    const a = r.access(who, 'writer');
    assert.deepEqual([a.right, a.status, a.code, a.reasons], ['none', 404, 'routines_off', ['bot_not_enabled']]);
  }
  // enabled in the file; explicit none → 403 routines_forbidden
  r = fakeRights({ file: { writer: true }, overrides: ov });
  assert.equal(r.access(admin, 'writer').right, 'manage');
  const f = r.access(dev('d_aaaaaaaaaa'), 'writer');
  assert.deepEqual([f.right, f.status, f.code, f.reasons], ['none', 403, 'routines_forbidden', ['device_forbidden']]);
  assert.equal(r.access(admin, 'default').code, 'routines_off', 'default needs its own opt-in');
  // read ceiling: at most read, also for admin and a manage override
  r = fakeRights({ mode: 'read', env: '*', overrides: ov });
  assert.equal(r.access(admin, 'default').right, 'read');
  assert.deepEqual(r.access(admin, 'default').reasons, ['read_only_server']);
  assert.equal(r.access(dev('d_aaaaaaaaaa'), 'default').right, 'read');
  assert.equal(r.access(dev('d_aaaaaaaaaa'), 'writer').code, 'routines_forbidden');
  // off ceiling: none everywhere, 404
  r = fakeRights({ mode: 'off', env: '*', file: { writer: true }, overrides: ov });
  for (const bot of ['default', 'writer']) assert.deepEqual([r.access(admin, bot).status, r.access(admin, bot).reasons], [404, ['routines_off']]);
  assert.deepEqual(r.enabledBots(), []);
});

test('enablement: env OR file; * covers only bots the bridge serves; enabledBots order; credential ids', () => {
  let r = fakeRights({ env: 'writer', file: { writer: false, reader: true } });
  assert.equal(r.isEnabled('writer'), true, 'env enables even when the file says false');
  assert.equal(r.isEnabled('reader'), true);
  assert.equal(r.isEnabled('default'), false);
  assert.deepEqual(r.enabledBots(), ['writer', 'reader']);
  r = fakeRights({ env: '*' });
  assert.deepEqual(r.enabledBots(), ['default', 'writer', 'reader']);
  assert.equal(r.isEnabled('ghost'), false, 'a profile the bridge does not serve');
  assert.equal(r.isEnabled('Bad Name'), false);
  r = fakeRights({ env: '*', overrides: { d_aaaaaaaaaa: { default: 'none' } } });
  assert.equal(r.rightOfCredential('admin_0123456789abcdef', 'default'), 'manage');
  assert.equal(r.rightOfCredential('open', 'default'), 'manage');
  assert.equal(r.rightOfCredential('dev_d_bbbbbbbbbb', 'default'), 'read');
  assert.equal(r.rightOfCredential('dev_d_aaaaaaaaaa', 'default'), 'none');
  assert.equal(r.rightOfCredential(null, 'default'), 'none');
  assert.equal(r.rightOfCredential('junk', 'default'), 'none');
});

// ---------- persistence ----------

test('devices.json: routines fields survive issue / redeem / flushUse / revoke; unknown values dropped', () => {
  const dir = tmp('routines-store-');
  let t = 1_000_000;
  const store = createDeviceStore({ dir, now: () => t });
  const a = store.issue('Phone');
  store.setRoutines({ bots: { default: true, writer: false }, devices: { [a.id]: { default: 'manage', writer: 'none' } } });
  const b = store.issue('Tablet'); // issue rewrites the file
  const red = store.redeem(a.code); // redeem rewrites the file
  assert.ok(red);
  t += 11 * 60_000;
  assert.ok(store.authenticate(red.token)); // flushUse on first use / after 10 min
  store.revoke(b.id);
  const doc = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  assert.deepEqual(doc.routines, { bots: { default: true, writer: false } });
  assert.deepEqual(doc.devices.find((d) => d.id === a.id).routines, { default: 'manage', writer: 'none' });
  assert.equal(doc.devices.find((d) => d.id === b.id).routines, undefined);
  // another process (fresh store) sees the same
  const other = createDeviceStore({ dir });
  assert.deepEqual(other.routinesPolicy(), { bots: { default: true, writer: false } });
  assert.deepEqual(other.deviceRoutines(a.id), { default: 'manage', writer: 'none' });
  const v = other.routinesView();
  assert.deepEqual(v.devices.map((d) => [d.id, d.status]).sort(), [[a.id, 'active'], [b.id, 'revoked']].sort());
  assert.doesNotMatch(JSON.stringify(v), /sha256|codeSha256|hbd_/);
  // null removes an override; unknown device ids are refused and nothing is written
  other.setRoutines({ devices: { [a.id]: { writer: null } } });
  assert.deepEqual(other.deviceRoutines(a.id), { default: 'manage' });
  const before = fs.readFileSync(store.file, 'utf8');
  assert.throws(() => other.setRoutines({ bots: { default: false }, devices: { d_zzzzzzzzzz: { default: 'read' } } }), (e) => e.code === 'unknown_device');
  assert.equal(fs.readFileSync(store.file, 'utf8'), before);
  // parse: unknown bots / rights / types dropped
  assert.deepEqual(parseRoutinesPolicy({ routines: { bots: { default: true, 'Bad!': true, writer: 'yes' } } }), { bots: { default: true } });
  const [d] = parseDevices({ devices: [{ id: 'd_aaaaaaaaaa', sha256: 'a'.repeat(64), routines: { default: 'admin', writer: 'read', 'x/y': 'read' } }] });
  assert.deepEqual(d.routines, { writer: 'read' });
  const [e] = parseDevices({ devices: [{ id: 'd_aaaaaaaaaa', sha256: 'a'.repeat(64), routines: { default: 'admin' } }] });
  assert.equal('routines' in e, false);
  fs.rmSync(dir, { recursive: true });
});

// ---------- enforcement + admin endpoints (real bridge) ----------

let upstream;
/** @type {any[]} */ let seen = [];
const job = { id: ID, name: 'Digest', enabled: true, state: 'scheduled', last_run_at: '2026-01-01T07:00:00Z', last_status: 'ok' };
const servers = [];
before(async () => {
  upstream = http.createServer((req, res) => {
    req.resume();
    seen.push({ method: req.method, url: req.url });
    const p = new URL(req.url, 'http://x').pathname.replace(/^\/p\/[a-z0-9_-]+/, '');
    const json = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (p === '/api/jobs') return json(200, { jobs: [job] });
    if (p === `/api/jobs/${ID}`) return json(200, { job });
    if (p === `/api/jobs/${ID}/pause` || p === `/api/jobs/${ID}/resume`) return json(200, { job });
    if (p === '/api/sessions') return json(200, { object: 'list', data: [] });
    return json(404, { error: 'nope' });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
});
after(() => { for (const s of [...servers, upstream]) { s.close(); s.closeAllConnections(); } });

async function bridge(env = {}) {
  const ctx = createServer({
    HERMES_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`, HERMES_API_KEY: 'upstream-test-key', BRIDGE_TOKEN: TOKEN,
    BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'off', BRIDGE_PROFILES: 'writer', HERMES_HOME: path.join(os.tmpdir(), 'routines-no-hermes-home'),
    ...env,
  }, { logger: silentLogger });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  servers.push(ctx.server);
  const base = `http://127.0.0.1:${ctx.server.address().port}`;
  const call = async (p, { method = 'GET', body, auth = TOKEN } = {}) => {
    const r = await fetch(base + p, { method, headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = undefined; }
    return { status: r.status, data, text };
  };
  /** a paired device token */
  const pair = (label) => {
    const d = ctx.devices.issue(label);
    return { id: d.id, token: ctx.devices.redeem(d.code).token };
  };
  return { ctx, call, pair };
}

test('jobs: bots are opt-in; admin manages, a device views by default, grants and none apply; /p/<bot>/ separately', async () => {
  const { call, pair } = await bridge({ BRIDGE_STATE_DIR: tmp('routines-enf-') });
  const phone = pair('Phone');
  seen = [];
  let r = await call('/api/jobs');
  assert.deepEqual([r.status, r.data.error.code], [404, 'routines_off']);
  assert.equal(seen.length, 0, 'not enabled: never upstream');
  assert.equal((await call('/bridge/routines/rights', { method: 'PUT', body: { bots: { default: true } } })).status, 200);
  r = await call('/api/jobs');
  assert.deepEqual([r.status, r.data.hui], [200, { routines: 'control', rights: 'manage' }]);
  r = await call(`/api/jobs/${ID}`, { auth: phone.token });
  assert.deepEqual([r.status, r.data.hui], [200, { routines: 'read', rights: 'read' }]);
  seen = [];
  for (const a of ['pause', 'resume', 'run']) {
    r = await call(`/api/jobs/${ID}/${a}`, { method: 'POST', body: '{}', auth: phone.token });
    assert.deepEqual([r.status, r.data.error.code, r.data.error.message], [403, 'routines_read_only', 'This device may only view routines'], a);
  }
  assert.equal(seen.length, 0);
  // grant manage → mutations work
  assert.equal((await call('/bridge/routines/rights', { method: 'PUT', body: { devices: { [phone.id]: { default: 'manage' } } } })).status, 200);
  r = await call(`/api/jobs/${ID}/pause`, { method: 'POST', body: '{}', auth: phone.token });
  assert.deepEqual([r.status, r.data.hui.rights], [200, 'manage']);
  // explicit none → 403 routines_forbidden on read, too
  await call('/bridge/routines/rights', { method: 'PUT', body: { devices: { [phone.id]: { default: 'none' } } } });
  seen = [];
  for (const [method, p] of [['GET', '/api/jobs'], ['GET', `/api/jobs/${ID}`], ['POST', `/api/jobs/${ID}/pause`]]) {
    r = await call(p, { method, auth: phone.token, body: method === 'POST' ? '{}' : undefined });
    assert.deepEqual([r.status, r.data.error.code], [403, 'routines_forbidden'], p);
  }
  assert.equal(seen.length, 0);
  // the writer bot is not enabled yet; enabling it gives the device the default read
  assert.equal((await call('/p/writer/api/jobs', { auth: phone.token })).data.error.code, 'routines_off');
  await call('/bridge/routines/rights', { method: 'PUT', body: { bots: { writer: true } } });
  r = await call('/p/writer/api/jobs', { auth: phone.token });
  assert.deepEqual([r.status, r.data.hui.rights], [200, 'read']);
  assert.equal((await call(`/p/writer/api/jobs/${ID}/pause`, { method: 'POST', body: '{}', auth: phone.token })).data.error.code, 'routines_read_only');
  assert.equal(seen.at(-1).url, '/p/writer/api/jobs?include_disabled=true');
  // read ceiling wins over a manage grant; the message names the server
  const ro = await bridge({ BRIDGE_ROUTINES: 'read', BRIDGE_ROUTINES_BOTS: 'default' });
  r = await ro.call(`/api/jobs/${ID}/pause`, { method: 'POST', body: '{}' });
  assert.deepEqual([r.status, r.data.error.code, r.data.error.message], [403, 'routines_read_only', 'Routines are read-only on this bridge']);
});

test('admin endpoints: BRIDGE_TOKEN only, shape without hashes, validation, null removes, caps', async () => {
  const dir = tmp('routines-admin-');
  const { call, pair } = await bridge({ BRIDGE_STATE_DIR: dir, BRIDGE_ROUTINES_BOTS: 'writer,*' });
  const phone = pair('Phone');
  assert.equal((await call('/bridge/routines/rights', { auth: null })).status, 401);
  for (const method of ['GET', 'PUT']) {
    const r = await call('/bridge/routines/rights', { method, auth: phone.token, body: method === 'PUT' ? { bots: { default: true } } : undefined });
    assert.deepEqual([r.status, r.data.error.code], [403, 'admin_required'], method);
  }
  let r = await call('/bridge/routines/rights');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { mode: 'control', envBots: ['*', 'writer'], bots: {}, defaultRight: 'read', devices: [{ id: phone.id, label: 'Phone', status: 'active', routines: {} }] });
  r = await call('/bridge/routines/rights', { method: 'PUT', body: { bots: { default: false }, devices: { [phone.id]: { writer: 'manage', default: 'none' } } } });
  assert.deepEqual([r.data.bots, r.data.devices[0].routines], [{ default: false }, { writer: 'manage', default: 'none' }]);
  r = await call('/bridge/routines/rights', { method: 'PUT', body: { devices: { [phone.id]: { default: null } } } });
  assert.deepEqual(r.data.devices[0].routines, { writer: 'manage' });
  assert.doesNotMatch(r.text, /sha256|hbd_/);
  for (const [body, code] of [
    [{ extra: 1 }, 'unsupported_field'], [{ bots: { 'Bad!': true } }, 'invalid_bot'], [{ bots: { writer: 'yes' } }, 'invalid_request'],
    [{ devices: { [phone.id]: { writer: 'admin' } } }, 'invalid_right'], [{ devices: { d_zzzzzzzzzz: { writer: 'read' } } }, 'unknown_device'],
    [{ devices: { 'not-an-id': { writer: 'read' } } }, 'unknown_device'], ['[1]', 'invalid_json'], ['{', 'invalid_json'],
  ]) {
    r = await call('/bridge/routines/rights', { method: 'PUT', body });
    assert.deepEqual([r.status, r.data.error.code], [400, code], JSON.stringify(body));
  }
  r = await call('/bridge/routines/rights', { method: 'PUT', body: JSON.stringify({ bots: { default: true }, pad: 'x'.repeat(9000) }) });
  assert.deepEqual([r.status, r.data.error.code], [413, 'payload_too_large']);
  assert.equal((await call('/bridge/routines/rights', { method: 'DELETE' })).status, 405);
  // nothing of the refused writes landed
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'devices.json'), 'utf8')).routines, { bots: { default: false } });
  // no state dir: GET works (env bots only), PUT with changes is refused
  const plain = await bridge({ BRIDGE_ROUTINES_BOTS: 'default' });
  r = await plain.call('/bridge/routines/rights');
  assert.deepEqual([r.status, r.data.envBots, r.data.bots, r.data.devices], [200, ['default'], {}, []]);
  r = await plain.call('/bridge/routines/rights', { method: 'PUT', body: { bots: { writer: true } } });
  assert.deepEqual([r.status, r.data.error.code], [409, 'state_dir_required']);
});

test('CLI: routines status / enable / disable / grant on the state dir', () => {
  const dir = tmp('routines-cli-');
  const store = createDeviceStore({ dir });
  const d = store.issue('Laptop');
  const env = { BRIDGE_ROUTINES: 'read', BRIDGE_ROUTINES_BOTS: 'default' };
  assert.match(routinesCli('enable', ['writer'], { env, store })[0], /enabled for writer/);
  assert.match(routinesCli('grant', [d.id, 'writer', 'manage'], { env, store })[0], /writer = manage/);
  const lines = routinesCli('status', [], { env, store });
  assert.equal(lines[0], 'mode read (BRIDGE_ROUTINES)');
  assert.match(lines[1], /BRIDGE_ROUTINES_BOTS: default$/);
  assert.match(lines[2], /writer=on/);
  assert.ok(lines.some((l) => l.startsWith(d.id) && /writer=manage/.test(l)));
  assert.match(routinesCli('grant', [d.id, 'writer', 'default'], { env, store })[0], /read \(default\)/);
  assert.deepEqual(store.deviceRoutines(d.id), {});
  assert.match(routinesCli('disable', ['writer'], { env, store })[0], /disabled for writer/);
  assert.deepEqual(store.routinesPolicy(), { bots: { writer: false } });
  assert.throws(() => routinesCli('grant', ['d_zzzzzzzzzz', 'writer', 'read'], { env, store }), /unknown device/);
  assert.throws(() => routinesCli('grant', [d.id, 'writer', 'owner'], { env, store }), /usage/);
  assert.throws(() => routinesCli('enable', ['Bad!'], { env, store }), /invalid bot name/);
  assert.throws(() => routinesCli('nope', [], { env, store }), /usage/);

  // the installed bin: same commands, isolated HOME / config so no real env file is read
  const root = tmp('routines-bin-');
  const binEnv = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'config'), BRIDGE_TOKEN: TOKEN };
  const bin = new URL('../bin/hermes-ui-bridge.mjs', import.meta.url).pathname;
  let r = spawnSync(process.execPath, [bin, 'routines', 'grant', d.id, 'default', 'none', '--state-dir', dir], { env: binEnv, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(createDeviceStore({ dir }).deviceRoutines(d.id), { default: 'none' });
  r = spawnSync(process.execPath, [bin, 'routines', 'status', '--state-dir', dir], { env: binEnv, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /mode control/);
  assert.match(r.stdout, /default=none/);
  r = spawnSync(process.execPath, [bin, 'routines', 'grant', 'd_zzzzzzzzzz', 'default', 'read', '--state-dir', dir], { env: binEnv, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown device/);
  fs.rmSync(dir, { recursive: true });
  fs.rmSync(root, { recursive: true });
});
