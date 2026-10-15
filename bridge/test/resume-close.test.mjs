// Resume record vs. an upstream that closes its connection (Connection: close) while the bridge still holds part of the
// answer because the app reads slowly: the record must end with the response, not with the upstream socket
// (src/bridge.mjs `up` 'close'), so a re-attach after the turn replays every byte the app got. The slow app is a slow
// response writer inside the bridge process (kernel socket buffers would hide the backpressure on loopback).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';

const TOKEN = 'bridge-token-resume-close-test';
const FRAMES = 800; // ~800 KB
let upstream; let ctx; let port; let full = 0;
/** the bridge's response to the original request drains slowly (each write waits 2 ms for 'drain') */
let slowNext = false;

before(async () => {
  let body = `data: ${JSON.stringify({ id: 'c', choices: [{ index: 0, delta: { role: 'assistant' } }] })}\n\n`;
  for (let i = 0; i < FRAMES; i++) body += `data: ${JSON.stringify({ id: 'c', choices: [{ index: 0, delta: { content: `${i} ${'x'.repeat(1000)}` } }] })}\n\n`;
  body += 'data: [DONE]\n\n';
  full = Buffer.byteLength(body);
  upstream = http.createServer(async (req, res) => {
    for await (const _ of req);
    res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
    for (let i = 0; i < body.length; i += 16_000) res.write(body.slice(i, i + 16_000));
    res.end();
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  ctx = createServer({
    HERMES_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`, BRIDGE_TOKEN: TOKEN,
    BRIDGE_BOOTSTRAP: 'off', BRIDGE_ROUTER: 'off', BRIDGE_RESUME_TURN_KB: '4096',
  }, { logger: silentLogger, backend: null });
  const [handle] = ctx.server.listeners('request');
  ctx.server.removeAllListeners('request');
  ctx.server.on('request', (req, res) => {
    if (slowNext) {
      slowNext = false;
      const write = res.write.bind(res);
      res.write = (...args) => {
        write(...args);
        setTimeout(() => res.emit('drain'), 2);
        return false;
      };
    }
    handle(req, res);
  });
  ctx.server.listen(0, '127.0.0.1');
  await once(ctx.server, 'listening');
  port = ctx.server.address().port;
});
after(() => { ctx.push.stop(); for (const s of [ctx.server, upstream]) { s.closeAllConnections(); s.close(); } });

function post(key) {
  return new Promise((resolve, reject) => {
    const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'x-hermes-session-id': 'hui-close-1', 'idempotency-key': key };
    const req = http.request({ host: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST', headers, agent: false }, (res) => {
      let n = 0;
      res.on('data', (d) => { n += d.length; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, n }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(JSON.stringify({ model: 'hermes-agent', stream: true, messages: [{ role: 'user', content: 'hallo' }] }));
  });
}

test('upstream Connection: close + a slow app: the replay after the turn has every byte the app got', async () => {
  slowNext = true;
  const first = await post('turn-close-1');
  assert.equal(first.status, 200);
  assert.equal(first.n, full, 'the app got the whole answer');
  await sleep(20);
  const again = await post('turn-close-1');
  assert.equal(again.headers['x-hermes-ui-resumed'], '0');
  assert.equal(again.n, full, 'the record holds the whole answer, not just what the bridge had read when upstream closed');
});
