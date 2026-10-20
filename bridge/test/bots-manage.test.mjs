// /bridge/bots*: creating and editing bots through a FAKE hermes-ui-plus plugin, the bots.manage right, the owner's
// switch, the plugin's bot list in /bridge/profiles and /p/<new bot>/, the CLI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import { botsManageCli, checkBody, parseBotsCreate, projectBot, projectFields } from '../src/bots-manage.mjs';
import { createDeviceStore } from '../src/devices.mjs';
import { createProfiles } from '../src/profiles.mjs';

const TOKEN = 'bridge-test-token-000000000000';
const UPSTREAM_KEY = 'upstream_test_key_000000000000';
const PLUGIN_SECRET = 'plugin_test_secret_' + 'x'.repeat(40);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const dir = tmp('hui-bots-manage-');
const secretFile = path.join(dir, 'secret');
fs.writeFileSync(secretFile, PLUGIN_SECRET + '\n', { mode: 0o600 });
const closers = [];
after(() => { for (const c of closers) c(); fs.rmSync(dir, { recursive: true, force: true }); });

const listen = async (handler) => {
  const s = http.createServer(handler);
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  closers.push(() => { s.close(); s.closeAllConnections(); });
  return `http://127.0.0.1:${s.address().port}`;
};

const BODY = { title: 'Scout', job: 'Preise im Blick behalten', how: 'Kurz und sachlich.', template: 'deals', lang: 'de', may: { web: true, memory: true, routines: true, commands: false }, color: '#3f7d6e' };

/** Fake plugin: an in-memory list of bots, POST adds one; `o.create` overrides the create state, `o.fail` the answer. */
async function fakePlugin(o = {}) {
  const bots = [{ name: 'writer', title: 'Quill', description: 'Schreibt kurz', parked: false }, ...(o.extra ?? [])];
  const seen = [];
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const url = await listen(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
    if (req.headers.authorization !== `Bearer ${PLUGIN_SECRET}`) return json(res, 401, {});
    if (o.down) return json(res, 404, { error: { code: 'feature_off', reason: o.down, message: 'free <text>' } });
    if (req.url === '/bots' && req.method === 'GET') {
      return json(res, 200, { object: 'list', profile: 'default', limit: 50, count: bots.length, create: o.create ?? { available: true }, data: [...bots, { name: 'Bad Name!' }, { name: 'default' }] });
    }
    if (req.url === '/bots' && req.method === 'POST') {
      if (o.fail) return json(res, o.fail.status, { error: { message: 'internal /home/someone detail', code: o.fail.code, reason: o.fail.reason } });
      const row = { name: body.title.toLowerCase(), title: body.title, description: body.job, color: body.color, app: true, template: body.template, secret: 'never' };
      bots.push(row);
      return json(res, 201, row);
    }
    const m = /^\/bots\/([^/]+)$/.exec(req.url);
    if (m && req.method === 'GET') {
      const b = bots.find((x) => x.name === m[1]);
      return b ? json(res, 200, { name: b.name, title: b.title, job: b.description, how: 'Kurz.', template: b.template ?? null, lang: 'de', may: { web: true, memory: true, routines: false, commands: false, evil: true }, app: !!b.app })
        : json(res, 404, { error: { code: 'unknown_bot' } });
    }
    if (m && req.method === 'PATCH') {
      const b = bots.find((x) => x.name === m[1]);
      if (!b) return json(res, 404, { error: { code: 'unknown_bot' } });
      Object.assign(b, { title: body.title, description: body.job });
      return json(res, 200, b);
    }
    return json(res, 404, {});
  });
  return { url, seen, bots };
}

async function bridge(env = {}, plugin) {
  const ctx = createServer({
    HERMES_BASE_URL: 'http://127.0.0.1:9/v1', HERMES_API_KEY: UPSTREAM_KEY, BRIDGE_TOKEN: TOKEN, BRIDGE_BOOTSTRAP: 'off',
    BRIDGE_ROUTER: 'off', BRIDGE_PROFILES: 'writer', HERMES_HOME: path.join(dir, 'no-hermes-home'),
    ...(plugin ? { BRIDGE_HERMES_PLUGIN_URL: plugin.url, BRIDGE_HERMES_PLUGIN_SECRET_FILE: secretFile } : {}),
    ...env,
  }, { logger: silentLogger });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  closers.push(() => { ctx.server.close(); ctx.server.closeAllConnections(); });
  const base = `http://127.0.0.1:${ctx.server.address().port}`;
  const call = async (p, { method = 'GET', body, auth = TOKEN } = {}) => {
    const r = await fetch(base + p, { method, headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = undefined; }
    return { status: r.status, data, text, headers: r.headers };
  };
  const pair = (label) => {
    const d = ctx.devices.issue(label);
    return { id: d.id, token: ctx.devices.redeem(d.code).token };
  };
  return { ctx, call, pair };
}

test('pure: env setting, projections, body check', () => {
  assert.equal(parseBotsCreate(undefined), '');
  assert.equal(parseBotsCreate(' ON '), 'on');
  assert.equal(parseBotsCreate('0'), 'off');
  assert.throws(() => parseBotsCreate('maybe'), /BRIDGE_BOTS_CREATE/);
  assert.deepEqual(projectBot({ name: 'scout', title: ' Sc\nout ', description: 'd'.repeat(300), color: '#ABCDEF', app: true, template: 'deals', soul: 'x', pinned: 'yes' }),
    { name: 'scout', title: 'Sc out', description: 'd'.repeat(160), color: '#abcdef', app: true, template: 'deals' });
  assert.equal(projectBot({ name: 'default' }), null);
  assert.equal(projectBot({ name: '../x' }), null);
  assert.deepEqual(projectBot({ name: 'x', template: 'evil', color: 'red' }), { name: 'x' });
  assert.deepEqual(projectFields({ name: 'x', title: '', job: 'j', how: 7, template: 'code', lang: 'fr', may: { web: true, root: true } }),
    { name: 'x', title: 'x', job: 'j', how: '', template: 'code', lang: null, may: { web: true, memory: false, routines: false, commands: false }, app: false });
  const keys = ['title', 'job', 'how', 'template', 'lang', 'may', 'color'];
  assert.equal(checkBody(BODY, keys).ok, true);
  assert.deepEqual(checkBody({ ...BODY, api_key: 'x' }, keys), { ok: false, field: 'api_key', message: 'Unsupported field api_key' });
  assert.equal(checkBody({ ...BODY, how: 5 }, keys).field, 'how');
  assert.equal(checkBody({ ...BODY, template: 'x' }, keys).field, 'template');
  assert.equal(checkBody({ ...BODY, may: { web: 'yes' } }, keys).field, 'may');
  assert.equal(checkBody({ ...BODY, color: 'red' }, keys).field, 'color');
  assert.equal(checkBody([], keys).ok, false);
});

test('rights: off by default, owner switch, admin yes, device only with a grant; env overrides', async () => {
  const plugin = await fakePlugin();
  const { call, pair } = await bridge({ BRIDGE_STATE_DIR: tmp('bots-rights-') }, plugin);
  const phone = pair('Phone');
  let r = await call('/bridge/bots');
  assert.deepEqual([r.status, r.data], [200, { create: { allowed: false, reason: 'owner_off' }, admin: true, limit: 50, count: 1 }]);
  r = await call('/bridge/bots', { method: 'POST', body: BODY });
  assert.deepEqual([r.status, r.data.error.code, r.data.error.reason], [404, 'bots_unavailable', 'owner_off']);
  assert.equal(plugin.seen.filter((s) => s.method === 'POST').length, 0, 'never upstream while off');

  // device tokens cannot switch it on
  r = await call('/bridge/bots/rights', { method: 'PUT', body: { enabled: true }, auth: phone.token });
  assert.deepEqual([r.status, r.data.error.code], [403, 'admin_required']);
  r = await call('/bridge/bots/rights', { method: 'PUT', body: { enabled: true } });
  assert.deepEqual([r.status, r.data.enabled, r.data.setting], [200, true, 'file']);
  assert.deepEqual(r.data.devices.map((d) => [d.id, d.manage]), [[phone.id, false]]);

  r = await call('/bridge/bots');
  assert.deepEqual(r.data.create, { allowed: true });
  r = await call('/bridge/bots', { auth: phone.token });
  assert.deepEqual([r.data.create, r.data.admin, r.data.count], [{ allowed: false, reason: 'device_forbidden' }, false, 1]);
  r = await call('/bridge/bots', { method: 'POST', body: BODY, auth: phone.token });
  assert.deepEqual([r.status, r.data.error.code], [403, 'bots_forbidden']);
  r = await call('/bridge/bots/writer', { auth: phone.token });
  assert.equal(r.status, 403, 'reading the edit form needs the right too');

  r = await call('/bridge/bots/rights', { method: 'PUT', body: { devices: { [phone.id]: true } } });
  assert.deepEqual(r.data.devices.map((d) => [d.id, d.manage]), [[phone.id, true]]);
  r = await call('/bridge/bots', { auth: phone.token });
  assert.deepEqual(r.data.create, { allowed: true });
  r = await call('/bridge/bots/rights', { method: 'PUT', body: { devices: { d_zzzzzzzzzz: true } } });
  assert.deepEqual([r.status, r.data.error.code], [400, 'unknown_device']);
  r = await call('/bridge/bots/rights', { method: 'PUT', body: { enabled: 'yes' } });
  assert.equal(r.status, 400);
  r = await call('/bridge/bots/rights', { method: 'DELETE' });
  assert.equal(r.status, 405);
  r = await call('/bridge/bots/rights', { method: 'PUT', body: { enabled: null } });
  assert.equal(r.data.enabled, false, 'null = back to the default (off)');
  assert.equal((await call('/bridge/bots', { auth: null })).status, 401);

  const forced = await bridge({ BRIDGE_STATE_DIR: tmp('bots-rights-env-'), BRIDGE_BOTS_CREATE: 'off' }, plugin);
  await forced.call('/bridge/bots/rights', { method: 'PUT', body: { enabled: true } });
  assert.deepEqual((await forced.call('/bridge/bots')).data.create, { allowed: false, reason: 'bridge_off' });
  const on = await bridge({ BRIDGE_BOTS_CREATE: 'on' }, plugin);
  assert.deepEqual((await on.call('/bridge/bots')).data.create, { allowed: true }, 'env on without a state dir');
  const noKey = await bridge({ BRIDGE_BOTS_CREATE: 'on', HERMES_API_KEY: '' }, plugin);
  assert.deepEqual((await noKey.call('/bridge/bots')).data.create, { allowed: false, reason: 'no_api_key' });
});

test('plugin state: not configured, unreachable, refuses (not root, multiplex off, limit)', async () => {
  let b = await bridge({ BRIDGE_BOTS_CREATE: 'on' });
  assert.deepEqual((await b.call('/bridge/bots')).data.create, { allowed: false, reason: 'plugin_not_configured' });
  b = await bridge({ BRIDGE_BOTS_CREATE: 'on', BRIDGE_HERMES_PLUGIN_URL: 'http://127.0.0.1:9', BRIDGE_HERMES_PLUGIN_SECRET_FILE: secretFile });
  assert.deepEqual((await b.call('/bridge/bots')).data.create, { allowed: false, reason: 'plugin_unreachable' });
  for (const [create, reason] of [[{ available: false, reason: 'not_root_profile' }, 'not_root_profile'], [{ available: false, reason: 'multiplex_off' }, 'multiplex_off'],
    [{ available: false, reason: 'weird' }, 'plugin_unsupported'], [{ available: false, reason: 'limit' }, 'limit']]) {
    const plugin = await fakePlugin({ create });
    b = await bridge({ BRIDGE_BOTS_CREATE: 'on' }, plugin);
    assert.deepEqual((await b.call('/bridge/bots')).data.create, { allowed: false, reason }, reason);
    const r = await b.call('/bridge/bots', { method: 'POST', body: BODY });
    assert.equal(r.status, reason === 'limit' ? 409 : 404, reason);
  }
  const off = await fakePlugin({ down: 'disabled_by_config' });
  b = await bridge({ BRIDGE_BOTS_CREATE: 'on' }, off);
  assert.deepEqual((await b.call('/bridge/bots')).data.create, { allowed: false, reason: 'disabled_by_config' });
});

test('create: key added by the bridge, answer projected, listed in /bridge/profiles and served under /p/<name>/', async () => {
  const plugin = await fakePlugin();
  const { call } = await bridge({ BRIDGE_BOTS_CREATE: 'on' }, plugin);
  let r = await call('/bridge/profiles');
  assert.deepEqual(r.data.data.map((b) => b.name), ['default', 'writer']);
  r = await call('/p/scout/v1/models');
  assert.deepEqual([r.status, r.data.error.code], [404, 'unknown_profile'], 'not yet a bot');

  r = await call('/bridge/bots', { method: 'POST', body: BODY });
  assert.equal(r.status, 201);
  assert.deepEqual(r.data, { bot: { name: 'scout', label: 'Scout', description: BODY.job, color: '#3f7d6e', template: 'deals' } });
  const post = plugin.seen.find((s) => s.method === 'POST');
  assert.equal(post.auth, `Bearer ${PLUGIN_SECRET}`);
  assert.deepEqual(post.body, { ...BODY, api_key: UPSTREAM_KEY });
  assert.ok(!r.text.includes(UPSTREAM_KEY) && !r.text.includes('never'));

  r = await call('/bridge/profiles');
  const scout = r.data.data.find((b) => b.name === 'scout');
  assert.deepEqual(scout, { name: 'scout', default: false, label: 'Scout', description: BODY.job, color: '#3f7d6e', template: 'deals' });
  r = await call('/p/scout/v1/models');
  assert.notEqual(r.data?.error?.code, 'unknown_profile', 'the new bot is served (upstream down here: 502)');

  r = await call('/bridge/bots', { method: 'POST', body: { ...BODY, api_key: 'mine' } });
  assert.deepEqual([r.status, r.data.error.code, r.data.error.field], [400, 'invalid_field', 'api_key']);
  r = await call('/bridge/bots', { method: 'POST', body: '{nope' });
  assert.deepEqual([r.status, r.data.error.code], [400, 'invalid_json']);
  r = await call('/bridge/bots', { method: 'POST', body: { ...BODY, how: 'x'.repeat(20_000) } });
  assert.equal(r.status, 413);
  r = await call('/bridge/bots', { method: 'DELETE' });
  assert.deepEqual([r.status, r.headers.get('allow')], [405, 'GET, POST']);
});

test('create errors are mapped, never the plugin text', async () => {
  for (const [fail, status, code, more] of [
    [{ status: 409, code: 'exists' }, 409, 'exists', {}],
    [{ status: 409, code: 'limit' }, 409, 'limit', { limit: 50 }],
    [{ status: 400, code: 'invalid_field', reason: 'title' }, 400, 'invalid_field', { field: 'title' }],
    [{ status: 400, code: 'invalid_field', reason: 'secret' }, 400, 'invalid_field', { field: 'body' }],
    [{ status: 500, code: 'create_failed', reason: 'OSError' }, 502, 'create_failed', {}],
    [{ status: 404, code: 'feature_off', reason: 'multiplex_off' }, 404, 'bots_unavailable', { reason: 'multiplex_off' }],
    [{ status: 418, code: 'teapot' }, 502, 'upstream_error', {}],
  ]) {
    const plugin = await fakePlugin({ fail });
    const { call } = await bridge({ BRIDGE_BOTS_CREATE: 'on' }, plugin);
    const r = await call('/bridge/bots', { method: 'POST', body: BODY });
    assert.equal(r.status, status, code);
    assert.equal(r.data.error.code, code);
    for (const [k, v] of Object.entries(more)) assert.equal(r.data.error[k], v, `${code} ${k}`);
    assert.ok(!r.text.includes('/home/someone'));
  }
});

test('edit: GET fields, PATCH three fields; default and unknown refused', async () => {
  const plugin = await fakePlugin();
  const { call } = await bridge({ BRIDGE_BOTS_CREATE: 'on' }, plugin);
  let r = await call('/bridge/bots/writer');
  assert.deepEqual(r.data.bot, { name: 'writer', title: 'Quill', job: 'Schreibt kurz', how: 'Kurz.', template: null, lang: 'de', may: { web: true, memory: true, routines: false, commands: false }, app: false });
  r = await call('/bridge/bots/writer', { method: 'PATCH', body: { title: 'Feder', job: 'Schreibt', how: 'Knapp.' } });
  assert.deepEqual([r.status, r.data.bot.label], [200, 'Feder']);
  assert.equal((await call('/bridge/profiles')).data.data.find((b) => b.name === 'writer').label, 'Feder');
  r = await call('/bridge/bots/writer', { method: 'PATCH', body: { title: 'x', job: 'y', how: 'z', may: {} } });
  assert.deepEqual([r.status, r.data.error.field], [400, 'may']);
  r = await call('/bridge/bots/default', { method: 'PATCH', body: { title: 'x', job: 'y', how: 'z' } });
  assert.deepEqual([r.status, r.data.error.code], [403, 'default_bot']);
  r = await call('/bridge/bots/Nope!');
  assert.equal(r.status, 404);
  r = await call('/bridge/bots/ghost');
  assert.deepEqual([r.status, r.data.error.code], [404, 'unknown_bot']);
  r = await call('/bridge/bots/writer', { method: 'POST', body: {} });
  assert.equal(r.status, 405);
});

test('profiles: plugin bots per mode (auto adds, any lists them, list adds app bots, off ignores); parked never', () => {
  const rows = [{ name: 'scout', title: 'Scout', app: true, template: 'deals' }, { name: 'desk', title: 'Desk' }, { name: 'old', parked: true, app: true }];
  const home = tmp('bots-profiles-');
  fs.mkdirSync(path.join(home, 'profiles', 'writer'), { recursive: true });
  fs.writeFileSync(path.join(home, 'profiles', 'writer', 'config.yaml'), 'model: m\n');
  const auto = createProfiles({ HERMES_HOME: home }, { home });
  auto.setExternal(rows);
  assert.deepEqual(auto.names().sort(), ['desk', 'scout', 'writer']);
  assert.deepEqual(auto.list().find((b) => b.name === 'scout'), { name: 'scout', default: false, label: 'Scout', template: 'deals' });
  const any = createProfiles({ HERMES_HOME: path.join(home, 'missing') });
  assert.equal(any.mode, 'any');
  any.setExternal(rows);
  assert.deepEqual(any.names(), ['scout', 'desk']);
  assert.deepEqual(any.list().map((b) => b.label ?? b.name), ['default', 'Scout', 'Desk']);
  const list = createProfiles({ BRIDGE_PROFILES: 'writer=W', HERMES_HOME: path.join(home, 'missing') });
  list.setExternal(rows);
  assert.deepEqual(list.names(), ['writer', 'scout']);
  assert.equal(list.allowed('desk'), false, 'an explicit list stays the owner choice for profiles not made in the app');
  list.addExternal({ name: 'fresh', app: true });
  assert.equal(list.allowed('fresh'), true);
  const off = createProfiles({ BRIDGE_PROFILES: 'off' });
  off.setExternal(rows);
  assert.deepEqual(off.names(), []);
  // template from the files when the bridge can read them
  fs.writeFileSync(path.join(home, 'profiles', 'writer', 'profile.yaml'), "ui_meta:\n  hermes-ui-plus:\n    template: code\n  hermes-bots:\n    title: Quill\n");
  const fresh = createProfiles({ HERMES_HOME: home }, { home });
  assert.deepEqual(fresh.list().find((b) => b.name === 'writer'), { name: 'writer', default: false, label: 'Quill', model: 'm', template: 'code' });
  fs.rmSync(home, { recursive: true });
});

test('devices.json: bots policy and grants survive other writes; CLI and bin', () => {
  const sdir = tmp('bots-cli-');
  const store = createDeviceStore({ dir: sdir });
  const d = store.issue('Phone');
  const env = {};
  assert.match(botsManageCli('status', [], { env, store })[0], /not set \(off\)/);
  assert.match(botsManageCli('enable', [], { env, store })[0], /enabled/);
  assert.match(botsManageCli('grant', [d.id], { env, store })[0], /may create and edit bots/);
  store.redeem(d.code); // rewrites the file
  store.setRoutines({ bots: { default: true } });
  assert.deepEqual(store.botsPolicy(), { create: true });
  assert.equal(store.deviceBotsManage(d.id), true);
  const doc = JSON.parse(fs.readFileSync(path.join(sdir, 'devices.json'), 'utf8'));
  assert.deepEqual([doc.bots, doc.routines, doc.devices[0].botsManage], [{ create: true }, { bots: { default: true } }, true]);
  const lines = botsManageCli('status', [], { env: { BRIDGE_BOTS_CREATE: 'off' }, store });
  assert.match(lines[0], /off \(BRIDGE_BOTS_CREATE=off\)/);
  assert.ok(lines.some((l) => l.startsWith(d.id)));
  assert.match(botsManageCli('disable', [], { env: { BRIDGE_BOTS_CREATE: 'on' }, store })[0], /still overrides/);
  assert.match(botsManageCli('revoke', [d.id], { env, store })[0], /no longer/);
  assert.equal(store.deviceBotsManage(d.id), false);
  assert.throws(() => botsManageCli('grant', ['d_zzzzzzzzzz'], { env, store }), /unknown device/);
  assert.throws(() => botsManageCli('grant', [], { env, store }), /usage/);
  assert.throws(() => botsManageCli('nope', [], { env, store }), /usage/);

  const root = tmp('bots-bin-');
  const binEnv = { PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: path.join(root, 'config'), BRIDGE_TOKEN: TOKEN };
  const bin = new URL('../bin/hermes-ui-bridge.mjs', import.meta.url).pathname;
  let r = spawnSync(process.execPath, [bin, 'bots', 'enable', '--state-dir', sdir], { env: binEnv, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(createDeviceStore({ dir: sdir }).botsPolicy(), { create: true });
  r = spawnSync(process.execPath, [bin, 'bots', 'status', '--state-dir', sdir], { env: binEnv, encoding: 'utf8', timeout: 30_000 });
  assert.match(r.stdout, /creating bots from the app: on/);
  fs.rmSync(sdir, { recursive: true });
  fs.rmSync(root, { recursive: true });
});
