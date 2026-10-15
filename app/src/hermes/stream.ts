/**
 * Platform-independent streaming core. `client.ts` binds it to `expo/fetch`; tests inject a fake fetch.
 * Wire format and semantics: docs/HERMES-API.md
 */
import { withDeadline } from '../net/deadline.ts';
import { authErrorText } from './authError.ts';
import { makeT, type TFn, type TKey, type Vars } from '../i18n/core.ts';
import { createSseParser, createUtf8Decoder } from './sse.ts';
import { appendCapped, MAX_MESSAGE_TEXT } from './chatState.ts';
import { mapApproval, mapFrame, parseJson } from './events.ts';
import { answerBlocked, type RunStatus } from './approvals.ts';
import { BOOTSTRAP_SYSTEM_MESSAGE } from './bootstrap.ts';
import { scrubHosts } from './networkFailure.ts';
import { botFromBaseUrl, serverRootOf } from './bots.ts';
import { modelOptionsBody, splitProviderModel, type HermesChatOptions } from './capabilities.ts';
import type { HermesContentPart } from '../attachments/encodeHermes.ts';
import type {
  ApprovalChoice,
  ApprovalRequest,
  HermesConn,
  HermesErrorKind,
  HermesEvent,
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
  /** called once the server accepted the request (HTTP 200 headers in, before the first event) */
  onAccepted?: () => void;
  /** follow-up suggestions wanted (Settings → Chat). `false` adds the FOLLOWUPS_OFF_MESSAGE; default on */
  followups?: boolean;
  /** `Idempotency-Key` of this send (bridge: no second turn on a retry, resumable stream) */
  idempotencyKey?: string;
  /** pauses before each resume attempt (tests); default RESUME_DELAYS_MS */
  resumeDelaysMs?: readonly number[];
  /**
   * a prepared request instead of `buildRequest(conn, …)` (quick answers: POST /bridge/quick/v1/chat/completions
   * with their own short history, quick/stream.ts). Same streaming, error and abort handling.
   */
  request?: { url: string; headers: Record<string, string>; body: string };
};

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
  idempotencyKey?: string
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
    },
    body: JSON.stringify({
      model: picked.model,
      ...(picked.provider ? { provider: picked.provider } : {}),
      stream: true,
      // system message first (ephemeral on the server, not persisted), then ONLY the new user message
      messages: [
        // bridge connections: the bridge injects the bootstrap itself (and keeps client system messages)
        ...(conn.bootstrap === false ? [] : [{ role: 'system', content: BOOTSTRAP_SYSTEM_MESSAGE }]),
        ...(followups === false ? [{ role: 'system', content: FOLLOWUPS_OFF_MESSAGE }] : []),
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
 * Pauses before re-attaching to a lost stream (UI bridge with Idempotency-Key, `X-Hermes-UI-Resume: 1`). Each attempt
 * continues at the byte offset the app has; afterwards the normal recovery (live inbox / stored session) takes over.
 */
export const RESUME_DELAYS_MS: readonly number[] = [500, 1500, 3000];
/** request header: continue the recorded stream of this Idempotency-Key at this byte offset (bridge/src/replay.mjs) */
export const RESUME_OFFSET_HEADER = 'X-Hermes-UI-Resume-Offset';

/** resolves after `ms` or as soon as `signal` aborts (never rejects) */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal?.addEventListener('abort', done);
  });
}

export async function streamChatCore(
  fetchImpl: FetchLike,
  params: StreamChatParams
): Promise<StreamChatResult> {
  const { conn, text, sessionId, onEvent } = params;
  const idleMs = params.idleTimeoutMs ?? 45000;
  const resumeDelays = params.resumeDelaysMs ?? RESUME_DELAYS_MS;
  const req = params.request ?? buildRequest(conn, params.content ?? text, sessionId, params.modelOptions, params.followups, params.idempotencyKey);
  if (params.signal?.aborted) return { sessionId, text: '', aborted: true };

  // One HTTP connection at a time (the request, then resumed streams): its own AbortController, idle timer and a
  // promise that rejects as soon as it is aborted (user stop or idle timeout), even if the fetch implementation or its
  // body stream does not react to the signal promptly.
  let ctrl = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abortPromise: Promise<never> = Promise.reject();
  abortPromise.catch(() => {});
  const kick = () => {
    if (timer) clearTimeout(timer);
    const c = ctrl;
    timer = setTimeout(() => {
      timedOut = true;
      c.abort();
    }, idleMs);
  };
  const onExternalAbort = () => ctrl.abort();
  params.signal?.addEventListener('abort', onExternalAbort);
  const open = async (extraHeaders: Record<string, string>): Promise<FetchResponseLike> => {
    const c = (ctrl = new AbortController());
    timedOut = false;
    abortPromise = new Promise<never>((_, reject) => {
      c.signal.addEventListener('abort', () => reject(wrapFetchError(undefined, c.signal, timedOut)));
    });
    abortPromise.catch(() => {});
    if (params.signal?.aborted) c.abort();
    kick();
    try {
      return await Promise.race([
        fetchImpl(req.url, { method: 'POST', headers: { ...req.headers, ...extraHeaders }, body: req.body, signal: c.signal }),
        abortPromise,
      ]);
    } catch (e) {
      throw wrapFetchError(e, c.signal, timedOut);
    }
  };

  const result: StreamChatResult = { sessionId, text: '', aborted: false };
  let sawFinish = false;
  let sawDone = false;
  let sawError = false;
  let accepted = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  /** body bytes received for this turn (the resume offset) */
  let received = 0;

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
      received += r.value.byteLength;
      handle(decoder.decode(r.value));
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
  let resumeAttempt = 0;
  /** re-attach at `received` (same Idempotency-Key); null when the bridge cannot continue this stream */
  const resume = async (): Promise<FetchResponseLike | null> => {
    while (resumeAttempt < resumeDelays.length) {
      closeConnection();
      await pause(resumeDelays[resumeAttempt++], params.signal);
      if (params.signal?.aborted) return null;
      let res: FetchResponseLike;
      try {
        res = await open({ [RESUME_OFFSET_HEADER]: String(received) });
      } catch (e) {
        if (isTransportFailure(e)) continue; // still offline: next attempt
        return null;
      }
      if (res.ok && res.body && (res.headers.get('content-type') || '').toLowerCase().includes('text/event-stream')) {
        kick();
        return res;
      }
      // 409 resume_unavailable (bridge restarted, turn broken or expired), turn_unrecorded (over the buffer) or anything else
      res.text().catch(() => {});
      return null;
    }
    return null;
  };

  try {
    let res = await open({});
    kick();
    if (!res.ok) throw await Promise.race([errorFromResponse(res), abortPromise]);

    const sid = res.headers.get('x-hermes-session-id');
    if (sid) result.sessionId = sid;
    accepted = true;
    params.onAccepted?.();
    // UI bridge recorded this turn under our Idempotency-Key: a lost stream can be continued at a byte offset
    const resumable = !!params.idempotencyKey && res.headers.get('x-hermes-ui-resume') === '1';

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
        | { id?: string; choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[] }
        | undefined;
      const choice = json?.choices?.[0];
      emit({ type: 'start', completionId: json?.id ?? '' });
      // Hermes v0.22: the non-streaming twin of `delta.reasoning_content`
      const reasoning = choice?.message?.reasoning_content;
      if (typeof reasoning === 'string' && reasoning) emit({ type: 'reasoning', text: reasoning });
      const content = choice?.message?.content;
      if (content) emit({ type: 'text', text: content });
      emit({ type: 'finish', reason: choice?.finish_reason ?? 'stop' });
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
      if (resumable && lost && !sawFinish && !sawError && !params.signal?.aborted) {
        const next = await resume();
        if (next?.body) {
          body = next.body;
          continue;
        }
        if (params.signal?.aborted) throw keyedHermesError('aborted', 'backends.hermes.errors.aborted');
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
      ctrl.abort();
    }
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
  approval: Pick<ApprovalRequest, 'runId' | 'requestId'>,
  choice: ApprovalChoice,
  timeoutMs = APPROVAL_REQUEST_TIMEOUT_MS,
): Promise<void> {
  if (!approval.runId) throw new HermesError('bad_request', 'Approval ohne run_id');
  const body: { choice: ApprovalChoice; request_id?: string } = { choice };
  if (approval.requestId) body.request_id = approval.requestId;
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
 * `status` is `waiting_for_approval`. Works for chat completion ids. 404 → `{status:'not_found'}`; other failures throw.
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
    const status = typeof o.status === 'string' ? o.status : 'unknown';
    const out: RunStatus = { status };
    const date = Date.parse(res.headers.get('date') ?? '');
    if (Number.isFinite(date)) out.serverNowMs = date;
    if (typeof o.approval === 'object' && o.approval !== null && !Array.isArray(o.approval)) {
      const a = mapApproval(o.approval as Record<string, unknown>);
      out.approval = a.runId ? a : { ...a, runId };
    }
    return out;
  });
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
