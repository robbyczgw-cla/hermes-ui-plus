import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, statSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, loadEnvFiles, prepareEnv, ensureToken, preflight, featureSummary, directProviders, directProvidersLine } from '../src/cli.mjs';
import { PAIR_SCHEMES, buildPairUri, loadPairConfig, createPairing, isLocalRequest, generateCode, CODE_TTL_MS, MAX_FAILED_ATTEMPTS, PairingUnavailableError, REDEEM_PATH, REDEEM_PER_ADDRESS, REDEEM_GLOBAL } from '../src/pair.mjs';
import { createServer } from '../src/server.mjs';
import { createDeviceStore } from '../src/devices.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'hub-'));

// ---- CLI args / env ----
test('parseArgs: flags, repeatable env-file, --opt=value', () => {
  const o = parseArgs(['--env-file', 'a.env', '--env-file=b.env', '--pair', '--port', '9000', '--host=0.0.0.0', '--no-check', '--strict']);
  assert.deepEqual(o.envFiles, ['a.env', 'b.env']);
  assert.equal(o.pair, true); assert.equal(o.port, 9000); assert.equal(o.host, '0.0.0.0');
  assert.equal(o.check, false); assert.equal(o.strict, true);
});
test('parseArgs: errors', () => {
  assert.throws(() => parseArgs(['--bogus']), /unknown option/);
  assert.throws(() => parseArgs(['--env-file']), /needs a value/);
  assert.throws(() => parseArgs(['--port', 'abc']), /--port/);
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--version']).version, true);
});
test('env files: real env wins, later file wins, missing file errors', () => {
  const d = tmp();
  writeFileSync(join(d, 'a.env'), 'A=file-a\nB="quoted"\n# c\n');
  writeFileSync(join(d, 'b.env'), 'A=file-b\n');
  const env = loadEnvFiles(['a.env', 'b.env'], { B: 'real' }, d);
  assert.equal(env.A, 'file-b'); assert.equal(env.B, 'real');
  assert.throws(() => loadEnvFiles(['nope.env'], {}, d), /not found/);
  rmSync(d, { recursive: true });
});
test('token state file: generated once, 0600, reused; explicit token wins', () => {
  const d = tmp();
  const a = ensureToken(join(d, 's'));
  assert.equal(a.created, true); assert.ok(a.token.length >= 32);
  assert.equal(statSync(a.file).mode & 0o777, 0o600);
  const b = ensureToken(join(d, 's'));
  assert.equal(b.created, false); assert.equal(b.token, a.token);
  const p = prepareEnv(parseArgs([]), { HERMES_BASE_URL: 'http://h', BRIDGE_STATE_DIR: join(d, 's') }, d);
  assert.equal(p.env.BRIDGE_TOKEN, a.token);
  assert.equal(p.env.BRIDGE_UPLOAD_DIR, join(d, 's', 'uploads'));
  const q = prepareEnv(parseArgs(['--port', '1234']), { BRIDGE_TOKEN: 'mine', BRIDGE_STATE_DIR: join(d, 'x') }, d);
  assert.equal(q.env.BRIDGE_TOKEN, 'mine'); assert.equal(q.tokenInfo, null); assert.equal(q.env.BRIDGE_PORT, '1234');
  assert.equal(JSON.parse(readFileSync(a.file, 'utf8')).token, a.token);
  rmSync(d, { recursive: true });
});

test('preflight: reachable + valid key, bad key, unreachable', async () => {
  const mock = http.createServer((req, res) => {
    if (req.url === '/health') return res.end('{"status":"ok"}');
    if (req.url === '/v1/models') { res.statusCode = req.headers.authorization === 'Bearer good' ? 200 : 401; return res.end('{}'); }
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${mock.address().port}`;
  const cfg = (key) => ({ upstream: { baseUrl: base, apiKey: key } });
  try {
    // + the skill check: this mock has no /v1/skills (404) and HERMES_BASE_URL is loopback, but no Hermes home is given
    assert.deepEqual((await preflight(cfg('good'))).map((r) => r.level), ['ok', 'ok', 'info']);
    const bad = (await preflight(cfg('bad'))).at(-1);
    assert.equal(bad.level, 'error');
    assert.match(bad.message, /more than one API_SERVER_KEY line, the last one counts/);
  } finally { mock.close(); }
  const dead = await preflight({ upstream: { baseUrl: 'http://127.0.0.1:1', apiKey: '' } }, { timeoutMs: 500 });
  assert.equal(dead[0].level, 'warn'); assert.equal(dead[0].fatalWhenStrict, true);
  assert.match(dead[0].message, /hermes gateway status/); // fresh-user 0.1.1: a foreground gateway killed by `gateway restart`
});

test('featureSummary reports optional features', () => {
  const { config } = createServer({ HERMES_BASE_URL: 'http://h', BRIDGE_TOKEN: 't' }, {});
  const f = Object.fromEntries(featureSummary(config, { GROQ_API_KEY: 'x', ANTHROPIC_API_KEY: 'y', BRIDGE_META: 'on', BRIDGE_UPLOAD_DIR: '/nonexistent/u' }));
  assert.match(f.voice, /speech-to-text via groq/); assert.match(f.voice, /text-to-speech off/);
  assert.match(f.meta, /^on/); assert.match(f.uploads, /^on/);
  assert.match(f.images, /^proxy on/); // the image proxy is no provider: on by default, not in "direct providers"
  assert.match(Object.fromEntries(featureSummary(config, { BRIDGE_IMAGE_PROXY: 'off' })).images, /BRIDGE_IMAGE_PROXY=off/);
  assert.match(Object.fromEntries(featureSummary(config, { ANTHROPIC_API_KEY: 'y' })).meta, /^off \(opt-in/); // a key alone: off
});

test('featureSummary / directProviders: pure pass-through by default, direct providers named without secrets', () => {
  const { config } = createServer({ HERMES_BASE_URL: 'http://h', BRIDGE_TOKEN: 't', ROUTER_BACKEND: 'heuristic' }, {});
  const none = Object.fromEntries(featureSummary(config, { BRIDGE_UPLOAD_DIR: '/nonexistent/u' }));
  assert.equal(none.extras, 'direct providers: none (pure Hermes pass-through)');
  assert.deepEqual(directProviders({}, 'heuristic'), {});

  const env = { ANTHROPIC_API_KEY: 'sk-ant-secret-test', BRIDGE_META: 'on', SERPER_API_KEY: 'serper-secret-test', GROQ_API_KEY: 'gsk-secret-test', DEEPGRAM_API_KEY: 'dg-secret-test' };
  const claude = createServer({ HERMES_BASE_URL: 'http://h', BRIDGE_TOKEN: 't', ROUTER_BACKEND: 'claude', ...env }, {}).config;
  const all = Object.fromEntries(featureSummary(claude, env));
  assert.equal(all.extras, 'direct providers: router=claude, meta=claude, images=serper, voice=groq/deepgram (called from the bridge, outside Hermes)');
  for (const [k, secret] of Object.entries(env)) if (k.endsWith('_KEY')) assert.ok(!JSON.stringify(all).includes(secret));

  // BRIDGE_META=off turns titles off even with the key (the router key is unaffected); a key-less BRIDGE_META=on stays off
  assert.deepEqual(directProviders({ ...env, BRIDGE_META: 'off' }, 'anthropic'), { router: 'claude', images: 'serper', voice: 'groq/deepgram' });
  assert.deepEqual(directProviders({ BRIDGE_META: 'on' }, 'heuristic'), {});
  assert.deepEqual(directProviders({ ANTHROPIC_API_KEY: 'k' }, 'heuristic'), {}); // a key in the shell alone enables nothing
  assert.deepEqual(directProviders({ ANTHROPIC_API_KEY: 'k', BRIDGE_META: 'on' }, 'heuristic'), { meta: 'claude' });
  assert.match(featureSummary(claude, { ...env, BRIDGE_META: 'off' }).find(([k]) => k === 'meta')[1], /^off \(opt-in/);
  assert.equal(directProvidersLine({ router: 'jev>claude' }), 'direct providers: router=jev>claude (called from the bridge, outside Hermes)');
  assert.deepEqual(directProviders({ BRIDGE_IMAGE_PROVIDERS: 'brave,serper', BRAVE_API_KEY: 'b', SERPER_API_KEY: 's', OPENAI_API_KEY: 'o', BRIDGE_STT_PROVIDER: 'openai' }, 'off'), { images: 'brave>serper', voice: 'openai' });
});

test('missing bootstrap message: loud startup warning and a feature line; off on purpose stays quiet', () => {
  const lines = [];
  const logger = { debug() {}, info() {}, error() {}, warn: (msg, f) => lines.push({ msg, ...f }), enabled: () => true };
  const missing = join(tmp(), 'nope', 'bootstrap-system-message.txt');
  const { config } = createServer({ HERMES_BASE_URL: 'http://h', BRIDGE_TOKEN: 't' }, { logger, defaultBootstrapFile: missing });
  assert.equal(config.bootstrap, null);
  assert.equal(config.bootstrapMissing, missing);
  assert.equal(lines.length, 1);
  assert.match(lines[0].msg, /bootstrap system message not found/);
  assert.equal(lines[0].file, missing);
  assert.match(Object.fromEntries(featureSummary(config, {})).skill, /MISSING/);

  lines.length = 0;
  const off = createServer({ HERMES_BASE_URL: 'http://h', BRIDGE_TOKEN: 't', BRIDGE_BOOTSTRAP: 'off' }, { logger, defaultBootstrapFile: missing }).config;
  assert.deepEqual([off.bootstrap, off.bootstrapMissing, lines.length], [null, '', 0]);
  assert.match(Object.fromEntries(featureSummary(off, {})).skill, /off \(BRIDGE_BOOTSTRAP=off\)/);

  const file = join(tmp(), 'bootstrap-system-message.txt');
  writeFileSync(file, 'UI bootstrap\n');
  const on = createServer({ HERMES_BASE_URL: 'http://h', BRIDGE_TOKEN: 't' }, { logger, defaultBootstrapFile: file }).config;
  assert.deepEqual([on.bootstrap, on.bootstrapMissing, lines.length], ['UI bootstrap', '', 0]);
});

test('Docker image ships the bundled skill (bootstrap message) and the build context does not exclude it', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /^COPY skill \.\/skill$/m);
  assert.match(dockerfile, /skill\/bootstrap-system-message\.txt/); // build-time check with a clear message
  const ignore = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(!ignore.some((l) => /^\/?skill\b/.test(l)), '.dockerignore must not exclude skill/');
});

test('npm package ships the license: files lists LICENSE and prepack copies it from the repository root', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.files.includes('LICENSE'));
  assert.match(pkg.scripts.prepack, /bundle-skill/);
  const bundle = readFileSync(new URL('../scripts/bundle-skill.mjs', import.meta.url), 'utf8');
  assert.match(bundle, /copyFileSync\(license, join\(bridge, 'LICENSE'\)\)/);
  assert.ok(readFileSync(new URL('../../LICENSE', import.meta.url), 'utf8').includes('MIT'));
});

// ---- pairing ----
test('pair URI format: one-time code `c=`; `t=` only for the explicit legacy admin-token mode', () => {
  assert.equal(buildPairUri({ url: 'https://bridge.example.net', code: 'Ab_9-x', name: 'My Hermes' }), 'hermesuiplus://pair?u=https%3A%2F%2Fbridge.example.net&c=Ab_9-x&n=My%20Hermes');
  assert.equal(buildPairUri({ url: 'https://b', code: 'c1', token: 'never-both' }), 'hermesuiplus://pair?u=https%3A%2F%2Fb&c=c1');
  const uri = buildPairUri({ url: 'https://bridge.example.net', token: 'a+b/c=', name: 'My Hermes' });
  assert.equal(uri, 'hermesuiplus://pair?u=https%3A%2F%2Fbridge.example.net&t=a%2Bb%2Fc%3D&n=My%20Hermes');
  const u = new URL(uri);
  assert.equal(u.protocol, 'hermesuiplus:'); assert.equal(u.searchParams.get('t'), 'a+b/c='); assert.equal(u.searchParams.get('n'), 'My Hermes');
  assert.equal(buildPairUri({ url: 'http://x', token: '', name: '' }), 'hermesuiplus://pair?u=http%3A%2F%2Fx');
});
test('pair config validation', () => {
  assert.equal(loadPairConfig({ BRIDGE_PUBLIC_URL: 'https://b.example.net/' }).publicUrl, 'https://b.example.net');
  assert.throws(() => loadPairConfig({ BRIDGE_PUBLIC_URL: 'ftp://x' }), /BRIDGE_PUBLIC_URL/);
  assert.throws(() => loadPairConfig({ BRIDGE_PUBLIC_URL: 'nonsense' }), /BRIDGE_PUBLIC_URL/);
  assert.equal(loadPairConfig({}).enabled, false);
  assert.equal(loadPairConfig({ BRIDGE_PAIRING: '1' }).enabled, true);
});
test('generateCode format', () => assert.match(generateCode(), /^[A-Z2-9]{4}-[A-Z2-9]{4}$/));

const LOOP = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const fakeReq = (url, { remote = '10.0.0.5', headers = {} } = {}) => ({ method: 'GET', url, headers: { host: LOOP.has(remote) ? '127.0.0.1:8790' : 'b.example.net', ...headers }, socket: { remoteAddress: remote } });
const fakeRes = () => {
  const r = { status: 0, headers: {}, body: Buffer.alloc(0), headersSent: false };
  r.writeHead = (s, h) => { r.status = s; r.headers = h; };
  r.end = (b) => { r.body = Buffer.from(b ?? ''); r.done = true; };
  return r;
};
const call = async (p, req) => { const res = fakeRes(); await p.handle(req, res); return res; };
const bc = { host: '127.0.0.1', port: 8790, token: 'sekret-token-1234567' };
const store = () => createDeviceStore({ dir: tmp() });

test('isLocalRequest: loopback only without proxy headers', () => {
  assert.equal(isLocalRequest(fakeReq('/', { remote: '127.0.0.1' })), true);
  assert.equal(isLocalRequest(fakeReq('/', { remote: '::1' })), true);
  assert.equal(isLocalRequest(fakeReq('/', { remote: '127.0.0.1', headers: { 'x-forwarded-for': '1.2.3.4' } })), false);
  assert.equal(isLocalRequest(fakeReq('/', { remote: '127.0.0.1', headers: { 'tailscale-user-login': 'x' } })), false);
  assert.equal(isLocalRequest(fakeReq('/', { remote: '192.168.1.2' })), false);
});
// H3: a plain reverse proxy (nginx proxy_pass, socat, ssh -L) adds no forwarding headers, and a DNS-rebinding page
// reaches loopback with its own name in Host. Neither may count as "local".
test('isLocalRequest: Host must be loopback; cross-site fetches and more proxy headers are refused', () => {
  const loop = (headers) => isLocalRequest(fakeReq('/', { remote: '127.0.0.1', headers }));
  assert.equal(loop({ host: 'localhost:8790' }), true);
  assert.equal(loop({ host: '[::1]:8790' }), true);
  assert.equal(loop({ host: 'rebind.attacker.example:8790' }), false);
  assert.equal(loop({ host: 'bridge.example.net' }), false); // nginx proxy_pass keeps the public Host
  assert.equal(loop({ host: '127.0.0.1.attacker.example' }), false);
  assert.equal(loop({ host: '' }), false);
  assert.equal(loop({ host: 'localhost', 'sec-fetch-site': 'cross-site' }), false);
  assert.equal(loop({ host: 'localhost', 'sec-fetch-site': 'none' }), true);
  for (const h of ['x-forwarded-proto', 'x-real-ip', 'forwarded', 'via', 'cf-connecting-ip']) assert.equal(loop({ host: 'localhost', [h]: '1' }), false, h);
});
test('pairing: DNS-rebinding Host is refused before anything else (421), even with a valid code', async () => {
  const p = createPairing(bc, { env: { BRIDGE_PAIRING: '1', BRIDGE_PUBLIC_URL: 'https://b.example.net' }, code: 'ABCD-EFG2' });
  const r = await call(p, fakeReq('/bridge/pair', { remote: '127.0.0.1', headers: { host: 'rebind.attacker.example:8790' } }));
  assert.equal(r.status, 421); assert.ok(!r.body.toString().includes(bc.token));
  const c = await call(p, fakeReq('/bridge/pair?code=ABCD-EFG2', { headers: { host: 'evil.example' } }));
  assert.equal(c.status, 421);
  // BRIDGE_ALLOWED_HOSTS extends the list
  const p2 = createPairing(bc, { env: { BRIDGE_PAIRING: '1', BRIDGE_PUBLIC_URL: 'https://b.example.net', BRIDGE_ALLOWED_HOSTS: 'hermes-host.lan:8790' }, code: 'ABCD-EFG2', devices: store() });
  assert.equal((await call(p2, fakeReq('/bridge/pair?code=ABCD-EFG2', { headers: { host: 'hermes-host.lan:8790' } }))).status, 200);
});
test('pairing: a plain reverse proxy on the same host (no forwarding headers) needs the code', async () => {
  const p = createPairing(bc, { env: { BRIDGE_PUBLIC_URL: 'https://b.example.net' } });
  const r = await call(p, fakeReq('/bridge/pair', { remote: '127.0.0.1', headers: { host: 'b.example.net' } }));
  assert.equal(r.status, 404); assert.ok(!r.body.toString().includes(bc.token));
});
test('pairing: remote is 404 unless BRIDGE_PAIRING=1; never leaks the token', async () => {
  const p = createPairing(bc, { env: { BRIDGE_PUBLIC_URL: 'https://b.example.net' } });
  const r = await call(p, fakeReq('/bridge/pair'));
  assert.equal(r.status, 404); assert.ok(!r.body.toString().includes(bc.token));
});
test('pairing: localhost gets QR page, svg and png with a one-time code (never a token)', async () => {
  const p = createPairing(bc, { env: { BRIDGE_PUBLIC_URL: 'https://b.example.net', BRIDGE_NAME: 'Home' }, devices: store() });
  const html = await call(p, fakeReq('/bridge/pair', { remote: '127.0.0.1' }));
  assert.equal(html.status, 200); assert.match(html.headers['content-type'], /text\/html/);
  assert.equal(html.headers['cache-control'], 'no-store');
  assert.match(html.body.toString(), /<svg/);
  assert.match(html.body.toString(), /works once/);
  assert.match(html.body.toString(), /Reload the page for another device/); // on the bridge machine a reload does issue a new code
  assert.ok(!html.body.toString().includes(bc.token));
  assert.match(p.payload(), /^hermesuiplus:\/\/pair\?u=https%3A%2F%2Fb\.example\.net&c=[A-Za-z0-9_-]{43}&n=Home$/);
  const svg = await call(p, fakeReq('/bridge/pair.svg', { remote: '127.0.0.1' }));
  assert.match(svg.headers['content-type'], /image\/svg/);
  const png = await call(p, fakeReq('/bridge/pair.png', { remote: '::1' }));
  assert.equal(png.body.subarray(1, 4).toString(), 'PNG');
});
test('pairing: code is one-time, case/dash tolerant, wrong code 403', async () => {
  const p = createPairing(bc, { env: { BRIDGE_PAIRING: '1', BRIDGE_PUBLIC_URL: 'https://b.example.net' }, code: 'ABCD-EFG2', devices: store() });
  assert.equal((await call(p, fakeReq('/bridge/pair'))).status, 401);
  assert.equal((await call(p, fakeReq('/bridge/pair?code=NOPE-NOPE'))).status, 403);
  const ok = await call(p, fakeReq('/bridge/pair?code=abcdefg2', { remote: '127.0.0.1', headers: { 'x-forwarded-for': '1.1.1.1' } }));
  assert.equal(ok.status, 200); assert.match(ok.body.toString(), /<svg/);
  // fresh-user 0.1.1 (#10): one consistent sentence, no "reload the page" next to "the code is used up"
  const text = ok.body.toString();
  assert.match(text, /This page's code is used up\. For another device run <code>devices add "Phone"<\/code>/);
  assert.doesNotMatch(text, /Reload the page/);
  assert.match(text, /works once and expires in 1 hour/);
  assert.equal((await call(p, fakeReq('/bridge/pair?code=ABCD-EFG2'))).status, 403); // used up
});
test('pairing: code expires after 10 minutes', async () => {
  let t = 1_000_000;
  const p = createPairing(bc, { env: { BRIDGE_PAIRING: '1' }, code: 'ABCD-EFG2', now: () => t, devices: store() });
  t += CODE_TTL_MS + 1;
  const r = await call(p, fakeReq('/bridge/pair?code=ABCD-EFG2'));
  assert.equal(r.status, 403); assert.ok(!r.body.toString().includes(bc.token));
  const p2 = createPairing(bc, { env: { BRIDGE_PAIRING: '1' }, code: 'ABCD-EFG2', now: () => t, devices: store() });
  t += CODE_TTL_MS - 1000;
  assert.equal((await call(p2, fakeReq('/bridge/pair?code=ABCD-EFG2'))).status, 200);
});
test('pairing: rate limit locks after repeated wrong codes, even for the right one; window resets', async () => {
  let t = 5_000_000;
  const p = createPairing(bc, { env: { BRIDGE_PAIRING: '1' }, code: 'ABCD-EFG2', now: () => t, devices: store() });
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) assert.equal((await call(p, fakeReq('/bridge/pair?code=XXXX-XXXX'))).status, 403);
  const locked = await call(p, fakeReq('/bridge/pair?code=ABCD-EFG2'));
  assert.equal(locked.status, 429); assert.ok(!locked.body.toString().includes(bc.token));
});

test('integration: createServer serves /bridge/pair on loopback', async () => {
  const { server } = createServer({ HERMES_BASE_URL: 'http://127.0.0.1:1', BRIDGE_TOKEN: 'test-token-integration', BRIDGE_PUBLIC_URL: 'https://b.example.net', BRIDGE_STATE_DIR: tmp() }, {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ok = await fetch(`${base}/bridge/pair.svg`);
    assert.equal(ok.status, 200);
    const viaProxy = await fetch(`${base}/bridge/pair`, { headers: { 'x-forwarded-for': '8.8.8.8' } });
    assert.equal(viaProxy.status, 404);
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

// Review finding (high): without a device store pairing used to embed BRIDGE_TOKEN (a permanent admin credential).
test('fail closed: no device store → pair page 503, issue() throws, no token anywhere; BRIDGE_PAIR_ADMIN_TOKEN=1 restores t=', async () => {
  const { server } = createServer({ HERMES_BASE_URL: 'http://127.0.0.1:1', BRIDGE_TOKEN: 'test-token-integration', BRIDGE_PUBLIC_URL: 'https://b.example.net' }, {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const p of ['/bridge/pair', '/bridge/pair.svg', '/bridge/pair.png']) {
      const r = await fetch(base + p);
      const body = await r.text();
      assert.equal(r.status, 503, p);
      assert.match(body, /BRIDGE_STATE_DIR/);
      assert.ok(!body.includes('test-token-integration'));
    }
  } finally {
    server.close();
    server.closeAllConnections();
  }
  const p = createPairing(bc, { env: { BRIDGE_PUBLIC_URL: 'https://b.example.net', BRIDGE_PAIRING: '1' } });
  assert.throws(() => p.issue('x'), (e) => e instanceof PairingUnavailableError && !e.message.includes(bc.token));
  assert.throws(() => p.payload('x'), PairingUnavailableError);
  const remote = createPairing(bc, { env: { BRIDGE_PAIRING: '1' }, code: 'ABCD-EFG2' });
  const code = await call(remote, fakeReq('/bridge/pair?code=ABCD-EFG2'));
  assert.equal(code.status, 503); assert.ok(!code.body.toString().includes(bc.token));
  assert.equal((await call(remote, fakeReq('/bridge/pair?code=ABCD-EFG2'))).status, 503, 'page code not spent on a refusal');
  // explicit, documented-unsafe opt-in: the old behaviour
  const legacy = createPairing(bc, { env: { BRIDGE_PUBLIC_URL: 'https://b.example.net', BRIDGE_PAIR_ADMIN_TOKEN: '1' } });
  assert.equal(legacy.payload(), `hermesuiplus://pair?u=https%3A%2F%2Fb.example.net&t=${bc.token}&n=Hermes`);
  // no auth at all: nothing secret to hand out, link without credential
  assert.equal(createPairing({ ...bc, token: '' }, { env: {} }).payload(), 'hermesuiplus://pair?u=http%3A%2F%2F127.0.0.1%3A8790&n=Hermes');
});

test('BRIDGE_PAIR_SCHEME: hermesuiplus by default, hermesui (personal) / hermesiui (pre-rename apps) on request, nothing else', () => {
  const id = JSON.parse(readFileSync(new URL('../../app/brand/identity.json', import.meta.url), 'utf8'));
  assert.deepEqual(PAIR_SCHEMES, [id.scheme, ...id.legacySchemes]);
  assert.equal(loadPairConfig({}).scheme, 'hermesuiplus');
  assert.equal(loadPairConfig({ BRIDGE_PAIR_SCHEME: 'hermesiui' }).scheme, 'hermesiui');
  assert.equal(loadPairConfig({ BRIDGE_PAIR_SCHEME: 'hermesui' }).scheme, 'hermesui');
  assert.throws(() => loadPairConfig({ BRIDGE_PAIR_SCHEME: 'javascript' }), /BRIDGE_PAIR_SCHEME/);
  assert.equal(buildPairUri({ url: 'http://x', scheme: 'hermesui' }), 'hermesui://pair?u=http%3A%2F%2Fx');
});

test('redeem: global rate limit across addresses (behind a proxy everybody shares one address anyway)', async () => {
  let t = 1_000;
  const p = createPairing(bc, { env: {}, devices: store(), now: () => t });
  const post = (remote, code) => {
    const body = Buffer.from(JSON.stringify({ code }));
    const req = { method: 'POST', url: REDEEM_PATH, headers: { 'content-length': String(body.length) }, socket: { remoteAddress: remote }, resume() {}, async *[Symbol.asyncIterator]() { yield body; } };
    return call(p, req);
  };
  assert.equal(p.matches({ method: 'POST', url: REDEEM_PATH }), true);
  assert.equal(p.matches({ method: 'GET', url: REDEEM_PATH }), false);
  let n = 0;
  for (let a = 0; a < 6; a++) for (let i = 0; i < REDEEM_PER_ADDRESS; i++, n++) assert.equal((await post(`192.0.2.${a}`, 'x'.repeat(43))).status, 410);
  assert.equal(n, REDEEM_GLOBAL);
  assert.equal((await post('198.51.100.7', 'x'.repeat(43))).status, 429, 'fresh address, global budget used up');
  t += 60_001;
  assert.equal((await post('198.51.100.7', 'x'.repeat(43))).status, 410);
});

test('Docker: compose example offers the web bundle (BRIDGE_WEB_DIR + ./web volume), says there is no prebuilt image; ENTRYPOINT keeps --env-file for the bridge', async () => {
  const compose = readFileSync(new URL('../docker-compose.example.yml', import.meta.url), 'utf8');
  assert.match(compose, /^\s+# BRIDGE_WEB_DIR: \/web$/m);
  assert.match(compose, /^\s+# - \.\/web:\/web:ro/m);
  assert.match(compose, /--strip-components=1/);
  assert.match(compose, /no prebuilt image/);
  assert.match(compose, /\/bridge\/pair\?code=/);
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /^ENTRYPOINT \["node", "--", "bin\/hermes-ui-bridge\.mjs"\]$/m);
  // what `--` buys: the bridge, not Node.js, reports a missing env file
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['--', new URL('../bin/hermes-ui-bridge.mjs', import.meta.url).pathname, '--env-file', '/nonexistent-test-dir/env'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /error: env file not found: \/nonexistent-test-dir\/env\. Create it first/);
  // the wizard's compose snippet mounts a host web dir instead of passing the host path into the container
  const { composeSnippet } = await import('../src/setup/service.mjs');
  const c = composeSnippet({ envFile: '/e', webDir: '/srv/web' });
  assert.match(c, /BRIDGE_WEB_DIR: \/web/);
  assert.match(c, /- "\/srv\/web:\/web:ro"/);
  assert.doesNotMatch(composeSnippet({ envFile: '/e' }), /\/web/);
});
