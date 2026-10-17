#!/usr/bin/env node
// Entry point: `node --env-file=.env src/server.mjs` (dev: `npm run dev` reads ./.env if present) (env vars: see docs/ROUTER.md).
import http from 'node:http';
import { loadConfig } from './config.mjs';
import { createBridgeHandler } from './bridge.mjs';
import { createLogger } from './log.mjs';
import { createRouter } from './router/router.mjs';
import { createBackend } from './router/backends/index.mjs';
import { LruCache } from './lru.mjs';
import { createUploads } from './uploads.mjs'; // file uploads (docs/ROUTER.md, "File uploads")
import { createMedia } from './media.mjs'; // GET /bridge/media: files Hermes announced as MEDIA:<path> (docs/ROUTER.md, "Media files")
import { createVoice } from './voice.mjs'; // STT/TTS (docs/ROUTER.md, "Voice (STT/TTS)")
import { createPairing } from './pair.mjs'; // QR pairing (docs/ROUTER.md, "Install & pairing")
import { createImages } from './images.mjs'; // web image search (docs/ROUTER.md, "Image search")
import { createImageProxy } from './image-proxy.mjs'; // GET /bridge/img?u=: images Hermes' tools returned (docs/BRIDGE.md, "Image proxy")
import { createMeta } from './meta.mjs'; // titles & follow-ups (docs/ROUTER.md, "Meta (titles & follow-ups)")
import { createQuick } from './quick.mjs'; // quick answers via the optional Hermes plugin (docs/HERMES-PLUGIN.md)
import { createHermesPush } from './push-hermes.mjs'; // push + live inbox (docs/SELF-HOSTING.md "Push notifications")
import { createAuth } from './auth.mjs'; // BRIDGE_TOKEN (admin) + per-device tokens
import { createDeviceStore } from './devices.mjs';
import { createDeviceAdmin } from './device-admin.mjs';
import { checkRequestPath } from './paths.mjs';
import { createStatic, isLandingRequest, serveLanding } from './static.mjs'; // optional web app: BRIDGE_WEB_DIR (src/static.mjs)
import { createProfiles } from './profiles.mjs'; // Hermes profiles under /p/<name>/ (BRIDGE_PROFILES)

/** Unauthenticated liveness path (`GET /bridge/live` → 200 "ok"): says only that the bridge process answers. */
export const LIVE_PATH = '/bridge/live';

/** Where device tokens live: BRIDGE_STATE_DIR, else systemd's $STATE_DIRECTORY (first entry), else none. */
export function deviceStateDir(env) {
  if (/^(0|off|false|no)$/i.test(env.BRIDGE_DEVICE_TOKENS ?? '')) return '';
  return env.BRIDGE_STATE_DIR || String(env.STATE_DIRECTORY ?? '').split(':')[0] || '';
}

/** Build a ready-to-listen server (also used by tests). */
export function createServer(env = process.env, o = {}) {
  const config = loadConfig(env, { defaultBootstrapFile: o.defaultBootstrapFile });
  const logger = o.logger ?? createLogger({ level: config.logLevel });
  if (config.bootstrapMissing) {
    logger.warn('bootstrap system message not found: the hermes-ui skill will not trigger for app chats. '
      + 'npm/git installs: reinstall or run `npm run bundle-skill`; Docker: run `npm run bundle-skill` before `docker build`. '
      + 'Set BRIDGE_BOOTSTRAP=off to silence this on purpose.', { file: config.bootstrapMissing });
  }
  if (config.skillInlineMissing) { // src/skillInline.mjs: chat works, but models that skip skill_view lose the components
    logger.warn('hermes-ui SKILL.md not found: app turns get the bootstrap message without the inline skill core. '
      + 'Run `npm run bundle-skill`, set BRIDGE_SKILL_FILE, or BRIDGE_SKILL_INLINE=off to silence this on purpose.', { file: config.skillInlineMissing });
  }
  // --- auth: every module checks Bearer tokens through config.auth (src/auth.mjs). Device tokens need a state dir.
  const stateDir = deviceStateDir(env);
  const devices = config.token && stateDir ? createDeviceStore({ dir: stateDir, logger, now: o.now, lockWaitMs: 0 }) : null;
  config.auth = createAuth(config, devices);
  const backend = o.backend !== undefined ? o.backend : createBackend(config.router);
  const router = config.router.kind === 'off' ? null : createRouter({
    backend,
    timeoutMs: config.router.timeoutMs,
    fallback: config.router.fallback,
    fastPathMin: config.router.fastPathMin,
    mode: config.router.mode,
    cache: new LruCache({ max: config.router.cacheSize, ttlMs: config.router.cacheTtlMs }),
    logger,
  });
  // --- push hook-in: /bridge/push/*, GET /bridge/inbox/stream, POST /bridge/hermes-hook (src/push-hermes.mjs, own auth).
  // --- Hermes profiles ("bots"): `/p/<name>/…` allow-list, GET /bridge/profiles, push watcher per profile
  const profiles = o.profiles ?? createProfiles(env);
  const push = createHermesPush(config, { env, logger, fetch: o.fetch, senders: o.pushSenders, now: o.now, profiles });
  const bridgeHandler = createBridgeHandler(config, { router, logger, turns: push.turns, approvals: push.approvals, profiles });
  // --- uploads hook-in: POST /bridge/uploads is handled by src/uploads.mjs (own auth check, streamed
  // to disk, not subject to BRIDGE_MAX_BODY_BYTES); every other request goes to the bridge unchanged.
  const uploads = createUploads(config, { env, logger });
  const media = createMedia(config, { env, logger }); // GET /bridge/media?path= (BRIDGE_MEDIA_DIRS allow-list, own auth check)
  // --- voice hook-in: GET /bridge/voice/config, POST /bridge/stt, POST /bridge/tts (src/voice.mjs, own auth check).
  const voice = createVoice(config, { env, logger, fetch: o.fetch });
  // --- meta hook-in: POST /bridge/meta, GET /bridge/meta/config (src/meta.mjs, own auth check; 404 unless BRIDGE_META=on + ANTHROPIC_API_KEY).
  const meta = createMeta(config, { env, logger, backend: o.metaBackend });
  // --- quick hook-in: POST /bridge/quick[/v1/chat/completions], GET /bridge/quick/config (src/quick.mjs, own auth
  // check; 404 feature_off unless the hermes-ui-plus plugin answers on BRIDGE_HERMES_PLUGIN_URL).
  const quick = createQuick(config, { env, logger, fetch: o.quickFetch, now: o.now });
  // --- pairing hook-in: GET /bridge/pair[.svg|.png] (src/pair.mjs; loopback or one-time page code with BRIDGE_PAIRING=1)
  // and POST /bridge/pair/redeem (one-time pair code → device token, unauthenticated, rate limited).
  const pairing = createPairing(config, { env, logger, devices, now: o.now });
  const deviceAdmin = createDeviceAdmin({ auth: config.auth, devices, issue: (label) => pairing.issue(label) });
  // --- images hook-in: GET /bridge/images, /bridge/images/config (src/images.mjs, own auth check; keys SERPER_API_KEY/BRAVE_API_KEY).
  // --- image proxy hook-in: GET /bridge/img?u=<https url> (src/image-proxy.mjs, own auth check, no keys; BRIDGE_IMAGE_PROXY=off).
  const imageProxy = createImageProxy(config, { env, logger, now: o.now, ...o.imageProxy });
  const images = createImages(config, { env, logger, fetch: o.fetch, providers: o.imageProviders, proxy: imageProxy });
  // --- web app hook-in: GET/HEAD outside /v1, /api, /bridge, /health when BRIDGE_WEB_DIR is set (no auth: public bundle).
  const web = createStatic({ dir: env.BRIDGE_WEB_DIR, logger, csp: env.BRIDGE_WEB_CSP });
  // Without Bearer auth, CORS response headers alone cannot prevent a browser's simple POST from
  // invoking the user's agent. Same-origin web clients and explicitly configured origins are allowed.
  const openModeOriginAllowed = (req) => {
    const origin = req.headers.origin;
    if (!origin) return !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']);
    if (typeof origin !== 'string' || origin === 'null') return false;
    if (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) return true;
    const scheme = req.socket.encrypted ? 'https' : 'http';
    if (origin === `${scheme}://${req.headers.host}`) return true;
    try { return origin === new URL(env.BRIDGE_PUBLIC_URL).origin; } catch { return false; }
  };
  // Server timeouts: headersTimeout / requestTimeout bound how long a client may take to SEND its request (slowloris,
  // a body that never ends). They do not touch responses, so SSE chat answers and the inbox stream can run for hours.
  // keepAliveTimeout: idle keep-alive sockets. BRIDGE_REQUEST_TIMEOUT_MS covers slow uploads (default 5 min).
  const requestTimeout = Math.max(1000, Number(o.requestTimeoutMs ?? env.BRIDGE_REQUEST_TIMEOUT_MS) || 300_000);
  const server = http.createServer({
    requestTimeout,
    headersTimeout: Math.min(30_000, requestTimeout),
    connectionsCheckingInterval: o.connectionsCheckingIntervalMs ?? 10_000,
  }, (req, res) => {
    if (!config.token && config.allowNoAuth && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      && !openModeOriginAllowed(req)) {
      req.resume();
      res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store', 'connection': 'close' });
      return res.end('{"error":{"message":"Origin is not allowed","type":"invalid_request_error","code":"origin_forbidden"}}');
    }
    // M1: one path check for every route (dot segments, encoded slashes/dots, double encoding → 400)
    if (!checkRequestPath(req.url).ok) {
      res.writeHead(400, { 'content-type': 'application/json', 'x-hermes-ui-bridge': '1' });
      return res.end('{"error":{"message":"Invalid request path","type":"invalid_request_error","code":"invalid_path"}}');
    }
    // liveness of the bridge process itself (Docker HEALTHCHECK): no auth, no Hermes call, no log line, no state
    if (req.url === LIVE_PATH && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store', 'x-hermes-ui-bridge': '1' });
      return res.end(req.method === 'HEAD' ? undefined : 'ok\n');
    }
    if (deviceAdmin.matches(req)) return void deviceAdmin.handle(req, res).catch((e) => { logger.error('devices failed', { err: e.message }); if (!res.headersSent) res.writeHead(500); res.end(); });
    if (pairing.matches(req)) return pairing.handle(req, res).catch((e) => { logger.error('pairing failed', { err: e.message }); if (!res.headersSent) res.writeHead(500); res.end(); });
    if (meta.matches(req)) return meta.handle(req, res);
    if (quick.matches(req)) return void quick.handle(req, res).catch((e) => { logger.error('quick failed', { err: e.name }); if (!res.headersSent) res.writeHead(500); res.end(); });
    if (uploads.matches(req)) return uploads.handle(req, res);
    if (media.matches(req)) return void media.handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
    if (imageProxy.matches(req)) return void imageProxy.handle(req, res).catch((e) => { logger.error('image proxy failed', { err: String(e?.message ?? e).slice(0, 120) }); if (!res.headersSent) res.writeHead(500); res.end(); });
    if (images.matches(req)) return images.handle(req, res);
    if (voice.matches(req)) return voice.handle(req, res);
    if (push.matches(req)) return void push.handle(req, res).catch((e) => { logger.error('push failed', { err: e.message }); if (!res.headersSent) res.writeHead(500); res.end(); });
    if (web.matches(req)) return web.handle(req, res);
    if (!web.enabled && isLandingRequest(req)) return serveLanding(req, res); // fixed status page, no state, no secrets
    return bridgeHandler(req, res);
  });
  server.timeout = 0; // no socket inactivity timeout: SSE answers can be silent for minutes (tool calls)
  server.keepAliveTimeout = 65_000;
  // server.close waits for incoming requests only. Detached turns still own outgoing Hermes sockets;
  // exiting before those finish interrupts the agent even though the phone merely went into the background.
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  let closing;
  const close = () => closing ??= (async () => {
    push.stop();
    // Check turns after incoming requests close: an accepted request can start a detached turn during drain.
    const drained = new Promise((resolve) => server.close(resolve)).then(() => bridgeHandler.whenIdle());
    let timer;
    try {
      await Promise.race([drained, new Promise((resolve) => {
        timer = setTimeout(() => {
          logger.warn('shutdown_drain_expired', { turns: bridgeHandler.running(), connections: sockets.size });
          bridgeHandler.abortAll();
          for (const socket of sockets) socket.destroy();
          resolve();
        }, config.drainMs);
      })]);
    } finally { clearTimeout(timer); devices?.close(); }
  })();
  return { server, close, config, logger, router, uploads, media, voice, meta, quick, pairing, images, imageProxy, push, devices, web, profiles };
}

/**
 * Background services of a created server, shared by this entrypoint and bin/hermes-ui-bridge.mjs (Astra F13: the
 * CLI used to skip the push watcher): uploads retention + Hermes session watcher. The returned stop() also ends
 * open inbox streams (push.stop) so server.close() is not held open by them.
 * @param {ReturnType<typeof createServer>} ctx
 */
export function startServices(ctx) {
  const stopCleanup = ctx.uploads.startCleanup(); // uploads retention: at startup and every 24 h
  ctx.push.start(); // Hermes session watcher (only polls while devices are registered or the app is connected)
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    stopCleanup();
    ctx.push.stop();
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ctx = createServer();
  const { server, config, logger } = ctx;
  const stopServices = startServices(ctx);
  server.listen(config.port, config.host, () => {
    logger.info('listening', {
      host: config.host, port: config.port, upstream: new URL(config.upstream.baseUrl).host,
      router: config.router.kind, routerModel: config.router.model || undefined, timeoutMs: config.router.timeoutMs,
      hint: config.hint.mode, bootstrap: Boolean(config.bootstrap), skillInline: Boolean(config.skillInline), auth: config.token ? 'token' : 'none',
      profiles: ctx.profiles.mode,
    });
  });
  installShutdownHandlers(ctx, stopServices);
}

/** Share signal semantics between the executable and the CLI. A second signal skips the drain. */
export function installShutdownHandlers(ctx, stopServices, { signals = process, exit = (code) => process.exit(code) } = {}) {
  let stopping = false;
  const stop = () => {
    if (stopping) return exit(1);
    stopping = true;
    stopServices();
    void ctx.close().then(() => exit(0), () => exit(1));
  };
  signals.on('SIGTERM', stop);
  signals.on('SIGINT', stop);
  return () => { signals.off('SIGTERM', stop); signals.off('SIGINT', stop); };
}
