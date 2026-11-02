// A bot's turn in the background (0.3: GET /bridge/bots/activity, "<Name> is working" card with Stop) on Hermes
// v0.22.3+ (0.2.2: Stop is POST /v1/runs/{chatcmpl}/stop, a closed connection does not end the turn). Both live on the
// same tracked turn in bridge.mjs: the activity entry and the run entry with its run id.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';

const UP_KEY = 'upstream-secret-test';
const TOKEN = 'bridge-token-test';
const RUN = 'chatcmpl-botstopfake01';
const closers = [];
after(() => { for (const c of closers.reverse()) c(); });
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const progress = (o) => `event: hermes.tool.progress\ndata: ${JSON.stringify(o)}\n\n`;

/** v0.22.5-like upstream: turns keep streaming after the client is gone, only a run stop ends them */
async function fakeHermes(o = {}) {
  const seen = [];
  const s = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const url = String(req.url);
    seen.push(`${req.method} ${url}`);
    if (/\/v1\/runs\/[^/]+\/approval$/.test(url)) {
      s.answers.push(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ run_id: RUN, status: 'resolved', prompt_id: 'prompt-test-0001' }));
      return;
    }
    const stop = /^(\/p\/[a-z0-9_-]+)?\/v1\/runs\/([^/]+)\/stop$/.exec(url);
    if (stop) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ run_id: stop[2], status: 'stopping' }));
      const turn = s.turns.get(stop[2]);
      setTimeout(() => turn?.end(`data: {"id":"${RUN}","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"cancelled"}]}\n\ndata: [DONE]\n\n`), 20);
      return;
    }
    if (/\/v1\/chat\/completions$/.test(url)) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-hermes-session-id': String(req.headers['x-hermes-session-id']) });
      res.write(`data: {"id":"${RUN}","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n`);
      res.write(progress({ tool: 'terminal', toolCallId: 'c1', status: 'running', label: 'make test' }));
      if (o.approval) res.write(`event: approval.request\ndata: ${JSON.stringify(o.approval)}\n\n`);
      s.turns.set(RUN, res);
      const iv = setInterval(() => { if (!res.writableEnded) res.write(': keepalive\n\n'); }, 10);
      res.on('close', () => clearInterval(iv));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{}');
  });
  s.turns = new Map();
  s.answers = [];
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  closers.push(() => { s.close(); s.closeAllConnections(); });
  return { url: `http://127.0.0.1:${s.address().port}`, seen, answers: s.answers };
}

test('a detached bot turn is listed as working, Stop from the card ends it through /p/<bot>/v1/runs/{id}/stop, then it is gone', async () => {
  const up = await fakeHermes();
  const { server, activity: tracker } = createServer({
    HERMES_BASE_URL: up.url, HERMES_API_KEY: UP_KEY, BRIDGE_TOKEN: TOKEN, BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'off',
    BRIDGE_PROFILES: 'writer', BRIDGE_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'hui-botstop-')), BRIDGE_PUSH: 'off',
  }, { logger: silentLogger });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  closers.push(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
  const turnsOf = async () => {
    const r = await (await fetch(`${base}/bridge/bots/activity`, { headers: auth })).json();
    return r.data.map((d) => [d.bot, d.turns.map((t) => [t.sessionId, t.steps.map((s) => s.state)])]);
  };

  // the phone starts a turn of the writer bot and goes away: the run stays (detached)
  const ac = new AbortController();
  const done = fetch(`${base}/p/writer/v1/chat/completions`, {
    method: 'POST', signal: ac.signal, headers: { ...auth, 'x-hermes-session-id': 'hui-botstop' },
    body: JSON.stringify({ model: 'hermes', stream: true, messages: [{ role: 'user', content: 'tests' }] }),
  }).then(async (r) => { for await (const _ of r.body) { /* read */ } }).catch(() => {});
  const listed = [['writer', [['hui-botstop', ['running']]]]];
  const seesTurn = async () => { for (let i = 0; i < 300 && JSON.stringify(await turnsOf()) !== JSON.stringify(listed); i++) await tick(); };
  await seesTurn();
  ac.abort();
  await done;
  await tick();
  assert.deepEqual(await turnsOf(), listed, 'listed while detached');

  // Stop on the "<Name> is working" card (app: stopBridgeTurn) = POST /bridge/chat/stop {sessionId, profile}
  const r = await fetch(`${base}/bridge/chat/stop`, { method: 'POST', headers: auth, body: JSON.stringify({ sessionId: 'hui-botstop', profile: 'writer' }) });
  assert.deepEqual(await r.json(), { stopped: 1 });
  assert.ok(up.seen.includes(`POST /p/writer/v1/runs/${RUN}/stop`), `run stop under the bot's prefix: ${up.seen.join(', ')}`);
  for (let i = 0; i < 600 && tracker.running() > 0; i++) await tick(25);
  assert.deepEqual(await turnsOf(), [], 'the stopped turn left the activity list');
  assert.equal(tracker.running(), 0);
});

test('v0.22.5: an approval of a detached bot turn reaches the bot with its generation, the turn stays listed as working', async () => {
  const REQUEST = 'prompt-test-0001';
  const up = await fakeHermes({ approval: { request_id: REQUEST, execution_generation: 3, event: 'approval.request', run_id: RUN, command: 'sudo -n true', choices: ['once', 'deny'] } });
  const { server } = createServer({
    HERMES_BASE_URL: up.url, HERMES_API_KEY: UP_KEY, BRIDGE_TOKEN: TOKEN, BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'off',
    BRIDGE_PROFILES: 'writer', BRIDGE_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'hui-botstop-')), BRIDGE_PUSH: 'off',
  }, { logger: silentLogger });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  closers.push(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
  const turnsOf = async () => {
    const r = await (await fetch(`${base}/bridge/bots/activity`, { headers: auth })).json();
    return JSON.stringify(r.data.map((d) => [d.bot, d.turns.map((t) => t.sessionId)]));
  };
  const listed = JSON.stringify([['writer', ['hui-botapproval']]]);

  const ac = new AbortController();
  const done = fetch(`${base}/p/writer/v1/chat/completions`, {
    method: 'POST', signal: ac.signal, headers: { ...auth, 'x-hermes-session-id': 'hui-botapproval' },
    body: JSON.stringify({ model: 'hermes', stream: true, messages: [{ role: 'user', content: 'tests' }] }),
  }).then(async (r) => { for await (const _ of r.body) { /* read */ } }).catch(() => {});
  for (let i = 0; i < 300 && !up.seen.some((x) => x.includes('/chat/completions')); i++) await tick();
  await tick();
  ac.abort();
  await done;
  for (let i = 0; i < 300 && (await turnsOf()) !== listed; i++) await tick();
  assert.equal(await turnsOf(), listed, 'listed while detached');

  // an older app answers without the generation (another device, the turn's own stream is gone)
  const r = await fetch(`${base}/p/writer/v1/runs/${RUN}/approval`, { method: 'POST', headers: auth, body: JSON.stringify({ choice: 'deny', request_id: REQUEST }) });
  assert.equal(r.status, 200);
  assert.ok(up.seen.includes(`POST /p/writer/v1/runs/${RUN}/approval`), `under the bot's prefix: ${up.seen.join(', ')}`);
  assert.deepEqual(up.answers.map((a) => JSON.parse(a)), [{ request_id: REQUEST, execution_generation: 3, choice: 'deny' }]);
  assert.equal(await turnsOf(), listed, 'an answered approval does not end the turn');
});
