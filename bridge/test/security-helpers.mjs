import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';

export const TEST_TOKEN = 'test-security-admin-token-00000000';
export const SEEDS = [0x16c0ffee, 0x5eed1234, 0x20261016];
export const LONG = process.env.HUI_BRIDGE_FUZZ_LONG === '1';
export const ROUNDS = LONG ? 2048 : 64;
export function random(seed) {
  let state = seed >>> 0;
  return (max) => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) % max;
  };
}
export const tick = () => new Promise((resolve) => setImmediate(resolve));

// Every connection is to an ephemeral loopback listener. No ambient environment, services or DNS.
export async function localBridge(t, { env = {}, options = {}, respond } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hui-security-test-'));
  const seen = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    seen.push({ url: req.url, method: req.method, headers: req.headers, body });
    if (respond) respond(req, res, body);
    else res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const ctx = createServer({
    HERMES_BASE_URL: `http://127.0.0.1:${upstream.address().port}`,
    HERMES_HOME: join(root, 'mock-hermes-home'),
    HERMES_API_KEY: 'test-security-upstream-key', BRIDGE_TOKEN: TEST_TOKEN,
    BRIDGE_ROUTER: 'off', BRIDGE_BOOTSTRAP: 'off', BRIDGE_PUSH: 'off',
    BRIDGE_STATE_DIR: join(root, 'state'), BRIDGE_UPLOAD_DIR: join(root, 'uploads'),
    BRIDGE_UPLOAD_MAX_BYTES: '1024', BRIDGE_MAX_BODY_BYTES: '4096',
    BRIDGE_PROFILES: 'writer,reader', BRIDGE_DRAIN_MS: '1', ...env,
  }, { logger: silentLogger, ...options });
  ctx.server.listen(0, '127.0.0.1'); await once(ctx.server, 'listening');
  t.after(async () => {
    ctx.server.closeAllConnections();
    upstream.closeAllConnections();
    await ctx.close();
    await new Promise((resolve) => upstream.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const port = ctx.server.address().port;
  const request = (path, { method = 'GET', body, headers = {}, auth = true } = {}) => new Promise((resolve, reject) => {
    const chunks = Array.isArray(body) ? body : body === undefined ? [] : [body];
    const req = http.request({ host: '127.0.0.1', port, path, method, agent: false, headers: {
      ...(auth ? { authorization: `Bearer ${TEST_TOKEN}` } : {}), ...headers,
    } }, (res) => {
      const out = [];
      res.on('data', (c) => out.push(c));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(out).toString() }));
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
  return { ctx, root, port, seen, request, base: `http://127.0.0.1:${port}` };
}
