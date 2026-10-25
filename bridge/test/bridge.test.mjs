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
    assert.match(m1[1].content, /^\[hermes-ui-skill\] /); // skill core inline right after the bootstrap (src/skillInline.mjs)
    assert.match(m1[2].content, /^UI-ROUTER-HINT: format=chart component=bar/);
    assert.equal(m1[3].role, 'user');
    // Header-less client resending history: Hermes derives the session id from the system
    // prompt, so the bridge must not vary it -> bootstrap only, no hint.
    await rawRequest(base, '/v1/chat/completions', { body: chat([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hallo' }, { role: 'user', content: 'Zeig das als Tabelle' }]) });
    const m2 = seen[1].body.messages;
    assert.equal(m2.filter((m) => m.role === 'system').length, 2); // bootstrap + skill core, both constant
    assert.ok(!m2.some((m) => /^UI-ROUTER-HINT/.test(m.content)));
    // Client already sends the marker -> not duplicated.
    await rawRequest(base, '/v1/chat/completions', { headers: { 'x-hermes-session-id': 's1' }, body: chat([{ role: 'system', content: '[hermes-ui-app] Client: own' }, { role: 'user', content: 'Hallo' }]) });
    assert.equal(seen[2].body.messages.filter((m) => /^\[hermes-ui-app\]/.test(m.content)).length, 1);
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
function startAndDrop(base, headers = {}, prefix = '') {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${prefix}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers } }, (res) => {
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

/** Hermes v0.22.2 answers a run stop for a chat completion id with 409 (it only knows /v1/runs runs) */
const legacyRunStop = (req, res) => {
  if (!/\/v1\/runs\/[^/]+\/stop$/.test(String(req.url))) return false;
  res.writeHead(409, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Run is not active in this gateway process', type: 'invalid_request_error', code: 'run_not_active' } }));
  return true;
};

test('POST /bridge/chat/stop ends the kept run of that session (the app\'s stop button)', async () => {
  seen = [];
  let upstreamClosed;
  const closed = new Promise((r) => { upstreamClosed = r; });
  behaviour = (req, res) => {
    if (legacyRunStop(req, res)) return;
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
    // the run API was asked first (v0.22.2: 409), then the connection closed as before
    assert.deepEqual(seen.filter((x) => x.url.includes('/runs/')).map((x) => `${x.method} ${x.url}`), ['POST /v1/runs/c1/stop']);
    assert.equal((await rawRequest(base, '/bridge/chat/stop', { headers: { authorization: 'Bearer nope' }, body: { sessionId: 'hui-stop' } })).status, 401);
  } finally {
    server.close(); server.closeAllConnections();
  }
});

test('POST /bridge/chat/stop on Hermes v0.22.3+: POST /v1/runs/{chatcmpl}/stop ends the turn, the final chunk reaches the app', async () => {
  seen = [];
  const RUN = 'chatcmpl-0225stop';
  /** @type {http.ServerResponse|null} */
  let turn = null;
  let upstreamClosed = false;
  behaviour = (req, res) => {
    const url = String(req.url);
    if (url.endsWith('/stop')) {
      // v0.22.5 api_server_authority_runs.stop_run: 200 {run_id, status: stopping, admission_id}; the stream then ends
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ run_id: RUN, status: 'stopping', admission_id: 'adm_test_0001' }));
      setTimeout(() => {
        turn?.end(`data: {"id":"${RUN}","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"cancelled"}],"hermes":{"completed":false,"partial":false,"failed":false,"error":"","error_code":"agent_error"}}\n\ndata: [DONE]\n\n`);
      }, 30);
      return;
    }
    turn = res;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'x-hermes-session-id': 'hui-0225' });
    res.write(`data: {"id":"${RUN}","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n`);
    res.write(`data: {"id":"${RUN}","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Teil"},"finish_reason":null}]}\n\n`);
    // v0.22.3+: a closed connection does NOT stop the turn, so keep writing until stopped
    const iv = setInterval(() => { if (!res.writableEnded) res.write(': keepalive\n\n'); }, 10);
    res.on('close', () => { clearInterval(iv); upstreamClosed = !res.writableFinished; });
  };
  const { server, base } = await startBridge();
  try {
    // the app keeps reading its stream while it presses stop
    const body = new Promise((resolve, reject) => {
      const req = http.request(`${base}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-hermes-session-id': 'hui-0225' } }, (res) => {
        const c = [];
        res.on('data', (d) => c.push(d));
        res.on('end', () => resolve(Buffer.concat(c).toString()));
      });
      req.on('error', reject);
      req.end(JSON.stringify(chat([{ role: 'user', content: 'lang' }])));
    });
    await new Promise((r) => setTimeout(r, 80));
    const r = await rawRequest(base, '/bridge/chat/stop', { body: { sessionId: 'hui-0225' } });
    assert.deepEqual(JSON.parse(r.body.toString()), { stopped: 1 });
    const text = await body;
    assert.match(text, /"finish_reason":"cancelled"/, 'Hermes\' own end of the turn reaches the app');
    assert.match(text, /data: \[DONE\]/);
    assert.equal(upstreamClosed, false, 'the turn ended by itself, the bridge did not cut it');
    const stopCall = seen.find((x) => String(x.url).endsWith('/stop'));
    assert.equal(stopCall.url, `/v1/runs/${RUN}/stop`);
    assert.equal(stopCall.method, 'POST');
    assert.equal(stopCall.headers.authorization, `Bearer ${UP_KEY}`);
  } finally {
    server.close(); server.closeAllConnections();
  }
});

test('POST /bridge/chat/stop: an accepted run stop whose stream lingers is closed after the grace time', async () => {
  seen = [];
  let closedAt = 0;
  behaviour = (req, res) => {
    if (String(req.url).endsWith('/stop')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"status":"stopping"}');
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"id":"chatcmpl-linger","choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n');
    const iv = setInterval(() => res.write(': keepalive\n\n'), 20);
    res.on('close', () => { clearInterval(iv); closedAt = Date.now(); });
  };
  const { server, base } = await startBridge();
  try {
    await startAndDrop(base, { 'x-hermes-session-id': 'hui-linger' });
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    assert.deepEqual(JSON.parse((await rawRequest(base, '/bridge/chat/stop', { body: { sessionId: 'hui-linger' } })).body.toString()), { stopped: 1 });
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(closedAt, 0, 'not cut right after the accepted stop');
    for (let i = 0; i < 60 && !closedAt; i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(closedAt - t0 >= 2500, `closed after the grace time (${closedAt - t0} ms)`);
  } finally {
    server.close(); server.closeAllConnections();
  }
});

test('POST /bridge/chat/stop is scoped to the profile: the same session id in another profile keeps running', async () => {
  seen = [];
  /** @type {Set<string>} upstream paths of the runs still streaming */
  const running = new Set();
  behaviour = (req, res) => {
    if (legacyRunStop(req, res)) return;
    const url = String(req.url);
    running.add(url);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(SSE_PARTS[0]);
    const iv = setInterval(() => res.write(': keepalive\n\n'), 10);
    res.on('close', () => { clearInterval(iv); running.delete(url); });
  };
  const { server, base } = await startBridge({ BRIDGE_PROFILES: 'writer,reader', HERMES_HOME: '/nonexistent-hermes-home-test' });
  const settle = () => new Promise((r) => setTimeout(r, 50));
  const stop = async (body) => {
    const r = await rawRequest(base, '/bridge/chat/stop', { body });
    return { status: r.status, body: JSON.parse(r.body.toString()) };
  };
  try {
    const sid = { 'x-hermes-session-id': 'hui-same' };
    await startAndDrop(base, sid);
    await startAndDrop(base, sid, '/p/writer');
    await startAndDrop(base, sid, '/p/reader');
    await settle();
    assert.deepEqual([...running].sort(), ['/p/reader/v1/chat/completions', '/p/writer/v1/chat/completions', '/v1/chat/completions']);

    assert.deepEqual(await stop({ sessionId: 'hui-same', profile: 'writer' }), { status: 200, body: { stopped: 1 } });
    await settle();
    assert.deepEqual([...running].sort(), ['/p/reader/v1/chat/completions', '/v1/chat/completions'], 'only the writer run stopped');

    assert.deepEqual(await stop({ sessionId: 'hui-same' }), { status: 200, body: { stopped: 1 } }, 'no profile = the default profile');
    await settle();
    assert.deepEqual([...running], ['/p/reader/v1/chat/completions']);

    assert.deepEqual(await stop({ sessionId: 'hui-same', profile: 'nope' }), { status: 200, body: { stopped: 0 } });
    assert.equal((await stop({ sessionId: 'hui-same', profile: 'Bad/Name' })).status, 400);
    assert.equal((await stop({ sessionId: 'hui-same', profile: 7 })).status, 400);
    assert.deepEqual(await stop({ sessionId: 'hui-same', profile: 'reader' }), { status: 200, body: { stopped: 1 } });
    await settle();
    assert.equal(running.size, 0);
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
