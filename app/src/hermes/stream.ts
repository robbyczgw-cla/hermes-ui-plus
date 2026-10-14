/**
 * Platform-independent streaming core. `client.ts` binds it to `expo/fetch`; tests inject a fake fetch.
 * Wire format and semantics: docs/HERMES-API.md
 */
import { withDeadline } from '../net/deadline.ts';
import { authErrorText } from './authError.ts';
import { makeT, type TFn, type TKey, type Vars } from '../i18n/core.ts';
import { createSseParser, createUtf8Decoder } from './sse.ts';
import { mapApproval, mapFrame, parseJson } from './events.ts';
import { answerBlocked, type RunStatus } from './approvals.ts';
import { BOOTSTRAP_SYSTEM_MESSAGE } from './bootstrap.ts';
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
  return keyedHermesError('network', 'backends.hermes.errors.networkDetail', { detail: e instanceof Error ? e.message : String(e) });
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
};

export type StreamChatResult = {
  /** session id to use for the next message (response header, falls back to the one sent) */
  sessionId: string;
  completionId?: string;
  finishReason?: string;
  /** finish/error message if the agent reported one */
  error?: string;
  /** concatenated assistant text */
  text: string;
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
  followups: boolean = true
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

export async function streamChatCore(
  fetchImpl: FetchLike,
  params: StreamChatParams
): Promise<StreamChatResult> {
  const { conn, text, sessionId, onEvent } = params;
  const idleMs = params.idleTimeoutMs ?? 45000;
  const req = buildRequest(conn, params.content ?? text, sessionId, params.modelOptions, params.followups);

  const ctrl = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const kick = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, idleMs);
  };
  const onExternalAbort = () => ctrl.abort();
  // Rejects as soon as the request is aborted (user stop or idle timeout), even if the fetch
  // implementation or its body stream does not react to the signal promptly.
  const abortPromise = new Promise<never>((_, reject) => {
    ctrl.signal.addEventListener('abort', () => reject(wrapFetchError(undefined, ctrl.signal, timedOut)));
  });
  abortPromise.catch(() => {});
  if (params.signal) {
    if (params.signal.aborted) return { sessionId, text: '', aborted: true };
    params.signal.addEventListener('abort', onExternalAbort);
  }

  const result: StreamChatResult = { sessionId, text: '', aborted: false };
  let sawFinish = false;
  let sawDone = false;
  let sawError = false;
  let accepted = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const emit = (ev: HermesEvent) => {
    switch (ev.type) {
      case 'start':
        if (ev.completionId) result.completionId = ev.completionId;
        break;
      case 'text':
        result.text += ev.text;
        break;
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

  try {
    kick();
    let res: FetchResponseLike;
    try {
      res = await Promise.race([
        fetchImpl(req.url, {
          method: 'POST',
          headers: req.headers,
          body: req.body,
          signal: ctrl.signal,
        }),
        abortPromise,
      ]);
    } catch (e) {
      throw wrapFetchError(e, ctrl.signal, timedOut);
    }
    kick();
    if (!res.ok) throw await Promise.race([errorFromResponse(res), abortPromise]);

    const sid = res.headers.get('x-hermes-session-id');
    if (sid) result.sessionId = sid;
    accepted = true;
    params.onAccepted?.();

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
        | { id?: string; choices?: { message?: { content?: string }; finish_reason?: string }[] }
        | undefined;
      const choice = json?.choices?.[0];
      emit({ type: 'start', completionId: json?.id ?? '' });
      const content = choice?.message?.content;
      if (content) emit({ type: 'text', text: content });
      emit({ type: 'finish', reason: choice?.finish_reason ?? 'stop' });
      emit({ type: 'done' });
      return result;
    }

    const parser = createSseParser();
    const decoder = createUtf8Decoder();
    const handle = (chunk: string) => {
      for (const frame of parser.push(chunk)) {
        for (const ev of mapFrame(frame)) emit(ev);
      }
    };

    reader = res.body.getReader();
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
      handle(decoder.decode(r.value));
      if (sawDone) break;
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
  const msg = e instanceof Error ? e.message : String(e);
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
 */
export async function stopBridgeTurnCore(fetchImpl: FetchLike, conn: HermesConn, sessionId: string): Promise<void> {
  const root = conn.baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '');
  const res = await fetchImpl(joinUrl(root, '/bridge/chat/stop'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${conn.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) throw await errorFromResponse(res);
}
