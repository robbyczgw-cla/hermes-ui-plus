// Review hardening: header allow-list both ways, pass-through timeouts + body caps, server request timeouts that do
// not cut long SSE answers, atomic temp files.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import { filterRequestHeaders, filterResponseHeaders, FORWARD_REQUEST_HEADERS } from '../src/bridge.mjs';
import { writeFileAtomicSync, tempNameFor } from '../src/atomic-write.mjs';

const TOKEN = 'bridge-token-hardening-0000';
let upstream;
let seen = [];
/** @type {(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => void} */
let behaviour = (_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end('{}'); };
let ctx;
let base;

before(async () => {
  upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    behaviour(req, res, Buffer.concat(chunks));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  ctx = createServer({
    HERMES_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, HERMES_API_KEY: 'up-key', BRIDGE_TOKEN: TOKEN,
    BRIDGE_ROUTER: 'off', BRIDGE_BOOTSTRAP: 'off', BRIDGE_UPSTREAM_TIMEOUT_MS: '1000',
  }, { logger: silentLogger, requestTimeoutMs: 1000, connectionsCheckingIntervalMs: 100 });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  base = `http://127.0.0.1:${ctx.server.address().port}`;
});
after(() => {
  for (const s of [ctx.server, upstream]) { s.close(); s.closeAllConnections(); }
});

const auth = { authorization: `Bearer ${TOKEN}` };

test('request headers: allow-list only (app headers + content negotiation); response: no set-cookie, no upstream CORS', () => {
  const out = filterRequestHeaders({
    'content-type': 'application/json', accept: 'text/event-stream', 'accept-language': 'de', 'user-agent': 'app/1',
    'x-hermes-session-id': 's', 'x-hermes-session-key': 'k', 'idempotency-key': 'i', 'last-event-id': '7',
    authorization: 'Bearer x', cookie: 'a=b', origin: 'https://evil.example', referer: 'https://evil.example/',
    'x-forwarded-for': '192.0.2.1', forwarded: 'for=192.0.2.1', 'x-custom': '1', 'x-hermes-ui-route': 'off', host: 'h',
    'tailscale-user-login': 'alice', 'accept-encoding': 'gzip', 'content-length': '3', connection: 'keep-alive',
  });
  assert.deepEqual(Object.keys(out).sort(), [...FORWARD_REQUEST_HEADERS].sort());
  const res = filterResponseHeaders({ 'content-type': 'x', 'set-cookie': ['a=b'], 'access-control-allow-origin': '*', connection: 'close', 'x-hermes-session-id': 's' });
  assert.deepEqual(Object.keys(res).sort(), ['content-type', 'x-hermes-session-id']);
});

test('pass-through: only allow-listed headers reach Hermes, set-cookie never reaches the client', async () => {
  behaviour = (_q, r) => { r.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'session=upstream; HttpOnly' }); r.end('{"data":[]}'); };
  seen = [];
  const r = await fetch(`${base}/v1/models`, { headers: { ...auth, cookie: 'c=1', 'x-forwarded-for': '192.0.2.9', 'x-secret-thing': 'zzz', 'accept-language': 'es' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('set-cookie'), null);
  const h = seen[0].headers;
  assert.equal(h.authorization, 'Bearer up-key');
  assert.equal(h['accept-language'], 'es');
  for (const k of ['cookie', 'x-forwarded-for', 'x-secret-thing']) assert.equal(h[k], undefined, k);
});

test('/health: never reads or forwards a request body', async () => {
  behaviour = (_q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"status":"ok"}'); };
  seen = [];
  const r = await new Promise((resolve, reject) => {
    const q = http.request(`${base}/health`, { method: 'GET', headers: { 'content-type': 'application/json', 'content-length': '9' } }, resolve);
    q.on('error', reject);
    q.end('{"a":"b"}');
  });
  r.resume();
  assert.equal(r.statusCode, 200);
  assert.equal(seen[0].body.length, 0);
  assert.equal(seen[0].headers['content-type'], undefined);
});

test('approval answer: body capped at 8 KB before anything goes upstream', async () => {
  seen = [];
  const r = await fetch(`${base}/v1/runs/run-1/approval`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ choice: 'once', pad: 'x'.repeat(9000) }) });
  assert.equal(r.status, 413);
  assert.equal(seen.length, 0);
  behaviour = (_q, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); };
  const ok = await fetch(`${base}/v1/runs/run-1/approval`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ choice: 'once' }) });
  assert.equal(ok.status, 200);
  // (first a run status lookup for a v0.22.3+ generation: none here, so the body goes up unchanged)
  assert.deepEqual(JSON.parse(seen.find((x) => x.method === 'POST').body.toString()), { choice: 'once' });
});

test('pass-through: a hanging upstream answers 504 after the upstream timeout', async () => {
  behaviour = () => { /* never answers */ };
  const t0 = Date.now();
  const r = await fetch(`${base}/v1/runs/run-2`, { headers: auth });
  assert.equal(r.status, 504);
  assert.equal((await r.json()).error.code, 'upstream_timeout');
  assert.ok(Date.now() - t0 < 5000);
  const h = await fetch(`${base}/health`);
  assert.equal(h.status, 504, '/health is bounded too');
});

test('server: a request body that never finishes is cut (requestTimeout); a long SSE answer is not', async () => {
  // slow client: headers promise 100 bytes, only 5 arrive
  const sock = net.connect(Number(new URL(base).port), '127.0.0.1');
  await once(sock, 'connect');
  sock.write(`POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ${TOKEN}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"mes`);
  let got = '';
  sock.on('data', (d) => { got += d; });
  const closed = await Promise.race([once(sock, 'close').then(() => true), new Promise((r) => setTimeout(() => r(false), 4000))]);
  sock.destroy();
  assert.equal(closed, true, 'stalled request closed by the server');
  assert.match(got, /^HTTP\/1\.1 408/);

  // SSE answer running 2.5x longer than requestTimeout still completes
  behaviour = (_q, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    let n = 0;
    const iv = setInterval(() => {
      res.write(`data: {"choices":[{"delta":{"content":"${n}"}}]}\n\n`);
      if (++n === 5) { clearInterval(iv); res.end('data: [DONE]\n\n'); }
    }, 500);
  };
  const r = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] }) });
  const text = await r.text();
  assert.equal(r.status, 200);
  assert.match(text, /\[DONE\]/);
  assert.equal((text.match(/^data: \{/gm) ?? []).length, 5);
});

test('atomic write: random temp name, O_EXCL, no leftovers; a planted symlink at the target is replaced, not followed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-atomic-'));
  const file = path.join(dir, 'state.json');
  assert.notEqual(tempNameFor(file), tempNameFor(file));
  writeFileAtomicSync(file, 'one');
  writeFileAtomicSync(file, 'two');
  assert.equal(fs.readFileSync(file, 'utf8'), 'two');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
  const outside = path.join(dir, 'outside');
  fs.writeFileSync(outside, 'keep');
  fs.rmSync(file);
  fs.symlinkSync(outside, file);
  writeFileAtomicSync(file, 'three');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');
  assert.equal(fs.lstatSync(file).isSymbolicLink(), false);
  assert.throws(() => writeFileAtomicSync(path.join(dir, 'missing', 'x'), 'y'));
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});
