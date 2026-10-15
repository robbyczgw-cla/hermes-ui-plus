/**
 * One quick answer from the bridge: POST /bridge/quick/v1/chat/completions (SSE), parsed by the same streaming
 * core as a Hermes turn (hermes/stream.ts – idle timeout, abort, JSON fallback, error mapping incl. Retry-After) and
 * mapped to the same HermesEvents, so the chat state and the hui renderer are shared. The fetch is injected
 * (client binding in hooks.ts, fake fetch in stream.test.ts).
 */
import { streamChatCore, type FetchLike, type StreamChatResult } from '../hermes/stream.ts';
import type { HermesEvent } from '../hermes/types.ts';
import { buildQuickRequest, type QuickConn, type QuickModel, type QuickTurn } from './core.ts';

export type StreamQuickParams = {
  conn: QuickConn;
  history: readonly QuickTurn[];
  model?: QuickModel;
  lang?: string;
  signal?: AbortSignal;
  onEvent: (ev: HermesEvent) => void;
  /** no bytes for this long → timeout (the plugin's first-byte timeout is 20 s) */
  idleTimeoutMs?: number;
};

export function streamQuickCore(fetchImpl: FetchLike, p: StreamQuickParams): Promise<StreamChatResult> {
  return streamChatCore(fetchImpl, {
    conn: { baseUrl: p.conn.baseUrl, apiKey: p.conn.apiKey },
    text: '',
    sessionId: 'quick',
    signal: p.signal,
    onEvent: p.onEvent,
    idleTimeoutMs: p.idleTimeoutMs ?? 30_000,
    request: buildQuickRequest(p.conn, p.history, { model: p.model, lang: p.lang }),
  });
}
