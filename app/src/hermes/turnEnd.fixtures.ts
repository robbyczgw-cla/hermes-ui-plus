/**
 * Wire fixtures of how a Hermes chat turn ends, for BOTH server generations (fake ids only):
 *  - v0.22.2: an interrupt ends with `finish_reason: "stop"`, `GET /v1/runs/{id}` carries `approval`, approval events
 *    have `pattern_key` and no `execution_generation`.
 *  - v0.22.5 ("unified gateway", same shapes since v0.22.3): `cancelled` / `length` + `hermes.error_code` / `error` with a
 *    bare reason code, run status with `pending_controls`, approval events with `execution_generation` + `timeout_s`.
 * Shapes read from the v0.22.5 source (gateway/platforms/api_server_openai_routes.py `_write_sse_chat_completion`,
 * `_finish_reason`; api_server_authority_runs.py `run_projection`).
 */

export const FAKE_COMPLETION_ID = 'chatcmpl-test-0000000000000000';
export const FAKE_REQUEST_ID = 'apr_test_00000000';
export const FAKE_SESSION_ID = 'sess_test_00000000';

type Json = Record<string, unknown>;

const chunk = (delta: Json, finish: string | null = null, extra: Json = {}): Json => ({
  id: FAKE_COMPLETION_ID,
  object: 'chat.completion.chunk',
  created: 1_800_000_000,
  model: 'hermes-agent',
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...extra,
});

const usage = { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 };

/** SSE body: the given data frames (objects, or raw strings) and named events, then `[DONE]` */
export function sseBody(frames: (Json | string | { event: string; data: Json })[], done = true): string {
  let out = '';
  for (const f of frames) {
    if (typeof f === 'string') out += `data: ${f}\n\n`;
    else if ('event' in f && typeof f.event === 'string') out += `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`;
    else out += `data: ${JSON.stringify(f)}\n\n`;
  }
  return done ? `${out}data: [DONE]\n\n` : out;
}

const start = chunk({ role: 'assistant' });
const text = (t: string) => chunk({ content: t });

/** the final chunk of a v0.22.5 turn that did not end with `stop` */
function finalChunk(reason: string, hermes: Json, error?: { message: string; type: string }, use: Json = usage): Json {
  return chunk({}, reason, { usage: use, ...(error ? { error } : {}), hermes: { completed: false, ...hermes } });
}

const noUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

// ------------------------------------------------------------------ v0.22.2

export const V0222 = {
  /** the user pressed Stop / a watchdog interrupted: v0.22.2 still says `stop` (partial text, no hermes block) */
  interruptedStop: sseBody([start, text('Ich fange an'), chunk({}, 'stop', { usage })]),
  /** approval event: pattern_key, no execution_generation, no timeout */
  approvalEvent: {
    request_id: FAKE_REQUEST_ID,
    run_id: FAKE_COMPLETION_ID,
    command: 'rm -rf build/',
    description: 'recursive delete',
    pattern_key: 'rm_recursive',
    choices: ['once', 'session', 'always', 'deny'],
    timestamp: 1_800_000_000,
  },
  /** GET /v1/runs/{id} while it waits: the legacy `approval` object */
  runWaiting: (): Json => ({
    object: 'hermes.run',
    run_id: FAKE_COMPLETION_ID,
    status: 'waiting_for_approval',
    approval: { ...V0222.approvalEvent },
  }),
};

// ------------------------------------------------------------------ v0.22.5

export const V0225 = {
  /**
   * interrupted (user Stop, watchdog): `cancelled`, partial text kept. Final chunk as a live v0.22.5 sends it after a
   * stop via the run API: `error: null`, `error_code: "agent_error"`, no top-level `error`.
   */
  cancelled: sseBody([start, text('Ich fange an'), finalChunk('cancelled', { partial: false, failed: false, error: null, error_code: 'agent_error' })]),
  /** interrupted before any text */
  cancelledEmpty: sseBody([start, finalChunk('cancelled', { partial: false, failed: false, error: null, error_code: 'agent_error' })]),
  /** output truncated */
  truncated: sseBody([
    start,
    text('Lange Liste: 1, 2, 3'),
    finalChunk('length', { partial: true, failed: false, error: 'Response truncated due to output length limit', error_code: 'output_truncated' }, { message: 'Response truncated due to output length limit', type: 'agent_error' }),
  ]),
  /** iteration budget exhausted (v0.22.5 only): `length` + error_code */
  stepLimit: sseBody([
    start,
    text('Ich habe drei Dateien geprüft.'),
    finalChunk('length', { partial: true, failed: false, error: 'Iteration budget exhausted', error_code: 'iteration_budget_exhausted' }, { message: 'Iteration budget exhausted', type: 'agent_error' }),
  ]),
  /**
   * a refusal of the session authority (live v0.22.5: a follow-up into a chat paused by a hard restart, or a write to
   * the Bot Chat): HTTP 200, NO content or role delta, one final chunk with a bare reason code, [DONE]
   */
  refused: (code: string) =>
    sseBody([finalChunk('error', { completed: true, partial: false, failed: true }, { message: code, type: 'RuntimeStoreError' }, noUsage)]),
  /** an agent error with a human message */
  agentError: sseBody([
    start,
    text('Teil 1'),
    finalChunk('error', { partial: true, failed: true, error: '  Provider returned 500: upstream overloaded \n', error_code: 'agent_error' }, { message: '  Provider returned 500: upstream overloaded \n', type: 'APIError' }),
  ]),
  /** an error finish without any message (server crash mid-stream) */
  errorNoMessage: sseBody([start, chunk({}, 'error')]),
  /** a future finish reason this app does not know, without text */
  futureEmpty: sseBody([start, chunk({}, 'content_filter', { usage })]),
  /** a future finish reason with text */
  futureText: sseBody([start, text('Antwort'), chunk({}, 'content_filter', { usage })]),
  /** approval event: execution_generation + timeout_s, no pattern_key */
  approvalEvent: {
    request_id: FAKE_REQUEST_ID,
    run_id: FAKE_COMPLETION_ID,
    command: 'rm -rf build/',
    description: 'recursive delete',
    choices: ['once', 'session', 'always', 'deny'],
    execution_generation: 3,
    timeout_s: 120,
  },
  /** GET /v1/runs/{id} (run_projection): pending_controls, no `approval` */
  run: (status: string, pending: Json[] = []): Json => ({
    pending_controls: pending,
    run_id: FAKE_COMPLETION_ID,
    status,
    session_id: FAKE_SESSION_ID,
    admission_id: 'adm_test_00000000',
    execution_generation: 3,
    output: '',
    usage: {},
  }),
  /** one pending approval control as run_projection lists it */
  pendingApproval: (promptId = FAKE_REQUEST_ID): Json => ({
    kind: 'approval',
    prompt_id: promptId,
    execution_generation: 3,
    command: 'rm -rf build/',
    description: 'recursive delete',
    choices: ['once', 'deny', 'session', 'always'],
    timeout_s: 120,
  }),
  /** a pending clarify control (not an approval: ignored by the approval restore) */
  pendingClarify: (): Json => ({ kind: 'clarify', prompt_id: 'clr_test_00000000', execution_generation: 3, question: 'Which one?', choices: ['a', 'b'] }),
  /** non-streaming refusal (HTTP 409 / 503): OpenAI error JSON */
  httpRefusal: (code: string): Json => ({ error: { message: code, type: 'invalid_request_error', param: null, code } }),
  /** GET /v1/runs/{id} after a hard restart: the cut turn's chat completion id is unknown */
  runNotFound: (): Json => ({ error: { message: `Run not found: ${FAKE_COMPLETION_ID}`, type: 'invalid_request_error', param: null, code: 'run_not_found' } }),
};

/** every reason code the session authority sends (wire) */
export const REASON_CODES = [
  'permission_denied',
  'unknown_execution',
  'queue_full',
  'runtime_draining',
  'storage_unavailable',
  'admission_conflict',
  'session_deleted',
  'not_found',
  'admission_queued',
  'chain_moved',
  'bot_chat_unbound',
] as const;
