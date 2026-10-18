// GET /bridge/img?u=: SSRF refusals (scheme, port, credentials, local names, private / CGNAT / ULA / mapped
// addresses, also after DNS and after redirects), type checks (content-type + magic bytes, no svg), size and time
// limits, header hygiene, disk cache (LRU, TTL), per-credential rate limit, metadata-only logs, routing and auth.
// The upstream is a local server reached through the transport test seam; the address policy is the real one
// except where a test explicitly lets 127.0.0.1 through to reach that local server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import https from 'node:https';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from '../src/server.mjs';
import { createLogger, silentLogger } from '../src/log.mjs';
import { createImageProxy, isPublicAddress, loadImageProxyConfig, parseTarget, sniffImageType, IMAGE_PROXY_DEFAULTS } from '../src/image-proxy.mjs';

const TOKEN = 'bridge-test-token';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(30)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(30)]);
const AVIF = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypmif1'), Buffer.alloc(4), Buffer.from('mif1avifmiaf'), Buffer.alloc(20)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
// ICONDIR (reserved 0, type 1, 1 image) + one ICONDIRENTRY (16x16, reserved 0, …)
const ICO = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]), Buffer.alloc(30, 3)]);

/* ───────────── fake upstream ───────────── */

let up, upPort, tmp;
const hits = [];
/** last request headers per path */
const seen = new Map();
const endless = new Set();

function upstreamHandler(req, res) {
  const path = req.url.split('?')[0];
  hits.push(path);
  seen.set(path, req.headers);
  const send = (status, type, body, extra = {}) => { res.writeHead(status, { 'content-type': type, 'content-length': body.length, ...extra }); res.end(body); };
  switch (path) {
    case '/endless-redirect':
    case '/endless-error': {
      endless.add(res);
      res.on('close', () => endless.delete(res));
      res.writeHead(path === '/endless-redirect' ? 302 : 503, { location: '/ok.png' });
      res.write('never finishes');
      return;
    }
    case '/ok.png': return send(200, 'image/png', PNG, { 'set-cookie': 'track=1' });
    case '/ok.jpg': return send(200, 'image/jpeg; charset=binary', JPEG);
    case '/mislabelled.png': return send(200, 'image/png', JPEG); // served with the sniffed type
    case '/a.webp': return send(200, 'image/webp', WEBP);
    case '/a.gif': return send(200, 'image/gif', GIF);
    case '/a.avif': return send(200, 'image/avif', AVIF);
    case '/html': return send(200, 'text/html', Buffer.from('<html>hi</html>'));
    case '/svg': return send(200, 'image/svg+xml', SVG);
    case '/fake.png': return send(200, 'image/png', Buffer.from('<html><script>x</script></html>'));
    case '/gzip.png': return send(200, 'image/png', PNG, { 'content-encoding': 'gzip' });
    case '/big-declared': res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(9 * 1024 * 1024) }); return res.end();
    case '/big-chunked': {
      res.writeHead(200, { 'content-type': 'image/png' });
      const chunk = Buffer.alloc(64 * 1024, 7);
      chunk.set(PNG.subarray(0, 8));
      let sent = 0;
      const pump = () => { while (sent < 9 * 1024 * 1024) { sent += chunk.length; if (!res.write(chunk)) return res.once('drain', pump); } res.end(); };
      res.on('error', () => {});
      return pump();
    }
    case '/missing': return send(404, 'text/plain', Buffer.from('nope'));
    case '/redir': res.writeHead(302, { location: '/ok.png' }); return res.end();
    case '/redir3': res.writeHead(301, { location: '/redir2' }); return res.end();
    case '/redir2': res.writeHead(307, { location: '/redir' }); return res.end();
    case '/loop': res.writeHead(302, { location: '/loop' }); return res.end();
    case '/to-private': res.writeHead(302, { location: 'https://internal.example.com/x.png' }); return res.end();
    case '/to-http': res.writeHead(302, { location: 'http://img.example.com/ok.png' }); return res.end();
    case '/to-literal': res.writeHead(302, { location: 'https://169.254.169.254/latest/meta-data' }); return res.end();
    case '/to-port': res.writeHead(302, { location: 'https://img.example.com:8443/ok.png' }); return res.end();
    case '/to-localhost': res.writeHead(302, { location: 'https://localhost/ok.png' }); return res.end();
    case '/slow': return; // never answers
    default: return send(404, 'text/plain', Buffer.from('?'));
  }
}

/** Test DNS: names → addresses (img.example.com → 127.0.0.1, the local upstream). */
const DNS = {
  'img.example.com': ['127.0.0.1'],
  'other.example.com': ['127.0.0.1'],
  'internal.example.com': ['10.0.0.5'],
  'cgnat.example.com': ['100.100.100.100'],
  'ula.example.com': ['fd12:3456::1'],
  'mapped.example.com': ['::ffff:127.0.0.1'],
  'metadata.example.com': ['169.254.169.254'],
  'mixed.example.com': ['93.184.215.14', '192.168.1.1'],
  'public-only.example.com': ['93.184.215.14'],
};
const resolve = async (host) => (DNS[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
const LOOPBACK_OK = (ip) => ip === '127.0.0.1' || isPublicAddress(ip);

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hui-imgproxy-'));
  up = http.createServer(upstreamHandler);
  up.listen(0, '127.0.0.1');
  await once(up, 'listening');
  upPort = up.address().port;
});
after(async () => {
  up.closeAllConnections?.();
  up.close();
  await rm(tmp, { recursive: true, force: true });
});

/** A proxy mounted on its own server. */
async function mount(opts = {}) {
  const lines = [];
  const logger = createLogger({ level: 'info', sink: (l) => lines.push(l) });
  const config = { ...loadImageProxyConfig({}), cacheDir: '', ...opts.config };
  const proxy = createImageProxy({ token: TOKEN }, {
    config, logger, resolve, now: opts.now,
    allowAddress: opts.allowAddress ?? LOOPBACK_OK,
    transport: { request: http.request, port: upPort },
  });
  const srv = http.createServer((req, res) => (proxy.matches(req) ? void proxy.handle(req, res) : (res.writeHead(404), res.end())));
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const base = `http://127.0.0.1:${srv.address().port}`;
  const get = (u, { auth = TOKEN, headers = {} } = {}) => fetch(`${base}/bridge/img?u=${encodeURIComponent(u)}`, { headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...headers } });
  return { proxy, get, lines, close: () => new Promise((r) => srv.close(r)) };
}
const code = async (res) => (await res.json()).error.code;

/* ───────────── unit: policy ───────────── */

test('isPublicAddress: private, loopback, link-local, CGNAT, ULA, multicast, mapped and reserved ranges are refused', () => {
  for (const ip of ['0.0.0.0', '10.1.2.3', '100.100.100.100', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.168.0.1', '192.0.0.8', '192.0.2.1', '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.255.255.250', '255.255.255.255', '240.0.0.1',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fec0::1', 'ff02::1',
    '2001:db8::1', '2001::1', '2002:7f00:1::1', '3fff::1', '[::1]', 'not-an-ip', '']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['93.184.215.14', '1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '2a00:1450:4001::200e']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});

test('parseTarget: https on 443 only, no credentials, no local names, no private literals', () => {
  assert.equal(parseTarget('https://img.example.com/a.png?w=800').ok, true);
  assert.equal(parseTarget('https://img.example.com:443/a.png').ok, true);
  assert.equal(parseTarget('https://img.example.com/a.png#frag').url.href, 'https://img.example.com/a.png');
  const cases = {
    invalid_url: ['', null, 'http://img.example.com/a.png', 'ftp://img.example.com/a.png', 'data:image/png;base64,AAAA', 'file:///etc/passwd', 'javascript:alert(1)',
      'https://user:pw@img.example.com/a.png', 'https://user@img.example.com/a.png', 'https://img.example.com:8443/a.png', 'https://img.example.com:80/a.png',
      'https://img.example.com/a b.png', 'https://img.example.com/\n.png', 'https://img.example.com\\@evil/', `https://img.example.com/${'x'.repeat(2100)}`, 'not a url'],
    forbidden_address: ['https://localhost/a.png', 'https://foo.localhost/a.png', 'https://intranet/a.png', 'https://printer.local/a.png', 'https://db.internal/x',
      'https://127.0.0.1/a.png', 'https://0x7f.1/a.png', 'https://2130706433/a.png', 'https://10.0.0.1/a.png', 'https://169.254.169.254/latest/meta-data',
      'https://100.100.100.100/a.png', 'https://[::1]/a.png', 'https://[::ffff:127.0.0.1]/a.png', 'https://[fd00::1]/a.png', 'https://[fe80::1]/a.png', 'https://224.0.0.1/a.png'],
  };
  for (const [want, list] of Object.entries(cases)) {
    for (const u of list) {
      const r = parseTarget(u);
      assert.equal(r.ok, false, String(u));
      assert.equal(r.code, want, String(u));
    }
  }
});

test('sniffImageType: magic bytes decide; svg, html and truncated data are no image', () => {
  assert.equal(sniffImageType(PNG), 'image/png');
  assert.equal(sniffImageType(JPEG), 'image/jpeg');
  assert.equal(sniffImageType(WEBP), 'image/webp');
  assert.equal(sniffImageType(GIF), 'image/gif');
  assert.equal(sniffImageType(AVIF), 'image/avif');
  assert.equal(sniffImageType(ICO), 'image/x-icon');
  // a cursor file (type 2), no images or a non-zero reserved byte is no favicon
  const cur = Buffer.from(ICO);
  cur[2] = 2;
  const none = Buffer.from(ICO);
  none[4] = 0;
  const reserved = Buffer.from(ICO);
  reserved[9] = 7;
  for (const b of [cur, none, reserved]) assert.equal(sniffImageType(b), null);
  for (const b of [SVG, Buffer.from('<html></html>'), Buffer.from([0x89, 0x50]), Buffer.alloc(0), Buffer.from('RIFF0000WAVEfmt '), null]) assert.equal(sniffImageType(b), null);
});

test('loadImageProxyConfig: on by default, BRIDGE_IMAGE_PROXY=off, cache below the state dir', () => {
  const d = loadImageProxyConfig({});
  assert.equal(d.enabled, true);
  assert.equal(d.cacheDir, '');
  assert.equal(d.maxBytes, 8 * 1024 * 1024);
  assert.equal(d.maxRedirects, 3);
  assert.equal(d.connectTimeoutMs, 5000);
  assert.equal(d.totalTimeoutMs, 15000);
  for (const v of ['off', 'OFF', '0', 'false', 'no']) assert.equal(loadImageProxyConfig({ BRIDGE_IMAGE_PROXY: v }).enabled, false, v);
  assert.equal(loadImageProxyConfig({ BRIDGE_IMAGE_PROXY: 'on' }).enabled, true);
  assert.equal(loadImageProxyConfig({ BRIDGE_STATE_DIR: '/var/lib/x' }).cacheDir, '/var/lib/x/image-cache');
  assert.equal(loadImageProxyConfig({ STATE_DIRECTORY: '/var/lib/y:/other' }).cacheDir, '/var/lib/y/image-cache');
  assert.equal(loadImageProxyConfig({ BRIDGE_STATE_DIR: '/s', BRIDGE_IMAGE_PROXY_CACHE_MB: '0' }).cacheDir, '');
  assert.equal(loadImageProxyConfig({ BRIDGE_STATE_DIR: '/s' }).cacheBytes, 200 * 1024 * 1024);
});

/* ───────────── route: happy paths ───────────── */

test('happy path: image served with the sniffed type, safe headers; no client headers, cookies or referrer go upstream', async () => {
  const p = await mount();
  try {
    const r = await p.get('https://img.example.com/ok.png?w=800&secret=abc', { headers: { cookie: 'session=1', referer: 'https://app.example.com/chat', 'x-private': 'y' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy'), /sandbox/);
    assert.match(r.headers.get('cache-control'), /max-age=86400/);
    assert.equal(r.headers.get('set-cookie'), null);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
    const h = seen.get('/ok.png');
    assert.equal(h.cookie, undefined);
    assert.equal(h.referer, undefined);
    assert.equal(h.authorization, undefined);
    assert.equal(h['x-private'], undefined);
    assert.match(h['user-agent'], /HermesUI-ImageProxy/);
    assert.equal(h['accept-encoding'], 'identity');

    const m = await p.get('https://img.example.com/mislabelled.png');
    assert.equal(m.status, 200);
    assert.equal(m.headers.get('content-type'), 'image/jpeg');
    for (const [path, type] of [['/ok.jpg', 'image/jpeg'], ['/a.webp', 'image/webp'], ['/a.gif', 'image/gif'], ['/a.avif', 'image/avif']]) {
      const x = await p.get(`https://img.example.com${path}`);
      assert.equal(x.status, 200, path);
      assert.equal(x.headers.get('content-type'), type, path);
    }
  } finally { await p.close(); }
});

test('redirects: followed up to 3, each hop re-validated (private DNS, http, literal, port, localhost refused)', async () => {
  const p = await mount();
  try {
    assert.equal((await p.get('https://img.example.com/redir')).status, 200);
    assert.equal((await p.get('https://img.example.com/redir3')).status, 200); // 3 hops: redir3 → redir2 → redir → ok
    let r = await p.get('https://img.example.com/loop');
    assert.equal(r.status, 502); assert.equal(await code(r), 'too_many_redirects');
    hits.length = 0;
    r = await p.get('https://img.example.com/to-private');
    assert.equal(r.status, 403); assert.equal(await code(r), 'forbidden_address');
    assert.deepEqual(hits, ['/to-private']); // the private target was never contacted
    r = await p.get('https://img.example.com/to-http');
    assert.equal(r.status, 400); assert.equal(await code(r), 'invalid_url');
    r = await p.get('https://img.example.com/to-literal');
    assert.equal(r.status, 403); assert.equal(await code(r), 'forbidden_address');
    r = await p.get('https://img.example.com/to-port');
    assert.equal(r.status, 400);
    r = await p.get('https://img.example.com/to-localhost');
    assert.equal(r.status, 403);
  } finally { await p.close(); }
});

/* ───────────── route: refusals ───────────── */

test('auth: no token or a wrong token → 401, nothing fetched', async () => {
  const p = await mount();
  try {
    hits.length = 0;
    assert.equal((await p.get('https://img.example.com/ok.png', { auth: '' })).status, 401);
    assert.equal((await p.get('https://img.example.com/ok.png', { auth: 'wrong' })).status, 401);
    assert.deepEqual(hits, []);
  } finally { await p.close(); }
});

test('DNS: a name resolving to a private / CGNAT / ULA / mapped / metadata address (or ANY private one) is refused before connecting', async () => {
  const p = await mount({ allowAddress: isPublicAddress }); // the real policy: loopback is refused too
  try {
    hits.length = 0;
    for (const h of ['img.example.com', 'internal.example.com', 'cgnat.example.com', 'ula.example.com', 'mapped.example.com', 'metadata.example.com', 'mixed.example.com']) {
      const r = await p.get(`https://${h}/ok.png`);
      assert.equal(r.status, 403, h);
      assert.equal(await code(r), 'forbidden_address', h);
    }
    const nx = await p.get('https://nx.example.com/ok.png');
    assert.equal(nx.status, 502);
    assert.deepEqual(hits, []);
  } finally { await p.close(); }
});

test('type: non-image, svg, fake magic bytes and encoded bodies → 415', async () => {
  const p = await mount();
  try {
    for (const path of ['/html', '/svg', '/fake.png', '/gzip.png']) {
      const r = await p.get(`https://img.example.com${path}`);
      assert.equal(r.status, 415, path);
      assert.equal(await code(r), 'unsupported_type', path);
    }
  } finally { await p.close(); }
});

test('size: declared or streamed body over 8 MB → 413', async () => {
  const p = await mount();
  try {
    let r = await p.get('https://img.example.com/big-declared');
    assert.equal(r.status, 413);
    r = await p.get('https://img.example.com/big-chunked');
    assert.equal(r.status, 413); assert.equal(await code(r), 'too_large');
  } finally { await p.close(); }
});

test('upstream status other than 200 → 502; failures are remembered for a while (no re-fetch)', async () => {
  const p = await mount();
  try {
    hits.length = 0;
    assert.equal((await p.get('https://img.example.com/missing')).status, 502);
    assert.equal((await p.get('https://img.example.com/missing')).status, 502);
    assert.deepEqual(hits, ['/missing']);
  } finally { await p.close(); }
});

test('timeout: total timeout → 504', async () => {
  const p = await mount({ config: { totalTimeoutMs: 300 } });
  try {
    const t0 = Date.now();
    const r = await p.get('https://img.example.com/slow');
    assert.equal(r.status, 504); assert.equal(await code(r), 'timeout');
    assert.ok(Date.now() - t0 < 3000);
  } finally { await p.close(); }
});

test('connect timeout → 504 (a socket that never connects; 5 s default lowered for the test)', async () => {
  const proxy = createImageProxy({ token: TOKEN }, {
    config: { ...loadImageProxyConfig({}), connectTimeoutMs: 200 },
    resolve,
    allowAddress: LOOPBACK_OK,
    transport: {
      port: upPort,
      request: (opts) => http.request({ ...opts, agent: undefined, createConnection: () => { const s = new net.Socket(); s.connecting = true; return s; } }),
    },
  });
  const srv = http.createServer((req, res) => void proxy.handle(req, res));
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening');
  try {
    const t0 = Date.now();
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/bridge/img?u=${encodeURIComponent('https://img.example.com/ok.png')}`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(r.status, 504);
    assert.ok(Date.now() - t0 < 3000);
  } finally { srv.close(); }
});

test('rate limit: uncached fetches per credential and minute; cached answers do not count', async () => {
  let t = 1_000_000;
  const cacheDir = join(tmp, 'rate-cache');
  const p = await mount({ config: { ratePerMin: 2, cacheDir }, now: () => t });
  try {
    assert.equal((await p.get('https://img.example.com/ok.png')).status, 200);
    assert.equal((await p.get('https://img.example.com/ok.jpg')).status, 200);
    assert.equal((await p.get('https://img.example.com/ok.png')).status, 200); // cached
    const r = await p.get('https://img.example.com/a.gif');
    assert.equal(r.status, 429); assert.equal(r.headers.get('retry-after'), '30');
    t += 61_000;
    assert.equal((await p.get('https://img.example.com/a.gif')).status, 200);
  } finally { await p.close(); }
});

test('off: BRIDGE_IMAGE_PROXY=off → 404, and /bridge/images/config advertises the proxy state', async () => {
  for (const [env, want] of [[{}, true], [{ BRIDGE_IMAGE_PROXY: 'off' }, false]]) {
    const { server } = createServer({ HERMES_BASE_URL: 'http://127.0.0.1:1', BRIDGE_TOKEN: TOKEN, ...env }, { logger: silentLogger, imageProxy: { resolve, allowAddress: LOOPBACK_OK, transport: { request: http.request, port: upPort } } });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const auth = { authorization: `Bearer ${TOKEN}` };
    try {
      const cfg = await (await fetch(`${base}/bridge/images/config`, { headers: auth })).json();
      assert.equal(cfg.available, false); // no search provider: the public default
      assert.equal(cfg.proxy.available, want);
      const r = await fetch(`${base}/bridge/img?u=${encodeURIComponent('https://img.example.com/ok.png')}`, { headers: auth });
      assert.equal(r.status, want ? 200 : 404);
      if (!want) assert.equal(await code(r), 'proxy_disabled');
      assert.equal((await fetch(`${base}/bridge/img?u=x`)).status, 401); // auth before anything else
    } finally { server.close(); }
  }
});

/* ───────────── cache ───────────── */

test('disk cache: sha256(url) file names, served without upstream, TTL 24 h, LRU size cap', async () => {
  let t = 5_000_000;
  const cacheDir = join(tmp, 'cache');
  const p = await mount({ config: { cacheDir, cacheBytes: 100 }, now: () => t }); // PNG and JPEG are 48 bytes each
  try {
    hits.length = 0;
    const u = 'https://img.example.com/ok.png?v=1';
    assert.equal((await p.get(u)).status, 200);
    const key = createHash('sha256').update(new URL(u).href).digest('hex');
    assert.deepEqual(await readdir(cacheDir), [`${key}.png`]);
    assert.deepEqual(await readFile(join(cacheDir, `${key}.png`)), PNG);
    const again = await p.get(u);
    assert.equal(again.status, 200);
    assert.equal(again.headers.get('content-type'), 'image/png');
    assert.deepEqual(hits, ['/ok.png']); // second answer from disk

    // LRU: a third 48-byte image exceeds 100 bytes → the least recently used one goes
    assert.equal((await p.get('https://img.example.com/ok.jpg')).status, 200);
    assert.equal((await p.get(u)).status, 200); // touch → most recent
    assert.equal((await p.get('https://img.example.com/a.gif?v=2')).status, 200);
    const files = await readdir(cacheDir);
    assert.ok(files.includes(`${key}.png`));
    assert.ok(!files.some((f) => f.endsWith('.jpg')));

    // TTL
    hits.length = 0;
    t += 25 * 3600_000;
    assert.equal((await p.get(u)).status, 200);
    assert.deepEqual(hits, ['/ok.png']);
  } finally { await p.close(); }
});

test('disk cache survives a restart (index rebuilt from the directory), stray temp files are removed', async () => {
  const cacheDir = join(tmp, 'cache2');
  const a = await mount({ config: { cacheDir } });
  await a.get('https://img.example.com/ok.png?restart=1');
  await a.close();
  await writeFile(join(cacheDir, `${'a'.repeat(64)}.png.123.tmp`), 'x');
  const b = await mount({ config: { cacheDir } });
  try {
    hits.length = 0;
    assert.equal((await b.get('https://img.example.com/ok.png?restart=1')).status, 200);
    assert.deepEqual(hits, []);
    assert.ok(!(await readdir(cacheDir)).some((f) => f.endsWith('.tmp')));
  } finally { await b.close(); }
});

/* ───────────── logs ───────────── */

test('logs: host, status, bytes, ms only; never the path or query string', async () => {
  const p = await mount();
  try {
    await p.get('https://img.example.com/ok.png?token=very-secret-query');
    await p.get('https://img.example.com/svg?token=very-secret-query');
    await p.get('https://10.0.0.1/private-path?token=very-secret-query');
    const all = p.lines.join('\n');
    assert.ok(!all.includes('very-secret-query'));
    assert.ok(!all.includes('/ok.png'));
    assert.ok(!all.includes('private-path'));
    const ok = p.lines.map((l) => JSON.parse(l)).find((l) => l.msg === 'image_proxy');
    assert.equal(ok.host, 'img.example.com');
    assert.equal(ok.status, 200);
    assert.equal(ok.bytes, PNG.length);
    assert.equal(typeof ok.ms, 'number');
  } finally { await p.close(); }
});

/* ───────────── real TLS ───────────── */

function haveOpenssl() {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

test('TLS: certificate checked against the host name (SNI) while connecting to the checked address', { skip: !haveOpenssl() && 'openssl not available' }, async () => {
  const dir = join(tmp, 'tls');
  execFileSync('mkdir', ['-p', dir]);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=img.example.com',
    '-addext', 'subjectAltName=DNS:img.example.com', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
  const key = await readFile(join(dir, 'key.pem'));
  const cert = await readFile(join(dir, 'cert.pem'));
  const tls = https.createServer({ key, cert }, upstreamHandler);
  tls.listen(0, '127.0.0.1'); await once(tls, 'listening');
  const port = tls.address().port;
  const mk = (ca) => createImageProxy({ token: TOKEN }, { config: loadImageProxyConfig({}), resolve, allowAddress: LOOPBACK_OK, transport: { port, ...(ca ? { ca } : {}) } });
  const run = async (proxy, u) => {
    const srv = http.createServer((req, res) => void proxy.handle(req, res));
    srv.listen(0, '127.0.0.1'); await once(srv, 'listening');
    try {
      return await fetch(`http://127.0.0.1:${srv.address().port}/bridge/img?u=${encodeURIComponent(u)}`, { headers: { authorization: `Bearer ${TOKEN}` } });
    } finally { srv.close(); }
  };
  try {
    const ok = await run(mk(cert), 'https://img.example.com/ok.png');
    assert.equal(ok.status, 200);
    assert.deepEqual(Buffer.from(await ok.arrayBuffer()), PNG);
    assert.equal((await run(mk(null), 'https://img.example.com/ok.png')).status, 502); // untrusted cert
    assert.equal((await run(mk(cert), 'https://other.example.com/ok.png')).status, 502); // name mismatch
  } finally { tls.closeAllConnections?.(); tls.close(); }
});

test('defaults match the documented limits', () => {
  assert.equal(IMAGE_PROXY_DEFAULTS.maxBytes, 8 * 1024 * 1024);
  assert.equal(IMAGE_PROXY_DEFAULTS.cacheBytes, 200 * 1024 * 1024);
  assert.equal(IMAGE_PROXY_DEFAULTS.cacheTtlMs, 24 * 3600_000);
});


for (const target of ['endless-redirect', 'endless-error']) {
  test(`unused upstream body is closed immediately: ${target}`, async () => {
    const p = await mount();
    try {
      const result = await p.get(`https://img.example.com/${target}`);
      await result.arrayBuffer();
      assert.equal(result.status, target === 'endless-redirect' ? 200 : 502);
      for (let i = 0; endless.size && i < 20; i++) await new Promise((r) => setTimeout(r, 10));
      assert.equal(endless.size, 0, 'no abandoned response survives completion');
    } finally {
      for (const res of endless) res.destroy();
      await p.close();
    }
  });
}
