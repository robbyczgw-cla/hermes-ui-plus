// Fresh-user test of 0.1.1, scenario C (Docker): the hermes-ui skill never reached Hermes and every app answer was
// plain text with a "Skill 'hermes-ui' not found" tool error. The bridge now says so at startup (src/cli.mjs
// preflight), and the Docker healthcheck uses an unauthenticated liveness path (GET /bridge/live).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preflight, listedSkill, skillOnDisk, recheckUntilReachable, UI_SKILL } from '../src/cli.mjs';
import { createServer, LIVE_PATH } from '../src/server.mjs';

/** fake fetch: /health ok, /v1/models ok, /v1/skills as given ({status, body}) */
const hermes = (skills) => async (url) => {
  const p = new URL(url).pathname;
  if (p === '/health') return new Response('{"status":"ok"}');
  if (p === '/v1/models') return new Response('{"data":[]}');
  if (p === '/v1/skills') return new Response(JSON.stringify(skills.body ?? {}), { status: skills.status ?? 200 });
  return new Response('', { status: 404 });
};
const cfg = (baseUrl = 'http://127.0.0.1:8642') => ({ upstream: { baseUrl, apiKey: 'test-key-000' } });
const skillLine = async (skills, o = {}) => (await preflight(cfg(o.base), { fetch: hermes(skills), hermesHome: o.home ?? '', hermesHomeExplicit: o.explicit ?? false })).at(-1);

test('listedSkill: enabled, disabled, missing, unknown shape', () => {
  assert.equal(listedSkill({ object: 'list', data: [{ name: 'pdf' }, { name: UI_SKILL, category: 'ui' }] }), 'enabled');
  assert.equal(listedSkill([UI_SKILL]), 'enabled');
  assert.equal(listedSkill({ skills: [{ name: UI_SKILL, enabled: false }] }), 'disabled');
  assert.equal(listedSkill({ data: [{ name: 'pdf' }] }), 'missing');
  assert.equal(listedSkill({ data: [] }), 'missing');
  assert.equal(listedSkill({ error: 'x' }), null);
  assert.equal(listedSkill(null), null);
});

test('preflight: GET /v1/skills decides when Hermes can list its skills', async () => {
  const ok = await skillLine({ body: { data: [{ name: UI_SKILL }] } });
  assert.equal(ok.level, 'ok'); assert.match(ok.message, /hermes-ui skill installed in Hermes/);
  const missing = await skillLine({ body: { data: [{ name: 'pdf' }] } });
  assert.equal(missing.level, 'warn');
  assert.match(missing.message, /NOT installed in Hermes: app answers stay plain text/);
  assert.match(missing.message, /docker cp/); assert.match(missing.message, /No Hermes restart needed/);
  const disabled = await skillLine({ body: { data: [{ name: UI_SKILL, enabled: false }] } });
  assert.equal(disabled.level, 'warn'); assert.match(disabled.message, /disabled/);
});

test('preflight: Hermes cannot list skills (HTTP 500 bug) -> look on disk, but only for a Hermes on this machine', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hui-skill-'));
  try {
    const home = join(root, '.hermes');
    mkdirSync(join(home, 'skills', 'pdf'), { recursive: true });
    const broken = { status: 500, body: { error: { message: 'Failed to enumerate skills' } } };
    const without = await skillLine(broken, { home });
    assert.equal(without.level, 'warn'); assert.match(without.message, /NOT installed/);
    // one category level deeper counts too (skills/<category>/hermes-ui)
    mkdirSync(join(home, 'skills', 'ui', UI_SKILL), { recursive: true });
    writeFileSync(join(home, 'skills', 'ui', UI_SKILL, 'SKILL.md'), '# test skill\n');
    const found = await skillLine(broken, { home });
    assert.equal(found.level, 'ok'); assert.match(found.message, /found in .*skills \(GET \/v1\/skills: HTTP 500\)/);
    // a remote Hermes (Docker network name, another host): a local folder says nothing about it
    const remote = await skillLine(broken, { home, base: 'http://hermes:8642' });
    assert.equal(remote.level, 'info'); assert.match(remote.message, /could not check .*HTTP 500.*hermes skills list.*HERMES_HOME/);
    // ... unless HERMES_HOME was set on purpose (Hermes' data folder mounted read-only into the bridge container)
    assert.equal((await skillLine(broken, { home, base: 'http://hermes:8642', explicit: true })).level, 'ok');
    rmSync(join(home, 'skills', 'ui'), { recursive: true });
    assert.match((await skillLine(broken, { home, base: 'http://hermes:8642', explicit: true })).message, /NOT installed/);
    // no Hermes home here at all (the bridge's own container)
    assert.equal((await skillLine(broken, { home: join(root, 'nope') })).level, 'info');
    assert.equal((await skillLine({ status: 404 })).level, 'info');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('preflight: no skill check when the key is rejected or Hermes is down', async () => {
  const rejected = async (url) => (new URL(url).pathname === '/health' ? new Response('{}') : new Response('', { status: 401 }));
  const r = await preflight(cfg(), { fetch: rejected });
  assert.deepEqual(r.map((x) => x.level), ['ok', 'error']);
});

test('skillOnDisk: null without a skills folder, false / true by content', () => {
  const root = mkdtempSync(join(tmpdir(), 'hui-skill-'));
  try {
    assert.equal(skillOnDisk(''), null);
    assert.equal(skillOnDisk(root), null);
    mkdirSync(join(root, 'skills', UI_SKILL), { recursive: true });
    assert.equal(skillOnDisk(root), false, 'a folder without SKILL.md is no skill');
    writeFileSync(join(root, 'skills', UI_SKILL, 'SKILL.md'), '# test\n');
    assert.equal(skillOnDisk(root), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bin: the startup log warns when Hermes lacks the skill', async () => {
  const mock = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') return res.end('{"status":"ok"}');
    if (req.url === '/v1/models') return res.end('{"data":[]}');
    if (req.url === '/v1/skills') return res.end('{"object":"list","data":[{"name":"pdf"}]}');
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'hui-skill-bin-'));
  const child = spawn(process.execPath, [new URL('../bin/hermes-ui-bridge.mjs', import.meta.url).pathname, '--port', '0', '--state-dir', dir], {
    env: { PATH: process.env.PATH, HOME: dir, HERMES_BASE_URL: `http://127.0.0.1:${mock.address().port}`, HERMES_API_KEY: 'test-key-000' },
  });
  try {
    let out = '';
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no "listening" line:\n${out}`)), 20_000);
      child.stdout.on('data', (d) => { out += d; if (/listening on/.test(out)) { clearTimeout(t); resolve(); } });
      child.once('exit', (c) => { clearTimeout(t); reject(new Error(`exited ${c}:\n${out}`)); });
    });
    assert.match(out, /\[!!\] hermes-ui skill is NOT installed in Hermes/);
    assert.match(out, /\[ok\] API key accepted/);
  } finally {
    child.kill('SIGKILL');
    mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /bridge/live: 200 without a token, never touches Hermes; other bridge paths still need the token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hui-live-'));
  const ctx = createServer({ HERMES_BASE_URL: 'http://127.0.0.1:1', BRIDGE_TOKEN: 'test-token-0000000000', BRIDGE_STATE_DIR: dir, BRIDGE_LOG_LEVEL: 'silent' });
  await new Promise((r) => ctx.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${ctx.server.address().port}`;
  try {
    const r = await fetch(base + LIVE_PATH);
    assert.equal(r.status, 200); assert.equal(await r.text(), 'ok\n');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const h = await fetch(base + LIVE_PATH, { method: 'HEAD' });
    assert.equal(h.status, 200);
    assert.notEqual((await fetch(base + LIVE_PATH, { method: 'POST' })).status, 200);
    assert.equal((await fetch(base + '/bridge/status')).status, 401);
  } finally {
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// fresh-user re-run of scenario C (2026-10-17): compose starts Hermes and the bridge together; Hermes' gateway needs a
// few seconds, so the startup check saw "not reachable" and the skill check never ran
test('recheckUntilReachable: reports key and skill checks once Hermes answers, gives up after maxMs', async () => {
  let t = 0;
  const timers = [];
  const setTimer = (fn, ms) => { const h = { fn, at: t + ms, unref() {} }; timers.push(h); return h; };
  const clearTimer = (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); };
  const run = async () => { const h = timers.shift(); t = h.at; await h.fn(); };
  const down = [{ level: 'warn', fatalWhenStrict: true, message: 'Hermes not reachable' }];
  const up = [{ level: 'ok', message: 'Hermes reachable' }, { level: 'ok', message: 'API key accepted' }, { level: 'warn', message: 'hermes-ui skill is NOT installed' }];
  let calls = 0;
  const reports = [];
  recheckUntilReachable(async () => (++calls < 3 ? down : up), (lines, ms) => reports.push([lines, ms]), { intervalMs: 5000, maxMs: 60_000, now: () => t, setTimer, clearTimer });
  await run(); await run();
  assert.equal(reports.length, 0);
  await run();
  assert.deepEqual(reports, [[up, 15_000]]);
  assert.equal(timers.length, 0, 'no more checks');
  // never reachable: one final line, then quiet
  const gaveUp = [];
  recheckUntilReachable(async () => down, (lines) => gaveUp.push(lines), { intervalMs: 5000, maxMs: 12_000, now: () => t, setTimer, clearTimer });
  while (timers.length) await run();
  assert.equal(gaveUp.length, 1);
  assert.match(gaveUp[0][0].message, /still not reachable after \d+ s/);
  // stop() cancels
  const stop = recheckUntilReachable(async () => up, () => assert.fail('stopped'), { now: () => t, setTimer, clearTimer });
  stop();
  assert.equal(timers.length, 0);
});

test('bin: Hermes not up at start -> the checks follow in the log once it answers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hui-recheck-'));
  // reserve a port, start the bridge against it while nothing listens there, then start the fake Hermes
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const child = spawn(process.execPath, [new URL('../bin/hermes-ui-bridge.mjs', import.meta.url).pathname, '--port', '0', '--state-dir', dir], {
    env: { PATH: process.env.PATH, HOME: dir, HERMES_BASE_URL: `http://127.0.0.1:${port}`, HERMES_API_KEY: 'test-key-000', HUI_TEST_RECHECK_MS: '200' },
  });
  let mock;
  try {
    let out = '';
    const waitFor = (re, ms) => new Promise((resolve, reject) => {
      if (re.test(out)) return resolve();
      const t = setTimeout(() => reject(new Error(`no ${re}:\n${out}`)), ms);
      const on = (d) => { out += d; if (re.test(out)) { clearTimeout(t); child.stdout.off('data', on); resolve(); } };
      child.stdout.on('data', on);
    });
    await waitFor(/listening on/, 20_000);
    assert.match(out, /\[!!\] Hermes not reachable/);
    mock = http.createServer((req, res) => {
      if (req.url === '/health') return res.end('{"status":"ok"}');
      if (req.url === '/v1/models') return res.end('{"data":[]}');
      if (req.url === '/v1/skills') return res.end('{"data":[{"name":"hermes-ui"}]}');
      res.statusCode = 404; res.end();
    });
    await new Promise((r) => mock.listen(port, '127.0.0.1', r));
    await waitFor(/hermes-ui skill installed in Hermes/, 20_000);
    assert.match(out, /startup checks, \d+ s after start:\n {2}\[ok\] Hermes reachable/);
  } finally {
    child.kill('SIGKILL');
    mock?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
