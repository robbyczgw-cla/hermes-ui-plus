// Push + live inbox for Hermes (docs/SELF-HOSTING.md "Push notifications"). Own auth check (same Bearer BRIDGE_TOKEN as the bridge).
//
// Why polling: Hermes' api_server platform is not push-capable (`supports_async_delivery = False`,
// gateway/platforms/api_server.py). Background results for app sessions land in the session transcript
// (wake self-POST turn or an `async_delegation_complete` row, gateway/wake.py), and every cron run is its own
// session (`cron_<job>_<YYYYMMDD_HHMMSS>`, source `cron`) whose final answer is the report Hermes delivers
// to Telegram. The bridge therefore watches GET /api/sessions (+ /messages) and treats new assistant rows
// that it did not stream itself as unsolicited. Optional low-latency trigger: Hermes' outbound webhook
// (`hooks.outbound`, event post_llm_call, HMAC-signed) -> POST /bridge/hermes-hook -> poll now.
//
// Routes:
//   /bridge/push/*            shared push routes (push/src/routes.mjs)
//   GET  /bridge/inbox/stream live SSE of unsolicited messages (?sources=api_server[,cron]; default api_server only);
//                             push only when no stream
//   POST /bridge/hermes-hook  Hermes outbound webhook (X-Hermes-Signature-256), triggers a poll; 404 without secret
//
// Bots (docs/BOTS-SERVER.md): every watched profile's "Bot Chat" (the session with exactly that title, any source: the
// app creates it as api_server, Hermes itself as cli when a `deliver: bot-chat` job fires first) is watched too. A cron
// delivery there is an injected user-ish row `[Cronjob "<name>" output — …]` + the bot's comment: the notification
// carries the job's output (the reminder text), titled with the bot; silent runs ([SILENT]) notify nobody. Inbox events
// of a Bot Chat carry `botChat: true` (the app opens that bot's thread).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { silentLogger } from './log.mjs';
import { createPushService } from './push/index.mjs';
import { makeAuthorizer, makeCredentials } from './auth.mjs';
import { createApprovalWatcher } from './approvals.mjs';
import { upstreamUrl } from './paths.mjs';
import { writeFileAtomicSync } from './atomic-write.mjs';
import { profilePrefix } from './profiles.mjs';

export const INBOX_PATH = '/bridge/inbox/stream';
export const HOOK_PATH = '/bridge/hermes-hook';
export const OWNER = 'owner'; // the bridge has one user (BRIDGE_TOKEN)
const SILENT_MARKERS = new Set(['[SILENT]', 'SILENT', 'NO_REPLY', 'NO REPLY']);
// The hook only triggers a poll; an oversized (or forged) body is dropped early (review L4). Polling still covers it.
const HOOK_BODY_MAX = 1024 * 1024;
const REAUTH_MS = 30_000;
/** Hermes profiles polled besides the default one (each costs one sessions request per source and poll). */
export const MAX_POLLED_PROFILES = 8;
/** What a client gets when it does not ask for sources (stream / device scope): the app's own sessions only.
 * api_server sessions are further limited to BRIDGE_PUSH_SESSION_PREFIX (hui-) by the poller. Cron is opt-in. */
export const DEFAULT_CLIENT_SOURCES = Object.freeze(['api_server']);
/** Sources a registration / stream may ask for. `routines`: results of the routines inbox (src/routines-inbox.mjs). */
export const KNOWN_SOURCES = Object.freeze(['api_server', 'cron', 'telegram', 'cli', 'routines']);
/** a bot's one shared thread (Hermes Desktop's convention; src/bridge.mjs BOT_CHAT_TITLE) */
const BOT_CHAT = 'Bot Chat';
/** `[Cronjob "<name>" output — scheduled job, not the user. …]\n\n<output>` (dash variants tolerated) */
const CRON_INJECT = /^\[Cronjob "([^"\n]{0,200})" output\b[^\]\n]*\]\s*([\s\S]*)$/;

/** A cron delivery row in a Bot Chat → {name, output}, else null. */
export function parseCronInjection(text) {
  const m = CRON_INJECT.exec(String(text ?? '').trim());
  return m ? { name: m[1].trim(), output: m[2].trim() } : null;
}

const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

/** Hermes' autonomous-lane silence rule (gateway/response_filters.py is_autonomous_silence_response), simplified. */
export function isSilence(text) {
  const t = String(text ?? '').trim();
  if (!t) return true;
  if (t.toUpperCase().startsWith('[SILENT]')) return true;
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const canon = (s) => s.replace(/[.!。]+$/, '').toUpperCase();
  return [t, lines[0], lines.at(-1)].some((c) => SILENT_MARKERS.has(canon(c)));
}

/** Message content (string or content-part array) -> text. */
export function messageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : p?.type === 'text' ? p.text ?? '' : '')).join('');
  return '';
}

export function loadPushConfig(env) {
  const readMaybe = (f) => (f ? fs.readFileSync(f, 'utf8').trim() : '');
  const sources = (env.BRIDGE_PUSH_SOURCES || 'api_server').split(',').map((s) => s.trim()).filter(Boolean);
  const cron = (env.BRIDGE_PUSH_CRON || 'delivered').toLowerCase();
  if (!['delivered', 'all', 'off'].includes(cron)) throw new Error('BRIDGE_PUSH_CRON must be delivered|all|off');
  let webpush = null;
  if (env.BRIDGE_PUSH_VAPID_PUBLIC_KEY) {
    const privateKey = env.BRIDGE_PUSH_VAPID_PRIVATE_KEY || readMaybe(env.BRIDGE_PUSH_VAPID_PRIVATE_KEY_FILE);
    if (privateKey) webpush = { publicKey: env.BRIDGE_PUSH_VAPID_PUBLIC_KEY, privateKey, subject: vapidSubject(env) };
  }
  return {
    enabled: bool(env.BRIDGE_PUSH, true),
    stateDir: env.BRIDGE_STATE_DIR || null,
    webpush,
    fcm: env.BRIDGE_PUSH_FCM_SERVICE_ACCOUNT_FILE ? { serviceAccount: env.BRIDGE_PUSH_FCM_SERVICE_ACCOUNT_FILE } : null,
    apns:
      env.BRIDGE_PUSH_APNS_KEY_FILE && env.BRIDGE_PUSH_APNS_KEY_ID && env.BRIDGE_PUSH_APNS_TEAM_ID
        ? { key: env.BRIDGE_PUSH_APNS_KEY_FILE, keyId: env.BRIDGE_PUSH_APNS_KEY_ID, teamId: env.BRIDGE_PUSH_APNS_TEAM_ID, topic: env.BRIDGE_PUSH_APNS_TOPIC || 'xyz.hermesui.app' }
        : null,
    sources: sources.filter((s) => !(s === 'cron' && cron === 'off')),
    cronMode: cron,
    sessionPrefix: env.BRIDGE_PUSH_SESSION_PREFIX ?? 'hui-',
    pollMs: num(env.BRIDGE_PUSH_POLL_MS, 30_000),
    livePollMs: num(env.BRIDGE_PUSH_LIVE_POLL_MS, 8_000),
    settleMs: num(env.BRIDGE_PUSH_SETTLE_MS, 15_000),
    hookSecret: env.BRIDGE_PUSH_HOOK_SECRET || '',
    hookReadMs: num(env.BRIDGE_PUSH_HOOK_READ_MS, 10_000), // GPT security M5: unauthenticated body read deadline
    // M3: message previews leave the server via Google/Apple (FCM/APNs) → off unless BRIDGE_PUSH_PREVIEW=1
    preview: bool(env.BRIDGE_PUSH_PREVIEW, false),
    title: env.BRIDGE_PUSH_TITLE || 'Hermes',
    coalesceMs: num(env.BRIDGE_PUSH_COALESCE_MS, 15_000),
    // Hermes' approvals.timeout (hermes-host: 300 s). Hermes sends no deadline; expiresAt = request time + this (estimate)
    approvalTimeoutMs: num(env.BRIDGE_APPROVAL_TIMEOUT_S, 300) * 1000,
    approvals: bool(env.BRIDGE_PUSH_APPROVALS, true),
  };
}

/**
 * @param {ReturnType<typeof import('./config.mjs').loadConfig>} config
 * @param {{env?: Record<string, string|undefined>, logger?: any, fetch?: typeof fetch, senders?: object, now?: () => number,
 *   profiles?: {names: () => string[]}}} [o]  profiles: Hermes profiles to watch besides the default (src/profiles.mjs)
 */
export function createHermesPush(config, o = {}) {
  const env = o.env ?? process.env;
  const log = o.logger ?? silentLogger;
  const pc = loadPushConfig(env);
  const now = o.now ?? Date.now;
  const doFetch = o.fetch ?? globalThis.fetch;
  const service = createPushService({
    stateDir: pc.stateDir,
    webpush: pc.webpush,
    fcm: pc.fcm,
    apns: pc.apns,
    senders: o.senders,
    fetch: o.fetch,
    log: (msg, f) => log.info(msg, f),
    notifier: { coalesceMs: pc.coalesceMs },
  });
  const sendJson = (res, status, body) => {
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': buf.length, 'cache-control': 'no-store', 'x-hermes-ui-bridge': '1' });
    res.end(buf);
  };
  const routes = service.routes({
    sendJson,
    validateScope: (user, scope) => {
      const bad = (scope.sources ?? []).find((s) => !KNOWN_SOURCES.includes(s));
      return bad ? { ok: false, message: `unknown source ${bad}` } : { ok: true, value: { sources: scope.sources } };
    },
    // apps add `routines` to their scope only when the bridge lists it (an older bridge refuses unknown sources)
    publicConfig: () => ({ ...service.publicConfig(), sources: [...KNOWN_SOURCES] }),
  });

  // routines inbox hooks (src/routines-inbox.mjs, set by server.mjs): which bots it covers, rights per credential
  /** @type {{covers: (bot: string) => boolean, rightOfCredential: (cred: any, bot: string) => string} | null} */
  let routinesHooks = null;
  const canReadRoutines = (cred, bot) => Boolean(routinesHooks) && routinesHooks.rightOfCredential(cred, bot) !== 'none';

  // ---------- state: per session last_active + seen-until (epoch s), persisted without content ----------
  const stateFile = pc.stateDir ? path.join(pc.stateDir, 'push-hermes.json') : null;
  // sessions: key = session id (default profile) or `<profile>/<session id>`; profiles: non-default profiles with a baseline
  let state = { initialized: false, sessions: {}, profiles: /** @type {string[]} */ ([]) };
  if (stateFile && fs.existsSync(stateFile)) {
    try {
      state = { initialized: false, sessions: {}, profiles: [], ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
      if (!Array.isArray(state.profiles)) state.profiles = [];
    } catch {
      /* start fresh (baseline again, no notifications for old rows) */
    }
  }
  function saveState() {
    if (!stateFile) return;
    const entries = Object.entries(state.sessions).sort((a, b) => b[1].la - a[1].la).slice(0, 400);
    state.sessions = Object.fromEntries(entries);
    try {
      fs.mkdirSync(pc.stateDir, { recursive: true, mode: 0o700 });
      writeFileAtomicSync(stateFile, JSON.stringify(state), { mode: 0o600 });
    } catch (e) {
      log.warn('push_state_save_failed', { error: String(e?.code ?? e?.message ?? e) });
    }
  }

  // ---------- turns the bridge streams itself (never notified) ----------
  // A turn whose client went away mid-stream (network switch, app in the background) is `detached`: the bridge
  // keeps the Hermes run going, but the app never got the answer → it is delivered like any unsolicited message.
  /** @type {Map<string, {start: number, end: number|null, detached?: boolean}[]>} */
  const turns = new Map();
  const turnHooks = {
    /** @param {string} sessionId @param {string|null} [profile] Hermes profile of the turn (null = default) */
    begin(sessionId, profile = null) {
      /** @type {{start: number, end: number|null, detached?: boolean}|null} */
      let w = null;
      const end = () => {
        if (!w) return;
        w.end = now();
        trigger(); // the reply is in; nothing to notify (unless detached), but advance the cursor soon
      };
      end.detach = () => {
        if (w) w.detached = true;
      };
      if (!sessionId) return end;
      const key = sessionKey(profile, sessionId);
      const list = turns.get(key) ?? [];
      w = { start: now(), end: null };
      list.push(w);
      turns.set(key, list.slice(-5));
      if (turns.size > 1000) turns.delete(turns.keys().next().value);
      return end;
    },
  };
  const busy = (key) => (turns.get(key) ?? []).some((w) => w.end === null);
  const streamedByBridge = (key, tsSec) => (turns.get(key) ?? []).some((w) => !w.detached && tsSec * 1000 >= w.start - 2000 && tsSec * 1000 <= (w.end ?? Infinity) + 5000);

  // ---------- approvals: Hermes waits for a decision (src/approvals.mjs) ----------
  // approval.request seen on a chat stream (live or detached) → live inbox event `approval`, else push; the answer /
  // timeout / end of the turn → `approval_resolved` to every connected stream so other devices can dismiss.
  const approvals = createApprovalWatcher({
    now,
    log,
    timeoutMs: pc.approvalTimeoutMs,
    onRequest(ev) {
      if (!pc.approvals) return;
      void service
        .dispatch({
          user: OWNER,
          key: `approval|${ev.requestId}`,
          threadKey: `approval|${ev.requestId}`, // one notification per request, never coalesced with another
          kind: 'approval',
          title: 'Hermes',
          // a bot's request names the bot ("Scout wartet auf deine Freigabe"), the default one stays "Hermes"
          ...(ev.hermesProfile ? { botName: botName(ev.hermesProfile) } : {}),
          text: ev.command,
          previewDefault: pc.preview, // previews off: generic body, no command text
          ttl: Math.max(60, Math.ceil(pc.approvalTimeoutMs / 1000)),
          // hermesProfile: the bot whose chat asks (absent = default); the app opens / answers under /p/<profile>/
          data: { src: 'hermes', sessionId: ev.sessionId, source: 'api_server', runId: ev.runId, requestId: ev.requestId, ...(ev.hermesProfile ? { hermesProfile: ev.hermesProfile } : {}) },
          match: (reg) => (reg.scope?.sources?.length ? reg.scope.sources : DEFAULT_CLIENT_SOURCES).includes('api_server'),
          inbox: ev,
          inboxEvent: 'hui.approval',
        })
        .then((via) => log.info('push_hermes_approval', { via }))
        .catch((e) => log.warn('push_approval_failed', { error: String(e?.message ?? e).slice(0, 80) }));
    },
    onResolved(ev) {
      if (pc.approvals) service.inbox.publish(OWNER, ev, 'hui.approval_resolved');
    },
  });

  // ---------- Hermes API ----------
  async function hermes(p) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await doFetch(upstreamUrl(config.upstream.baseUrl, p).href, {
        headers: { ...(config.upstream.apiKey ? { authorization: `Bearer ${config.upstream.apiKey}` } : {}), accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (!res.ok) throw Object.assign(new Error(`hermes ${res.status}`), { status: res.status });
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /** cron jobs per Hermes profile ('' = default) */
  const jobsByProfile = new Map();
  async function cronJob(sessionId, prefix = '') {
    const m = /^cron_(.+)_\d{8}_\d{6}$/.exec(sessionId);
    if (!m) return null;
    let jobs = jobsByProfile.get(prefix) ?? { at: 0, map: new Map() };
    if (now() - jobs.at > 10 * 60_000) {
      try {
        const j = await hermes(`${prefix}/api/jobs?include_disabled=true`);
        jobs = { at: now(), map: new Map((j?.jobs ?? []).map((x) => [String(x.id), { name: x.name, deliver: x.deliver }])) };
      } catch {
        jobs = { at: now(), map: jobs.map }; // jobs API unavailable: keep the old map, do not filter
      }
      jobsByProfile.set(prefix, jobs);
    }
    return jobs.map.get(m[1]) ?? null;
  }

  // ---------- poller ----------
  let polling = null;
  let timer = null;
  let unsupported = false;
  const active = () => service.store.size > 0 || service.inbox.size > 0;

  /** Hermes profiles to watch: the default (null) + the bridge's known profiles (capped). */
  const watchedProfiles = () => [null, ...(o.profiles?.names?.() ?? []).slice(0, MAX_POLLED_PROFILES)];

  async function pollOnce() {
    if (unsupported) return;
    for (const profile of watchedProfiles()) {
      const ok = await pollProfile(profile);
      if (!ok && !profile) return; // the default profile failed: try again next time (state not marked initialized)
    }
    state.initialized = true;
    saveState();
  }

  /** @returns {Promise<boolean>} false when the session list could not be read */
  async function pollProfile(profile) {
    const prefix = profilePrefix(profile);
    const nowSec = now() / 1000;
    // baseline per profile: everything that exists when a profile is first watched counts as seen
    const first = profile ? !state.profiles.includes(profile) : !state.initialized;
    for (const source of pc.sources) {
      let list;
      try {
        list = (await hermes(`${prefix}/api/sessions?source=${encodeURIComponent(source)}&limit=25`))?.data ?? [];
      } catch (e) {
        if (e?.status === 404 && !profile) {
          unsupported = true; // Hermes without the sessions API
          log.warn('push_sessions_api_missing');
        } else log.warn('push_poll_failed', { error: String(e?.message ?? e).slice(0, 80), ...(profile ? { profile } : {}) });
        return false;
      }
      for (const s of list) {
        if (!s?.id || typeof s.last_active !== 'number') continue;
        if (source === 'api_server' && pc.sessionPrefix && !s.id.startsWith(pc.sessionPrefix)) continue;
        const key = sessionKey(profile, s.id);
        const prev = state.sessions[key];
        if (first || (!prev && source !== 'cron')) {
          // baseline: everything that exists now (and app sessions we first see) counts as seen
          state.sessions[key] = { la: s.last_active, su: s.last_active };
          continue;
        }
        if (prev && s.last_active <= prev.la) continue;
        if (busy(key)) continue;
        if (!s.ended_at && nowSec - s.last_active < pc.settleMs / 1000) continue; // still running: next poll
        let msgs = [];
        try {
          msgs = (await hermes(`${prefix}/api/sessions/${encodeURIComponent(s.id)}/messages?order=latest&limit=10`))?.data ?? [];
        } catch {
          continue;
        }
        const su = prev?.su ?? 0;
        const fresh = msgs
          .filter((m) => m?.role === 'assistant' && typeof m.timestamp === 'number' && m.timestamp > su)
          .filter((m) => m.display_kind !== 'hidden' && m.finish_reason !== 'tool_calls' && messageText(m.content).trim())
          .filter((m) => !streamedByBridge(key, m.timestamp))
          .sort((a, b) => a.timestamp - b.timestamp);
        const maxTs = Math.max(su, s.last_active, ...msgs.map((m) => (typeof m.timestamp === 'number' ? m.timestamp : 0)));
        state.sessions[key] = { la: s.last_active, su: maxTs };
        if (!fresh.length) continue;
        const last = fresh.at(-1);
        const text = messageText(last.content);
        let name = s.title || '';
        if (s.source === 'cron') {
          if (isSilence(text)) continue;
          const job = await cronJob(s.id, prefix);
          if (pc.cronMode === 'delivered' && job && (!job.deliver || /^(local|none)$/i.test(String(job.deliver)))) continue;
          // delivered into a bot's Bot Chat: the Bot Chat watcher notifies (one ping per run, not two)
          if (job && /^bot-chat\b/i.test(String(job.deliver ?? ''))) continue;
          name = job?.name || name;
        }
        const title = name ? `${pc.title} · ${String(name).replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim().slice(0, 60)}` : pc.title;
        // hermesProfile: the bot of the session (absent = default) – the app fetches it under /p/<profile>/
        const bot = profile ? { hermesProfile: profile } : {};
        const cronCovered = s.source === 'cron' && Boolean(routinesHooks?.covers(profile ?? 'default'));
        const inbox = { id: `h_${profile ? `${profile}_` : ''}${s.id}_${last.id}`, sessionId: s.id, ...bot, source: s.source, messageId: String(last.id), role: 'assistant', content: text, timestamp: Math.round(last.timestamp * 1000), title, count: fresh.length };
        const via = await service.dispatch({
          user: OWNER,
          key: `${key}#${last.id}`,
          threadKey: key,
          title,
          text,
          count: fresh.length,
          previewDefault: pc.preview,
          data: { src: 'hermes', sessionId: s.id, ...bot, source: s.source, messageId: String(last.id) },
          match: (reg) => {
            const sources = reg.scope?.sources?.length ? reg.scope.sources : DEFAULT_CLIENT_SOURCES;
            if (!sources.includes(s.source)) return false;
            // the routines inbox pushes this cron run itself to registrations that asked for `routines`: no second push
            return !(cronCovered && sources.includes('routines') && canReadRoutines(reg.credential, profile ?? 'default'));
          },
          inbox,
        });
        log.info('push_hermes_message', { source: s.source, via, count: fresh.length, ...(profile ? { profile } : {}) });
      }
    }
    await pollBotChat(profile, prefix, first, nowSec);
    if (profile && !state.profiles.includes(profile)) state.profiles = [...state.profiles, profile].slice(-50);
    return true;
  }

  /** display name of a bot for a notification title (label, else the profile name; default: BRIDGE_PUSH_TITLE) */
  function botName(profile) {
    const entry = o.profiles?.list?.().find((b) => (profile ? b.name === profile : b.default));
    return entry?.label || profile || pc.title;
  }

  /** the profile's Bot Chat: new cron deliveries / unsolicited answers → push + live inbox (botChat: true) */
  async function pollBotChat(profile, prefix, first, nowSec) {
    let rows;
    try {
      rows = (await hermes(`${prefix}/api/sessions?title=${encodeURIComponent(BOT_CHAT)}&include_hidden=1&limit=5`))?.data ?? [];
    } catch {
      return;
    }
    const s = rows
      .filter((r) => r?.title === BOT_CHAT && typeof r.id === 'string' && typeof r.last_active === 'number')
      .sort((a, b) => b.last_active - a.last_active)[0];
    if (!s) return;
    const key = sessionKey(profile, s.id);
    const prev = state.sessions[key];
    if (first || !prev) {
      state.sessions[key] = { la: s.last_active, su: s.last_active };
      return;
    }
    if (s.last_active <= prev.la || busy(key)) return;
    if (nowSec - s.last_active < pc.settleMs / 1000) return; // the bot may still be commenting: next poll
    let msgs = [];
    try {
      msgs = (await hermes(`${prefix}/api/sessions/${encodeURIComponent(s.id)}/messages?order=latest&limit=12`))?.data ?? [];
    } catch {
      return;
    }
    const su = prev.su ?? 0;
    const fresh = msgs
      .filter((m) => typeof m?.timestamp === 'number' && m.timestamp > su && m.display_kind !== 'hidden')
      .sort((a, b) => a.timestamp - b.timestamp);
    state.sessions[key] = { la: s.last_active, su: Math.max(su, s.last_active, ...msgs.map((m) => (typeof m?.timestamp === 'number' ? m.timestamp : 0))) };
    // what the user did not see: cron deliveries, and answers the bridge did not stream (another client, a lost stream)
    const cron = fresh.filter((m) => m.role === 'user').map((m) => ({ m, c: parseCronInjection(messageText(m.content)) })).filter((x) => x.c);
    const answers = fresh
      .filter((m) => m.role === 'assistant' && m.finish_reason !== 'tool_calls' && messageText(m.content).trim() && !streamedByBridge(key, m.timestamp))
      .filter((m) => !isSilence(messageText(m.content)));
    const job = cron.at(-1)?.c ?? null;
    // a cron run with nothing new ([SILENT] output) notifies nobody, whatever the bot commented
    if (job && isSilence(job.output)) return;
    if (!job && !answers.length) return;
    const last = answers.at(-1) ?? cron.at(-1).m;
    const text = job && !isSilence(job.output) ? job.output : messageText(last.content);
    const name = botName(profile);
    const title = job?.name ? `${name} · ${job.name.replace(/^\[bot:[^\]]*\]\s*/, '').slice(0, 60)}` : name;
    const bot = profile ? { hermesProfile: profile } : {};
    const inbox = {
      id: `b_${profile ? `${profile}_` : ''}${s.id}_${last.id}`, sessionId: s.id, ...bot, source: 'api_server', botChat: true,
      messageId: String(last.id), role: 'assistant', content: text, timestamp: Math.round(last.timestamp * 1000), title, count: cron.length + answers.length,
    };
    const via = await service.dispatch({
      user: OWNER,
      key: `${key}#${last.id}`,
      threadKey: key,
      title,
      text,
      count: 1,
      previewDefault: pc.preview,
      data: { src: 'hermes', sessionId: s.id, ...bot, source: 'api_server', botChat: '1', messageId: String(last.id) },
      // the app's own default scope (api_server) covers a bot's thread
      match: (reg) => (reg.scope?.sources?.length ? reg.scope.sources : DEFAULT_CLIENT_SOURCES).includes('api_server'),
      inbox,
    });
    log.info('push_hermes_bot_chat', { via, cron: cron.length, answers: answers.length, ...(profile ? { profile } : {}) });
  }

  function poll() {
    if (!polling) polling = pollOnce().catch((e) => log.warn('push_poll_error', { error: String(e?.message ?? e).slice(0, 80) })).finally(() => (polling = null));
    return polling;
  }
  function schedule(ms) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      if (pc.enabled && active()) await poll();
      schedule(service.inbox.size > 0 ? pc.livePollMs : pc.pollMs);
    }, ms);
    timer.unref?.();
  }
  let lastTrigger = 0;
  function trigger() {
    if (!pc.enabled || !active()) return;
    const wait = Math.max(1500, 2000 - (now() - lastTrigger));
    lastTrigger = now();
    schedule(wait); // debounce bursts of hook calls; settleMs still applies inside the poll
  }

  const authorized = makeAuthorizer(config); // BRIDGE_TOKEN or a device token (src/auth.mjs)
  // GPT security H3: registrations are bound to the registering credential; a revoked device's ones are dropped
  const credentials = makeCredentials(config);
  service.setCredentialCheck((_user, cred) => credentials.valid(cred));

  async function handleHook(req, res) {
    if (!pc.hookSecret) return sendJson(res, 404, { error: { message: 'Not found' } });
    const tooLarge = () => {
      res.writeHead(413, { connection: 'close', 'content-type': 'application/json' }).end('{"error":{"message":"hook body too large"}}');
      req.destroy();
    };
    if (Number(req.headers['content-length'] ?? 0) > HOOK_BODY_MAX) return tooLarge();
    const chunks = [];
    let size = 0;
    // the signature can only be checked after the body: bound how long an unauthenticated sender may take
    const deadline = setTimeout(() => req.destroy(), pc.hookReadMs);
    deadline.unref?.();
    try {
      for await (const c of req) {
        size += c.length;
        if (size > HOOK_BODY_MAX) return tooLarge();
        chunks.push(c);
      }
    } finally {
      clearTimeout(deadline);
    }
    if (req.destroyed && !req.complete) return;
    const sig = String(req.headers['x-hermes-signature-256'] ?? '');
    const want = 'sha256=' + crypto.createHmac('sha256', pc.hookSecret).update(Buffer.concat(chunks)).digest('hex');
    if (size > HOOK_BODY_MAX || sig.length !== want.length || !timingSafeEq(Buffer.from(sig), Buffer.from(want))) {
      return sendJson(res, 401, { error: { message: 'bad signature' } });
    }
    res.writeHead(204).end();
    trigger();
  }

  return {
    service,
    turns: turnHooks,
    approvals,
    /** BRIDGE_PUSH_PREVIEW: previews of routine results follow the same operator default */
    previewDefault: pc.preview,
    /** @param {{covers: (bot: string) => boolean, rightOfCredential: (cred: any, bot: string) => string} | null} hooks */
    setRoutines(hooks) {
      routinesHooks = hooks;
    },
    pollNow: () => poll(),
    matches(req) {
      if (req.method === 'OPTIONS') return false; // CORS preflight is answered by the bridge handler
      const p = (req.url ?? '').split('?')[0];
      return routes.matches(p) || p === INBOX_PATH || p === HOOK_PATH;
    },
    async handle(req, res) {
      const url = new URL(req.url ?? '/', 'http://bridge');
      const p = url.pathname;
      const origin = req.headers.origin;
      if (origin && config.corsOrigins.length && (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin))) {
        res.setHeader('access-control-allow-origin', config.corsOrigins.includes('*') ? '*' : origin);
        res.setHeader('vary', 'Origin');
      }
      if (p === HOOK_PATH && req.method === 'POST') return handleHook(req, res).catch(() => res.destroy());
      if (!authorized(req)) return sendJson(res, 401, { error: { message: 'Invalid bridge token', type: 'invalid_request_error', code: 'invalid_api_key' } });
      if (p === INBOX_PATH && req.method === 'GET') {
        const want = (url.searchParams.get('sources') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        const allowed = new Set(want.length ? want : DEFAULT_CLIENT_SOURCES);
        const cred = credentials.of(req);
        // routine hints (no content) only reach streams whose credential may read that bot's routines
        const filter = (ev) => allowed.has(ev.source) && (ev.source !== 'routines' || canReadRoutines(cred, ev.hermesProfile));
        service.inbox.attach(OWNER, req, res, { filter, headers: { 'x-hermes-ui-bridge': '1' }, ready: { sources: [...allowed] } });
        // a revoked device token (src/devices.mjs) must not keep its live stream
        const recheck = setInterval(() => {
          if (!authorized(req)) res.end();
        }, REAUTH_MS);
        recheck.unref?.();
        res.on('close', () => clearInterval(recheck));
        trigger();
        return;
      }
      if (routes.matches(p)) {
        await routes.handle(req, res, OWNER, p, credentials.of(req) ?? undefined);
        if (req.method === 'POST' && p.endsWith('/register')) trigger();
        return;
      }
      sendJson(res, 404, { error: { message: 'Not found' } });
    },
    start() {
      if (pc.enabled) schedule(1000);
      return () => this.stop();
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      approvals.stop();
      service.stop();
    },
  };
}

/** State / turn key of a session: plain id for the default profile, `<profile>/<id>` otherwise. */
export function sessionKey(profile, sessionId) {
  return profile ? `${profile}/${sessionId}` : sessionId;
}

function timingSafeEq(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** VAPID contact: BRIDGE_PUSH_VAPID_SUBJECT, else the bridge's own https address, else a placeholder (setup asks for one). */
export function vapidSubject(env) {
  const set = (env.BRIDGE_PUSH_VAPID_SUBJECT ?? '').trim();
  if (set) return set;
  const pub = (env.BRIDGE_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^/\s]+/i.test(pub) ? pub : 'mailto:admin@localhost';
}
