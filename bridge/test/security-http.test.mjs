import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PAIR_CODE_TTL_MS } from '../src/devices.mjs';
import { createPairing, CODE_TTL_MS, MAX_FAILED_ATTEMPTS } from '../src/pair.mjs';
import { SEEDS, ROUNDS, LONG, random, localBridge, TEST_TOKEN } from './security-helpers.mjs';

const jsonHeaders = { 'content-type': 'application/json' };
const filesIn = async (dir) => {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) files.push(...await filesIn(join(dir, entry.name)));
    else files.push(join(dir, entry.name));
  }
  return files;
};

for (const seed of SEEDS) {
  test(`seed=${seed}: redeem brute force, replay, expiry and concurrent requests`, async (t) => {
    let now = 1_800_000_000_000;
    const { ctx, request } = await localBridge(t, { options: { now: () => now } });
    const next = random(seed);
    const redeem = (code) => request('/bridge/pair/redeem', { method: 'POST', auth: false, headers: jsonHeaders, body: JSON.stringify({ code }) });
    const invalid = '{"error":{"message":"Invalid or expired pairing code","type":"invalid_request_error","code":"pair_code_invalid"}}';
    for (let i = 0; i < ROUNDS; i++) {
      const result = await redeem('test-fake-' + String(next(100000)).padStart(33, '0'));
      assert.equal(result.status, i % 12 < 10 ? 410 : 429);
      assert.ok(!result.body.includes('test-fake-'));
      if (i % 12 === 11) now += 61_000;
    }
    now += 61_000;
    const pending = ctx.devices.issue('test-concurrency');
    const answers = await Promise.all(Array.from({ length: 8 }, () => redeem(pending.code)));
    assert.equal(answers.filter((r) => r.status === 200).length, 1);
    assert.equal(answers.filter((r) => r.body === invalid).length, 7);
    const token = JSON.parse(answers.find((r) => r.status === 200).body).token;
    assert.ok(ctx.devices.authenticate(token));
    assert.equal((await redeem(pending.code)).body, invalid);
    now += 61_000;
    const revoked = ctx.devices.issue('test-revoked');
    ctx.devices.revoke(revoked.id);
    const expired = ctx.devices.issue('test-expired');
    now = expired.expiresAt;
    assert.equal((await redeem(expired.code)).body, invalid, 'exact expiry is exclusive');
    assert.equal((await redeem(revoked.code)).body, invalid);
    assert.equal((await redeem('test-' + 'a'.repeat(38))).body, invalid);
    const edge = ctx.devices.issue('test-before-expiry');
    now += PAIR_CODE_TTL_MS - 1;
    assert.equal((await redeem(edge.code)).status, 200);

    if (LONG) {
      // Informational only: wall-clock timing cannot prove constant-time code. Codes are never logged.
      const durations = [];
      for (const code of [pending.code, revoked.code, 'test-' + 'b'.repeat(38)]) {
        now += 61_000;
        const started = performance.now();
        assert.equal((await redeem(code)).body, invalid);
        durations.push(Math.round((performance.now() - started) * 1000));
      }
      t.diagnostic(`invalid-code latency samples (microseconds, informational): ${durations.join(', ')}`);
    }
  });

  test(`seed=${seed}: short pairing page codes lock, expire and consume exactly once`, async () => {
    let now = 1_800_000_000_000;
    const consumed = new Error('test-code-consumed');
    const make = () => createPairing({ host: 'localhost', port: 1, token: TEST_TOKEN }, {
      env: { BRIDGE_PAIRING: '1', BRIDGE_PUBLIC_URL: 'https://bridge.example.com' },
      now: () => now, code: 'TEST-AAAA',
      // Stop after authorization/consumption, before rendering: the security corpus needs no QR dependency.
      devices: { issue: () => { throw consumed; } },
    });
    const call = async (pair, code) => {
      const req = { method: 'GET', url: '/bridge/pair.svg?code=' + encodeURIComponent(code), headers: { host: 'bridge.example.com' }, socket: { remoteAddress: '192.0.2.1' } };
      const res = { writeHead(status) { this.status = status; }, end() {} };
      await pair.handle(req, res);
      return res.status;
    };
    const pair = make();
    const next = random(seed);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) assert.equal(await call(pair, 'fake-' + next(1000)), 403);
    assert.equal(await call(pair, 'TEST-AAAA'), 429);
    now += CODE_TTL_MS;
    assert.equal(await call(pair, 'TEST-AAAA'), 403);
    const fresh = make();
    await assert.rejects(call(fresh, 'test-aaaa'), (error) => error === consumed);
    assert.equal(await call(fresh, 'TEST-AAAA'), 403);
    const expires = make();
    now += CODE_TTL_MS;
    assert.equal(await call(expires, 'TEST-AAAA'), 403);
  });

  test(`seed=${seed}: profile routing rejects encoded, nested and unknown paths before upstream`, async (t) => {
    const { request, seen } = await localBridge(t);
    const next = random(seed);
    const rejected = [
      '/p/%77riter/v1/models', '/p/WRITER/v1/models', '/p/nope/v1/models', '/p/writer/p/reader/v1/models',
      '/p/writer/../api/jobs', '/p/writer/%2e%2e/api/jobs', '/p/writer%2freader/v1/models',
      '/p/writer/%252e%252e/api/jobs', '/p/writer/bridge/status', '/p/__proto__/v1/models',
      '/p/constructor/v1/models', '/p/writer/v1/runs', '/p/writer/api/jobs/nothex', '/p//v1/models',
    ];
    for (let i = 0; i < ROUNDS; i++) {
      const result = await request(rejected[next(rejected.length)]);
      assert.ok([400, 404, 405].includes(result.status));
    }
    assert.equal(seen.length, 0);
    for (const profile of ['writer', 'reader']) {
      assert.equal((await request(`/p/${profile}/v1/models`)).status, 200);
      assert.equal(seen.at(-1).url, `/p/${profile}/v1/models`);
    }
    assert.equal((await request('/p/writer/health', { auth: false })).status, 401);
  });
}

test('uploads: spoofed MIME and polyglot bytes stay inert; traversal never changes the storage root', async (t) => {
  const { request, root } = await localBridge(t);
  const zip = Buffer.from('PK\x03\x04test-fake-archive');
  const polyglot = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('<script>test</script>PK\x03\x04')]);
  for (const [body, mime] of [[zip, 'application/zip'], [polyglot, 'application/octet-stream']]) {
    assert.equal((await request('/bridge/uploads', { method: 'POST', headers: { 'x-filename': 'test.zip', 'content-type': mime }, body })).status, 415);
  }
  for (const [body, mime] of [[zip, 'text/plain'], [polyglot, 'image/png'], [Buffer.from('<svg onload="test"/>'), 'image/png']]) {
    const result = await request('/bridge/uploads', {
      method: 'POST', headers: { 'x-filename': encodeURIComponent('../../test/..\\test-polyglot.png'), 'content-type': mime }, body,
    });
    assert.equal(result.status, 201, 'MIME is a declared-type filter, not a content scanner');
    const stored = JSON.parse(result.body);
    assert.ok(!relative(join(root, 'uploads'), stored.path).startsWith('..'));
    assert.equal(stored.name, 'test-polyglot.png');
    assert.deepEqual(await readFile(stored.path), body);
    assert.equal((await request('/bridge/uploads/' + stored.id)).status, 404, 'uploads are not a public file server');
  }
  const atLimit = await request('/bridge/uploads', { method: 'POST', headers: { 'x-filename': 'test.txt', 'content-type': 'text/plain' }, body: Buffer.alloc(1024, 65) });
  assert.equal(atLimit.status, 201);
  const overLimit = await request('/bridge/uploads', { method: 'POST', headers: { 'x-filename': 'test.txt', 'content-type': 'text/plain' }, body: [Buffer.alloc(600), Buffer.alloc(425)] });
  assert.equal(overLimit.status, 413);
  assert.equal((await filesIn(join(root, 'uploads'))).some((file) => file.endsWith('.part')), false);
});

test('JSON prototype keys do not alter auth, routing, stop scope or global prototypes; request bodies stay bounded', async (t) => {
  const { request, seen } = await localBridge(t);
  const pollution = '{"__proto__":{"polluted":true,"token":"test-fake"},"constructor":{"prototype":{"polluted":true}},"messages":[{"role":"user","content":"test"}],"sessionId":"test-session"}';
  for (const path of ['/v1/chat/completions', '/bridge/chat/stop', '/api/sessions/test-session/model']) {
    assert.equal((await request(path, { method: 'POST', headers: jsonHeaders, body: pollution })).status, 200);
    assert.equal({}.polluted, undefined);
  }
  assert.equal((await request('/bridge/status', { auth: false })).status, 401);
  const before = seen.length;
  for (const path of ['/bridge/chat/stop', '/bridge/pair/redeem', '/bridge/devices', '/api/sessions/test-session/model', '/v1/runs/test-run/approval']) {
    const result = await request(path, { method: 'POST', headers: { ...jsonHeaders, 'content-length': '16384' }, body: ' '.repeat(16384) });
    assert.equal(result.status, 413, path);
  }
  // Chat's streaming overflow path may close the socket before its 413 can be read; it must never forward.
  await request('/v1/chat/completions', { method: 'POST', headers: jsonHeaders, body: [' '.repeat(2048), ' '.repeat(2049)] }).catch((error) => {
    assert.ok(['ECONNRESET', 'EPIPE'].includes(error.code));
  });
  assert.equal(seen.length, before);
});

test('replay cannot cross credentials, profiles or sessions, and invalid offsets never start a turn', async (t) => {
  const { ctx, request, seen } = await localBridge(t, { respond: (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' }).end('data: {"test":"Grüß 🌍"}\n\ndata: [DONE]\n\n');
  } });
  const headers = { ...jsonHeaders, 'idempotency-key': 'test-same-key', 'x-hermes-session-id': 'test-session' };
  const body = '{"stream":true,"messages":[{"role":"user","content":"test"}]}';
  const first = await request('/v1/chat/completions', { method: 'POST', headers, body });
  assert.equal(first.status, 200);
  const resumeHeaders = { ...headers, 'x-hermes-ui-resume-offset': '1' };
  const again = await request('/v1/chat/completions', { method: 'POST', headers: resumeHeaders, body });
  assert.equal(again.status, 200);
  assert.deepEqual(Buffer.from(again.body), Buffer.from(first.body).subarray(1));
  for (const offset of ['-1', '1e9', 'NaN', '9007199254740993', '0x10']) {
    const result = await request('/v1/chat/completions', { method: 'POST', headers: { ...headers, 'x-hermes-ui-resume-offset': offset }, body });
    assert.equal(result.status, 400);
  }
  assert.equal((await request('/v1/chat/completions', { method: 'POST', headers: { ...resumeHeaders, 'x-hermes-ui-resume-offset': '999999999999999' }, body })).status, 409);
  const pending = ctx.devices.issue('test-replay-device');
  const device = ctx.devices.redeem(pending.code);
  assert.equal((await request('/v1/chat/completions', { method: 'POST', headers: { ...resumeHeaders, authorization: `Bearer ${device.token}` }, body })).status, 409);
  assert.equal((await request('/p/writer/v1/chat/completions', { method: 'POST', headers: resumeHeaders, body })).status, 409);
  assert.equal((await request('/v1/chat/completions', { method: 'POST', headers: { ...resumeHeaders, 'x-hermes-session-id': 'test-other-session' }, body })).status, 409);
  assert.equal(seen.length, 1);
});

test('stop selects exactly one profile/session namespace, including default-profile aliases', async (t) => {
  const live = new Set();
  const { base, request } = await localBridge(t, { respond: (req, res) => {
    const key = req.url + ':' + req.headers['x-hermes-session-id'];
    live.add(key);
    res.once('close', () => live.delete(key));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"test":true}\n\n');
  } });
  const controls = [];
  t.after(() => controls.forEach((ctrl) => ctrl.abort()));
  for (const prefix of ['', '/p/writer', '/p/reader']) {
    for (const session of ['test-a', 'test-a.writer']) {
      const ctrl = new AbortController(); controls.push(ctrl);
      const res = await fetch(base + prefix + '/v1/chat/completions', {
        method: 'POST', signal: ctrl.signal,
        headers: { authorization: `Bearer ${TEST_TOKEN}`, 'content-type': 'application/json', 'x-hermes-session-id': session },
        body: '{"stream":true,"messages":[{"role":"user","content":"test"}]}',
      });
      assert.equal(res.status, 200);
    }
  }
  assert.equal(live.size, 6);
  for (const profile of ['writer', 'reader', 'default']) {
    const invalid = await request('/bridge/chat/stop', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ sessionId: 'test-a\0writer', profile }) });
    assert.equal(invalid.status, 400);
    const stopped = await request('/bridge/chat/stop', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ sessionId: 'test-a', profile }) });
    assert.deepEqual(JSON.parse(stopped.body), { stopped: 1 });
    const again = await request('/bridge/chat/stop', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ sessionId: 'test-a', profile }) });
    assert.deepEqual(JSON.parse(again.body), { stopped: 0 });
  }
  // Socket close delivery can lag the stop response, so observe the upstream close events explicitly.
  for (let i = 0; i < 100 && live.size !== 3; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(live.size, 3);
  assert.ok([...live].every((key) => key.endsWith(':test-a.writer')));
});

test('landing page is invariant under hostile query, Host and Origin headers, auth and pairing state', async (t) => {
  const { ctx, request } = await localBridge(t, { env: { BRIDGE_PAIRING: '1', BRIDGE_NAME: 'test-private-name' } });
  const normal = await request('/', { auth: false });
  ctx.devices.issue('test-private-label');
  const hostile = await request('/?code=test-fake&token=test-fake&name=%3Cscript%3E', {
    headers: { host: 'evil.example.com', origin: 'https://evil.example.com', 'x-forwarded-host': 'fake.example.com' },
  });
  assert.equal(hostile.status, 200);
  assert.equal(hostile.body, normal.body);
  assert.doesNotMatch(hostile.body, /test-private|test-fake|evil\.example|fake\.example|<script|\son\w+=/i);
  assert.match(hostile.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(hostile.headers['cache-control'], 'no-store');
});

test('incomplete uploads and headers are cut by local request deadlines; WebSockets cannot bypass HTTP auth', async (t) => {
  const { port, root, request, seen } = await localBridge(t, { options: { requestTimeoutMs: 1000, connectionsCheckingIntervalMs: 50 } });
  const stalled = async (head) => {
    const socket = net.connect(port, '127.0.0.1');
    const closed = once(socket, 'close');
    const timer = setTimeout(() => socket.destroy(new Error('slowloris deadline exceeded')), 5000);
    socket.on('error', () => {});
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    try {
      await once(socket, 'connect'); socket.write(head);
      await closed;
      assert.match(Buffer.concat(chunks).toString(), /^HTTP\/1\.1 408/);
    } finally { clearTimeout(timer); socket.destroy(); }
  };
  await Promise.all([
    stalled('POST /bridge/uploads HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ' + TEST_TOKEN + '\r\nX-Filename: test.txt\r\nContent-Type: text/plain\r\nContent-Length: 512\r\n\r\npartial'),
    stalled('GET /v1/models HTTP/1.1\r\nHost: localhost\r\nX-Test: unfinished'),
  ]);
  for (let i = 0; i < 50 && (await filesIn(join(root, 'uploads'))).length; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(await filesIn(join(root, 'uploads')), []);
  for (const auth of [true, false]) {
    const result = await request('/v1/models', { auth, headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': Buffer.from('test-fake-key-00').toString('base64') } });
    assert.equal(result.status, 501);
  }
  assert.deepEqual(seen, []);
});
