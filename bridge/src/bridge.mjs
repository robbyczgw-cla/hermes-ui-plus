// UI Bridge HTTP handler: auth, router, hint injection, byte-faithful proxy to Hermes.
import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { routingContext } from './router/context.mjs';
import { applySystemMessages, buildHint } from './router/hint.mjs';
import { asciiJson, createAssistantCollector, sseFrame } from './sse.mjs';
import { LruCache } from './lru.mjs';
import { silentLogger } from './log.mjs';
import { checkRequestPath, upstreamUrl } from './paths.mjs';
import { makeAuthorizer, makeCredentials } from './auth.mjs';
import { approvalAnswerRun } from './approvals.mjs';
import { createReplayStore, idempotencyKey, resumeOffset, RESUMABLE_HEADER } from './replay.mjs';
import { createProfiles, DEFAULT_PROFILE, isProfileName, PROFILES_PATH, splitProfilePath } from './profiles.mjs';

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const API_BODY_MAX = 64 * 1024;
const API_TIMEOUT_MS = 30_000;
const STOP_BODY_MAX = 4 * 1024;
const APPROVAL_BODY_MAX = 8 * 1024;
const MODEL_LOCK_BODY_MAX = 8 * 1024;
export const STOP_PATH = '/bridge/chat/stop';

export const ROUTE_EVENT = 'hermes.ui.route';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
/**
 * The only request headers forwarded upstream (allow-list): what the app sends plus standard content negotiation.
 * Everything else stays at the bridge - auth is replaced, cookies / origin / referer / forwarding headers / client
 * hints never reach Hermes (browser-only headers would trip Hermes' CORS check).
 */
export const FORWARD_REQUEST_HEADERS = new Set([
  'content-type', 'accept', 'accept-language', 'user-agent',
  'x-hermes-session-id', 'x-hermes-session-key', 'idempotency-key', 'last-event-id',
]);
/** Never sent back to the client: hop-by-hop (above), upstream CORS (the bridge does its own), cookies. */
const DROP_RESPONSE = new Set(['set-cookie', 'set-cookie2']);
const EXPOSE_HEADERS = 'X-Hermes-Session-Id, X-Hermes-Session-Key, X-Hermes-Completed, X-Hermes-Partial, X-Hermes-Error, X-Hermes-UI-Route, X-Hermes-UI-Bridge, X-Hermes-UI-Resume, X-Hermes-UI-Resumed, Date, X-Hermes-UI-Server-Time';

/** @param {import('node:http').IncomingHttpHeaders} h */
export function filterRequestHeaders(h) {
  /** @type {Record<string, string|string[]>} */
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    const lk = k.toLowerCase();
    if (v === undefined || !FORWARD_REQUEST_HEADERS.has(lk)) continue;
    out[lk] = v;
  }
  return out;
}

/** @param {import('node:http').IncomingHttpHeaders} h @param {{dropLength?: boolean}} [o] */
export function filterResponseHeaders(h, o = {}) {
  const connTokens = new Set(String(h.connection ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean));
  /** @type {Record<string, string|string[]>} */
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    const lk = k.toLowerCase();
    if (v === undefined || HOP_BY_HOP.has(lk) || DROP_RESPONSE.has(lk) || connTokens.has(lk) || lk.startsWith('access-control-')) continue;
    if (o.dropLength && lk === 'content-length') continue;
    out[lk] = v;
  }
  return out;
}

/** Public RouteDecision (SPEC fields only). */
export function publicDecision(d) {
  /** @type {any} */
  const out = { format: d.format };
  if (d.component) out.component = d.component;
  out.confidence = d.confidence;
  out.reason = d.reason;
  out.model = d.model;
  out.ms = d.ms;
  return out;
}

const truthy = (v) => v === true || v === 1 || (typeof v === 'string' && /^(1|true|yes|on)$/i.test(v));

/**
 * @param {ReturnType<typeof import('./config.mjs').loadConfig>} config
 * @param {{router: ReturnType<typeof import('./router/router.mjs').createRouter>|null,
 *   logger?: ReturnType<typeof import('./log.mjs').createLogger>,
 *   turns?: {begin: (sessionId: string, profile?: string|null) => () => void},
 *   approvals?: ReturnType<typeof import('./approvals.mjs').createApprovalWatcher>,
 *   profiles?: ReturnType<typeof import('./profiles.mjs').createProfiles>}} deps
 *   turns: push watcher (src/push-hermes.mjs) skips what we stream; approvals: approval.request → inbox + push (src/approvals.mjs);
 *   profiles: Hermes profiles reachable under `/p/<name>/…` (src/profiles.mjs; default: from process.env)
 */
export function createBridgeHandler(config, deps) {
  const log = deps.logger ?? silentLogger;
  const router = config.router.kind === 'off' ? null : deps.router;
  const upstream = new URL(config.upstream.baseUrl);
  const client = upstream.protocol === 'https:' ? https : http;
  const agent = new client.Agent({ keepAlive: true });
  const memory = config.memory.enabled ? new LruCache({ max: config.memory.maxSessions, ttlMs: config.memory.ttlMs }) : null;
  // chat turns with an Idempotency-Key: a retry re-attaches instead of starting a second turn, a lost stream resumes
  // from a byte offset (src/replay.mjs)
  const replay = config.resume?.enabled === false ? null : createReplayStore(config.resume ?? {});
  const profiles = deps.profiles ?? createProfiles(process.env);
  // router context memory per (profile, session): sessions are namespaced per Hermes profile
  const memoryKey = (profile, sid) => (profile ? `${profile}\0${sid}` : sid);

  // BRIDGE_TOKEN (admin/bootstrap) or a per-device token (src/devices.mjs) when the server wired one in
  const authorized = makeAuthorizer(config);
  // GPT security M5: budgets. Concurrent chat turns per credential (a stolen device token cannot open unbounded
  // turns) and unauthenticated /health passthroughs in flight (each one is an upstream request).
  const credentials = makeCredentials(config);
  // A turn holds its slot until the UPSTREAM turn ends (response end / error / stop), not until the phone disconnects:
  // detached runs keep going on Hermes. maxTurnsTotal caps all credentials together.
  const limits = { chatHeaderTimeoutMs: 60_000, turnMaxMs: 2 * 3600_000, maxConcurrentTurns: 8, maxTurnsTotal: 16, maxHealthInFlight: 4, apiTimeoutMs: API_TIMEOUT_MS, ...(config.limits ?? {}) };
  /** @type {Map<string, number>} */
  const turnsByCredential = new Map();
  let turnsTotal = 0;
  const active = new Map();
  const idleWaiters = new Set();
  const whenIdle = () => turnsTotal === 0 ? Promise.resolve() : new Promise((resolve) => idleWaiters.add(resolve));
  let healthInFlight = 0;

  /**
   * Running upstream chat requests per (Hermes profile, X-Hermes-Session-Id). A client that goes away (network switch,
   * app in the background) does NOT stop the Hermes run any more – the answer lands in the session and reaches the app
   * via the live inbox / session sync. A deliberate stop is `POST /bridge/chat/stop {sessionId, profile?}`.
   * @type {Map<string, Set<{reqId: string, up: import('node:http').ClientRequest}>>}
   */
  const runs = new Map();
  // session ids are only unique within a profile; `default` is the unprefixed profile
  const runKey = (profile, sid) => (profile && profile !== DEFAULT_PROFILE ? `${profile}\0${sid}` : sid);
  function trackRun(sessionId, entry) {
    if (!sessionId) return () => {};
    const set = runs.get(sessionId) ?? new Set();
    set.add(entry);
    runs.set(sessionId, set);
    return () => {
      set.delete(entry);
      if (!set.size && runs.get(sessionId) === set) runs.delete(sessionId);
    };
  }

  function cors(req, res) {
    const origin = req.headers.origin;
    if (!origin || !config.corsOrigins.length) return;
    if (!config.corsOrigins.includes('*') && !config.corsOrigins.includes(origin)) return;
    res.setHeader('Access-Control-Allow-Origin', config.corsOrigins.includes('*') ? '*' : origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Expose-Headers', EXPOSE_HEADERS);
  }

  function sendJson(res, status, body) {
    if (res.headersSent) return res.destroy();
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': buf.length, 'x-hermes-ui-bridge': '1' });
    res.end(buf);
  }
  const openaiError = (res, status, message, type, code) => sendJson(res, status, { error: { message, type, code: code ?? null } });

  /** Start an upstream request. Caller pipes/ends the body. `path` = origin-form target, appended to the base path. */
  function upstreamRequest(method, path, headers) {
    const url = upstreamUrl(config.upstream.baseUrl, path);
    /** @type {Record<string, any>} */
    const h = { ...headers };
    if (config.upstream.apiKey) h.authorization = `Bearer ${config.upstream.apiKey}`;
    return client.request(url, { method, headers: h, agent });
  }

  /** Abort upstream when the client goes away before the response finished. */
  function linkAbort(res, onAbort) {
    const onClose = () => { if (!res.writableFinished) onAbort(); };
    res.on('close', onClose);
    return () => res.off('close', onClose);
  }

  function upstreamFailed(res, err, reqId) {
    log.warn('upstream_error', { reqId, error: String(err?.code ?? err?.message ?? err).slice(0, 120) });
    if (!res.headersSent) openaiError(res, 502, 'Hermes upstream unavailable', 'bridge_error', 'upstream_unavailable');
    else res.destroy();
  }

  /**
   * Strict allow-list pass-through for the Hermes sessions / model-options API (docs/ROUTER.md, "Hermes
   * sessions pass-through"). Returns the allowed methods for a path, or null when the path is not allowed.
   */
  function apiAllowed(path) {
    if (path === '/api/sessions' || path === '/api/model/options') return ['GET'];
    const m = /^\/api\/sessions\/([^/]+)(\/messages|\/fork|\/model)?$/.exec(path);
    if (!m || !SAFE_ID.test(m[1]) || m[1].includes('..')) return null;
    if (m[2] === '/fork') return ['POST']; // /branch in the app: copies the session (Hermes marks the old one forked)
    if (m[2] === '/model') return ['POST']; // Hermes v0.22 session model lock: the model picked for this chat
    return m[2] ? ['GET'] : ['GET', 'PATCH', 'DELETE'];
  }

  /**
   * Strict allow-list for Hermes' OpenAI-style `/v1` API (docs/BRIDGE.md, "Narrow pass-through"): exactly what the app
   * calls. Run creation (`POST /v1/runs`), `/v1/responses`, run events / steer / stop, toolsets, artifacts and anything
   * else under `/v1` are never forwarded. Returns the allowed methods for a path, or null (→ 404).
   */
  function v1Allowed(path) {
    switch (path) {
      case '/v1/chat/completions': return ['POST']; // own route (router + hint + turn budget) in handle()
      case '/v1/health': return ['GET']; // unauthenticated, handled before the token check
      case '/v1/models': case '/v1/capabilities': case '/v1/skills': return ['GET'];
      default: break;
    }
    // GET /v1/runs/{id}: status + pending approval after a lost stream; POST …/approval: answer approval.request
    const m = /^\/v1\/runs\/([^/]+)(\/approval)?$/.exec(path);
    if (!m || !SAFE_ID.test(m[1]) || m[1].includes('..')) return null;
    return m[2] ? ['POST'] : ['GET'];
  }

  /**
   * Buffered pass-through for the small, non-streaming routes (/health, /api/sessions…, /v1/models, run status,
   * approval answers): request body capped (`bodyMax`, only for POST/PATCH; GET/DELETE bodies are never read or
   * forwarded), upstream timeout limits.apiTimeoutMs (BRIDGE_UPSTREAM_TIMEOUT_MS, 30 s), response streamed back. `tap` sees the parsed request JSON once
   * Hermes accepted it (2xx).
   * @param {{bodyMax?: number, tap?: ((body: any) => void) | null}} [o]
   */
  async function apiPassthrough(req, res, reqId, { bodyMax = API_BODY_MAX, tap = null } = {}) {
    const method = req.method ?? '';
    const headers = filterRequestHeaders(req.headers);
    let body = null;
    if (method === 'PATCH' || method === 'POST') {
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > bodyMax) {
        req.resume();
        res.setHeader('connection', 'close');
        return openaiError(res, 413, 'Request body too large', 'invalid_request_error', 'payload_too_large');
      }
      try {
        const chunks = [];
        let size = 0;
        for await (const c of req) {
          size += c.length;
          if (size > bodyMax) {
            res.setHeader('connection', 'close');
            return openaiError(res, 413, 'Request body too large', 'invalid_request_error', 'payload_too_large');
          }
          chunks.push(c);
        }
        body = Buffer.concat(chunks);
      } catch { return res.destroy(); }
      headers['content-length'] = String(body.length);
    } else {
      req.resume(); // GET/DELETE (and /health): no body upstream
      delete headers['content-type'];
    }
    headers['accept-encoding'] = 'identity';
    const up = upstreamRequest(method, req.url, headers); // query string verbatim
    const unlink = linkAbort(res, () => up.destroy());
    up.setTimeout(limits.apiTimeoutMs, () => up.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    up.on('response', (upRes) => {
      const st = upRes.statusCode ?? 502;
      if (tap && st >= 200 && st < 300) {
        try { tap(JSON.parse(body?.toString('utf8') || '{}')); } catch { /* not JSON: Hermes would have refused it */ }
      }
      res.writeHead(st, { ...filterResponseHeaders(upRes.headers), 'x-hermes-ui-bridge': '1' });
      upRes.pipe(res);
      upRes.on('error', () => res.destroy());
      upRes.on('end', unlink);
    });
    up.on('error', (err) => {
      unlink();
      if (res.destroyed) return;
      if (err?.code === 'ETIMEDOUT' && !res.headersSent) return openaiError(res, 504, 'Hermes upstream timed out', 'bridge_error', 'upstream_timeout');
      upstreamFailed(res, err, reqId);
    });
    up.end(body ?? undefined);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      /** @type {Buffer[]} */
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > config.maxBodyBytes) { reject(Object.assign(new Error('body too large'), { code: 'TOO_LARGE' })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  /**
   * @param {() => void} release  frees the turn slot (idempotent); called once the upstream request is over
   * @param {ReturnType<ReturnType<typeof createReplayStore>['begin']>|null} rec  replay record (Idempotency-Key) or null
   * @param {string|null} [profile]  Hermes profile of a `/p/<name>/` request (null = default)
   * @returns {Promise<boolean>} true when an upstream request was started (it owns `release` then)
   */
  async function chatCompletions(req, res, reqId, started, release, ac, rec, profile = null) {
    let raw;
    try {
      raw = await readBody(req);
    } catch (err) {
      if (/** @type {any} */ (err).code === 'TOO_LARGE') openaiError(res, 413, 'Request body too large', 'invalid_request_error');
      else res.destroy();
      return false;
    }
    if (ac.signal.aborted) return false;
    /** @type {any} */
    let body = null;
    try { body = JSON.parse(raw.toString('utf8')); } catch { /* forward untouched; Hermes answers 400 */ }
    const valid = body && typeof body === 'object' && Array.isArray(body.messages);
    const stream = valid && truthy(body.stream);
    if (rec && !stream) {
      // non-streaming: Hermes dedupes Idempotency-Key itself (forwarded below)
      replay?.drop(rec);
      rec = null;
    }
    const sessionHeader = String(req.headers['x-hermes-session-id'] ?? '').trim();
    const routeOptOut = /^(off|0|false|none)$/i.test(String(req.headers['x-hermes-ui-route'] ?? ''));

    // Client disconnect before the request went upstream: abort routing, nothing runs. After that the Hermes run is
    // kept going (Hermes interrupts the agent when its connection closes) and the rest of the stream is drained.
    /** @type {import('node:http').ClientRequest|null} */
    let up = null;
    /** @type {import('node:http').IncomingMessage|null} */
    let upRes = null;
    let detached = false;
    let selfClosed = false; // the bridge itself cut the response (upstream failure), not the client
    let endTurn = () => {};
    const onClientClose = () => {
      if (res.writableFinished || selfClosed) return;
      log.info('http', { reqId, method: req.method, path: '/v1/chat/completions', status: 'client_closed', ms: Math.round(performance.now() - started), upstream: up ? 'kept' : 'none' });
      if (!up) return ac.abort();
      detached = true;
      endTurn.detach?.(); // push watcher: the app did not get this answer → deliver it via inbox / push
      if (upRes) {
        upRes.unpipe(res);
        upRes.resume();
      }
    };
    res.on('close', onClientClose);
    const unlink = () => res.off('close', onClientClose);

    let decision = null;
    let turns = [];
    let outBody = raw;
    if (valid) {
      const prior = sessionHeader && memory ? memory.get(memoryKey(profile, sessionHeader)) : undefined;
      turns = routingContext(body.messages, { prior, maxChars: config.router.contextMaxChars });
      if (router && !routeOptOut && (stream || config.router.routeNonStream)) {
        decision = await router.route(turns, { signal: ac.signal, reqId });
        if (ac.signal.aborted) return false;
      }
      // Header-less multi-turn clients: Hermes derives the session id from the system prompt +
      // first user message, so a per-turn hint would fork the session. Skip the hint there.
      const statelessMultiTurn = !sessionHeader && body.messages.some((m) => m?.role === 'assistant');
      const hintAllowed = config.hint.mode === 'on' || (config.hint.mode === 'auto' && !statelessMultiTurn);
      const hint = decision && hintAllowed ? buildHint(decision, config.hint) : null;
      if (hint || config.bootstrap) {
        const messages = applySystemMessages(body.messages, { bootstrap: config.bootstrap, skill: config.skillInline, hint });
        outBody = Buffer.from(JSON.stringify({ ...body, messages }));
      }
      if (decision) log.debug('hint', { reqId, injected: Boolean(hint), statelessMultiTurn });
    }

    if (ac.signal.aborted) return false;
    const headers = filterRequestHeaders(req.headers);
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(outBody.length);
    headers['accept-encoding'] = 'identity'; // we observe the stream for context memory
    up = upstreamRequest('POST', req.url, headers);
    const abortUpstream = () => up.destroy(ac.signal.reason);
    ac.signal.addEventListener('abort', abortUpstream, { once: true });
    const headerTimer = setTimeout(() => up.destroy(Object.assign(new Error('response headers timed out'), { code: 'ETIMEDOUT' })), limits.chatHeaderTimeoutMs);
    endTurn = deps.turns?.begin(sessionHeader, profile) ?? (() => {});
    const untrack = trackRun(sessionHeader && runKey(profile, sessionHeader), { reqId, up });
    // 'close' = the upstream request is over: response consumed (also while detached), error, or stopped
    up.on('close', () => {
      // a record whose turn never answered is dropped; once there is a response, its own 'close' ends the record: the
      // socket can close (Connection: close) while a slow app still has unread bytes buffered in upRes
      if (!upRes) rec?.end();
      clearTimeout(headerTimer);
      ac.signal.removeEventListener('abort', abortUpstream);
      unlink();
      untrack();
      endTurn();
      release();
    });
    const routeHeader = decision ? { 'x-hermes-ui-route': asciiJson(publicDecision(decision)) } : {};

    up.on('response', (r) => {
      clearTimeout(headerTimer);
      upRes = r;
      const status = upRes.statusCode ?? 502;
      const isSse = status === 200 && /text\/event-stream/i.test(String(upRes.headers['content-type'] ?? ''));
      // only a 200 SSE turn is recorded for retries / resume; any other answer drops the record (a retry runs anew)
      if (rec && !isSse) {
        replay?.drop(rec);
        rec = null;
      }
      const head = {
        ...filterResponseHeaders(upRes.headers, { dropLength: isSse && (Boolean(decision) || Boolean(rec)) }),
        ...routeHeader,
        'x-hermes-ui-bridge': '1',
        ...(rec ? { [RESUMABLE_HEADER]: '1' } : {}),
      };
      rec?.start({ status, headers: head });
      const routeFrame = isSse && decision ? sseFrame(ROUTE_EVENT, publicDecision(decision)) : '';
      if (!detached) {
        res.writeHead(status, head);
        res.flushHeaders?.();
        if (routeFrame) res.write(routeFrame);
      }
      if (rec) {
        if (routeFrame) rec.append(Buffer.from(routeFrame));
        upRes.on('data', (c) => rec.append(c));
        upRes.on('close', () => rec.end(!upRes.complete));
      }

      // approval.request side channel (also while detached): inbox event + push, see src/approvals.mjs
      const watch = isSse && deps.approvals ? deps.approvals.observe({ sessionId: () => String(upRes.headers['x-hermes-session-id'] ?? sessionHeader ?? '') || null, profile }) : null;
      if (watch) {
        upRes.on('data', (c) => watch.push(c));
        upRes.on('close', () => watch.end());
      }
      const collect = memory && status === 200 && valid;
      const collector = collect && isSse ? createAssistantCollector(8000, { onOversize: (m) => log.warn('sse_frame_dropped', { reqId, ...m }) }) : null;
      /** @type {Buffer[]} */ const jsonChunks = [];
      let jsonSize = 0;
      if (collect) {
        upRes.on('data', (c) => {
          if (collector) collector.push(c);
          else if (jsonSize < 2_000_000) { jsonChunks.push(c); jsonSize += c.length; }
        });
      }
      if (detached) upRes.resume();
      else upRes.pipe(res);
      upRes.on('error', () => {
        if (detached) return;
        selfClosed = true;
        res.destroy();
      });
      upRes.on('end', () => {
        unlink();
        if (detached) log.info('upstream_done', { reqId, status, ms: Math.round(performance.now() - started), client: 'closed' });
        if (!collect) return;
        let assistant = '';
        if (collector) assistant = collector.end();
        else {
          try { assistant = JSON.parse(Buffer.concat(jsonChunks).toString('utf8'))?.choices?.[0]?.message?.content ?? ''; } catch { /* ignore */ }
        }
        const sid = String(upRes.headers['x-hermes-session-id'] ?? sessionHeader ?? '');
        if (!sid || !turns.length) return;
        const next = [...turns];
        if (typeof assistant === 'string' && assistant.trim()) next.push({ role: 'assistant', content: assistant.slice(0, config.router.contextMaxChars) });
        memory?.set(memoryKey(profile, sid), next.slice(-4));
      });
    });
    up.on('error', (err) => {
      unlink();
      if (detached) return log.info('upstream_done', { reqId, status: 'error', ms: Math.round(performance.now() - started), client: 'closed' });
      if (res.destroyed || ac.signal.aborted) return;
      selfClosed = true;
      if (err?.code === 'ETIMEDOUT' && !res.headersSent) openaiError(res, 504, 'Hermes upstream timed out', 'bridge_error', 'upstream_timeout');
      else upstreamFailed(res, err, reqId);
    });
    up.end(outBody);
    return true;
  }

  /**
   * Same Idempotency-Key again: re-attach to the recorded turn (from `offset`, else from the start) instead of starting
   * a second Hermes turn. A resume request (`offset` given) for an unknown key never starts a turn.
   */
  function reattach(req, res, reqId, rec, offset) {
    req.resume(); // the body is the original request's: never sent upstream again
    if (offset === null) return openaiError(res, 400, 'Invalid X-Hermes-UI-Resume-Offset', 'invalid_request_error', 'invalid_resume_offset');
    if (!rec) return openaiError(res, 409, 'Nothing to resume for this Idempotency-Key', 'invalid_request_error', 'resume_unavailable');
    const sid = String(req.headers['x-hermes-session-id'] ?? '').trim();
    if (sid !== rec.sessionId) return openaiError(res, 409, 'Idempotency-Key was used for another session', 'invalid_request_error', 'idempotency_key_conflict');
    const refused = rec.attach(res, offset ?? 0);
    if (refused) {
      if (refused.code === 'idempotency_in_progress' || refused.status === 429) res.setHeader('retry-after', '1');
      return openaiError(res, refused.status, refused.message, refused.status === 429 ? 'rate_limit_error' : 'invalid_request_error', refused.code);
    }
    log.info('chat_resume', { reqId, offset: offset ?? 0, live: rec.state === 'live' });
  }

  /**
   * POST /bridge/chat/stop {sessionId, profile?}: the user pressed stop → end the Hermes run(s) of that session in that
   * profile (none / `default` = the unprefixed profile). Bridge routes have no `/p/<name>/` form, so it is in the body.
   */
  async function stopRun(req, res, reqId) {
    let body = null;
    try {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > STOP_BODY_MAX) return openaiError(res, 413, 'Request body too large', 'invalid_request_error', 'payload_too_large');
        chunks.push(c);
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      return openaiError(res, 400, 'Invalid JSON', 'invalid_request_error');
    }
    const sessionId = String(body?.sessionId ?? req.headers['x-hermes-session-id'] ?? '').trim();
    if (!SAFE_ID.test(sessionId)) return openaiError(res, 400, 'sessionId required', 'invalid_request_error');
    const profile = body?.profile ?? null;
    if (profile !== null && profile !== '' && !isProfileName(profile)) return openaiError(res, 400, 'Invalid profile', 'invalid_request_error');
    const set = runs.get(runKey(profile, sessionId));
    const stopped = set ? set.size : 0;
    // closing the upstream connection is what makes Hermes interrupt the agent (docs/HERMES-API.md)
    for (const r of set ?? []) r.up.destroy();
    log.info('chat_stop', { reqId, stopped });
    sendJson(res, 200, { stopped });
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  const handle = function (req, res) {
    const reqId = randomUUID().slice(0, 8);
    const started = performance.now();
    // M1: decode once, refuse dot segments / encoded slashes, route on exactly what is forwarded upstream
    const checked = checkRequestPath(req.url);
    const fullPath = checked.ok ? checked.path : '(rejected)';
    res.on('finish', () => log.info('http', { reqId, method: req.method, path: fullPath, status: res.statusCode, ms: Math.round(performance.now() - started) }));
    if (!checked.ok) return openaiError(res, 400, 'Invalid request path', 'invalid_request_error', 'invalid_path');
    // the forwarded target must stay below HERMES_BASE_URL's path (upstreamUrl throws otherwise; never for a checked path)
    try { upstreamUrl(config.upstream.baseUrl, req.url ?? ''); } catch { return openaiError(res, 400, 'Invalid request path', 'invalid_request_error', 'invalid_path'); }
    cors(req, res);
    // Hermes profiles: `/p/<name>/<path>` routes like `<path>` (same allow-list) and is forwarded with the prefix
    // (req.url untouched). Bridge endpoints have no profile form; an unknown / invalid name never reaches Hermes.
    const split = splitProfilePath(fullPath);
    if ('error' in split) return openaiError(res, 404, 'Not found', 'invalid_request_error', 'unknown_profile');
    const { profile, path } = split;
    if (profile && !/^\/(v1|api)\/|^\/health$/.test(path)) return openaiError(res, 404, 'Not found', 'invalid_request_error');
    // the prefix must be literal in the raw target too (no %-escapes Hermes would decode into another name)
    if (profile && !String(req.url).startsWith(`/p/${profile}/`)) return openaiError(res, 404, 'Not found', 'invalid_request_error', 'unknown_profile');

    if (req.method === 'OPTIONS' && req.headers.origin && config.corsOrigins.length) {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'access-control-allow-headers': String(req.headers['access-control-request-headers'] ?? 'authorization, content-type, x-hermes-session-id, x-hermes-session-key'),
        'access-control-max-age': '600',
      });
      return res.end();
    }
    if (req.headers.upgrade) return openaiError(res, 501, 'WebSocket upgrades are not proxied by the bridge', 'bridge_error');
    if (req.method === 'GET' && !profile && (path === '/health' || path === '/v1/health')) {
      if (healthInFlight >= limits.maxHealthInFlight) {
        res.setHeader('retry-after', '1');
        return openaiError(res, 503, 'Too many health checks in flight', 'rate_limit_error', 'rate_limit_exceeded');
      }
      healthInFlight++;
      res.once('close', () => { healthInFlight--; });
      return void apiPassthrough(req, res, reqId);
    }
    if (!authorized(req)) return openaiError(res, 401, 'Invalid bridge token', 'invalid_request_error', 'invalid_api_key');
    // only after auth: which profiles exist is not public (a profiled /health needs the token, too)
    if (profile && !profiles.allowed(profile)) return openaiError(res, 404, 'Not found', 'invalid_request_error', 'unknown_profile');
    if (req.method === 'GET' && path === PROFILES_PATH && !profile) {
      // Hermes profiles ("bots") the app can pick: name, default flag, optional label / model (never secrets)
      return sendJson(res, 200, { object: 'list', mode: profiles.mode, data: profiles.list() });
    }
    if (req.method === 'GET' && path === '/bridge/status') {
      return sendJson(res, 200, {
        ok: true,
        router: router ? { kind: config.router.kind, mode: router.mode, model: router.backend?.model ?? 'heuristic-v1', timeoutMs: router.timeoutMs, cacheSize: router.cache?.size ?? 0 } : null,
        hint: config.hint.mode,
        bootstrap: Boolean(config.bootstrap),
        memorySessions: memory?.size ?? 0,
        resume: replay ? { enabled: true, ...replay.stats() } : { enabled: false },
      });
    }
    if (req.method === 'POST' && path === '/v1/chat/completions') {
      const cred = credentials.of(req) ?? 'anonymous';
      const key = replay ? idempotencyKey(req.headers) : null;
      const scope = key ? `${cred}\0${profile ?? ''}\0${key}` : ''; // a key never re-attaches across profiles
      if (key) {
        const known = replay.get(scope);
        const offset = resumeOffset(req.headers);
        // a plain retry of a turn whose upstream stream broke (Hermes restart / timeout / reset) runs anew: that turn
        // gave no answer, a re-attach could only refuse; a resume request (offset) never starts a turn
        const rerun = known && offset === undefined && replay.rerunnable(known);
        if ((known && !rerun) || offset !== undefined) return reattach(req, res, reqId, known, offset);
      }
      const running = turnsByCredential.get(cred) ?? 0;
      if (running >= limits.maxConcurrentTurns || turnsTotal >= limits.maxTurnsTotal) {
        req.resume();
        res.setHeader('retry-after', '5');
        const perCred = running >= limits.maxConcurrentTurns;
        return openaiError(res, 429, perCred ? 'Too many concurrent turns for this credential' : 'Too many concurrent turns on this bridge', 'rate_limit_error', 'rate_limit_exceeded');
      }
      turnsByCredential.set(cred, running + 1);
      turnsTotal++;
      let released = false;
      const ac = new AbortController();
      let ceiling;
      const release = () => {
        if (released) return;
        released = true;
        clearTimeout(ceiling);
        active.delete(reqId);
        turnsTotal--;
        if (turnsTotal === 0) {
          for (const resolve of idleWaiters) resolve();
          idleWaiters.clear();
        }
        const left = (turnsByCredential.get(cred) ?? 1) - 1;
        if (left > 0) turnsByCredential.set(cred, left);
        else turnsByCredential.delete(cred);
      };
      const abort = () => {
        ac.abort(Object.assign(new Error('turn lifetime exceeded'), { code: 'ETIMEDOUT' }));
        res.destroy();
        req.destroy(); // also bounds incomplete request bodies
        release();
      };
      active.set(reqId, { abort, started });
      ceiling = setTimeout(abort, limits.turnMaxMs);
      const rec = key ? replay.begin(scope, String(req.headers['x-hermes-session-id'] ?? '').trim()) : null;
      return void chatCompletions(req, res, reqId, started, release, ac, rec, profile).then((upstreamStarted) => {
        if (!upstreamStarted) {
          release(); // body refused / client gone while routing: nothing runs upstream
          if (rec) replay.drop(rec);
        }
      }, (err) => {
        release();
        if (rec) replay.drop(rec);
        log.error('chat_failed', { reqId, error: String(err?.message ?? err).slice(0, 200) });
        if (!res.headersSent) openaiError(res, 500, 'Bridge error', 'bridge_error');
        else res.destroy();
      });
    }
    if (req.method === 'POST' && path === STOP_PATH) {
      return void stopRun(req, res, reqId).catch(() => res.destroy());
    }
    if (path.startsWith('/api/')) {
      // session ids are plain [A-Za-z0-9._:-]: any %-escape in the raw path is refused (no second decoding upstream)
      const methods = (req.url ?? '').split('?')[0].includes('%') ? null : apiAllowed(path);
      if (!methods) return openaiError(res, 404, 'Not found', 'invalid_request_error');
      if (!methods.includes(req.method ?? '')) {
        res.setHeader('Allow', methods.join(', '));
        return openaiError(res, 405, 'Method not allowed', 'invalid_request_error', 'method_not_allowed');
      }
      return void apiPassthrough(req, res, reqId, path.endsWith('/model') ? { bodyMax: MODEL_LOCK_BODY_MAX } : {});
    }
    if (path.startsWith('/v1/')) {
      // run ids are plain [A-Za-z0-9._:-] as well: no %-escapes (no second decoding upstream)
      const methods = (req.url ?? '').split('?')[0].includes('%') ? null : v1Allowed(path);
      if (!methods) return openaiError(res, 404, 'Not found', 'invalid_request_error');
      if (!methods.includes(req.method ?? '')) {
        req.resume();
        res.setHeader('Allow', methods.join(', '));
        return openaiError(res, 405, 'Method not allowed', 'invalid_request_error', 'method_not_allowed');
      }
      const answerRun = deps.approvals ? approvalAnswerRun(req.method, path) : null;
      const tap = answerRun ? (body) => deps.approvals.answered(answerRun, body, profile) : null; // other devices dismiss the card
      return void apiPassthrough(req, res, reqId, { bodyMax: req.method === 'POST' ? APPROVAL_BODY_MAX : API_BODY_MAX, tap });
    }
    // a profile's /health: token required (above), no unauthenticated health budget needed
    if (profile && req.method === 'GET' && path === '/health') return void apiPassthrough(req, res, reqId);
    return openaiError(res, 404, 'Not found', 'invalid_request_error');
  };
  return Object.assign(handle, {
    whenIdle,
    running: () => [...active].map(([reqId, turn]) => ({ reqId, ms: Math.round(performance.now() - turn.started) })),
    abortAll: () => { for (const turn of active.values()) turn.abort(); agent.destroy(); },
  });
}
