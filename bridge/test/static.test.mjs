// BRIDGE_WEB_DIR: static web app served by the bridge (src/static.mjs) - path safety, SPA fallback, encodings.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, utimesSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.mjs';
import { resolveStaticFile, isApiPath, appCsp, cspHeader, SANDBOX_CDN_ORIGINS } from '../src/static.mjs';
import { silentLogger } from '../src/log.mjs';

const base = mkdtempSync(join(tmpdir(), 'hub-web-'));
const web = join(base, 'web');
const outside = join(base, 'secret');
const BIG_JS = `console.log(${JSON.stringify('x'.repeat(4000))});\n`;
let srv;
let port;

before(async () => {
  mkdirSync(join(web, 'assets'), { recursive: true });
  mkdirSync(join(web, '.well-known'), { recursive: true });
  mkdirSync(join(web, 'docs'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(join(web, 'docs', 'index.html'), 'docs index');
  writeFileSync(join(web, 'assets', 'app-0123abcd.js'), BIG_JS);
  writeFileSync(join(web, 'assets', 'app-0123abcd.js.br'), zlib.brotliCompressSync(BIG_JS));
  writeFileSync(join(web, 'assets', 'plain.js'), BIG_JS);
  writeFileSync(join(web, 'assets', 'stale.js'), BIG_JS);
  writeFileSync(join(web, 'assets', 'stale.js.gz'), zlib.gzipSync('STALE'));
  const old = new Date(Date.now() - 3600_000);
  utimesSync(join(web, 'assets', 'stale.js.gz'), old, old); // older than the original -> ignored
  writeFileSync(join(web, '.env'), 'SECRET=1');
  writeFileSync(join(web, '.well-known', 'assetlinks.json'), '[]');
  writeFileSync(join(outside, 'passwd.txt'), 'root:x');
  symlinkSync(join(outside, 'passwd.txt'), join(web, 'leak.txt'));
  symlinkSync(outside, join(web, 'linkdir'));
  ({ server: srv } = createServer({ HERMES_BASE_URL: 'http://127.0.0.1:9', BRIDGE_TOKEN: 'tok-static-test', BRIDGE_WEB_DIR: web }, { logger: silentLogger, backend: null }));
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  port = srv.address().port;
});
after(() => { srv.close(); rmSync(base, { recursive: true, force: true }); });

/** Raw request (keeps the path byte-exact, no client-side normalization). */
function get(path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('index, SPA fallback, directory index, missing asset 404', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  assert.equal(r.headers['cache-control'], 'no-cache');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.match(r.body.toString(), /<title>app/);
  assert.match((await get('/chat/123')).body.toString(), /<title>app/);
  assert.equal((await get('/docs')).body.toString(), 'docs index');
  assert.equal((await get('/assets/missing.js')).status, 404);
  assert.equal((await get('/.well-known/assetlinks.json')).status, 200);
});

test('path safety: traversal, encoded dots, hidden files, symlinks out of the root', async () => {
  for (const p of ['/../secret/passwd.txt', '/assets/../../secret/passwd.txt', '/%2e%2e/secret/passwd.txt', '/%2E%2E%2Fsecret', '/assets%2f..%2f..%2fsecret', '/a\\..\\b', '/%252e%252e/x']) {
    const r = await get(p);
    assert.ok(r.status === 400 || r.status === 404, `${p} -> ${r.status}`);
    assert.doesNotMatch(r.body.toString(), /root:x/);
  }
  assert.equal((await get('/.env')).status, 404);
  assert.equal((await get('/leak.txt')).status, 404);
  assert.equal((await get('/linkdir/passwd.txt')).status, 404);
  const root = realpathSync(web);
  assert.equal(resolveStaticFile(root, '/../secret/passwd.txt'), null);
  assert.equal(resolveStaticFile(root, '/.git/config'), null);
  assert.equal(resolveStaticFile(root, '/linkdir/passwd.txt'), null);
  assert.equal(resolveStaticFile(root, 'relative'), null);
  assert.equal(resolveStaticFile(root, '/x\0y'), null);
  assert.equal(resolveStaticFile(root, '/nope')?.fallback, true);
});

test('precompressed br sibling, on-the-fly gzip, stale sibling ignored, HEAD', async () => {
  const br = await get('/assets/app-0123abcd.js', { headers: { 'accept-encoding': 'gzip, br' } });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(br.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(br.headers.vary, 'Accept-Encoding');
  assert.equal(zlib.brotliDecompressSync(br.body).toString(), BIG_JS);
  const gz = await get('/assets/plain.js', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(zlib.gunzipSync(gz.body).toString(), BIG_JS);
  const stale = await get('/assets/stale.js', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(zlib.gunzipSync(stale.body).toString(), BIG_JS);
  const id = await get('/assets/plain.js', { headers: { 'accept-encoding': 'identity' } });
  assert.equal(id.headers['content-encoding'], undefined);
  assert.equal(id.body.toString(), BIG_JS);
  const head = await get('/assets/plain.js', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers['content-length']), BIG_JS.length);
});

test('API paths stay with the bridge; POST is never static', async () => {
  assert.equal((await get('/v1/models')).status, 401);
  assert.equal((await get('/api/sessions')).status, 401);
  assert.notEqual((await get('/bridge/devices')).headers['content-type'], 'text/html; charset=utf-8');
  const post = await get('/', { method: 'POST' });
  assert.ok([401, 404].includes(post.status), String(post.status)); // bridge auth/404, never the web app
  assert.doesNotMatch(post.body.toString(), /<title>app/);
  for (const p of ['/v1', '/v1/x', '/api/x', '/bridge', '/bridge/pair', '/health', '/health/detailed']) assert.equal(isApiPath(p), true, p);
  for (const p of ['/', '/index.html', '/v1x', '/apis', '/healthy']) assert.equal(isApiPath(p), false, p);
});

test('without BRIDGE_WEB_DIR the bridge does not serve / (auth error as before)', async () => {
  const { server } = createServer({ HERMES_BASE_URL: 'http://127.0.0.1:9', BRIDGE_TOKEN: 'tok' }, { logger: silentLogger, backend: null });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const r = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: server.address().port, path: '/' }, (res) => { res.resume(); resolve(res.statusCode); }));
  server.close();
  assert.equal(r, 401);
});

// Review finding (medium): CSP for the served PWA. The policy was checked in Chromium against a real Expo web export
// (app boot + /gallery with hui-html srcdoc sandboxes: no violations); see docs/BRIDGE.md "Web app CSP".
test('CSP: enforced on HTML (index + SPA fallback), not on assets; report-only / off via BRIDGE_WEB_CSP', async () => {
  for (const p of ['/', '/settings']) {
    const r = await get(p, { headers: { 'x-forwarded-proto': 'https' } });
    const csp = r.headers['content-security-policy'];
    assert.ok(csp, p);
    const d = Object.fromEntries(csp.split(';').map((x) => x.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    assert.deepEqual(d['default-src'], ["'self'"]);
    assert.deepEqual(d['object-src'], ["'none'"]);
    assert.deepEqual(d['frame-ancestors'], ["'none'"]);
    assert.deepEqual(d['base-uri'], ["'self'"]);
    assert.deepEqual(d['form-action'], ["'self'"]);
    // the srcdoc sandbox inherits this policy: it must allow what the sandbox's own CSP allows (app/src/sandbox/shell.ts)
    for (const s of ["'unsafe-inline'", "'unsafe-eval'", ...SANDBOX_CDN_ORIGINS]) assert.ok(d['script-src'].includes(s), s);
    assert.ok(!d['script-src'].some((s) => s.startsWith("'sha256-") || s.startsWith("'nonce-")), 'hashes/nonces would disable unsafe-inline for the sandbox');
    assert.ok(!d['connect-src'].includes('http:') && !d['img-src'].includes('http:'), 'no plain-http exfiltration');
    assert.ok(!csp.includes('*'), 'no wildcard sources');
  }
  const js = await get('/assets/plain.js');
  assert.equal(js.headers['content-security-policy'], undefined);
  assert.equal(cspHeader('report-only').name, 'content-security-policy-report-only');
  assert.equal(cspHeader('off'), null);
  assert.equal(cspHeader(undefined).name, 'content-security-policy');
  assert.equal(cspHeader('').value, appCsp());
});

test('CSP: direct HTTP LAN shell permits http images and connections', async () => {
  const r = await get('/');
  const directives = r.headers['content-security-policy'].split(';');
  for (const name of ['connect-src', 'img-src']) {
    assert.ok(directives.find((d) => d.trim().startsWith(name)).split(/\s+/).includes('http:'), name);
  }
});
