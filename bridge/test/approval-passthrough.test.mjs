// Approval path through the bridge (team A): `approval.request` SSE frames, POST /v1/runs/{id}/approval and
// GET /v1/runs/{id} must reach the app / Hermes unchanged (only the auth header is swapped for the upstream key).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';

const UP_KEY = 'upstream-secret';
const TOKEN = 'bridge-token';
const RUN = 'chatcmpl-ap1';

const APPROVAL = {
  command: 'rm -rf build/',
  pattern_key: 'rm -rf',
  pattern_keys: ['rm -rf'],
  description: 'recursive delete',
  allow_permanent: true,
  allow_session: true,
  request_id: 'f3b2c1d0e9a84b7c',
  event: 'approval.request',
  run_id: RUN,
  timestamp: 1_800_000_000.25,
  choices: ['once', 'session', 'always', 'deny'],
  session_id: 'sess-ap',
};
const SSE_PARTS = [
  `data: {"id":"${RUN}","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n`,
  'event: hermes.tool.progress\ndata: {"tool":"terminal","emoji":"💻","label":"rm -rf build/","toolCallId":"t1","status":"running"}\n\n',
  `event: approval.request\ndata: ${JSON.stringify(APPROVAL)}\n\n`,
  ': keepalive\n\n',
  `event: approval.request\ndata: ${JSON.stringify({ ...APPROVAL, request_id: 'second-req', command: 'sudo reboot', choices: ['once', 'deny'], smart_denied: true })}\n\n`,
  `data: {"id":"${RUN}","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Erledigt – Grüße"},"finish_reason":"stop"}]}\n\n`,
  'data: [DONE]\n\n',
];
const SSE_BYTES = Buffer.from(SSE_PARTS.join(''));

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
    seen.push({ method: req.method, url: req.url, headers: req.headers, raw: body });
    behaviour(req, res, body);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
});
after(() => {
  upstream.close();
  upstream.closeAllConnections();
});

async function startBridge() {
  const { server } = createServer(
    {
      HERMES_BASE_URL: upstreamUrl, HERMES_API_KEY: UP_KEY, BRIDGE_TOKEN: TOKEN,
      BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'heuristic', BRIDGE_LOG_LEVEL: 'silent', BRIDGE_ROUTER_FASTPATH_MIN: 'off',
    },
    { logger: silentLogger },
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function rawRequest(base, path, { method = 'POST', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body !== undefined ? body : undefined);
  });
}

test('SSE: approval.request frames (two parallel requests) reach the app byte for byte', async () => {
  seen = [];
  behaviour = (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-hermes-session-id': 'sess-ap' });
    // awkward chunking: split inside the approval JSON and inside a UTF-8 sequence
    let i = 0;
    const sizes = [7, 1, 300, 3, 41];
    const tick = () => {
      if (i >= SSE_BYTES.length) return res.end();
      const n = sizes[i % sizes.length];
      res.write(SSE_BYTES.subarray(i, i + n));
      i += n;
      setImmediate(tick);
    };
    tick();
  };
  const { server, base } = await startBridge();
  try {
    const res = await rawRequest(base, '/v1/chat/completions', {
      headers: { 'x-hermes-session-id': 'sess-ap' },
      body: JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'user', content: 'räum build auf' }] }),
    });
    assert.equal(res.status, 200);
    const text = res.body.toString('latin1');
    const firstEnd = text.indexOf('\n\n') + 2;
    assert.match(res.body.subarray(0, firstEnd).toString(), /^event: hermes\.ui\.route\n/, 'only the route event is added in front');
    assert.ok(res.body.subarray(firstEnd).equals(SSE_BYTES), 'upstream bytes incl. approval.request must be forwarded unchanged');
    assert.equal(seen[0].headers.authorization, `Bearer ${UP_KEY}`, 'same upstream key = same run owner on Hermes');
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

test('POST /v1/runs/{id}/approval: path, body and the answer (200 and 409) pass through unchanged', async () => {
  const okBody = Buffer.from(JSON.stringify({ object: 'hermes.run.approval_response', run_id: RUN, choice: 'once', request_id: APPROVAL.request_id, resolved: 1 }));
  const goneBody = Buffer.from(JSON.stringify({ error: { message: `Run has no pending approval: ${RUN}`, type: 'invalid_request_error', code: 'approval_not_pending' } }));
  let reply = { status: 200, body: okBody };
  seen = [];
  behaviour = (req, res) => {
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(reply.body);
  };
  const { server, base } = await startBridge();
  try {
    const sent = `{"choice":"once","request_id":"${APPROVAL.request_id}"}`;
    const res = await rawRequest(base, `/v1/runs/${RUN}/approval`, { body: sent });
    assert.equal(res.status, 200);
    assert.ok(res.body.equals(okBody));
    // the bridge never saw this request on a stream: it asks the run status for a v0.22.3+ generation (none here)
    assert.deepEqual(seen.map((x) => `${x.method} ${x.url}`), [`GET /v1/runs/${RUN}`, `POST /v1/runs/${RUN}/approval`]);
    seen = seen.filter((x) => x.method === 'POST');
    const up = seen[0];
    assert.equal(up.method, 'POST');
    assert.equal(up.url, `/v1/runs/${RUN}/approval`);
    assert.equal(up.raw.toString(), sent, 'body byte-identical');
    assert.equal(up.headers.authorization, `Bearer ${UP_KEY}`);
    assert.equal(up.headers['content-type'], 'application/json');

    reply = { status: 409, body: goneBody };
    const late = await rawRequest(base, `/v1/runs/${RUN}/approval`, { body: '{"choice":"always","request_id":"x"}' });
    assert.equal(late.status, 409);
    assert.ok(late.body.equals(goneBody), 'Hermes error code reaches the app (approval_not_pending)');
    assert.equal(seen.filter((x) => x.method === 'POST')[1].raw.toString(), '{"choice":"always","request_id":"x"}');

    // without the bridge token nothing reaches Hermes
    const n = seen.length;
    const denied = await rawRequest(base, `/v1/runs/${RUN}/approval`, { body: sent, headers: { authorization: `Bearer ${UP_KEY}` } });
    assert.equal(denied.status, 401);
    assert.equal(seen.length, n);
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

test('GET /v1/runs/{id}: waiting_for_approval status (restore after a lost stream) passes through with its Date header', async () => {
  const status = Buffer.from(JSON.stringify({ object: 'hermes.run', run_id: RUN, status: 'waiting_for_approval', last_event: 'approval.request', approval: APPROVAL }));
  const date = new Date(1_800_000_100_000).toUTCString();
  seen = [];
  behaviour = (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', date });
    res.end(status);
  };
  const { server, base } = await startBridge();
  try {
    const res = await rawRequest(base, `/v1/runs/${RUN}`, { method: 'GET' });
    assert.equal(res.status, 200);
    assert.ok(res.body.equals(status));
    assert.equal(res.headers.date, date, 'server clock for restored deadlines');
    assert.equal(seen[0].method, 'GET');
    assert.equal(seen[0].url, `/v1/runs/${RUN}`);
    assert.equal(seen[0].headers.authorization, `Bearer ${UP_KEY}`);
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
