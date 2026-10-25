/**
 * Platform-independent streaming core. `client.ts` binds it to `expo/fetch`; tests inject a fake fetch.
 * Wire format and semantics: docs/HERMES-API.md
 */
import { withDeadline } from '../net/deadline.ts';
import { authErrorText } from './authError.ts';
import { makeT, type TFn, type TKey, type Vars } from '../i18n/core.ts';
import { createSseParser, createUtf8Decoder } from './sse.ts';
import { PERF, perfMark, perfNow, perfSpan } from '../perf/probe.ts';
import { appendCapped, MAX_MESSAGE_TEXT } from './chatState.ts';
import { mapApproval, mapFrame, parseJson } from './events.ts';
import { answerBlocked, type RunStatus } from './approvals.ts';
import { reasonErrorText } from './turnEnd.ts';
import { BOOTSTRAP_SYSTEM_MESSAGE, HERMES_FEATURES_MESSAGE } from './bootstrap.ts';
import { scrubHosts } from './networkFailure.ts';
import { userTimeZoneMessage } from './timeZone.ts';
import { botFromBaseUrl, serverRootOf } from './bots.ts';
import { modelOptionsBody, splitProviderModel, type HermesChatOptions } from './capabilities.ts';
import type { HermesContentPart } from '../attachments/encodeHermes.ts';
import type {
  ApprovalChoice,
  ApprovalRequest,
  HermesConn,
  HermesErrorKind,
  HermesEvent,
  Usage,
} from './types';

export type FetchResponseLike = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
};

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<FetchResponseLike>;

const deT = makeT('de', 'de-DE');

export class HermesError extends Error {
  readonly hermesError = true;
  kind: HermesErrorKind;
  /** stable i18n key + params for `message` (see describeError) */
  text?: { key: TKey; params?: Vars };
  status?: number;
  /** seconds, from Retry-After */
  retryAfter?: number;
  code?: string;
  /**
   * true for a transport failure (network / idle timeout / unexpected end) AFTER Hermes accepted the request
   * (HTTP 200 headers in): the turn most likely keeps running server-side (recovery.ts), it is not a failed answer
   */
  accepted?: boolean;
  /**
   * the UI bridge refused to continue this (accepted, resumable) stream for good: `resume_unavailable` (record gone,
   * turn broken), `turn_unrecorded` (over the buffer) or another refusal. Absent when the resume window ran out offline.
   */
  resumeCode?: string;

  constructor(
    kind: HermesErrorKind,
    message: string,
    extra: { status?: number; retryAfter?: number; code?: string } = {}
  ) {
    super(message);
    this.name = 'HermesError';
    this.kind = kind;
    this.status = extra.status;
    this.retryAfter = extra.retryAfter;
    this.code = extra.code;
  }
}

export function isHermesError(e: unknown): e is HermesError {
  return typeof e === 'object' && e !== null && (e as { hermesError?: unknown }).hermesError === true;
}

/** HermesError whose `message` is the German text of `key`. */
export function keyedHermesError(
  kind: HermesErrorKind,
  key: TKey,
  params?: Vars,
  extra: { status?: number; retryAfter?: number; code?: string } = {}
): HermesError {
  const err = new HermesError(kind, deT(key, params), extra);
  err.text = params ? { key, params } : { key };
  return err;
}

/** Timeout (`timedOut`) or network failure of a fetch as a HermesError. */
export function hermesFetchFailure(e: unknown, timedOut: boolean): HermesError {
  if (timedOut) return keyedHermesError('timeout', 'backends.hermes.errors.timeout');
  return keyedHermesError('network', 'backends.hermes.errors.networkDetail', { detail: scrubHosts(e instanceof Error ? e.message : String(e)) });
}

/** Text of an error in the active language; server-provided messages are shown as they are. */
export function describeError(err: unknown, t: TFn = deT): string {
  if (isHermesError(err) && err.text) return t(err.text.key, err.text.params);
  return err instanceof Error ? err.message : String(err);
}

export type StreamChatParams = {
  conn: HermesConn;
  /** ONLY the new user message – the server keeps the history per X-Hermes-Session-Id */
  text: string;
  /** overrides `text` as message content (attachments → OpenAI content parts) */
  content?: string | HermesContentPart[];
  /** client-generated (or earlier returned) session id; sent on every request */
  sessionId: string;
  signal?: AbortSignal;
  /** every normalised event in wire order (text, tool, route, approval, status, finish, …) */
  onEvent: (ev: HermesEvent) => void;
  /** convenience: called for `approval.request` (also delivered via onEvent) */
  onApproval?: (approval: ApprovalRequest) => void;
  /** abort when no bytes arrive for this long (Hermes sends a keepalive every 10 s). Default 45000. */
  idleTimeoutMs?: number;
  /** per-chat reasoning/fast options → body `model_options` (omitted when all default) */
  modelOptions?: HermesChatOptions;
  /**
   * called once the server accepted the request (HTTP 200 headers in, before the first event). `resumable`: the UI
   * bridge recorded this turn under `idempotencyKey` (`X-Hermes-UI-Resume: 1`), a lost stream can re-attach later.
   */
  onAccepted?: (info: { resumable: boolean }) => void;
  /** follow-up suggestions wanted (Settings → Chat). `false` adds the FOLLOWUPS_OFF_MESSAGE; default on */
  followups?: boolean;
  /** `Idempotency-Key` of this send (bridge: no second turn on a retry, resumable stream) */
  idempotencyKey?: string;
  /** this chat renders live cards: the capability line (HERMES_FEATURES_MESSAGE) goes along; constant per chat */
  liveCards?: boolean;
  /** the chat's open live cards for the bridge router (`X-HUI-Live`, live/focus.ts); bridge connections only */
  liveHeader?: string;
  /** pauses before each resume attempt, the last one repeats (tests); default RESUME_DELAYS_MS */
  resumeDelaysMs?: readonly number[];
  /** how long a lost resumable stream keeps trying to re-attach (offline); default RESUME_WINDOW_MS */
  resumeWindowMs?: number;
  /**
   * re-attach instead of sending: the first request already continues the bridge's recording of `idempotencyKey` at
   * this byte offset (0 = the whole turn again; an app restart with an unfinished answer). Never starts a turn: an
   * unknown / expired key is refused (409, HermesError `code`).
   */
  resumeFrom?: number;
  /** subscribe to "try now" signals (network back, app in the foreground): a resume pause ends early */
  wake?: (fn: () => void) => () => void;
  /** a resumable stream was lost and is re-attaching (`lost`), or bytes arrive again (`resumed`) */
  onConnection?: (state: 'lost' | 'resumed') => void;
  /**
   * a prepared request instead of `buildRequest(conn, …)` (quick answers: POST /bridge/quick/v1/chat/completions
   * with their own short history, quick/stream.ts). Same streaming, error and abort handling.
   */
  request?: { url: string; headers: Record<string, string>; body: string };
  /**
   * reachability check on a fresh connection while the request waits for its response headers (HEADER_PROBE_AFTER_MS,
   * then every HEADER_PROBE_EVERY_MS): `ok: false` ends the request as a network failure right away. Without it only
   * the idle timeout ends a request written into a connection the network dropped silently (client.ts: probeServer).
   */
  probeReachable?: (signal: AbortSignal) => Promise<ReachProbe>;
  /** first check and repeat interval of `probeReachable` (tests); default HEADER_PROBE_AFTER_MS / HEADER_PROBE_EVERY_MS */
  headerProbeMs?: { after: number; every: number };
};

/** outcome of a reachability check: the server answered (any HTTP status), or why it did not */
export type ReachProbe = { ok: true } | { ok: false; detail: string };

export type StreamChatResult = {
  /** session id to use for the next message (response header, falls back to the one sent) */
  sessionId: string;
  completionId?: string;
  finishReason?: string;
  /** finish/error message if the agent reported one */
  error?: string;
  /** concatenated assistant text, capped like the chat message (MAX_MESSAGE_TEXT + CAP_MARKER, chatState.ts) */
  text: string;
  /** `text` hit that cap: a runaway stream no longer grows it */
  textCapped?: true;
  aborted: boolean;
};

export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`);
}

/**
 * Extra ephemeral system message, sent right before the user message ONLY while follow-up suggestions are switched off
 * in the app (nothing is added when they are on, so prompt caching stays identical). Keep in sync with the skill row
 * "follow-ups at the end" (hermes-skill/hermes-ui/SKILL.md).
 */
export const FOLLOWUPS_OFF_MESSAGE =
  '[hermes-ui-app] Follow-up suggestions are switched off in the app: do not add a suggestions block.';

export function buildRequest(
  conn: HermesConn,
  content: string | HermesContentPart[],
  sessionId: string,
  options?: HermesChatOptions,
  followups: boolean = true,
  idempotencyKey?: string,
  liveCards: boolean = false,
  liveHeader?: string,
  /** `userTimeZoneMessage()` (timeZone.ts): the user's zone, so "9 Uhr" means the phone's 9:00; none when omitted */
  userTime?: string
): { url: string; headers: Record<string, string>; body: string } {
  const modelOptions = modelOptionsBody(options);
  // a per-chat provider model (`provider::model`) goes out as `model` + `provider`
  const picked = splitProviderModel(conn.model || 'hermes-agent');
  return {
    url: joinUrl(conn.baseUrl, '/chat/completions'),
    headers: {
      Authorization: `Bearer ${conn.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Hermes-Session-Id': sessionId,
      'X-Hermes-Session-Key': conn.sessionKey || 'hermes-ui',
      // one key per sent message (kept by a retry of a send that never reached Hermes): the UI bridge never runs it
      // twice and can resume the stream; Hermes itself only dedupes non-streaming requests (docs/HERMES-API.md)
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      // open live cards for the bridge router (never forwarded to Hermes); a direct Hermes would refuse it in CORS
      ...(liveHeader && conn.bridge ? { 'X-HUI-Live': liveHeader } : {}),
    },
    body: JSON.stringify({
      model: picked.model,
      ...(picked.provider ? { provider: picked.provider } : {}),
      stream: true,
      // system message first (ephemeral on the server, not persisted), then ONLY the new user message
      messages: [
        // bridge connections: the bridge injects the bootstrap itself (and keeps client system messages)
        ...(conn.bootstrap === false ? [] : [{ role: 'system', content: BOOTSTRAP_SYSTEM_MESSAGE }]),
        // capability line right after it (the bridge puts its own bootstrap + skill core in front of it)
        ...(liveCards ? [{ role: 'system', content: HERMES_FEATURES_MESSAGE }] : []),
        ...(followups === false ? [{ role: 'system', content: FOLLOWUPS_OFF_MESSAGE }] : []),
        ...(userTime ? [{ role: 'system', content: userTime }] : []),
        { role: 'user', content },
      ],
      ...(modelOptions ? { model_options: modelOptions } : {}),
    }),
  };
}

function kindForStatus(status: number): HermesErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limit';
  if (status === 503) return 'busy';
  if (status >= 500) return 'server';
  return 'bad_request';
}

export async function errorFromResponse(res: FetchResponseLike): Promise<HermesError> {
  let message = `HTTP ${res.status}`;
  let code: string | undefined;
  try {
    const raw = (await res.text()).slice(0, 4000);
    const json = parseJson(raw) as { error?: { message?: unknown; code?: unknown } } | undefined;
    if (json && typeof json === 'object' && json.error) {
      if (typeof json.error.message === 'string') message = json.error.message;
      if (typeof json.error.code === 'string') code = json.error.code;
    } else if (raw.trim()) {
      message = `${message}: ${raw.trim().slice(0, 200)}`;
    }
  } catch {
    // body unreadable: keep the status text
  }
  const ra = res.headers.get('retry-after');
  const retryAfter = ra && /^\d+$/.test(ra) ? parseInt(ra, 10) : undefined;
  const err = new HermesError(kindForStatus(res.status), message, { status: res.status, retryAfter, code });
  // rejected key / token ("Invalid bridge token"): human text, the server's stays in `message`
  const auth = authErrorText(res.status, message);
  if (auth) err.text = auth;
  return err;
}

/**
 * A refused chat turn (Hermes ≥ 0.22.3 session authority: 409 / 503 with `error.code` = reason code, e.g.
 * `permission_denied`, `runtime_draining`): the explanation of that code (turnEnd.ts) as its text. `message` becomes
 * the German text like every keyed error; `code` keeps the wire code. Other errors are returned unchanged.
 */
export function withReasonText(err: HermesError): HermesError {
  // only the authority's refusal statuses: a 404 `not_found` of a proxy / unknown route is not a refused turn
  if (err.text || (err.status !== 409 && err.status !== 503)) return err;
  const reason = reasonErrorText(err.message, err.code);
  if (!reason) return err;
  return keyedHermesError(err.kind, reason.key, undefined, { status: err.status, retryAfter: err.retryAfter, code: err.code ?? err.message.trim() });
}

/**
 * Pauses before re-attaching to a lost stream (UI bridge with Idempotency-Key, `X-Hermes-UI-Resume: 1`); the last one
 * repeats until RESUME_WINDOW_MS. Each attempt continues at the byte offset the app has, so an airplane-mode minute or a
 * network switch continues live within a few seconds of the network coming back. Only when the bridge refuses
 * (`409 resume_unavailable` / `turn_unrecorded`) or the window runs out does the normal recovery take over.
 */
export const RESUME_DELAYS_MS: readonly number[] = [250, 750, 1500, 2500];
/** a lost resumable stream keeps re-attaching this long (from the loss) before the turn counts as interrupted */
export const RESUME_WINDOW_MS = 120_000;
/** a re-attach request that gets no response headers within this time is retried (half-open network after a switch) */
export const RESUME_CONNECT_TIMEOUT_MS = 15_000;
/** request header: continue the recorded stream of this Idempotency-Key at this byte offset (bridge/src/replay.mjs) */
export const RESUME_OFFSET_HEADER = 'X-Hermes-UI-Resume-Offset';
/** current upstream clock on reattachment, independent of a proxy-replaced HTTP Date */
export const SERVER_TIME_HEADER = 'X-Hermes-UI-Server-Time';
/**
 * A request without response headers after this long gets a reachability check on a fresh connection, repeated every
 * HEADER_PROBE_EVERY_MS. A keep-alive connection that a network loss did not reset (an interface that keeps its address,
 * e.g. a VPN tunnel or the emulator in airplane mode) takes the request without an error; the request would otherwise
 * wait for the idle timeout ("Taking a little longer…" instead of "Answer failed"). A reachable server is never cut off.
 */
export const HEADER_PROBE_AFTER_MS = 4000;
export const HEADER_PROBE_EVERY_MS = 10_000;
/** budget of one reachability check (the first probe of the chat header's health check, healthMachine.FIRST_PROBE_MS) */
export const REACH_PROBE_MS = 8000;

/**
 * GET /health on the server of `baseUrl` (root, then the base), bounded by `timeoutMs`: any HTTP answer is reachable.
 * `fetchImpl` should not share the chat's connection pool, so the check opens a fresh connection.
 */
export async function probeServerCore(
  fetchImpl: (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number }>,
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal,
  timeoutMs = REACH_PROBE_MS
): Promise<ReachProbe> {
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  let detail = 'server not reachable';
  try {
    return await withDeadline(
      timeoutMs,
      async (s) => {
        for (const url of new Set([joinUrl(serverRootOf(baseUrl), '/health'), joinUrl(baseUrl, '/health')])) {
          try {
            await fetchImpl(url, { headers, signal: s });
            return { ok: true } as const;
          } catch (e) {
            if (s.aborted) throw e;
            detail = scrubHosts(e instanceof Error ? e.message : String(e));
          }
        }
        return { ok: false, detail } as const;
      },
      signal
    );
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError';
    return { ok: false, detail: timedOut ? 'health check timed out' : detail };
  }
}

/** resumed responses that ended without a byte in a row before giving up (a recording that ended without finish) */
const MAX_EMPTY_RESUMES = 2;

/** bridge answers to a re-attach that are worth another attempt: still starting, busy, restarting proxy */
function transientRefusal(e: HermesError): boolean {
  return e.code === 'idempotency_in_progress' || e.status === 429 || e.status === 502 || e.status === 503 || e.status === 504;
}

/** resolves after `ms`, as soon as `signal` aborts or `wake` fires (never rejects) */
function pause(ms: number, signal?: AbortSignal, wake?: (fn: () => void) => () => void): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    let unwake: (() => void) | undefined;
    const done = () => {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      unwake?.();
      resolve();
    };
    const t = setTimeout(done, ms);
    signal?.addEventListener('abort', done);
    unwake = wake?.(done);
  });
}

export async function streamChatCore(
  fetchImpl: FetchLike,
  params: StreamChatParams
): Promise<StreamChatResult> {
  const { conn, text, sessionId, onEvent } = params;
  const idleMs = params.idleTimeoutMs ?? 45000;
  const resumeDelays = params.resumeDelaysMs ?? RESUME_DELAYS_MS;
  const resumeWindow = params.resumeWindowMs ?? RESUME_WINDOW_MS;
  const probeAfter = params.headerProbeMs?.after ?? HEADER_PROBE_AFTER_MS;
  const probeEvery = params.headerProbeMs?.every ?? HEADER_PROBE_EVERY_MS;
  const req = params.request ?? buildRequest(conn, params.content ?? text, sessionId, params.modelOptions, params.followups, params.idempotencyKey, params.liveCards, params.liveHeader, userTimeZoneMessage());
  // a re-attach never needs the message again (the bridge ignores the body): without it, a bridge that does not
  // know the resume header (BRIDGE_RESUME=off) gets a request Hermes refuses (400) instead of asking it a second time
  const resumeBody = JSON.stringify({ model: splitProviderModel(conn.model || 'hermes-agent').model, stream: true, messages: [] });
  if (params.signal?.aborted) return { sessionId, text: '', aborted: true };

  // One HTTP connection at a time (the request, then resumed streams): its own AbortController, idle timer and a
  // promise that rejects as soon as it is aborted (user stop or idle timeout), even if the fetch implementation or its
  // body stream does not react to the signal promptly.
  let ctrl = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abortPromise: Promise<never> = Promise.reject();
  abortPromise.catch(() => {});
  const kick = (ms = idleMs) => {
    if (timer) clearTimeout(timer);
    const c = ctrl;
    timer = setTimeout(() => {
      timedOut = true;
      c.abort();
    }, ms);
  };
  const onExternalAbort = () => ctrl.abort();
  params.signal?.addEventListener('abort', onExternalAbort);
  /** `offset`: a re-attach at this byte offset (same key, no message) instead of the request itself */
  /** the reachability check failed while this connection waited for headers (its detail), see HEADER_PROBE_AFTER_MS */
  let unreachable: string | undefined;
  const failure = (e: unknown, signal: AbortSignal) =>
    unreachable !== undefined
      ? keyedHermesError('network', 'backends.hermes.errors.networkDetail', { detail: unreachable })
      : wrapFetchError(e, signal, timedOut);
  /** probes the server while `c` waits for its response headers; returns the stop function */
  const watchHeaders = (c: AbortController): (() => void) => {
    const probe = params.probeReachable;
    if (!probe) return () => {};
    let stopped = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    let inFlight: AbortController | undefined;
    const check = async () => {
      inFlight = new AbortController();
      const r = await probe(inFlight.signal).catch((e: unknown): ReachProbe => ({ ok: false, detail: String(e) }));
      if (stopped) return;
      if (!r.ok) {
        unreachable = r.detail;
        c.abort();
        return;
      }
      t = setTimeout(() => void check(), probeEvery);
    };
    t = setTimeout(() => void check(), probeAfter);
    return () => {
      stopped = true;
      clearTimeout(t);
      inFlight?.abort();
    };
  };
  const open = async (offset?: number): Promise<FetchResponseLike> => {
    const c = (ctrl = new AbortController());
    timedOut = false;
    unreachable = undefined;
    abortPromise = new Promise<never>((_, reject) => {
      c.signal.addEventListener('abort', () => reject(failure(undefined, c.signal)));
    });
    abortPromise.catch(() => {});
    if (params.signal?.aborted) c.abort();
    const resuming = offset !== undefined;
    kick(resuming ? Math.min(idleMs, RESUME_CONNECT_TIMEOUT_MS) : idleMs);
    const headers = resuming ? { ...req.headers, [RESUME_OFFSET_HEADER]: String(offset) } : req.headers;
    // re-attaches have their own short connect timeout (RESUME_CONNECT_TIMEOUT_MS)
    const stopWatch = resuming ? () => {} : watchHeaders(c);
    perfMark('request');
    try {
      return await Promise.race([
        fetchImpl(req.url, { method: 'POST', headers, body: resuming ? resumeBody : req.body, signal: c.signal }),
        abortPromise,
      ]);
    } catch (e) {
      throw failure(e, c.signal);
    } finally {
      stopWatch();
    }
  };

  const result: StreamChatResult = { sessionId, text: '', aborted: false };
  let replaying = params.resumeFrom !== undefined && !!params.idempotencyKey;
  let serverClockOffset: number | undefined;
  const observeServerClock = (res: FetchResponseLike, recorded: boolean) => {
    const raw = res.headers.get(SERVER_TIME_HEADER);
    const clock = raw !== null && /^\d{1,15}$/.test(raw) ? Number(raw) : undefined;
    // Older bridges replay Date unchanged: retain an original live anchor instead of treating it as current.
    const serverNow = clock ?? (recorded ? NaN : Date.parse(res.headers.get('date') ?? ''));
    if (Number.isFinite(serverNow)) serverClockOffset = serverNow - Date.now();
  };
  let sawFinish = false;
  let sawDone = false;
  let sawError = false;
  let accepted = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  /** body bytes received for this turn (the resume offset) */
  let received = params.resumeFrom ?? 0;
  /** start of the current outage of a resumable stream (0 = connected) */
  let lostAt = 0;
  /** the current connection is a re-attach that has not delivered a byte yet */
  let resumedEmpty = false;
  let emptyResumes = 0;

  const emit = (ev: HermesEvent) => {
    switch (ev.type) {
      case 'start':
        if (ev.completionId) result.completionId = ev.completionId;
        break;
      case 'text':
      case 'textReplace': {
        // the same bound as the reducer: past the cap the transport keeps no (ever growing) copy either (Sol F12)
        const r = appendCapped(ev.type === 'text' ? result.text : '', ev.text, MAX_MESSAGE_TEXT);
        result.text = r.text;
        if (r.capped) result.textCapped = true;
        else delete result.textCapped;
        break;
      }
      case 'finish':
        sawFinish = true;
        result.finishReason = ev.reason;
        if (ev.error) result.error = ev.error;
        break;
      case 'done':
        sawDone = true;
        break;
      case 'error':
        sawError = true;
        result.error = ev.message;
        break;
      case 'approval':
        // Recorded events may be minutes old: the hook must restore their original approval deadline.
        if (replaying) ev = { ...ev, approval: {
          ...ev.approval, restored: true,
          ...(serverClockOffset !== undefined ? { serverNowMs: Date.now() + serverClockOffset } : {}),
        } };
        params.onApproval?.(ev.approval);
        break;
      default:
        break;
    }
    onEvent(ev);
  };

  const parser = createSseParser();
  const decoder = createUtf8Decoder();
  const handle = (chunk: string) => {
    for (const frame of parser.push(chunk)) {
      for (const ev of mapFrame(frame)) emit(ev);
    }
  };
  /** read one response body into the (shared) parser until it ends or [DONE] */
  const pump = async (body: ReadableStream<Uint8Array>) => {
    reader = body.getReader();
    for (;;) {
      if (ctrl.signal.aborted) throw wrapFetchError(undefined, ctrl.signal, timedOut);
      let r: ReadableStreamReadResult<Uint8Array>;
      try {
        r = await Promise.race([reader.read(), abortPromise]);
      } catch (e) {
        throw wrapFetchError(e, ctrl.signal, timedOut);
      }
      if (r.done) break;
      kick();
      if (resumedEmpty && r.value.byteLength) {
        resumedEmpty = false;
        emptyResumes = 0;
        if (lostAt) {
          lostAt = 0;
          params.onConnection?.('resumed');
        }
      }
      received += r.value.byteLength;
      const t0 = PERF ? perfNow() : 0;
      handle(decoder.decode(r.value));
      if (PERF) perfSpan('stream.chunk', t0);
      if (sawDone) break;
    }
  };
  /** close the current connection (a lost stream before resuming, or the end of the turn) */
  const closeConnection = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (reader) reader.cancel().catch(() => {});
    reader = null;
    ctrl.abort();
  };
  const isSse = (res: FetchResponseLike) => !!res.body && (res.headers.get('content-type') || '').toLowerCase().includes('text/event-stream');
  /** the bridge's final refusal of a re-attach (its error code), set when resume() gave up because of it */
  let refusal: string | undefined;
  /**
   * re-attach at `received` (same Idempotency-Key) until it works, the bridge refuses or the window of this outage
   * ran out (offline); null then
   */
  const resume = async (): Promise<FetchResponseLike | null> => {
    if (!lostAt) {
      lostAt = Date.now();
      params.onConnection?.('lost');
    }
    for (let attempt = 0; ; attempt++) {
      closeConnection();
      const left = lostAt + resumeWindow - Date.now();
      if (left <= 0) return null;
      await pause(Math.min(resumeDelays[Math.min(attempt, resumeDelays.length - 1)], left), params.signal, params.wake);
      if (params.signal?.aborted) return null;
      let res: FetchResponseLike;
      try {
        res = await open(received);
      } catch (e) {
        if (isTransportFailure(e)) continue; // still offline / no answer: next attempt
        return null;
      }
      if (res.ok && isSse(res)) {
        kick();
        resumedEmpty = true;
        replaying = true;
        observeServerClock(res, true);
        return res;
      }
      let err: HermesError;
      try {
        err = await Promise.race([errorFromResponse(res), abortPromise]);
      } catch {
        return null; // stopped meanwhile
      }
      if (transientRefusal(err)) continue;
      // 409 resume_unavailable (bridge restarted, turn broken or expired), turn_unrecorded (over the buffer) or anything else
      refusal = err.code ?? `http_${err.status ?? 0}`;
      return null;
    }
  };

  try {
    const reattach = params.resumeFrom !== undefined && !!params.idempotencyKey;
    let res = await open(reattach ? received : undefined);
    kick();
    if (!res.ok) throw withReasonText(await Promise.race([errorFromResponse(res), abortPromise]));
    // a re-attach that got anything but the recorded stream (an old bridge, a proxy): no answer of this turn
    if (reattach && !isSse(res)) {
      void res.body?.cancel().catch(() => {});
      throw new HermesError('bad_request', 'Resume answered without a stream', { status: res.status, code: 'resume_unavailable' });
    }
    const sid = res.headers.get('x-hermes-session-id');
    if (sid) result.sessionId = sid;
    accepted = true;
    // UI bridge recorded this turn under our Idempotency-Key: a lost stream can be continued at a byte offset
    const resumable = !!params.idempotencyKey && res.headers.get('x-hermes-ui-resume') === '1';
    // A deduplicated send can replay the turn even when the caller did not explicitly request resumeFrom.
    if (res.headers.get('x-hermes-ui-resumed') !== null) replaying = true;
    resumedEmpty = replaying;
    observeServerClock(res, replaying);
    params.onAccepted?.({ resumable });

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json') || !res.body) {
      // Server ignored stream:true (or no streaming body available): one-shot completion.
      let raw: string;
      try {
        raw = await Promise.race([res.text(), abortPromise]);
      } catch (e) {
        throw wrapFetchError(e, ctrl.signal, timedOut);
      }
      const json = parseJson(raw) as
        | {
            id?: string;
            choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[];
            error?: { message?: unknown };
            hermes?: { error?: unknown; error_code?: unknown };
          }
        | undefined;
      const choice = json?.choices?.[0];
      emit({ type: 'start', completionId: json?.id ?? '' });
      // Hermes v0.22: the non-streaming twin of `delta.reasoning_content`
      const reasoning = choice?.message?.reasoning_content;
      if (typeof reasoning === 'string' && reasoning) emit({ type: 'reasoning', text: reasoning });
      const content = choice?.message?.content;
      if (content) emit({ type: 'text', text: content });
      // a turn that did not end with `stop` carries `hermes{error, error_code}` (and `error{message}`), like the stream
      const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
      const reason = choice?.finish_reason ?? 'stop';
      const error = reason === 'stop' ? undefined : (text(json?.error?.message) ?? text(json?.hermes?.error));
      const errorCode = reason === 'stop' ? undefined : text(json?.hermes?.error_code);
      emit({ type: 'finish', reason, ...(error ? { error } : {}), ...(errorCode ? { errorCode } : {}) });
      emit({ type: 'done' });
      return result;
    }

    let body: ReadableStream<Uint8Array> = res.body;
    for (;;) {
      let failure: unknown = null;
      try {
        await pump(body);
      } catch (e) {
        failure = e;
      }
      if (failure === null && (sawFinish || sawDone || sawError)) break;
      // the body ended or broke before the turn did: continue where it stopped (parser state is kept, no flush)
      const lost = failure === null || isTransportFailure(failure);
      // a re-attach that ended cleanly without a byte, again: the recording ended without the turn's end
      const exhausted = failure === null && resumedEmpty && ++emptyResumes >= MAX_EMPTY_RESUMES;
      if (resumable && lost && !exhausted && !sawFinish && !sawError && !params.signal?.aborted) {
        const next = await resume();
        if (next?.body) {
          body = next.body;
          continue;
        }
        if (params.signal?.aborted) throw keyedHermesError('aborted', 'backends.hermes.errors.aborted');
        const err = isTransportFailure(failure) ? failure : keyedHermesError('stream', 'backends.hermes.errors.streamUnexpected');
        if (refusal) err.resumeCode = refusal;
        throw err;
      }
      if (failure !== null) throw failure;
      break;
    }
    const tail = decoder.flush();
    if (tail) handle(tail);
    for (const frame of parser.flush()) {
      for (const ev of mapFrame(frame)) emit(ev);
    }

    if (!sawFinish && !sawDone && !sawError) {
      throw keyedHermesError('stream', 'backends.hermes.errors.streamUnexpected');
    }
    return result;
  } catch (e) {
    // A terminal agent event already supplied the outcome. Losing the trailing [DONE] must not
    // replace that answer (or its actual error) with an interrupted turn and start recovery.
    if ((sawFinish || sawError) && isTransportFailure(e)) return result;
    if (isHermesError(e) && e.kind === 'aborted') {
      result.aborted = true;
      return result;
    }
    if (accepted && isTransportFailure(e)) e.accepted = true;
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    params.signal?.removeEventListener('abort', onExternalAbort);
    if (reader) {
      // Closing the body is what makes Hermes interrupt the agent (see docs/HERMES-API.md)
      reader.cancel().catch(() => {});
    }
    // Also close responses refused before pump() acquired a reader.
    ctrl.abort();
  }
}

/** network drop, idle timeout or a stream that ended without finish – not an answer from the server */
export function isTransportFailure(e: unknown): e is HermesError {
  return isHermesError(e) && (e.kind === 'network' || e.kind === 'timeout' || e.kind === 'stream');
}

function wrapFetchError(e: unknown, signal: AbortSignal, timedOut: boolean): HermesError {
  if (isHermesError(e)) return e;
  if (timedOut) {
    return keyedHermesError('timeout', 'backends.hermes.errors.noResponseTimeout');
  }
  if (signal.aborted) return keyedHermesError('aborted', 'backends.hermes.errors.aborted');
  // no host names / IPs in the stored message (failure card "Details", logs)
  const msg = scrubHosts(e instanceof Error ? e.message : String(e));
  return keyedHermesError('network', 'backends.hermes.errors.networkDetail', { detail: msg });
}

/** Bound the entire request, including response bodies and transports slow to react to abort. */
export async function withRequestTimeout<T>(timeoutMs: number, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  try {
    return await withDeadline(timeoutMs, request);
  } catch (e) {
    if (isHermesError(e)) throw e;
    throw hermesFetchFailure(e, e instanceof Error && e.name === 'TimeoutError');
  }
}

/**
 * Budget for the approval POST and the run-status GET (one value for both): long enough for a slow tailnet / a bridge
 * that is busy streaming, so a decision that reaches Hermes is rarely reported as failed.
 */
export const APPROVAL_REQUEST_TIMEOUT_MS = 30_000;

export async function respondApprovalCore(
  fetchImpl: FetchLike,
  conn: HermesConn,
  approval: Pick<ApprovalRequest, 'runId' | 'requestId' | 'executionGeneration'>,
  choice: ApprovalChoice,
  timeoutMs = APPROVAL_REQUEST_TIMEOUT_MS,
): Promise<void> {
  if (!approval.runId) throw new HermesError('bad_request', 'Approval ohne run_id');
  // Hermes ≥ 0.22.3 (request carries `execution_generation`) accepts exactly {request_id, execution_generation, choice};
  // older servers get the body they always got
  const body: Record<string, unknown> =
    approval.executionGeneration !== undefined
      ? { request_id: approval.requestId, execution_generation: approval.executionGeneration, choice }
      : { choice, ...(approval.requestId ? { request_id: approval.requestId } : {}) };
  await withRequestTimeout(timeoutMs, async (signal) => {
    const res = await fetchImpl(joinUrl(conn.baseUrl, `/runs/${encodeURIComponent(approval.runId)}/approval`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw await errorFromResponse(res);
  });
}

/**
 * Answer with the late-tap guard: an expired / no longer queued request is refused locally (HermesError with
 * code `approval_expired` / `approval_not_pending`) and NO request is sent – Hermes already denied it.
 * `retryOf`: the choice of an earlier attempt for this request that failed in transit (network / timeout). When
 * this retry sends the SAME choice and Hermes says `approval_not_pending`, the earlier attempt went through
 * (idempotent UX: answered, not an error).
 */
export async function answerApprovalCore(
  fetchImpl: FetchLike,
  conn: HermesConn,
  approval: ApprovalRequest | undefined,
  choice: ApprovalChoice,
  now: number,
  opts: { retryOf?: ApprovalChoice } = {},
): Promise<void> {
  const blocked = answerBlocked(approval, now);
  if (blocked === 'approval_expired') throw keyedHermesError('bad_request', 'approvals.error.expired', undefined, { code: blocked });
  if (blocked || !approval) throw keyedHermesError('bad_request', 'approvals.error.notPending', undefined, { code: 'approval_not_pending' });
  try {
    await respondApprovalCore(fetchImpl, conn, approval, choice);
  } catch (e) {
    if (opts.retryOf === choice && isHermesError(e) && e.code === 'approval_not_pending') return;
    throw e;
  }
}

/** a failed approval POST that may still have reached Hermes (retrying the same choice is idempotent) */
export function approvalMayHaveArrived(e: unknown): boolean {
  return isHermesError(e) && (e.kind === 'network' || e.kind === 'timeout');
}

/**
 * GET /v1/runs/{runId} (on the UI bridge allow-list): run status incl. the pending `approval` event when
 * `status` is `waiting_for_approval` (Hermes ≥ 0.22.3: from `pending_controls`, all of them in `approvals`).
 * Works for chat completion ids. 404 → `{status:'not_found'}` (also: Hermes restarted and forgot the run); other
 * failures throw.
 */
export async function fetchRunStatusCore(fetchImpl: FetchLike, conn: HermesConn, runId: string, timeoutMs = APPROVAL_REQUEST_TIMEOUT_MS): Promise<RunStatus> {
  return withRequestTimeout(timeoutMs, async (signal) => {
    const res = await fetchImpl(joinUrl(conn.baseUrl, `/runs/${encodeURIComponent(runId)}`), {
      method: 'GET',
      headers: { Authorization: `Bearer ${conn.apiKey}`, Accept: 'application/json' },
      signal,
    });
    if (res.status === 404) return { status: 'not_found' };
    if (!res.ok) throw await errorFromResponse(res);
    const json = parseJson(await res.text());
    const o = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
    // no status field: `unreported` (not Hermes ≥ 0.22.3's `unknown`, which means the run's execution was lost)
    const status = typeof o.status === 'string' ? o.status : 'unreported';
    const out: RunStatus = { status };
    const date = Date.parse(res.headers.get('date') ?? '');
    if (Number.isFinite(date)) out.serverNowMs = date;
    if (typeof o.approval === 'object' && o.approval !== null && !Array.isArray(o.approval)) {
      const a = mapApproval(o.approval as Record<string, unknown>);
      out.approval = a.runId ? a : { ...a, runId };
    } else {
      // Hermes ≥ 0.22.3: no `approval`; the open requests are `pending_controls[kind=approval]` (prompt_id = request id)
      const pending = pendingApprovals(o.pending_controls, runId);
      if (pending.length) {
        out.approval = pending[pending.length - 1];
        out.approvals = pending;
      }
    }
    const usage = parseRunUsage(o.usage);
    if (usage) out.usage = usage;
    return out;
  });
}

/** `pending_controls` of a Hermes ≥ 0.22.3 run status → its approval requests (oldest first; clarify prompts skipped) */
function pendingApprovals(raw: unknown, runId: string): ApprovalRequest[] {
  if (!Array.isArray(raw)) return [];
  const out: ApprovalRequest[] = [];
  for (const c of raw) {
    if (typeof c !== 'object' || c === null || Array.isArray(c)) continue;
    const pc = c as Record<string, unknown>;
    if (pc.kind !== 'approval') continue;
    const a = mapApproval(pc);
    if (!a.requestId) continue; // nothing to answer it with
    out.push(a.runId ? a : { ...a, runId });
  }
  return out;
}

/**
 * `usage` of a run status: Hermes runs report `{input_tokens, output_tokens, total_tokens}`, chat completions
 * `{prompt_tokens, completion_tokens, total_tokens}`. Undefined unless both counts are there (a footer "0 in" would lie).
 */
export function parseRunUsage(raw: unknown): Usage | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const u = raw as Record<string, unknown>;
  const num = (...keys: string[]) => {
    for (const k of keys) {
      const v = u[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    }
    return undefined;
  };
  const promptTokens = num('input_tokens', 'prompt_tokens');
  const completionTokens = num('output_tokens', 'completion_tokens');
  if (promptTokens === undefined || completionTokens === undefined || promptTokens + completionTokens === 0) return undefined;
  return { promptTokens, completionTokens, totalTokens: num('total_tokens') ?? promptTokens + completionTokens };
}

/**
 * UI bridge only: stop the Hermes run of `sessionId` (POST /bridge/chat/stop). The bridge keeps a run going when
 * the app's connection drops (network switch, background), so a deliberate stop has to say so. Best effort.
 * Session ids are per profile: the bot of `conn` goes in the body (bridge routes have no `/p/<bot>` form).
 */
export async function stopBridgeTurnCore(fetchImpl: FetchLike, conn: HermesConn, sessionId: string): Promise<void> {
  const root = serverRootOf(conn.baseUrl); // bridge route: never under a bot's /p/<bot> prefix
  const res = await fetchImpl(joinUrl(root, '/bridge/chat/stop'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${conn.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, profile: botFromBaseUrl(conn.baseUrl) ?? null }),
  });
  if (!res.ok) throw await errorFromResponse(res);
}
