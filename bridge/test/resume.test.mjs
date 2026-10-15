// Idempotent send + stream resume (src/replay.mjs, docs/BRIDGE.md "Idempotent send and resume"): a chat turn with an
// Idempotency-Key is recorded; the same key never starts a second Hermes turn, X-Hermes-UI-Resume-Offset continues a
// lost stream at a byte offset. Real bridge in front of a fake Hermes that streams chat.completion chunks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import { createReplayStore, idempotencyKey, resumeOffset, UNRECORDED_CODE } from '../src/replay.mjs';

const TOKEN = 'bridge-token-resume-test';
let upstream; let ctx; let port;
/** @type {{session: string, text: string}[]} */ let seen = [];
/** `abort-once` turns already broken (by message count) */
const aborted = new Set();
/** resolves when the fake Hermes finished a stream */
let upstreamDone = Promise.resolve();

const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

before(async () => {
  upstream = http.createServer(async (req, res) => {
    const body = [];
    for await (const c of req) body.push(c);
    const json = JSON.parse(Buffer.concat(body).toString() || '{}');
    const text = json.messages?.at(-1)?.content ?? '';
    seen.push({ session: String(req.headers['x-hermes-session-id'] ?? ''), text });
    if (text === 'busy') {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
      return res.end('{"error":{"message":"busy","type":"rate_limit_error","code":"rate_limit_exceeded"}}');
    }
    let finish;
    upstreamDone = new Promise((r) => { finish = r; });
    if (text === 'abort-once' && !aborted.has(json.messages.length)) {
      // the upstream turn breaks mid-stream (Hermes restart / reset): no answer, the record ends `aborted`
      aborted.add(json.messages.length);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-hermes-session-id': String(req.headers['x-hermes-session-id'] ?? '') });
      res.write(chunk({ role: 'assistant' }));
      await sleep(20);
      res.destroy();
      return finish();
    }
    if (text === 'late') await sleep(300);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'x-hermes-session-id': String(req.headers['x-hermes-session-id'] ?? '') });
    const n = text === 'big' ? 40 : 12;
    const pad = text === 'big' ? 'x'.repeat(4096) : '';
    res.write(chunk({ role: 'assistant' }));
    for (let i = 0; i < n; i++) {
      res.write(chunk({ content: `teil ${i} äöü ${pad}` }));
      await sleep(text === 'slow' || text === 'big' ? 25 : 2);
      if (res.destroyed) break;
    }
    res.write(chunk({}, 'stop'));
    res.end('data: [DONE]\n\n');
    finish();
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  ctx = createServer({
    HERMES_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`, BRIDGE_TOKEN: TOKEN,
    BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'heuristic', BRIDGE_RESUME_TURN_KB: '64',
  }, { logger: silentLogger, backend: null });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  port = ctx.server.address().port;
});
after(() => { ctx.push.stop(); for (const s of [ctx.server, upstream]) { s.closeAllConnections(); s.close(); } });

/**
 * POST a chat turn. `cutAfter`: destroy the connection once at least that many body bytes arrived.
 * @returns {Promise<{status: number, headers: any, body: Buffer, cut: boolean}>}
 */
function chat(text, { key, session = 'hui-resume-1', offset, cutAfter } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-hermes-session-id': session };
    if (key) headers['idempotency-key'] = key;
    if (offset !== undefined) headers['x-hermes-ui-resume-offset'] = String(offset);
    const req = http.request({ host: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST', headers, agent: false }, (res) => {
      const parts = [];
      let size = 0;
      let cut = false;
      res.on('data', (d) => {
        if (cut) return;
        parts.push(d);
        size += d.length;
        if (cutAfter !== undefined && size >= cutAfter) {
          cut = true;
          req.destroy();
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts), cut: true });
        }
      });
      res.on('end', () => { if (!cut) resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts), cut: false }); });
      res.on('error', () => { if (!cut) resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts), cut: true }); });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
    req.end(JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'user', content: text }] }));
  });
}

test('a keyed turn is marked resumable; the same key replays it byte for byte without a second Hermes turn', async () => {
  seen = [];
  const first = await chat('hallo', { key: 'turn-a-1' });
  assert.equal(first.status, 200);
  assert.equal(first.headers['x-hermes-ui-resume'], '1');
  assert.match(first.body.toString(), /data: \[DONE\]/);
  const again = await chat('hallo', { key: 'turn-a-1' });
  assert.equal(again.status, 200);
  assert.equal(again.headers['x-hermes-ui-resumed'], '0');
  assert.equal(again.headers['x-hermes-session-id'], 'hui-resume-1');
  assert.deepEqual(again.body, first.body, 'identical bytes, incl. the bridge route frame');
  assert.equal(seen.length, 1, 'Hermes saw one turn');
});

test('without Idempotency-Key nothing changes (no resume header, every request is a turn)', async () => {
  seen = [];
  const r = await chat('hallo');
  assert.equal(r.headers['x-hermes-ui-resume'], undefined);
  await chat('hallo');
  assert.equal(seen.length, 2);
});

test('lost stream: resume from the byte offset after the turn finished → the rest, exactly once', async () => {
  seen = [];
  const cut = await chat('slow', { key: 'turn-b-1', cutAfter: 300 });
  assert.ok(cut.cut);
  await upstreamDone; // the bridge kept the Hermes run going (detached)
  await sleep(20);
  const rest = await chat('slow', { key: 'turn-b-1', offset: cut.body.length });
  assert.equal(rest.status, 200);
  assert.equal(rest.headers['x-hermes-ui-resumed'], String(cut.body.length));
  const whole = Buffer.concat([cut.body, rest.body]).toString();
  for (let i = 0; i < 12; i++) assert.equal(whole.split(`teil ${i} `).length, 2, `chunk ${i} exactly once`);
  assert.match(whole, /data: \[DONE\]\n\n$/);
  assert.equal(seen.length, 1);
});

test('lost stream: resume while Hermes is still streaming → replay, then live, then the end', async () => {
  seen = [];
  const cut = await chat('slow', { key: 'turn-c-1', cutAfter: 200 });
  const rest = await chat('slow', { key: 'turn-c-1', offset: cut.body.length });
  assert.equal(rest.status, 200);
  const whole = Buffer.concat([cut.body, rest.body]).toString();
  for (let i = 0; i < 12; i++) assert.equal(whole.split(`teil ${i} `).length, 2, `chunk ${i} exactly once`);
  assert.match(whole, /data: \[DONE\]\n\n$/);
  assert.equal(seen.length, 1);
});

test('resume for an unknown key never starts a turn (409 resume_unavailable); bad offsets are refused', async () => {
  seen = [];
  const r = await chat('hallo', { key: 'never-sent', offset: 0 });
  assert.equal(r.status, 409);
  assert.equal(JSON.parse(r.body.toString()).error.code, 'resume_unavailable');
  const bad = await chat('hallo', { key: 'never-sent', offset: 'x' });
  assert.equal(bad.status, 400);
  await chat('hallo', { key: 'turn-d-1' });
  const beyond = await chat('hallo', { key: 'turn-d-1', offset: 10_000_000 });
  assert.equal(beyond.status, 409);
  assert.equal(seen.length, 1);
});

test('the same key for another session is a conflict, never a replay', async () => {
  seen = [];
  await chat('hallo', { key: 'turn-e-1', session: 'hui-resume-e1' });
  const r = await chat('hallo', { key: 'turn-e-1', session: 'hui-resume-e2' });
  assert.equal(r.status, 409);
  assert.equal(JSON.parse(r.body.toString()).error.code, 'idempotency_key_conflict');
  assert.equal(seen.length, 1);
});

test('a non-SSE answer (Hermes 429) drops the record: the retry with the same key is a new turn', async () => {
  seen = [];
  const r = await chat('busy', { key: 'turn-f-1' });
  assert.equal(r.status, 429);
  assert.equal(r.headers['x-hermes-ui-resume'], undefined);
  const again = await chat('hallo', { key: 'turn-f-1' });
  assert.equal(again.status, 200);
  assert.equal(seen.length, 2);
});

test('the same key while the first request is still starting → 409 idempotency_in_progress + Retry-After', async () => {
  seen = [];
  const first = chat('late', { key: 'turn-g-1' });
  await sleep(100);
  const dup = await chat('late', { key: 'turn-g-1' });
  assert.equal(dup.status, 409);
  assert.equal(JSON.parse(dup.body.toString()).error.code, 'idempotency_in_progress');
  assert.equal(dup.headers['retry-after'], '1');
  assert.equal((await first).status, 200);
  assert.equal(seen.length, 1);
});

test('a turn over the per-turn buffer stays live but is no longer resumable', async () => {
  seen = [];
  const cut = await chat('big', { key: 'turn-h-1', cutAfter: 1000 });
  await upstreamDone;
  await sleep(20);
  const r = await chat('big', { key: 'turn-h-1', offset: cut.body.length });
  assert.equal(r.status, 409);
  assert.equal(JSON.parse(r.body.toString()).error.code, UNRECORDED_CODE);
  const full = await chat('big', { key: 'turn-h-2' });
  assert.equal(full.status, 200);
  assert.match(full.body.toString(), /data: \[DONE\]/, 'the live stream itself is complete');
  assert.equal(seen.length, 2);
});

test('a turn whose upstream broke: a plain retry with the same key runs anew, a resume request still never does', async () => {
  seen = [];
  const first = await chat('abort-once', { key: 'turn-i-1' });
  assert.equal(first.status, 200);
  assert.doesNotMatch(first.body.toString(), /\[DONE\]/, 'the first stream broke');
  await sleep(20);
  const resume = await chat('abort-once', { key: 'turn-i-1', offset: first.body.length });
  assert.equal(resume.status, 409);
  assert.equal(JSON.parse(resume.body.toString()).error.code, 'resume_unavailable');
  assert.equal(seen.length, 1, 'a resume request never starts a turn');
  const retry = await chat('abort-once', { key: 'turn-i-1' });
  assert.equal(retry.status, 200);
  assert.equal(retry.headers['x-hermes-ui-resumed'], undefined, 'a new turn, not a re-attach');
  assert.equal(retry.headers['x-hermes-ui-resume'], '1');
  assert.match(retry.body.toString(), /data: \[DONE\]/);
  assert.equal(seen.length, 2);
  const again = await chat('abort-once', { key: 'turn-i-1' });
  assert.equal(again.headers['x-hermes-ui-resumed'], '0', 'the new turn is recorded under the key');
  assert.deepEqual(again.body, retry.body);
  assert.equal(seen.length, 2);
});

test('a finished turn over the buffer: the same key answers turn_unrecorded, never a second turn', async () => {
  seen = [];
  const cut = await chat('big', { key: 'turn-j-1', cutAfter: 1000 });
  assert.ok(cut.cut);
  await upstreamDone;
  await sleep(20);
  const retry = await chat('big', { key: 'turn-j-1' });
  assert.equal(retry.status, 409);
  assert.equal(JSON.parse(retry.body.toString()).error.code, UNRECORDED_CODE);
  assert.equal(seen.length, 1);
});

test('/bridge/status reports the resume store', async () => {
  const r = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/bridge/status', headers: { authorization: `Bearer ${TOKEN}` }, agent: false }, (res) => {
    const c = [];
    res.on('data', (d) => c.push(d));
    res.on('end', () => resolve(JSON.parse(Buffer.concat(c).toString())));
  }));
  assert.equal(r.resume.enabled, true);
  assert.equal(typeof r.resume.bytes, 'number');
});

test('replay store: header parsing', () => {
  assert.equal(idempotencyKey({ 'idempotency-key': ' turn-1 ' }), 'turn-1');
  assert.equal(idempotencyKey({ 'idempotency-key': 'a b' }), null);
  assert.equal(idempotencyKey({ 'idempotency-key': 'x'.repeat(256) }), null);
  assert.equal(idempotencyKey({}), null);
  assert.equal(resumeOffset({}), undefined);
  assert.equal(resumeOffset({ 'x-hermes-ui-resume-offset': '42' }), 42);
  assert.equal(resumeOffset({ 'x-hermes-ui-resume-offset': '-1' }), null);
});

test('replay store: total budget evicts finished records first, retention expires them', () => {
  let t = 0;
  const store = createReplayStore({ maxTurnBytes: 100, maxTotalBytes: 150, retainMs: 1000, now: () => t });
  const a = store.begin('s\0a', 'x');
  a.start({ status: 200, headers: {} });
  a.append(Buffer.alloc(80));
  a.end();
  const b = store.begin('s\0b', 'x');
  b.start({ status: 200, headers: {} });
  b.append(Buffer.alloc(80)); // needs room: the bytes of the finished `a` go, its key still never runs twice
  assert.equal(store.get('s\0a')?.resumable, false);
  assert.equal(store.get('s\0a').attach(/** @type {any} */ ({}), 0)?.code, UNRECORDED_CODE);
  assert.equal(b.resumable, true);
  const c = store.begin('s\0c', 'x');
  c.start({ status: 200, headers: {} });
  c.append(Buffer.alloc(80)); // only live `b` left: `c` cannot be buffered
  assert.equal(c.resumable, false);
  assert.equal(store.stats().bytes, 80);
  b.end();
  t = 5000;
  assert.equal(store.get('s\0b'), undefined, 'expired after retainMs');
  assert.equal(store.get('s\0a'), undefined, 'the byte-less entry expires as well');
  assert.equal(store.stats().bytes, 0);
});

test('replay store: an evicted broken turn is forgotten, only an aborted record is rerunnable', () => {
  const store = createReplayStore({ maxTurnBytes: 100, maxTotalBytes: 150 });
  const a = store.begin('s\0a', 'x');
  a.start({ status: 200, headers: {} });
  a.append(Buffer.alloc(80));
  assert.equal(store.rerunnable(a), false, 'live');
  a.end(true);
  assert.equal(store.rerunnable(a), true);
  assert.equal(a.attach(/** @type {any} */ ({}), 0)?.code, 'resume_unavailable');
  const b = store.begin('s\0b', 'x');
  b.start({ status: 200, headers: {} });
  b.append(Buffer.alloc(80));
  assert.equal(store.get('s\0a'), undefined);
  b.end();
  assert.equal(store.rerunnable(b), false, 'ended');
});
