// Hermes v0.22.3+ (unified gateway, session authority) vs v0.22.2 through the bridge: approval answers get the turn's
// execution_generation, run status gets the legacy `approval` object, and nothing changes for v0.22.2.
// Shapes from the v0.22.5 source: gateway/session_api_turn.py (stream approval sink), api_server_authority_runs.py
// (respond_run: body exactly {request_id, execution_generation, choice}; run_projection: pending_controls[]).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { createApprovalWatcher } from '../src/approvals.mjs';
import { silentLogger } from '../src/log.mjs';

const UP_KEY = 'upstream-secret-test';
const TOKEN = 'bridge-token-test';
const RUN = 'chatcmpl-0225fake0001';

/** approval.request as v0.22.5 streams it on /v1/chat/completions */
const REQ_0225 = {
  execution_generation: 3, command: 'sudo -n -s true', description: 'run as root', timeout_s: 300,
  request_id: 'prompt-test-0001', allow_session: true, allow_permanent: true,
  event: 'approval.request', run_id: RUN, timestamp: 1_800_000_000.5, session_id: 'sess-0225', choices: ['once', 'session', 'always', 'deny'],
};
/** the same request as v0.22.2 streams it (no generation, pattern keys) */
const REQ_0222 = {
  command: 'sudo -n -s true', pattern_key: 'sudo', pattern_keys: ['sudo'], description: 'run as root', allow_permanent: true, allow_session: true,
  request_id: 'req-test-0222', event: 'approval.request', run_id: RUN, timestamp: 1_800_000_000.5, choices: ['once', 'session', 'always', 'deny'], session_id: 'sess-0222',
};
const sse = (req) => [
  `data: {"id":"${RUN}","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n`,
  `event: approval.request\ndata: ${JSON.stringify(req)}\n\n`,
];

let upstream;
let upstreamUrl;
/** @type {{method: string, url: string, body: string}[]} */
let seen = [];
/** @type {(req: http.IncomingMessage, res: http.ServerResponse, body: string) => void} */
let behaviour;
/** open turn streams, ended in each test's cleanup */
const turns = new Set();

before(async () => {
  upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    seen.push({ method: String(req.method), url: String(req.url), body });
    behaviour(req, res, body);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
});
after(() => { upstream.close(); upstream.closeAllConnections(); });

async function startBridge() {
  const { server } = createServer({
    HERMES_BASE_URL: upstreamUrl, HERMES_API_KEY: UP_KEY, BRIDGE_TOKEN: TOKEN,
    BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'off', BRIDGE_LOG_LEVEL: 'silent',
  }, { logger: silentLogger });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close() { for (const t of turns) t.end(); turns.clear(); server.close(); server.closeAllConnections(); },
  };
}

function call(base, path, { method = 'POST', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...headers } }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(c).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** Start a streamed turn whose upstream sends `frames` and stays open; resolves once the app saw the approval */
function openTurn(base, sessionId) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-hermes-session-id': sessionId } }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; if (text.includes('approval.request')) resolve(() => req.destroy()); });
    });
    req.on('error', () => {});
    req.end(JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'user', content: 'sudo bitte' }] }));
    setTimeout(() => reject(new Error('no approval on the stream')), 2000);
  });
}

/** fake Hermes: a turn streams `frames` and stays open; the answer route replies like v0.22.5 / v0.22.2 */
function hermes(frames, { version, runStatus = null }) {
  return (req, res, body) => {
    const url = String(req.url);
    if (url.endsWith('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-hermes-session-id': String(req.headers['x-hermes-session-id'] ?? '') });
      for (const f of frames) res.write(f);
      turns.add(res);
      return;
    }
    if (url.endsWith('/approval')) {
      const j = JSON.parse(body || '{}');
      if (version === '0.22.5') {
        const exact = Object.keys(j).sort().join(',') === 'choice,execution_generation,request_id';
        res.writeHead(exact ? 200 : 400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(exact ? { run_id: RUN, status: 'resolved', prompt_id: j.request_id } : { error: { message: 'invalid_params', type: 'invalid_request_error', code: 'invalid_params' } }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ object: 'hermes.run.approval_response', run_id: RUN, choice: j.choice, request_id: j.request_id, resolved: 1 }));
    }
    if (req.method === 'GET' && /\/v1\/runs\/[^/]+$/.test(url)) {
      res.writeHead(runStatus ? 200 : 404, { 'content-type': 'application/json', date: new Date(1_800_000_100_000).toUTCString() });
      return res.end(runStatus ? JSON.stringify(runStatus) : '{"error":{"message":"not found","code":"not_found"}}');
    }
    res.writeHead(404);
    res.end();
  };
}

test('v0.22.5: an older app answer {choice, request_id} goes upstream as exactly {request_id, execution_generation, choice}', async () => {
  seen = [];
  behaviour = hermes(sse(REQ_0225), { version: '0.22.5' });
  const b = await startBridge();
  try {
    await openTurn(b.base, 'sess-0225');
    const r = await call(b.base, `/v1/runs/${RUN}/approval`, { body: JSON.stringify({ choice: 'deny', request_id: REQ_0225.request_id }) });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(JSON.parse(r.text), { run_id: RUN, status: 'resolved', prompt_id: REQ_0225.request_id });
    const posts = seen.filter((x) => x.url.endsWith('/approval'));
    assert.equal(posts.length, 1);
    assert.deepEqual(JSON.parse(posts[0].body), { request_id: REQ_0225.request_id, execution_generation: 3, choice: 'deny' });
    assert.equal(seen.filter((x) => x.method === 'GET').length, 0, 'generation from the stream, no lookup');
  } finally { b.close(); }
});

test('v0.22.5: an answer without request_id is the oldest pending request of that run (what v0.22.2 resolved)', async () => {
  seen = [];
  behaviour = hermes(sse(REQ_0225), { version: '0.22.5' });
  const b = await startBridge();
  try {
    await openTurn(b.base, 'sess-0225');
    const r = await call(b.base, `/v1/runs/${RUN}/approval`, { body: '{"choice":"once"}' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(JSON.parse(seen.find((x) => x.url.endsWith('/approval')).body), { request_id: REQ_0225.request_id, execution_generation: 3, choice: 'once' });
  } finally { b.close(); }
});

test('v0.22.5: an answer with execution_generation already set (a new app) is forwarded byte for byte', async () => {
  seen = [];
  behaviour = hermes(sse(REQ_0225), { version: '0.22.5' });
  const b = await startBridge();
  try {
    await openTurn(b.base, 'sess-0225');
    const sent = `{"request_id":"${REQ_0225.request_id}","execution_generation":3,"choice":"once"}`;
    assert.equal((await call(b.base, `/v1/runs/${RUN}/approval`, { body: sent })).status, 200);
    assert.equal(seen.find((x) => x.url.endsWith('/approval')).body, sent);
  } finally { b.close(); }
});

test('v0.22.5: the bridge missed the stream (restart): the generation comes from GET /v1/runs/{id} pending_controls', async () => {
  seen = [];
  behaviour = hermes([], {
    version: '0.22.5',
    runStatus: {
      pending_controls: [{ kind: 'approval', prompt_id: 'prompt-test-0002', execution_generation: 7, command: 'rm -rf build/', description: 'recursive delete', choices: ['once', 'session', 'always', 'deny'], timeout_s: 300 }],
      run_id: RUN, status: 'waiting_for_approval', session_id: 'sess-0225', admission_id: 'adm_test_0002', execution_generation: 7, output: '', usage: {},
    },
  });
  const b = await startBridge();
  try {
    const r = await call(b.base, `/v1/runs/${RUN}/approval`, { body: '{"choice":"always","request_id":"prompt-test-0002"}' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(seen.map((x) => `${x.method} ${x.url}`), [`GET /v1/runs/${RUN}`, `POST /v1/runs/${RUN}/approval`]);
    assert.deepEqual(JSON.parse(seen[1].body), { request_id: 'prompt-test-0002', execution_generation: 7, choice: 'always' });
  } finally { b.close(); }
});

test('v0.22.2: the answer is forwarded unchanged and nothing is looked up (the watcher saw no generation)', async () => {
  seen = [];
  behaviour = hermes(sse(REQ_0222), { version: '0.22.2' });
  const b = await startBridge();
  try {
    await openTurn(b.base, 'sess-0222');
    const sent = `{"choice":"once","request_id":"${REQ_0222.request_id}"}`;
    const r = await call(b.base, `/v1/runs/${RUN}/approval`, { body: sent });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.text).resolved, 1);
    assert.equal(seen.find((x) => x.url.endsWith('/approval')).body, sent, 'byte-identical');
    assert.equal(seen.filter((x) => x.method === 'GET').length, 0);
  } finally { b.close(); }
});

test('GET /v1/runs/{id} on v0.22.5: pending_controls also as the legacy `approval` object; Date header kept', async () => {
  seen = [];
  const status = {
    pending_controls: [{ kind: 'approval', prompt_id: 'prompt-test-0003', execution_generation: 4, command: 'sudo reboot', description: 'reboot', choices: ['once', 'deny'], timeout_s: 120 }],
    run_id: RUN, status: 'waiting_for_approval', session_id: 'sess-0225', admission_id: 'adm_test_0003', execution_generation: 4, output: '', usage: {},
  };
  behaviour = hermes([], { version: '0.22.5', runStatus: status });
  const b = await startBridge();
  try {
    const r = await call(b.base, `/v1/runs/${RUN}`, { method: 'GET' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.date, new Date(1_800_000_100_000).toUTCString());
    const j = JSON.parse(r.text);
    assert.deepEqual(j.pending_controls, status.pending_controls, 'the original fields stay');
    assert.deepEqual(j.approval, {
      execution_generation: 4, command: 'sudo reboot', description: 'reboot', choices: ['once', 'deny'], timeout_s: 120,
      event: 'approval.request', run_id: RUN, request_id: 'prompt-test-0003', session_id: 'sess-0225',
    });
    assert.equal(Number(r.headers['content-length']), Buffer.byteLength(r.text));
  } finally { b.close(); }
});

test('GET /v1/runs/{id}: v0.22.2 answers (with `approval`, or 404) pass through byte for byte', async () => {
  seen = [];
  const legacy = { object: 'hermes.run', run_id: RUN, status: 'waiting_for_approval', last_event: 'approval.request', approval: REQ_0222 };
  behaviour = hermes([], { version: '0.22.2', runStatus: legacy });
  let b = await startBridge();
  try {
    const r = await call(b.base, `/v1/runs/${RUN}`, { method: 'GET' });
    assert.equal(r.text, JSON.stringify(legacy));
  } finally { b.close(); }
  behaviour = hermes([], { version: '0.22.2', runStatus: null });
  b = await startBridge();
  try {
    const r = await call(b.base, `/v1/runs/${RUN}`, { method: 'GET' });
    assert.equal(r.status, 404);
    assert.equal(r.text, '{"error":{"message":"not found","code":"not_found"}}');
  } finally { b.close(); }
});

test('watcher: v0.22.5 sends no approval.responded; the passed-through answer still resolves the inbox card', () => {
  const resolved = [];
  const w = createApprovalWatcher({ onRequest: () => {}, onResolved: (ev) => resolved.push(ev), timeoutMs: 60_000 });
  const obs = w.observe({ sessionId: () => 'sess-0225', profile: null });
  obs.push(Buffer.from(sse(REQ_0225).join('')));
  assert.equal(w.pending(), 1);
  assert.equal(w.answered(RUN, { request_id: REQ_0225.request_id, execution_generation: 3, choice: 'deny' }), true);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].requestId, REQ_0225.request_id);
  assert.equal(resolved[0].choice, 'deny');
  w.stop();
});

test('watcher.answerBody: profile-scoped, invalid input untouched', async () => {
  const w = createApprovalWatcher({ onRequest: () => {}, onResolved: () => {}, timeoutMs: 60_000 });
  w.observe({ sessionId: () => 's', profile: 'writer' }).push(Buffer.from(sse(REQ_0225).join('')));
  assert.equal(await w.answerBody(RUN, { choice: 'once', request_id: REQ_0225.request_id }, null), null, 'other profile: unknown, no lookup given');
  assert.deepEqual((await w.answerBody(RUN, { choice: 'once', request_id: REQ_0225.request_id }, 'writer'))?.body, { request_id: REQ_0225.request_id, execution_generation: 3, choice: 'once' });
  assert.equal(await w.answerBody('chatcmpl-other', { choice: 'once', request_id: REQ_0225.request_id }, 'writer'), null, 'another run');
  assert.equal(await w.answerBody(RUN, { choice: 'rm -rf', request_id: REQ_0225.request_id }, 'writer'), null, 'odd choice: Hermes answers it');
  assert.equal(await w.answerBody(RUN, [], 'writer'), null);
  w.stop();
});
