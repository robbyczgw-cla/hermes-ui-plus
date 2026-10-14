// End-to-end tests: real HTTP bridge in front of a fake Hermes upstream.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { createSseParser } from '../src/sse.mjs';
import { silentLogger } from '../src/log.mjs';

const UP_KEY = 'upstream-secret';
const TOKEN = 'bridge-token';

// Upstream SSE body: Hermes-like frames incl. named events, keepalive comment, non-ASCII.
const SSE_PARTS = [
  'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
  ': keepalive\n\n',
  'event: hermes.tool.progress\ndata: {"tool":"web_search","emoji":"\\ud83d\\udd0d","label":"Suche","toolCallId":"t1","status":"running"}\n\n',
  'event: hermes.tool.progress\ndata: {"tool":"web_search","toolCallId":"t1","status":"completed"}\n\n',
  'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hier die Tabelle "},"finish_reason":null}]}\n\n',
  'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"– Grüße"},"finish_reason":null}]}\n\n',
  'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1}}\n\n',
  'data: [DONE]\n\n',
];
const SSE_BYTES = Buffer.from(SSE_PARTS.join(''));

const parseOr = (b) => { try { return b.length ? JSON.parse(b.toString()) : null; } catch { return b.toString(); } };
let upstream;
let upstreamUrl;
/** @type {any[]} */
let seen = [];
/** @type {(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => void} */
let behaviour;

before(async () => {
  upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: parseOr(body), req, res });
    behaviour(req, res, body);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
});
after(() => { upstream.close(); upstream.closeAllConnections(); });

/** Default upstream: SSE in awkward chunks (byte-split inside frames and UTF-8 sequences). */
function sseUpstream(sessionId = 'sess-123') {
  return (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no', 'x-hermes-session-id': req.headers['x-hermes-session-id'] || sessionId, 'x-hermes-session-key': 'app' });
    let i = 0;
    const sizes = [1, 3, 17, 64, 5, 200, 2, 9];
    const tick = () => {
      if (i >= SSE_BYTES.length) return res.end();
      const n = sizes[i % sizes.length];
      res.write(SSE_BYTES.subarray(i, i + n));
      i += n;
      setImmediate(tick);
    };
    tick();
  };
}

async function startBridge(env = {}, opts = {}) {
  const { server } = createServer({
    HERMES_BASE_URL: upstreamUrl, HERMES_API_KEY: UP_KEY, BRIDGE_TOKEN: TOKEN,
    BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'heuristic', BRIDGE_LOG_LEVEL: 'silent', BRIDGE_ROUTER_FASTPATH_MIN: 'off', ...env,
  }, { logger: silentLogger, ...opts });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function rawRequest(base, path, { method = 'POST', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

const chat = (messages, extra = {}) => ({ model: 'hermes-agent', stream: true, messages, ...extra });

test('SSE: route event first, then upstream bytes verbatim; headers both ways', async () => {
  seen = [];
  behaviour = sseUpstream();
  const { server, base } = await startBridge();
  try {
    const res = await rawRequest(base, '/v1/chat/completions', {
      headers: { 'x-hermes-session-id': 'sess-abc', 'x-hermes-session-key': 'app', 'idempotency-key': 'idem-1', origin: 'http://evil.test', cookie: 'a=b' },
      body: chat([{ role: 'user', content: 'Erstelle eine Tabelle der größten Seen' }]),
    });
    assert.equal(res.status, 200);
    const text = res.body.toString('latin1');
    const firstFrameEnd = text.indexOf('\n\n') + 2;
    const first = res.body.subarray(0, firstFrameEnd).toString();
    assert.match(first, /^event: hermes\.ui\.route\ndata: /);
    const decision = JSON.parse(first.split('\n')[1].slice(6));
    assert.equal(decision.format, 'table');
    assert.deepEqual(Object.keys(decision).sort(), ['confidence', 'format', 'model', 'ms', 'reason']);
    assert.ok(res.body.subarray(firstFrameEnd).equals(SSE_BYTES), 'upstream bytes must be forwarded unchanged');
    // response headers
    assert.equal(res.headers['x-hermes-session-id'], 'sess-abc');
    assert.equal(res.headers['x-hermes-session-key'], 'app');
    assert.equal(res.headers['content-type'], 'text/event-stream');
    assert.equal(res.headers['x-hermes-ui-bridge'], '1');
    assert.equal(JSON.parse(res.headers['x-hermes-ui-route']).format, 'table');
    // request headers seen upstream
    const up = seen[0];
    assert.equal(up.url, '/v1/chat/completions');
    assert.equal(up.headers.authorization, `Bearer ${UP_KEY}`);
    assert.equal(up.headers['x-hermes-session-id'], 'sess-abc');
    assert.equal(up.headers['x-hermes-session-key'], 'app');
    assert.equal(up.headers['idempotency-key'], 'idem-1');
    assert.equal(up.headers.origin, undefined);
    assert.equal(up.headers.cookie, undefined);
    // hint injected as system message, user message untouched
    assert.deepEqual(up.body.messages.map((m) => m.role), ['system', 'user']);
    assert.match(up.body.messages[0].content, /^UI-ROUTER-HINT: format=table confidence=0\.9$/);
    assert.equal(up.body.model, 'hermes-agent');
  } finally {
    server.close(); server.closeAllConnections();
  }
});

test('auth: bridge token required (not the Hermes key); /health is open', async () => {
  seen = [];
  behaviour = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"status":"ok"}'); };
  const { server, base } = await startBridge();
  try {
    const bad = await rawRequest(base, '/v1/models', { method: 'GET', headers: { authorization: `Bearer ${UP_KEY}` } });
    assert.equal(bad.status, 401);
    const none = await rawRequest(base, '/v1/chat/completions', { headers: { authorization: '' }, body: chat([{ role: 'user', content: 'x' }]) });
    assert.equal(none.status, 401);
    assert.equal(seen.length, 0);
    const health = await rawRequest(base, '/health', { method: 'GET', headers: { authorization: '' } });
    assert.equal(health.status, 200);
    assert.equal(health.body.toString(), '{"status":"ok"}');
    assert.equal(health.headers['x-hermes-ui-bridge'], '1');
    const models = await rawRequest(base, '/v1/models', { method: 'GET' });
    assert.equal(models.status, 200);
    assert.equal(seen.at(-1).headers.authorization, `Bearer ${UP_KEY}`);
    const status = await rawRequest(base, '/bridge/status', { method: 'GET' });
    assert.equal(JSON.parse(status.body).router.kind, 'heuristic');
  } finally {
    server.close(); server.closeAllConnections();
  }
});

test('bootstrap system message prepended once; stateless multi-turn gets no hint', async () => {
  seen = [];
  behaviour = sseUpstream();
  const { server, base } = await startBridge({ BRIDGE_BOOTSTRAP: 'on', BRIDGE_BOOTSTRAP_FILE: new URL('../../hermes-skill/bootstrap-system-message.txt', import.meta.url).pathname });
  try {
    await rawRequest(base, '/v1/chat/completions', { body: chat([{ role: 'user', content: 'Zeig das als Balkendiagramm: A 1, B 2, C 3' }]) });
    const m1 = seen[0].body.messages;
    assert.match(m1[0].content, /^\[hermes-ui-app\]/);
    assert.match(m1[1].content, /^UI-ROUTER-HINT: format=chart component=bar/);
    assert.equal(m1[2].role, 'user');
    // Header-less client resending history: Hermes derives the session id from the system
    // prompt, so the bridge must not vary it -> bootstrap only, no hint.
    await rawRequest(base, '/v1/chat/completions', { body: chat([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hallo' }, { role: 'user', content: 'Zeig das als Tabelle' }]) });
    const m2 = seen[1].body.messages;
    assert.equal(m2.filter((m) => m.role === 'system').length, 1);
    assert.ok(!m2.some((m) => /UI-ROUTER-HINT/.test(m.content)));
    // Client already sends the marker -> not duplicated.
    await rawRequest(base, '/v1/chat/completions', { headers: { 'x-hermes-session-id': 's1' }, body: chat([{ role: 'system', content: '[hermes-ui-app] Client: own' }, { role: 'user', content: 'Hallo' }]) });
    assert.equal(seen[2].body.messages.filter((m) => /\[hermes-ui-app\]/.test(m.content)).length, 1);
    // App notice "follow-ups off" (also marker-prefixed) is NOT a bootstrap: kept as sent, bootstrap still injected before it.
    const notice = '[hermes-ui-app] Follow-up suggestions are switched off in the app: do not add a suggestions block.';
    await rawRequest(base, '/v1/chat/completions', { headers: { 'x-hermes-session-id': 's1' }, body: chat([{ role: 'system', content: notice }, { role: 'user', content: 'Hallo' }]) });
    const m3 = seen[3].body.messages;
    assert.match(m3[0].content, /^\[hermes-ui-app\] Client:/);
    assert.equal(m3.filter((m) => m.content === notice).length, 1);
    assert.deepEqual(m3.at(-1), { role: 'user', content: 'Hallo' });
  } finally {
    server.close(); server.closeAllConnections();
  }
});

test('session memory: follow-up with only the new message is routed with prior turns', async () => {
  seen = [];
  behaviour = sseUpstream('sess-mem');
  const decisions = [];
  const backend = { id: 'spy', model: 'spy', decide: async (turns) => { decisions.push(turns); return { format: turns.length > 1 ? 'chart' : 'text', confidence: 0.9, reason: '' }; } };
  const { server, base } = await startBridge({ BRIDGE_ROUTER: 'openai', BRIDGE_ROUTER_BASE_URL: 'http://unused', BRIDGE_ROUTER_MODEL: 'x' }, { backend });
  try {
    await rawRequest(base, '/v1/chat/completions', { body: chat([{ role: 'user', content: 'E-Autos 2020-2025?' }]) });
    await rawRequest(base, '/v1/chat/completions', { headers: { 'x-hermes-session-id': 'sess-mem' }, body: chat([{ role: 'user', content: 'und jetzt als Diagramm' }]) });
    assert.deepEqual(decisions[1].map((t) => t.role), ['user', 'assistant', 'user']);
    assert.equal(decisions[1][1].content, 'Hier die Tabelle – Grüße');
    assert.equal(decisions[1][2].content, 'und jetzt als Diagramm');
  } finally {
    server.close(); server.closeAllConnections();
  }
});

test('router timeout: fallback decision still emitted before upstream bytes', async () => {
  seen = [];
  behaviour = sseUpstream();
  const backend = { id: 'slow', model: 'slow', decide: (_t, o) => new Promise((_r, rej) => o.signal.addEventListener('abort', () => rej(new Error('abort')))) };
  const { server, base } = await startBridge({ BRIDGE_ROUTER: 'openai', BRIDGE_ROUTER_BASE_URL: 'http://unused', BRIDGE_ROUTER_MODEL: 'x', BRIDGE_ROUTER_TIMEOUT_MS: '80' }, { backend });
  try {
    const t0 = performance.now();
    const res = await rawRequest(base, '/v1/chat/completions', { body: chat([{ role: 'user', content: 'Wie hoch ist der Mount Everest?' }]) });
    assert.ok(performance.now() - t0 < 1000);
    const d = JSON.parse(res.body.toString().split('\n')[1].slice(6));
    assert.equal(d.model, 'heuristic-v1');
    assert.match(d.reason, /fallback \(timeout\)/);
    // text with confidence < 0.75 -> no hint injected
    assert.equal(seen[0].body.messages.length, 1);
  } finally {
    server.close(); server.closeAllConnections();
  }
});

/** logger that records every line (to check the client_closed line) */
function captureLogger() {
  const lines = [];
  const rec = (level) => (msg, fields = {}) => lines.push({ level, msg, ...fields });
  return { lines, logger: { debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error') } };
}

/** POST a streaming chat, read the first bytes, then drop the connection (phone switches WiFi → LTE). */
function startAndDrop(base, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers } }, (res) => {
      res.once('data', () => { req.destroy(); resolve(); });
    });
    req.on('error', () => {});
    req.end(JSON.stringify(chat([{ role: 'user', content: 'Räum den Server auf' }])));
    setTimeout(() => reject(new Error('no data')), 2000);
  });
}

test('client disconnect mid-stream keeps the Hermes run going; one client_closed line without content', async () => {
  seen = [];
  let upstreamClosed = false;
  let finish;
  const finished = new Promise((r) => { finish = r; });
  behaviour = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(SSE_PARTS[0]);
    let n = 0;
    const iv = setInterval(() => {
      // keeps writing well after the client is gone (Hermes interrupts the agent when its connection closes)
      if (++n < 30) return void res.write(': keepalive\n\n');
      clearInterval(iv);
      res.end(SSE_PARTS.slice(4).join(''));
      finish();
    }, 10);
    res.on('close', () => { clearInterval(iv); upstreamClosed = !res.writableFinished; });
  };
  const { lines, logger } = captureLogger();
  const { server, base } = await startBridge({}, { logger });
  try {
    await startAndDrop(base, { 'x-hermes-session-id': 'hui-keep' });
    await Promise.race([finished, new Promise((_r, rej) => setTimeout(() => rej(new Error('upstream did not finish')), 3000))]);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(upstreamClosed, false, 'upstream must not be aborted by the client disconnect');
    const closed = lines.filter((l) => l.status === 'client_closed');
    assert.equal(closed.length, 1);
    assert.deepEqual(Object.keys(closed[0]).sort(), ['level', 'method', 'ms', 'msg', 'path', 'reqId', 'status', 'upstream']);
    assert.equal(closed[0].path, '/v1/chat/completions');
    assert.equal(closed[0].upstream, 'kept');
    assert.equal(typeof closed[0].ms, 'number');
    assert.match(closed[0].reqId, /^[0-9a-f]{8}$/);
    assert.ok(lines.some((l) => l.msg === 'upstream_done' && l.reqId === closed[0].reqId && l.status === 200));
    assert.doesNotMatch(JSON.stringify(lines), /Räum den Server|Hier die Tabelle/, 'no content in the logs');
  } finally {
    server.close(); server.closeAllConnections();
  }
});

test('POST /bridge/chat/stop ends the kept run of that session (the app\'s stop button)', async () => {
  seen = [];
  let upstreamClosed;
  const closed = new Promise((r) => { upstreamClosed = r; });
  behaviour = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(SSE_PARTS[0]);
    const iv = setInterval(() => res.write(': keepalive\n\n'), 10);
    res.on('close', () => { clearInterval(iv); upstreamClosed(); });
  };
  const { server, base } = await startBridge();
  try {
    await startAndDrop(base, { 'x-hermes-session-id': 'hui-stop' });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await rawRequest(base, '/bridge/chat/stop', { body: { sessionId: 'bad id!' } })).status, 400);
    const other = await rawRequest(base, '/bridge/chat/stop', { body: { sessionId: 'hui-other' } });
    assert.deepEqual(JSON.parse(other.body.toString()), { stopped: 0 });
    const r = await rawRequest(base, '/bridge/chat/stop', { body: { sessionId: 'hui-stop' } });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body.toString()), { stopped: 1 });
    await Promise.race([closed, new Promise((_r, rej) => setTimeout(() => rej(new Error('upstream not stopped')), 2000))]);
    assert.equal((await rawRequest(base, '/bridge/chat/stop', { headers: { authorization: 'Bearer nope' }, body: { sessionId: 'hui-stop' } })).status, 401);
  } finally {
    server.close(); server.closeAllConnections();
  }
});

test('client disconnect during routing: upstream is never called', async () => {
  seen = [];
  behaviour = sseUpstream();
  let started;
  const routing = new Promise((r) => { started = r; });
  const backend = { id: 'slow', model: 'slow', decide: (_t, o) => { started(); return new Promise((_r, rej) => o.signal.addEventListener('abort', () => rej(new Error('abort')))); } };
  const { server, base } = await startBridge({ BRIDGE_ROUTER: 'openai', BRIDGE_ROUTER_BASE_URL: 'http://unused', BRIDGE_ROUTER_MODEL: 'x', BRIDGE_ROUTER_TIMEOUT_MS: '5000' }, { backend });
  try {
    const req = http.request(`${base}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' } });
    req.on('error', () => {});
    req.end(JSON.stringify(chat([{ role: 'user', content: 'Hallo' }])));
    await routing;
    req.destroy();
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(seen.length, 0);
  } finally {
    server.close(); server.closeAllConnections();
  }
});

test('non-streaming JSON and upstream errors pass through unchanged (with route header)', async () => {
  seen = [];
  const json = '{"id":"x","choices":[{"index":0,"message":{"role":"assistant","content":"Hallo"},"finish_reason":"stop"}]}';
  behaviour = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json), 'x-hermes-session-id': 'nsid' }); res.end(json); };
  const { server, base } = await startBridge();
  try {
    const res = await rawRequest(base, '/v1/chat/completions', { body: chat([{ role: 'user', content: 'Hallo' }], { stream: false }) });
    assert.equal(res.body.toString(), json);
    assert.equal(res.headers['x-hermes-session-id'], 'nsid');
    assert.ok(res.headers['x-hermes-ui-route']);
    behaviour = (_req, res) => { res.writeHead(429, { 'content-type': 'application/json' }); res.end('{"error":{"message":"busy"}}'); };
    const busy = await rawRequest(base, '/v1/chat/completions', { body: chat([{ role: 'user', content: 'Hallo' }]) });
    assert.equal(busy.status, 429);
    assert.equal(busy.body.toString(), '{"error":{"message":"busy"}}');
    // invalid JSON body is forwarded untouched (Hermes answers 400)
    behaviour = (_req, res) => { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":{"message":"Invalid JSON in request body"}}'); };
    const invalid = await new Promise((resolve) => {
      const req = http.request(`${base}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); });
      req.end('{not json');
    });
    assert.equal(invalid, 400);
  } finally {
    server.close(); server.closeAllConnections();
  }
});

test('upstream down -> 502 OpenAI-style error', async () => {
  const { server } = createServer({ HERMES_BASE_URL: 'http://127.0.0.1:1/v1', BRIDGE_TOKEN: TOKEN, BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'heuristic' }, { logger: silentLogger });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const res = await rawRequest(`http://127.0.0.1:${server.address().port}`, '/v1/chat/completions', { body: chat([{ role: 'user', content: 'Hallo' }]) });
    assert.equal(res.status, 502);
    assert.equal(JSON.parse(res.body).error.code, 'upstream_unavailable');
  } finally {
    server.close(); server.closeAllConnections();
  }
});
