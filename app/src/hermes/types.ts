/**
 * Hermes client types. Only erasable TS syntax (no enums/namespaces) so Node can run the tests.
 * Wire details: docs/HERMES-API.md
 */
import type { RouteDecision } from '../protocol/types';
import type { Attachment } from '../attachments/types';
import type { TKey, Vars } from '../i18n/core.ts';
import type { TurnExtras } from './turnOverride';
import type { LiveBatches } from '../live/trailer.ts';

export type { RouteDecision };

export type ToolStatus = 'running' | 'done' | 'error';

export type ToolEvent = {
  /** Hermes `toolCallId` */
  id: string;
  /** function name, e.g. `terminal` */
  name: string;
  /** short human preview of the main argument (e.g. the shell command) or the tool name */
  label: string;
  status: ToolStatus;
  startedAt: number;
  endedAt?: number;
  /** emoji Hermes associates with the tool */
  emoji?: string;
  // ---- additions ("Werkzeug-Details"; never remove fields above) ----
  /** structured input/output for the detail view (Claude server tools; Hermes only sends a preview) */
  detail?: ToolDetail;
  /** raw wire payloads as received (Hermes: the hermes.tool.progress frames). Capped when persisted. */
  raw?: unknown[];
  /**
   * Hermes: length of the assistant text when this call started (live: first `hermes.tool.progress`; history:
   * the joined texts before the row's tool_calls). Text before such a cut is an interim note ("Ich schaue kurz
   * nach…"), not part of the final answer (hermes/progressNotes.ts). Offsets refer to `ChatMessage.text`.
   */
  textAt?: number;
};

export type ToolLink = {
  title: string;
  url: string;
  /** e.g. Claude web search `page_age`, WSP `[published 2026-10-14]` */
  age?: string;
  /** search result snippet (untrusted, plain text) */
  snippet?: string;
  /** extract: the page could not be read (WSP `Error: …` line, clipped) */
  failed?: string;
};

/**
 * Parsed web search / extract result (hermes/webResults.ts), stored with the tool detail. Everything is optional:
 * generic tools give a count at most, Web Search Plus (WSP) fills in routing, cache and research facts.
 */
export type ToolWebMeta = {
  provider?: string;
  count?: number;
  cached?: boolean;
  /** cache age in seconds (WSP header `cached 42s ago`, JSON `cache_status.age_seconds`) */
  cacheAgeS?: number;
  /** true = auto-routed, false = provider chosen explicitly; absent = unknown */
  auto?: boolean;
  /** routing confidence (`high` | `medium` | `low`) */
  confidence?: string;
  /** query type the router recognised (WSP intent: `news`, `docs`, `academic`, …) */
  queryType?: string;
  /** the query asked for recent results (WSP `recency query`) */
  recency?: boolean;
  /** requested freshness filter and the providers that applied it */
  freshness?: { requested: string; appliedBy?: string[]; notApplied?: string[] };
  /** research mode: pages read in full (header `pages=`, else counted from the source summaries) */
  research?: { pages: number };
  /** research mode: providers whose results were merged (header `providers=a,b,c`, WSP 5.1.2) */
  providers?: string[];
  /** providers that failed or came back empty before the serving one, in order (header `fallback_from=a,b`, WSP 5.1.2) */
  fallbackFrom?: string[];
  /** hit count the tool itself reported (header `results=N`); `count` follows it when present */
  reportedCount?: number;
  /** header `key=value` bits this app does not know: kept for forward compatibility, never shown */
  extras?: Record<string, string>;
  /** providers tried in order (WSP JSON `provider_attempts`) */
  attempts?: { provider: string; outcome: string; ms?: number; results?: number }[];
  /** time the tool itself reported */
  elapsedMs?: number;
  /** a failed call: the error line and the reason per provider */
  error?: string;
  providerErrors?: { provider: string; reason: string }[];
};

/** Extra per-tool details for the "Werkzeuge & Ablauf" panel. All optional. */
export type ToolDetail = {
  /** raw function / server-tool name when `ToolEvent.name` is a display name */
  tool?: string;
  /** tool input (Claude: server_tool_use.input, e.g. {query} / {url} / {code}) */
  input?: unknown;
  /** sanitized result (search hits, fetched page meta, stdout/stderr/return code); no encrypted blobs */
  output?: unknown;
  /** short one-line result summary, e.g. "8 Treffer" / "Exit 0" */
  summary?: string;
  /** web search hits / fetched pages (tappable) */
  links?: ToolLink[];
  /** parsed web search / extract result (hermes/webResults.ts): provider, hit count, cache, routing – when known */
  web?: ToolWebMeta;
  /** server error code of a failed tool result */
  errorCode?: string;
  /**
   * the tool was still running when the turn ended without a tool failure (connection lost / stopped):
   * shown neutral as "abgebrochen" (status stays `done` for older readers)
   */
  cancelled?: boolean;
};

/** Non-tool steps of a turn, in arrival order (timeline of the "Werkzeuge & Ablauf" panel). */
export type TraceKind =
  | 'route' // bridge hermes.ui.route (details: ChatMessage.route)
  | 'status' // hermes.status
  | 'approval' // approval.request
  | 'approval_answer' // the outcome (text = once|session|always|deny|expired|cancelled, data.requestId)
  | 'thinking' // reasoning / thinking block (data: {from, to} offsets into ChatMessage.reasoning)
  | 'fallback' // Claude server-side refusal fallback (data: {from, to, trigger})
  | 'request'; // Claude pause_turn continuation request

export type TraceStep = {
  id: string;
  kind: TraceKind;
  at: number;
  endedAt?: number;
  /** server/human text: status line, approval command, answer choice */
  text?: string;
  /** small structured payload (status kind, approval request, fallback models, thinking offsets) */
  data?: unknown;
};

/** Per-turn numbers for the footer ("Sonnet 5.5 · 3 Werkzeuge · 14,2 s · 18,7k in / 1,2k out · Cache 92 %"). */
export type TurnMetrics = {
  /** first visible answer token (time to first token = firstTokenAt - createdAt) */
  firstTokenAt?: number;
  endedAt?: number;
  /** model reported by the server (Claude: actually used, differs after a fallback) */
  model?: string;
  /** API requests in this turn (Claude: 1 + pause_turn continuations) */
  requests?: number;
  /** uncached input tokens (Claude `input_tokens`; Hermes: prompt_tokens) */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  webSearchRequests?: number;
  webFetchRequests?: number;
};

export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

/** `event: approval.request` payload (docs/HERMES-API.md). */
export type ApprovalRequest = {
  /** chat completion id = run id; used in `POST /v1/runs/{runId}/approval` */
  runId: string;
  requestId?: string;
  /** redacted command text */
  command: string;
  description: string;
  patternKey?: string;
  choices: ApprovalChoice[];
  smartDenied?: boolean;
  timestamp: number;
  // ---- additions (approval hardening, hermes/approvals.ts) ----
  /** server deadline (ms since epoch) if the event / run status carries one (`expires_at`); Hermes v0.21 does not */
  expiresAt?: number;
  /** server-advertised wait (`timeout` in the event or `approvals.timeout` from /v1/capabilities), seconds */
  timeoutSeconds?: number;
  /** ms (device clock) when the app received the request (live event or restored from GET /v1/runs/{id}) */
  receivedAt?: number;
  /** effective deadline in device ms (resolveDeadline): server value, else start + advertised timeout, else +300 s */
  deadlineAt?: number;
  /** true once the deadline passed: Hermes denied it ("silence is not consent"); the card stays, buttons disabled */
  expired?: boolean;
  /** rebuilt from GET /v1/runs/{id} or a recorded stream after a drop / restart */
  restored?: boolean;
  /** server clock (ms) when a replayed event arrived, from the bridge advancing the original upstream clock */
  serverNowMs?: number;
};

/** Outcome of an approval request in the persistent history (ChatMessage.approvalLog). */
export type ApprovalOutcome = ApprovalChoice | 'expired' | 'cancelled';

/** One compact, persisted history row: "✓ Erlaubt (einmal): rm -rf build/". */
export type ApprovalRecord = {
  requestId?: string;
  /** original server timestamp (seconds): replay identity when no request id was supplied */
  timestamp?: number;
  runId: string;
  /** redacted command, capped */
  command: string;
  description?: string;
  outcome: ApprovalOutcome;
  /** ms when the request arrived */
  requestedAt: number;
  /** ms of the outcome */
  at: number;
};

export type Usage = { promptTokens: number; completionTokens: number; totalTokens: number };

export type MessageStatus = 'streaming' | 'done' | 'error' | 'stopped';

/** quick answer marker on an assistant message (see ChatMessage.quick) */
export type QuickStamp = { model?: string; ms?: number };

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tools: ToolEvent[];
  route?: RouteDecision;
  status: MessageStatus;
  error?: string;
  createdAt: number;
  // ---- additions (never remove fields above) ----
  /** `delta.reasoning_content` ("thinking"), if the model streams it */
  reasoning?: string;
  /** transient `hermes.status` line (provider wait, retry, compaction); cleared when text resumes */
  statusNote?: string;
  /**
   * first pending approval of this turn (head of `pendingApprovals`, kept in sync by hermes/approvals.ts);
   * cleared once answered or the turn ends. Runtime only (not persisted).
   */
  approval?: ApprovalRequest;
  /** server finish_reason when the stream ended normally */
  finishReason?: string;
  /** true when finish_reason was `length` (output truncated) */
  truncated?: boolean;
  /**
   * the app shortened `text` (marker `[…]` at the cut): over MAX_MESSAGE_TEXT while streaming (hermes/chatState.ts) or
   * over STORED_TEXT_MAX when persisted (conversations/messages.ts). The answer shows a notice.
   */
  textCapped?: boolean;
  usage?: Usage;
  /** chat completion id of this turn */
  completionId?: string;
  /** user messages only: images/files sent with this turn (metadata + local uri, never base64) */
  attachments?: Attachment[];
  /**
   * user messages only: a stored message carried hidden app text (`[hui:note]` / `[hui:context]`, hermes/turnOverride.ts)
   * that was cut from `text` when the transcript was loaded; the bubble shows a compact chip instead.
   */
  turnExtras?: TurnExtras;
  /**
   * user messages only: the user's live-card edits this message carried to Hermes (`[hui:live]` trailer, live/trailer.ts),
   * cut from `text`; the bubble shows a quiet "… mitgeschickt" line and the live cards fold them (live/model.ts).
   */
  live?: LiveBatches;
  /**
   * Hermes hid rows of its stored history right before this message (context compaction scaffolding): what came
   * before may be gone from the model's context (live cards re-send their full state, live/extract.ts)
   */
  contextCut?: true;
  /**
   * user messages only: sent while attachment uploads were still running (hermes/pendingSend.ts). The bubble shows
   * per-attachment progress; the turn starts when every upload is done. Runtime only: persisted as `sendQueued`.
   */
  sendPending?: boolean;
  /**
   * user messages only: a send that was still waiting for its uploads when the app stopped (persisted form of
   * `sendPending`, hermes/pendingSend.ts). Not sent: the bubble offers "Erneut senden" / "Verwerfen", never automatic.
   */
  sendQueued?: boolean;
  /**
   * user messages only: the turn request of this message has started but the bridge / Hermes has not accepted it yet
   * (runtime, hermes/pendingSend.ts "durable send"). Persisted as `sendQueued` with its `sendKey`, without the answer
   * placeholder: a kill before the acknowledgement restores it as "Nicht gesendet".
   */
  sendUnacked?: boolean;
  /** non-tool timeline steps (route, status, approval, thinking, fallback, continuation) */
  trace?: TraceStep[];
  /** timing / token numbers of this turn */
  metrics?: TurnMetrics;
  /**
   * error messages: stable i18n key + params of `error`, translated at render time (messageErrorText).
   * `error` keeps the German text (older builds, logs, server messages without a key).
   */
  errorText?: { key: TKey; params?: Vars };
  /**
   * user messages: IANA time zone of the device when the message was sent. The date context sent to
   * the model on replay is formatted in this zone, so a later zone change does not shift past turns.
   */
  timeZone?: string;
  /**
   * Hermes assistant messages: ms when the stream was lost AFTER Hermes accepted the turn (network switch, app in
   * the background). With status `stopped` the answer is being recovered (live inbox / stored session, recovery.ts);
   * with status `error` recovery gave up – "Erneut" first checks the stored session so a finished turn is not re-sent.
   */
  interrupted?: number;
  /**
   * Hermes assistant messages: `Idempotency-Key` the turn was sent with (hermes/idempotency.ts). A retry of a send
   * that never showed an answer re-uses it, so the UI bridge never runs the same message twice. Also on a user
   * message while its turn is unacknowledged (`sendUnacked`) and on its stored queued form: "Erneut senden" re-uses it.
   */
  sendKey?: string;
  /**
   * Hermes assistant messages: the UI bridge recorded this turn under `sendKey` (`X-Hermes-UI-Resume: 1`). A lost stream
   * – also one persisted unfinished by an app that was killed – re-attaches live at the bridge (stream.ts `resumeFrom`)
   * instead of waiting for the stored session. Dropped once the bridge refused the re-attach.
   */
  resumable?: true;
  /**
   * runtime only: ms when the resumable stream of this (streaming) answer was lost; it is re-attaching meanwhile
   * ("Verbindung unterbrochen – verbinde neu…"). Cleared when bytes arrive again or the turn ends.
   */
  reconnecting?: number;
  /**
   * direct backends (no server-side run): ms when the stream died while the app was in the
   * background. Shown as a calm notice with "Fortsetzen" / "Neu starten" instead of a red error (background/cut.ts).
   */
  cutInBackground?: number;
  /** ms of the last "Fortsetzen": the continuation was appended to this message */
  continuedAt?: number;
  /** ms when a lost answer was filled in later (Hermes recovery: inbox / stored session) – "nachgeladen" cue */
  recoveredAt?: number;
  /** all pending approvals of this turn (queue, oldest first; runtime only, rebuilt via GET /v1/runs/{id}) */
  pendingApprovals?: ApprovalRequest[];
  /** persistent history of this turn's approvals (answered / expired / cancelled) */
  approvalLog?: ApprovalRecord[];
  /**
   * quick answers (app/src/quick): the answer came from the fast quick model, not from the Hermes agent. Drives the
   * "⚡ model · 1,6 s" meta line and the context label when it is handed to a Hermes chat. `ms` = time to first token.
   */
  quick?: QuickStamp;
};

export type HermesConn = {
  /** OpenAI-compatible base URL incl. `/v1`, e.g. http://192.0.2.10:8642/v1 */
  baseUrl: string;
  apiKey: string;
  model?: string;
  /** X-Hermes-Session-Key (memory scope). Default `hermes-ui`. */
  sessionKey?: string;
  /**
   * Send the bootstrap system message (bootstrap.ts) with every request. Default true; set false
   * when baseUrl points to the UI bridge, which injects it itself.
   */
  bootstrap?: boolean;
  /** baseUrl is the UI bridge → files are uploaded via POST /bridge/uploads (profile.bridge) */
  bridge?: boolean;
};

export type ChatStatus = 'idle' | 'streaming' | 'error';

export type HermesErrorKind =
  | 'auth' // 401
  | 'forbidden' // 403
  | 'bad_request' // other 4xx
  | 'rate_limit' // 429
  | 'busy' // 503 (draining)
  | 'server' // 5xx
  | 'network' // fetch failed
  | 'timeout' // no bytes for too long
  | 'stream' // stream ended unexpectedly / agent error finish
  | 'aborted';

/** Normalised events produced from the SSE stream (see events.ts). */
export type HermesEvent =
  | { type: 'start'; completionId: string; model?: string }
  | { type: 'text'; text: string }
  /** the answer text so far is replaced as a whole (`event: hermes.text.replace`, e.g. a final message that differs
   *  from the live draft streamed before it) */
  | { type: 'textReplace'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool';
      callId: string;
      name: string;
      status: ToolStatus;
      label?: string;
      emoji?: string;
      /** the wire payload as received */
      raw?: Record<string, unknown>;
      /** structured details (e.g. web search citations); merged into ToolEvent.detail */
      detail?: ToolDetail;
    }
  | { type: 'status'; kind: string; text: string }
  | { type: 'route'; route: RouteDecision }
  | { type: 'approval'; approval: ApprovalRequest }
  | {
      type: 'finish';
      reason: string;
      usage?: Usage;
      error?: string;
      errorCode?: string;
      partial?: boolean;
    }
  | { type: 'error'; message: string; code?: string }
  | { type: 'done' };
