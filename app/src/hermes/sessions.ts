/**
 * Hermes-native session API (`/api/sessions…`, server root, NOT under `/v1`). Pure: the fetch
 * implementation is injected (client.ts binds expo/fetch, tests a fake). Erasable TS only.
 *
 * Verified against /opt/hermes/gateway/platforms/api_server.py (route table `_http_route_table`,
 * handlers `_handle_list_sessions` … `_handle_session_messages`, projections `_session_response` /
 * `_message_response`) and with real calls, see docs/HERMES-API.md "Sessions API".
 *
 *   GET    /api/sessions?limit(≤200, default 50)&offset&source&include_children
 *          → {object:"list", data:[Session], limit, offset, has_more}
 *          (archived + hidden rows are excluded, ordered by last activity, pinned rows back-filled)
 *   GET    /api/sessions/{id}                     → {object:"hermes.session", session}
 *   PATCH  /api/sessions/{id} {title}             → {object:"hermes.session", session}
 *          (titles are unique per server and ≤ 100 chars → 400 invalid_title)
 *   DELETE /api/sessions/{id}                     → {object:"hermes.session.deleted", id, deleted}
 *   POST   /api/sessions/{id}/model {model, provider?} (v0.22) → {object:"hermes.session.model_lock", session_id, runtime}
 *          (409 session_active_turn while a turn is running)
 *   GET    /api/sessions/{id}/messages?order=latest|oldest&limit(≤500)&offset&include_compacted
 *          → {object:"list", session_id(resolved tip), data:[Message], pagination}
 *          (compression lineage root→tip is included; default page = latest 500)
 * Unknown session → 404 code `session_not_found`. Older Hermes / the UI bridge → plain 404 → unsupported.
 */
import { makeT, type TFn } from '../i18n/core.ts';
import { HermesError, errorFromResponse, withRequestTimeout, joinUrl, keyedHermesError, type FetchLike } from './stream.ts';
import { modelLockBody } from './modelLock.ts';

const deT = makeT('de', 'de-DE');

/** Session row as listed by Hermes (timestamps converted to ms). */
export type RemoteSession = {
  id: string;
  /** `api_server` (API/app), `telegram`, `cli`, `cron`, `oneshot`, `discord`, `slack`, `desktop`, `hermes_browser`, `dashboard`, … */
  source: string;
  title?: string;
  /** first user message (server-side preview) */
  preview?: string;
  model?: string;
  startedAt: number;
  lastActive?: number;
  endedAt?: number;
  messageCount: number;
  toolCallCount?: number;
  parentSessionId?: string;
  pinned?: boolean;
  archived?: boolean;
  /** delegate child (never shown as an ordinary chat) */
  internalChild?: boolean;
};

export type RemoteToolCall = {
  id: string;
  name: string;
  /** JSON string as produced by the model (parsed when possible) */
  arguments: unknown;
};

/** One stored message row. An assistant turn is several rows: assistant(tool_calls) → tool … → assistant. */
export type RemoteMessage = {
  /** integer row id */
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system' | string;
  /** string, or an OpenAI content-part array for multimodal user messages */
  content: unknown;
  toolCallId?: string;
  toolCalls?: RemoteToolCall[];
  toolName?: string;
  /** ms */
  timestamp?: number;
  finishReason?: string;
  reasoning?: string;
  /** `hidden` rows (compaction scaffolding, diagnostics) are not shown */
  displayKind?: string;
};

export type SessionPage = { sessions: RemoteSession[]; hasMore: boolean; limit: number; offset: number };
export type MessagesPage = { sessionId: string; messages: RemoteMessage[] };

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** Hermes stores epoch seconds (float) → ms */
const ms = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : Math.round(n < 1e11 ? n * 1000 : n);
};

export function parseSession(raw: unknown): RemoteSession | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const out: RemoteSession = {
    id,
    source: str(raw.source) ?? 'unknown',
    startedAt: ms(raw.started_at) ?? 0,
    messageCount: Math.max(0, Math.floor(num(raw.message_count) ?? 0)),
  };
  const title = str(raw.title)?.trim();
  if (title) out.title = title;
  const preview = str(raw.preview)?.trim();
  if (preview) out.preview = preview;
  if (str(raw.model)) out.model = str(raw.model);
  const last = ms(raw.last_active);
  if (last !== undefined) out.lastActive = last;
  const ended = ms(raw.ended_at);
  if (ended !== undefined) out.endedAt = ended;
  const tools = num(raw.tool_call_count);
  if (tools !== undefined) out.toolCallCount = tools;
  if (str(raw.parent_session_id)) out.parentSessionId = str(raw.parent_session_id);
  if (raw.pinned === true) out.pinned = true;
  if (raw.archived === true) out.archived = true;
  if (raw.is_internal_child === true) out.internalChild = true;
  return out;
}

export function parseSessionList(json: unknown): SessionPage {
  const j = isObj(json) ? json : {};
  const data = Array.isArray(j.data) ? j.data : [];
  const sessions = data.map(parseSession).filter((s): s is RemoteSession => !!s);
  return {
    sessions,
    hasMore: j.has_more === true,
    limit: num(j.limit) ?? sessions.length,
    offset: num(j.offset) ?? 0,
  };
}

function parseArgs(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function parseToolCalls(v: unknown): RemoteToolCall[] | undefined {
  let list = v;
  if (typeof list === 'string') list = parseArgs(list);
  if (!Array.isArray(list)) return undefined;
  const out: RemoteToolCall[] = [];
  list.forEach((tc, i) => {
    if (!isObj(tc)) return;
    const fn = isObj(tc.function) ? tc.function : {};
    const name = str(fn.name) ?? str(tc.name) ?? 'tool';
    const id = str(tc.id) ?? str(tc.call_id) ?? `call-${i}`;
    out.push({ id, name, arguments: parseArgs(fn.arguments ?? tc.arguments) });
  });
  return out.length ? out : undefined;
}

export function parseMessage(raw: unknown): RemoteMessage | null {
  if (!isObj(raw)) return null;
  const id = raw.id === undefined || raw.id === null ? undefined : String(raw.id);
  const role = str(raw.role);
  if (!id || !role) return null;
  const out: RemoteMessage = { id, role, content: raw.content ?? '' };
  if (str(raw.tool_call_id)) out.toolCallId = str(raw.tool_call_id);
  const calls = parseToolCalls(raw.tool_calls);
  if (calls) out.toolCalls = calls;
  if (str(raw.tool_name)) out.toolName = str(raw.tool_name);
  const ts = ms(raw.timestamp);
  if (ts !== undefined) out.timestamp = ts;
  if (str(raw.finish_reason)) out.finishReason = str(raw.finish_reason);
  const reasoning = str(raw.reasoning) ?? str(raw.reasoning_content);
  if (reasoning) out.reasoning = reasoning;
  if (str(raw.display_kind)) out.displayKind = str(raw.display_kind);
  return out;
}

export function parseMessages(json: unknown, fallbackId: string): MessagesPage {
  const j = isObj(json) ? json : {};
  const data = Array.isArray(j.data) ? j.data : [];
  return {
    sessionId: str(j.session_id) ?? fallbackId,
    messages: data.map(parseMessage).filter((m): m is RemoteMessage => !!m),
  };
}

/** Server root (`/api/...` lives there): strips a trailing `/v1`. */
export function apiRoot(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

/**
 * True when the server does not offer the session API at all (older Hermes without `/api/sessions`,
 * the UI bridge, the mock): plain 404 / 405 / 501. A 404 for an unknown session id carries the code
 * `session_not_found` and is NOT "unsupported".
 */
export function isUnsupportedError(e: unknown): boolean {
  if (!(e instanceof HermesError)) return false;
  if (e.status === 405 || e.status === 501) return true;
  return e.status === 404 && e.code !== 'session_not_found';
}

export function isNotFoundError(e: unknown): boolean {
  return e instanceof HermesError && e.status === 404 && e.code === 'session_not_found';
}

export type ApiConn = { baseUrl: string; apiKey: string };

export type JsonRequest = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  timeoutMs?: number
) => Promise<unknown>;

/** Authenticated JSON request against the server root. Throws HermesError. */
export function createJsonRequest(fetchImpl: FetchLike, conn: ApiConn, defaultTimeoutMs = 15000): JsonRequest {
  const root = apiRoot(conn.baseUrl);
  return async (method, path, body, timeoutMs = defaultTimeoutMs) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${conn.apiKey}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return withRequestTimeout(timeoutMs, async (signal) => {
      const res = await fetchImpl(joinUrl(root, path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw await errorFromResponse(res);
      const text = await res.text();
      if (!text.trim()) return {};
      try {
        return JSON.parse(text);
      } catch {
        throw keyedHermesError('server', 'backends.hermes.errors.invalidJson', undefined, { status: res.status });
      }
    });
  };
}

export type ListParams = { source?: string; limit?: number; offset?: number };
export type MessagesParams = { order?: 'latest' | 'oldest'; limit?: number; offset?: number; includeCompacted?: boolean };

function query(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

const sessionPath = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;

export function createSessionsClient(fetchImpl: FetchLike, conn: ApiConn, timeoutMs = 15000) {
  const request = createJsonRequest(fetchImpl, conn, timeoutMs);
  return {
    async list(p: ListParams = {}): Promise<SessionPage> {
      return parseSessionList(await request('GET', `/api/sessions${query({ limit: p.limit ?? 50, offset: p.offset, source: p.source })}`));
    },
    async get(id: string): Promise<RemoteSession> {
      const j = await request('GET', sessionPath(id));
      const s = parseSession(isObj(j) ? j.session : undefined);
      if (!s) throw keyedHermesError('server', 'backends.hermes.errors.invalidSession');
      return s;
    },
    async messages(id: string, p: MessagesParams = {}): Promise<MessagesPage> {
      const q = query({
        order: p.order ?? 'latest',
        limit: p.limit,
        offset: p.offset,
        include_compacted: p.includeCompacted ? 'true' : undefined,
      });
      return parseMessages(await request('GET', `${sessionPath(id)}/messages${q}`), id);
    },
    async rename(id: string, title: string): Promise<RemoteSession | null> {
      const j = await request('PATCH', sessionPath(id), { title });
      return parseSession(isObj(j) ? j.session : undefined);
    },
    /**
     * Hermes v0.22 session model lock (`POST /api/sessions/{id}/model`, hermes/modelLock.ts):
     * → `{object:"hermes.session.model_lock", session_id, runtime:{provider, model, route_source, model_lock}}`.
     * 404 session_not_found before the first stored turn, 409 model_lock_unavailable / 400 missing_model when Hermes
     * cannot route the model.
     */
    async lockModel(id: string, model: string): Promise<{ model?: string; provider?: string }> {
      const j = await request('POST', `${sessionPath(id)}/model`, modelLockBody(model));
      const rt = isObj(j) && isObj(j.runtime) ? j.runtime : {};
      return { model: str(rt.model), provider: str(rt.provider) };
    },
    /** true when Hermes deleted it; a session that no longer exists counts as deleted */
    async remove(id: string): Promise<boolean> {
      try {
        const j = await request('DELETE', sessionPath(id));
        return isObj(j) ? j.deleted !== false : true;
      } catch (e) {
        if (isNotFoundError(e)) return true;
        throw e;
      }
    },
  };
}

export type SessionsClient = ReturnType<typeof createSessionsClient>;

/** German message for session API failures (drawer notices). */
export function sessionErrorText(e: unknown, t: TFn = deT): string {
  if (e instanceof HermesError) {
    if (e.code === 'session_active_turn') return t('backends.hermes.errors.sessionActiveTurn');
    if (e.code === 'invalid_title') return t('backends.hermes.errors.invalidTitle', { detail: e.message });
    if (isUnsupportedError(e)) return t('backends.hermes.errors.sessionApiUnsupported');
    if (e.kind === 'auth') return t('backends.hermes.errors.apiKeyInvalid');
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
