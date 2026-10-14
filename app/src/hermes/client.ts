/**
 * Hermes API client bound to `expo/fetch` (streaming response bodies on native, SDK 57;
 * on web `expo/fetch` is the browser's fetch). All logic lives in stream.ts (tested).
 */
import { fetch as expoFetch } from 'expo/fetch';
import {
  answerApprovalCore,
  fetchRunStatusCore,
  respondApprovalCore,
  streamChatCore,
  joinUrl,
  errorFromResponse,
  HermesError,
  type FetchLike,
  type StreamChatParams,
  type StreamChatResult,
} from './stream';
import type { ApprovalChoice, ApprovalRequest, HermesConn } from './types';
import type { RunStatus } from './approvals';
import { hermesFetchFailure, stopBridgeTurnCore } from './stream.ts';
import { createJsonRequest, createSessionsClient, type ApiConn, type SessionsClient } from './sessions';
import { reportReachable } from '../chat/healthMachine';
import { parseCapabilities, parseModelOptions, type HermesCapabilities, type ModelOptionsCatalog } from './capabilities';

export { HermesError, isHermesError } from './stream';
export type { StreamChatParams, StreamChatResult } from './stream';

// expo/fetch's FetchResponse is structurally compatible with FetchResponseLike (ok/status/headers/body/text).
const rawFetch = expoFetch as unknown as FetchLike;
// every response also tells the chat header that the server is reachable again (healthMachine.reportReachable)
const nativeFetch: FetchLike = async (url, init) => {
  const res = await rawFetch(url, init);
  try {
    reportReachable(String(url), res.status);
  } catch {
    // status reporting must never break a request
  }
  return res;
};

/**
 * POST /chat/completions with stream:true and parse the SSE stream into HermesEvents.
 * Resolves when the turn is finished (or aborted: `result.aborted`); rejects with HermesError.
 * Abort via `params.signal` – closing the connection makes Hermes interrupt the agent (direct Hermes; the UI
 * bridge keeps the run going and needs `stopBridgeTurn` for a deliberate stop).
 */
export function streamChat(params: StreamChatParams): Promise<StreamChatResult> {
  return streamChatCore(nativeFetch, params);
}

/** Answer an `approval.request` while its stream is still open. */
export function respondApproval(
  conn: HermesConn,
  approval: Pick<ApprovalRequest, 'runId' | 'requestId'>,
  choice: ApprovalChoice
): Promise<void> {
  return respondApprovalCore(nativeFetch, conn, approval, choice);
}

/** Answer with the late-tap guard (expired → no request; see stream.ts answerApprovalCore). */
export function answerApproval(conn: HermesConn, approval: ApprovalRequest | undefined, choice: ApprovalChoice, now = Date.now(), opts?: { retryOf?: ApprovalChoice }): Promise<void> {
  return answerApprovalCore(nativeFetch, conn, approval, choice, now, opts);
}

/** GET /v1/runs/{runId}: run status + pending approval (restore after a lost stream / restart). */
export function fetchRunStatus(conn: HermesConn, runId: string, timeoutMs?: number): Promise<RunStatus> {
  return fetchRunStatusCore(nativeFetch, conn, runId, timeoutMs);
}

/** UI bridge: stop the Hermes run of a session (the bridge keeps runs alive when the app's connection drops). */
export function stopBridgeTurn(conn: HermesConn, sessionId: string): Promise<void> {
  return stopBridgeTurnCore(nativeFetch, conn, sessionId);
}

export type HealthResult = { ok: true; version?: string } | { ok: false; error: HermesError };

/** GET /health (no auth) – for the settings "test connection" button. */
export async function checkHealth(conn: HermesConn, timeoutMs = 8000): Promise<HealthResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // /health lives at the server root, the base URL ends in /v1
    const root = conn.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
    const res = await nativeFetch(joinUrl(root, '/health'), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: await errorFromResponse(res) };
    let version: string | undefined;
    try {
      const j = JSON.parse(await res.text()) as { version?: unknown };
      if (typeof j.version === 'string') version = j.version;
    } catch {
      // not JSON: still reachable
    }
    return { ok: true, version };
  } catch (e) {
    return {
      ok: false,
      error: hermesFetchFailure(e, ctrl.signal.aborted),
    };
  } finally {
    clearTimeout(t);
  }
}

/** GET /models with the API key – verifies URL + key. Returns model ids. */
export async function listModels(conn: HermesConn, timeoutMs = 8000): Promise<string[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await nativeFetch(joinUrl(conn.baseUrl, '/models'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${conn.apiKey}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw await errorFromResponse(res);
    const j = JSON.parse(await res.text()) as { data?: { id?: unknown }[] };
    return (j.data ?? []).map((m) => m.id).filter((x): x is string => typeof x === 'string');
  } catch (e) {
    if (e instanceof HermesError) throw e;
    throw hermesFetchFailure(e, ctrl.signal.aborted);
  } finally {
    clearTimeout(t);
  }
}

/** Hermes-native session API (`/api/sessions…`) bound to expo/fetch. See sessions.ts. */
export function hermesSessions(conn: ApiConn, timeoutMs?: number): SessionsClient {
  return createSessionsClient(nativeFetch, conn, timeoutMs);
}

/** GET /v1/capabilities → parsed flags/endpoints (null when the server answers something else). Throws HermesError. */
export async function fetchCapabilities(conn: ApiConn, timeoutMs = 8000): Promise<HermesCapabilities | null> {
  return parseCapabilities(await createJsonRequest(nativeFetch, conn, timeoutMs)('GET', '/v1/capabilities'));
}

/** GET /api/model/options (provider catalog with per-model reasoning/fast capabilities). Throws HermesError. */
export async function fetchModelOptions(conn: ApiConn, timeoutMs = 12000): Promise<ModelOptionsCatalog | null> {
  return parseModelOptions(await createJsonRequest(nativeFetch, conn, timeoutMs)('GET', '/api/model/options'));
}
