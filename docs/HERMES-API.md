# Hermes Agent API server – wire reference (v0.21.4)

Source of truth: the Hermes Agent source, `gateway/platforms/api_server.py` (**AS**),
`api_server_openai_routes.py` (**OR**), `api_server_runs.py` (**RUNS**), approval logic in
`tools/approval.py` + `approval_gateway_wait.py` (**APPR**). Line refs are `file:line`
as of 2026-10-10 (file mtime Oct 9). Everything marked **[verified]** was also confirmed with a real
call (fixtures in `mock-server/fixtures/`); the rest is from source only.

- Base URL: `http://127.0.0.1:8642` by default (`platforms.api_server.extra` `host` / `port`). OpenAI-style routes live under `/v1`.
- Auth: `Authorization: Bearer <API_SERVER_KEY>` (AS:1559-1581, constant-time compare).
  Server refuses to start without a strong key (AS:4427-4455).
- Every chat request runs the real Hermes agent (terminal-capable, with its full system prompt and memory, about 20k prompt tokens per turn on a typical setup). Keep test traffic against a real server small.

## Endpoints (route table AS:1718-1766, RUNS:234-240)

Every path is also mirrored under `/p/<profile>/…` (profile multiplexing; ignore).

| Method + path | Auth | Notes |
|---|---|---|
| `GET /health`, `GET /v1/health` | none | `{"status":"ok","platform":"hermes-agent","version":"…"}` (AS:2425) |
| `GET /health/detailed` | yes | gateway state, platforms, pid |
| `GET /v1/models` | yes | **[verified]** `{"object":"list","data":[{id,object:"model",created,owned_by:"hermes",permission:[],root,parent}]}`; ids: `hermes-agent` (default/virtual) plus one per configured `model_routes` entry (AS:2475-2489) |
| `GET /v1/capabilities` | yes | feature flags: `tool_progress_events`, `approval_events`, `run_approval_response`, `reasoning_streaming`, `session_continuity_header:"X-Hermes-Session-Id"`, `session_key_header:"X-Hermes-Session-Key"` (AS:68-77, 2512) |
| `POST /v1/chat/completions` | yes | **the one the app uses** (OR:636). Streaming + non-streaming |
| `POST /v1/responses`, `GET/DELETE /v1/responses/{id}` | yes | OpenAI Responses API (OR:1060+); different SSE events (`response.*`); not used |
| `POST /v1/runs`, `GET /v1/runs/{id}`, `GET /v1/runs/{id}/events` (SSE), `POST /v1/runs/{id}/approval`, `/steer`, `/stop` | yes | structured runs API (RUNS:234). **`/approval` also resolves approvals of a streaming chat completion** (see below) |
| `GET/POST /api/sessions`, `GET/PATCH/DELETE /api/sessions/{id}`, `GET /api/sessions/{id}/messages`, `POST …/fork`, `POST …/chat`, `POST …/chat/stream`, `POST …/model` | yes | Hermes-native session API (server root, not `/v1`). Used for drawer sync, transcript restore and tool details – see "Sessions API" below |
| `GET /api/model/options` | yes | provider/model catalog with per-model `capabilities` (reasoning/fast) – see "Capabilities + model_options" |
| `GET /v1/skills`, `/v1/toolsets`, `/api/jobs…`, artifacts, browser-control | yes | out of scope |

CORS (AS:797-800, 1470-1493, 811-826): **browsers get 403 for every request carrying an `Origin` header**
unless `platforms.api_server.extra.cors_origins` / `API_SERVER_CORS_ORIGINS` lists the origin (or `*`) –
not set by default. Native apps send no `Origin`, so they are unaffected. Even when enabled:
`Access-Control-Allow-Headers` is only `Authorization, Content-Type, Idempotency-Key, X-Hermes-Session-Id`
(**no `X-Hermes-Session-Key`**) and there is **no `Access-Control-Expose-Headers`**, so a web page can neither send
the session key nor read `X-Hermes-Session-Id`. => Web preview must use the mock server (or a bridge/proxy).
Set `API_SERVER_CORS_ORIGINS` only if a web build must talk to Hermes directly; the bridge serves the web app on its
own origin instead.

## `POST /v1/chat/completions` (OR:636-884)

### Request
```jsonc
{
  "model": "hermes-agent",        // optional. "hermes-agent" = gateway default. Other ids only if listed in /v1/models (model_routes alias)
  "stream": true,                 // bool or "true"/"false"/"1"/"0" strings (AS:279)
  "messages": [ {"role":"user","content":"…"} ],
  // optional: "provider", "model_options" {…reasoning etc.}, "metadata" {…relay metadata},
  //           "hermes_notification_category": "diagnostic" (only with X-Hermes-Session-Id; presentation only)
}
```
- `messages` required, non-empty array, else 400 `{"error":{"message":"Missing or invalid 'messages' field","type":"invalid_request_error"}}`.
- `role: "system"` entries are concatenated into an **ephemeral system prompt layered on top of the core prompt**.
  The app sends the bootstrap system message (`app/src/hermes/bootstrap.ts`, copy of `hermes-skill/bootstrap-system-message.txt`) as the first
  message of **every** request, also when continuing with `X-Hermes-Session-Id`; it is ephemeral (not persisted). It only feeds the
  fingerprint session id on the header-less path, which the app never uses. Byte-identical text keeps prompt caching effective.
  `conn.bootstrap = false` disables it (bridge injects it itself).
- Only the **last** `user`/`assistant` message is the new user turn (`user_message = conversation_messages[-1]`);
  everything before it is `history` (OR:577-598).
- `content` may be a string or an OpenAI content-part array (`text`, `image_url` with https or `data:` URLs;
  validated by `_normalize_multimodal_content`, ≤1000 parts, ≤64 KB per text part). Body limit 10 MB (AS:233).
- There is **no `hermes_*` request field** besides `hermes_notification_category`. Hermes-specific knobs are headers.
- `Idempotency-Key` header only applies to non-streaming requests (OR:786-797).

### Request headers
| Header | Meaning |
|---|---|
| `Authorization: Bearer …` | required |
| `X-Hermes-Session-Id: <id>` | **Continue (or name) a session.** History is loaded **server-side from state.db**, the request's earlier `messages` are ignored. Requires API key (else 403). Max 256 chars, no CR/LF/NUL/path-unsafe chars (else 400 `Invalid session ID`). An id from before a context-compression rotation is transparently mapped to the live tip (OR:684-731). |
| `X-Hermes-Session-Key: <key>` | **Memory/routing scope per channel**, independent of the session id: the key persists across transcripts (`/new` rotates the id, not the key). It is bound to the agent turn (`gateway_session_key`, AS:2348, 4225, 2282) → scopes long-term/provider memory and per-key model overrides, and tags the session row as `source=api_server`. Max 256 chars, no CR/LF/NUL (AS:1825-1845). Echoed back in the response. |
| `Idempotency-Key` | non-stream only |

**The app uses `X-Hermes-Session-Key: hermes-ui-dev`** (configurable via `conn.sessionKey`) so UI traffic never mixes with the
Telegram scope. The global files (MEMORY.md/USER.md/SOUL.md) are still part of the agent prompt – only key-scoped memory is separated.

### Session semantics (important)
- **With** `X-Hermes-Session-Id`: server uses that id as the session. Unknown id = empty history (no pre-registration needed)
  **[verified: first call with a client-generated id `hermes-ui-dev-<ts>` was accepted; the second call re-sent the same id with only the
  new message and the same id was echoed back; whether the model saw the history was not probed, see source OR:684-731]**. => **Client should generate its own id (e.g. `hui-<random>`) and send it on every
  request including the first**, and send **only the new user message** (`messages:[{role:user,…}]`).
- **Without** the header: id is derived as `api-` + sha256(system_prompt + "\n" + first user message)[:16] (AS:1045-1057) and
  history comes from the request body. Two fresh chats starting with the identical first message would collide on one session.
  => never rely on this path.
- Response header `X-Hermes-Session-Id` echoes the id you sent (stable even across compression rotation); when none was sent
  (non-stream) it reports the resolved id. Browsers cannot read it (no CORS expose) – irrelevant natively.
- "New chat" = just use a new client-generated id (keep the same `X-Hermes-Session-Key`).
- "In neuem Chat fortsetzen" (answer menu, `app/src/chat/answerMenu.ts`): from the LAST answer the app forks the session
  (`POST /api/sessions/{id}/fork`, like `/branch`). From an EARLIER answer there is no server-side way to cut a session, and
  request `messages` are ignored once a session id is sent → the app starts a new chat with a fresh client id, stores the
  transcript up to that answer locally and prefixes the first new user message with a `[hui:context] … [/hui:context]`
  block of the prior turns (`app/src/hermes/turnOverride.ts`) until Hermes accepted a turn. One-turn retry notes are
  appended as `[hui:note] …`; both markers are stripped again when stored transcripts are matched (`userTextCore`).

### Non-streaming response (`stream` false/omitted)
`200 {"id","object":"chat.completion","created","model","choices":[{"index":0,"message":{"role":"assistant","content":"…","reasoning_content"?:"…"},"finish_reason":"stop|length|error"}],"usage":{prompt_tokens,completion_tokens,total_tokens},"hermes"?:{completed,partial,failed,error,error_code}}`.
Headers: `X-Hermes-Session-Id`, `X-Hermes-Session-Key`; when the run did not complete also `X-Hermes-Completed: false`,
`X-Hermes-Partial: true|false`, `X-Hermes-Error: <redacted ≤200 chars>` (OR:809-841). No usable text + failure → **502**
`{"error":{"message","type":"server_error","param":null,"code":"agent_incomplete","hermes":{completed,partial,failed}}}`.
These `X-Hermes-Completed/-Partial/-Error` headers exist **only on non-streaming responses**; in streams the same info
arrives in the final chunk (below).

### Streaming response (`stream: true`) **[verified]**
Status 200 immediately (headers flushed before the agent runs), so errors later in the run can only be signalled in-band.
Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`,
`X-Hermes-Session-Id`, `X-Hermes-Session-Key` (when sent), `Transfer-Encoding: chunked` (AS/OR `_prepare_sse_response`, OR:866-884).

Framing (`_sse_frame`, AS:258-264): `[id: n\n][event: name\n]data: <one-line JSON>\n\n`. JSON is `ensure_ascii` (so `💻` escapes
are normal) and always single-line, so no multi-line `data:` in practice (the parser should still support it). Idle keepalive:
the comment line `: keepalive\n\n` every 10 s of silence (AS:236, OR:51-53; long tools/approval waits are silent otherwise).

Order of events in one turn (see `mock-server/fixtures/02-tool.sse`):
1. `data:` chunk with `delta: {"role":"assistant"}` – always first. Its `id` = `chatcmpl-<29 hex>` = **completion id = run id** (needed for approvals).
2. Any interleaving of:
   - `data:` OpenAI chunks `{"id","object":"chat.completion.chunk","created","model","choices":[{"index":0,"delta":{"content":"…"},"finish_reason":null}]}`
   - `data:` reasoning chunks with `delta: {"reasoning_content":"…"}` (DeepSeek style; render as "thinking" or drop) (OR:910-912)
   - `event: hermes.tool.progress` (below)
   - `event: hermes.status` (below)
   - `event: approval.request` (below)
   - `: keepalive` comments
3. Optional tail chunk with extra `delta.content` (post-stream transform / fallback text when no content was streamed, OR:941-953).
4. Final chunk: `choices[0].delta = {}`, `finish_reason`, `usage:{prompt_tokens,completion_tokens,total_tokens}`; if `finish_reason != "stop"` it also carries
   `error: {message, type}` (when known) and `hermes: {completed,partial,failed,error,error_code}` where `error_code` is `output_truncated` (finish `length`) or `agent_error`.
   `finish_reason`: `stop` | `length` (truncation) | `error` (OR:70-78).
5. `data: [DONE]\n\n`.

Server crash mid-stream: a chunk `{… "choices":[{"delta":{},"finish_reason":"error"}]}` (no message) followed by `data: [DONE]` (OR:967-972).
Hard connection loss without `[DONE]` is also possible (treat as error "stream ended unexpectedly").

#### `event: hermes.tool.progress` **[verified]**
```
event: hermes.tool.progress
data: {"tool": "terminal", "emoji": "💻", "label": "date", "toolCallId": "call-…-0", "status": "running"}

event: hermes.tool.progress
data: {"tool": "terminal", "toolCallId": "call-…-0", "status": "completed"}
```
- `running` carries `tool` (function name), `emoji`, `label` (short preview of the primary argument, e.g. the shell command; falls back to the tool name), `toolCallId`.
- `completed` carries only `tool`, `toolCallId`, `status`; it is dropped if no `running` was sent for that id. There is **no `error` status** on the wire
  (a failing tool still reports `completed`). Tools whose name starts with `_` are never sent. Parallel tools interleave by `toolCallId` (OR:668-687).
- Text before/after the tool is normal content: the model often says "I'll check…" first, then the event, then more text.
- Can be disabled server-side (`tool_progress_events: false`); then only content arrives.

#### `event: hermes.status` (OR:615-622, 916)
`data: {"kind": "<lifecycle|compacted|…>", "text": "<redacted human text>"}` – provider wait / retry countdown / fallback switch / context compaction.
Show as a transient status line; never part of the answer.

#### `event: approval.request` + approval flow (OR:568-596, AS:113-132, RUNS:1168-1216, APPR)
A dangerous terminal command makes the agent thread **block** (silent stream, only keepalives) until the user answers or `approvals.timeout`
(default **300 s**, APPR/approval_context.py:256) elapses → silence = deny.
```
event: approval.request
data: {"command":"rm -rf …(redacted)","pattern_key":"…","pattern_keys":["…"],"description":"…",
       "allow_permanent":true,"allow_session":true,"smart_denied"?:true,
       "request_id":"<uuid hex>","event":"approval.request","run_id":"chatcmpl-…","timestamp":1791659152.1,
       "session_id":"hui-…","choices":["once","session","always","deny"]}
```
`choices` shrinks to `["once","deny"]` when `smart_denied` or `allow_session` is false, and drops `always` when `allow_permanent` is false.
Respond **on a separate request** while the stream stays open:
```
POST /v1/runs/{run_id}/approval         (run_id = the event's run_id = chat completion id)
Authorization: Bearer …   Content-Type: application/json
{"choice":"once"|"session"|"always"|"deny","request_id":"<from event>"}   // aliases approve/approved/allow → once; also "all":true to resolve every pending
→ 200 {"object":"hermes.run.approval_response","run_id":"…","choice":"once","request_id":"…","resolved":1}
```
Errors: 400 `invalid_approval_choice`/`invalid_approval_request`; 404 run not found/not owned; 409 `approval_not_active` (turn ended) or `approval_not_pending`
(already answered/timed out); all in the OpenAI error envelope. After the answer the stream simply continues (tool progress → text).
(The approval flow was derived from source only; not triggered with a real call because that would require running a dangerous command.)

### Cancellation / disconnect
- Closing the HTTP connection (AbortController → `fetch` abort) is the supported way to stop a streaming turn: the writer catches
  `ConnectionResetError/BrokenPipe/OSError` on its **next write** and calls `_abandon_agent_task` → hard interrupt of the agent + reaping of its
  background processes (OR:964-966, AS:672-690). Latency: next token or next keepalive (≤10 s while the agent is silent, e.g. in a long tool call).
- `POST /v1/runs/{id}/stop` does **not** work for chat-completion streams: `_spawn_stream_agent` is called without `active_run_id`, so the run has no
  agent/task entry → `409 run_not_active` (RUNS:1253-1274, OR:598-634). Use disconnect.
- (Source-only, unverified) the turn is persisted in state.db up to the interruption, so the next message on the same session id should continue from there.
- Concurrency cap: default 10 in-flight agent runs → `429 {"error":{"type":"rate_limit_error","code":"rate_limit_exceeded"}}` + `Retry-After: 1` (AS:4080-4096).
  While the gateway drains/restarts: `503 gateway_draining` + `Retry-After: 1` (AS:1313).

### Timeouts
No server-side wall-clock limit on a chat completion; the only server timers are the 10 s keepalive and the 300 s approval timeout.
Clients must therefore not impose a short idle timeout (keepalive comments arrive every ≤10 s; treat >45 s of total silence as a dead connection).

### Error formats (non-stream / pre-stream)
OpenAI envelope `{"error":{"message","type","param","code"}}` (AS:906-923):
| Status | When | `type` / `code` |
|---|---|---|
| 400 | bad JSON / missing `messages` / empty user message / invalid session id/key / multimodal validation | `invalid_request_error` (bare `{message,type}` for some) |
| 401 | missing/wrong Bearer | `gateway_auth_error` / `gateway_auth_failed`, message `Invalid gateway API key (API_SERVER_KEY)` |
| 403 | `X-Hermes-Session-*` without a configured API key; CORS origin not allowed (empty body) | |
| 429 | concurrency cap | `rate_limit_error` / `rate_limit_exceeded` |
| 500 | agent raised in non-stream mode | `server_error` `Internal server error: …` |
| 502 | non-stream run produced no text and failed/partial | `server_error` / `agent_incomplete` |
| 503 | draining | `gateway_draining` |

## Known Hermes issues (as of Hermes v0.22.0)
The client is tested with Hermes v0.22.0; the wire facts in this document were verified against v0.21.4.

- **`GET /v1/skills` answers 500** `Failed to enumerate skills` on unpatched Hermes 0.21.5 to 0.22.0 (stray `include_editorial` argument; upstream issue #120831, fix in PR #124861). The app's `/skills` sheet recognises the error, says it is a Hermes bug and that skills still work in chats. There is no fallback endpoint behind the bridge.
- **Providers that Hermes runs as an external process do not stream** (for example the Claude subscription plugin): `/v1/chat/completions` with `stream: true` sends the finished answer as a single chunk at the end. Upstream PR #124566 lets such providers stream when their profile opts in; the plugin has to set that too. Clients see one big delta instead of a token stream; there is nothing to fix on the client side.

## Client implications (summary)
1. Generate session id client-side, always send `X-Hermes-Session-Id` + `X-Hermes-Session-Key: hermes-ui-dev`, send only the new user message.
2. Parse SSE with named events; unknown events must be ignored; handle `: keepalive` comments and `[DONE]`.
3. Tool UI = `hermes.tool.progress` keyed by `toolCallId` (running → completed; no error state on the wire).
4. Final chunk's `finish_reason` + `hermes{}` decide done / truncated / error; also treat stream end without `[DONE]` as error.
5. Stop = abort the fetch. Approvals = separate POST to `/v1/runs/{completion id}/approval`.
6. Retry after 429/503 honoring `Retry-After`.
7. `hermes.ui.route` is **not** sent by Hermes – only by the planned UI Bridge (`event: hermes.ui.route`, `data: RouteDecision`, before the first token).

## Sessions API **[verified 2026-10-10]** (AS:2972-3300, `hermes_state_messages.py`)
Auth = Bearer like everything else; the session routes ignore `X-Hermes-Session-Key`. Client: `app/src/hermes/sessions.ts`.
- `GET /api/sessions?limit=50(≤200)&offset&source=<one source>&include_children=false` →
  `{object:"list", data:[Session], limit, offset, has_more}`. Ordered by last activity; archived and hidden rows are excluded; pinned rows are
  back-filled past the window. `source` is a single value; seen on a real server: `api_server` (every API/app/bridge session, also
  `X-Hermes-Session-Id` ones), `telegram`, `cron`, `oneshot`; also allowed by the server: `cli`, `discord`, `slack`, `desktop`, `hermes_browser`, `dashboard`.
- Session (`_session_response`): `id, source, user_id, model, title|null, started_at, ended_at, end_reason, message_count, tool_call_count,
  input_tokens, output_tokens, cache_*_tokens, reasoning_tokens, *_cost_usd, api_call_count, parent_session_id, last_active, preview (first user msg),
  pinned, archived, hidden, has_system_prompt, has_model_config, is_internal_child`. Times are epoch **seconds** (float). Hermes generates titles itself
  (e.g. `Nur mit OK antworten`); some Telegram titles start with a `<think>` dump.
- `GET /api/sessions/{id}` → `{object:"hermes.session", session}`; unknown → 404 `code: session_not_found`.
- `PATCH /api/sessions/{id}` body only `title|end_reason|pinned|archived|hidden|unread` (others → 400 `unsupported_session_field`). Titles are
  sanitized, **unique per server** and ≤ 100 chars (else 400 `invalid_title`); `""`/null clears. → `{object:"hermes.session", session}`.
- `DELETE /api/sessions/{id}` → `{object:"hermes.session.deleted", id, deleted:true}`; 409 `session_active_turn` while a turn runs.
  Also drops gateway routing entries so Telegram does not resurrect the id.
- `GET /api/sessions/{id}/messages?order=latest|oldest&limit(≤500)&offset&include_compacted` → `{object:"list", session_id:<resolved tip>,
  data:[Message], pagination:{limit, offset, order, returned}}`. Default (no limit/order) = latest 500. Follows compression lineage root→tip.
  Message (`_message_response`): `id (int row id), session_id, role (user|assistant|tool|system), content (string or content-part array),
  tool_call_id, tool_calls ([{id, call_id, type:"function", function:{name, arguments:"<json string>"}}]), tool_name, timestamp (s),
  token_count, finish_reason, reasoning, reasoning_content, display_kind ("hidden" for compaction/diagnostic scaffolding)`.
  One assistant turn = `assistant{content, tool_calls, finish_reason:"tool_calls"}` → `tool{tool_call_id, tool_name, content:"{\"output\":…,\"exit_code\":0,\"error\":null}"}`
  → `assistant{content, reasoning, finish_reason:"stop"}`. **`tool_calls[].id` == `toolCallId` of `hermes.tool.progress`** (verified with session
  `hermes-ui-dev-1791659144`, call `call-f29c…-0`).
- `POST /api/sessions {id?, title?, source?, model?}` → 201 (409 `session_exists`). Not needed by the app (chat completions create the row).
- Servers without the API (older Hermes, old UI bridge versions, mock) answer a plain 404 → the app switches the feature off.

## Capabilities + model_options (AS:67-98, 289, 335-355, 1998-2018, 2492-2560, `api_server_request_options.py`, `hermes_cli/inventory.py`)
- `GET /v1/capabilities` **[verified]**: `{object:"hermes.api_server.capabilities", platform, model:"hermes-agent", auth:{type:"bearer", required},
  runtime, features:{chat_completions, …, run_approval_response, tool_progress_events, approval_events, session_resources, model_options,
  session_chat, session_fork, reasoning_streaming, skills_api, audio_api:false, …, session_continuity_header, session_key_header, cors,
  browser_extension_control:{…}}, endpoints:{name:{method, path}}}`. `cors` is `true` when CORS origins are configured.
- `GET /api/model/options[?refresh&include_unconfigured]` (source only): `{providers:[{slug, name, is_current, is_user_defined, models:[id],
  capabilities:{<model>:{fast, reasoning, can_disable_reasoning?, ultrafast?}}, featured_models, limit?, …}], model, provider}`.
- Chat completion body `model_options` (source only): `{reasoning:{enabled:bool, effort:"none|minimal|low|medium|high|xhigh|max|ultra"}}` or legacy
  `reasoning_effort`; `fast:true` → service tier `priority` (or explicit `service_tier`). Unknown efforts are ignored, never an error. The bridge forwards the body unchanged.

## Real calls made while writing this doc (3, all with key `hermes-ui-dev`)
1. `POST /v1/chat/completions` stream, "Antworte nur mit OK" → `fixtures/01-plain.sse` (+ `.headers.txt`)
2. Same session id, only the new message "Wie spät ist es? Nutze ein Tool falls nötig" → used `terminal` (`date`) → `fixtures/02-tool.sse`
3. `GET /v1/models` → `fixtures/03-models.http.txt`

Sessions workstream (2026-10-10, 6 calls, key `hermes-ui-dev`): `GET /v1/capabilities`; `GET /api/sessions?limit=25`;
`GET /api/sessions/hermes-ui-dev-1791659144/messages?order=latest&limit=50`; `POST /api/sessions {id:"hui-synctest-1791666767", title}` → 201;
`PATCH` its title → 200; `DELETE` it → `deleted:true`. No other session was modified.
