# Schnellfrage (quick question): design summary

Status: design only, not implemented. Target: one-off questions answered in roughly 1-3 s by a fast model
**without** the Hermes agent context (no memory, no tools, no session, about 20k fewer system tokens per call),
while still rendering interactive `hui` components through a short presentation prompt.

## Decision

Build it in the **UI Bridge** (`POST /bridge/quick`), not through Hermes.

Why not through Hermes (Hermes Agent v0.21.4 api_server, checked in source):

- The chat-completions, responses and runs endpoints accept per-request model/provider routing and `model_options`
  (reasoning effort, service tier, fast) but **no** switch to disable memory injection, skills, toolsets or session
  persistence. Client-sent `tools` are ignored; toolsets come from the profile configuration.
- `store: false` on `/v1/responses` only skips the response-chaining store; the session database row is still written.
- A request `system` message is an ephemeral layer on top of the core prompt, it cannot replace it.
- A minimal Hermes profile (no tools, memory off) would work but needs a second gateway process or gateway-wide profile
  multiplexing, still builds a full agent per request and still persists a session. Savings are roughly 3-4x fewer
  input tokens, not 10x, and latency stays agent-like.
- Measured on a real deployment: trivial Hermes API turns (no tool call) average about 20k input tokens per model call.

## Bridge endpoint

```
POST /bridge/quick/v1/chat/completions      (alias: POST /bridge/quick)
Authorization: Bearer <device token>
{ "messages": [{"role": "user"|"assistant", "content": "..."}], "stream": true, "lang": "de" }
```

- Streams an OpenAI-compatible SSE answer (`chat.completion.chunk`, final usage chunk, `[DONE]`), so the app can reuse
  its OpenAI-compatible chat session and the existing hui stream parser.
- Server-pinned provider, model, token cap, effort and system prompt. Client-sent model, system messages, tools and
  sampling parameters are ignored.
- Configuration (feature is off and answers 404 unless a provider is set):

| Variable | Meaning |
|---|---|
| `BRIDGE_QUICK_PROVIDER` | `anthropic` or `openai` (any OpenAI-compatible endpoint) |
| `BRIDGE_QUICK_MODEL` | model id (default: a small fast Claude model for `anthropic`) |
| `BRIDGE_QUICK_KEY` | provider key (falls back to the router's key for the same provider) |
| `BRIDGE_QUICK_BASE_URL` | base URL for `openai` |
| `BRIDGE_QUICK_MAX_TOKENS` | output cap, default 1024 |
| `BRIDGE_QUICK_RATE` / `BRIDGE_QUICK_DAILY` | per-device requests per minute / per day (proposal: 20 / 300) |
| `BRIDGE_QUICK_CONCURRENCY` | global in-flight cap |
| `BRIDGE_QUICK_DAILY_TOKENS` | optional global daily token fuse |
| `BRIDGE_QUICK_TTFB_MS` / `BRIDGE_QUICK_TOTAL_MS` | first-byte and total timeouts |

- Existing router backends are decision-only (`decide()`, non-streaming JSON); Quick adds a streaming method per provider
  next to them and shares client construction, key handling and error mapping. A classifier-only backend cannot serve it.
- `GET /bridge/quick/config` tells the app whether Quick is enabled, which model answers and the limits.

### Auth, limits, privacy

- Same Bearer check as every bridge route; the rate-limit key is the device id. Revoking a device token cuts Quick access.
- Per-device minute and daily limits, global concurrency cap, optional daily token fuse, `429` with `retry-after`.
- Request and input caps: 64 KB body, at most 6 turns, at most 4000 characters per turn, text only in v1.
- Client disconnect aborts the upstream stream, so a cancelled question stops billing.
- **No content logging:** only request id, device id, status, timings, model and token counts are logged. No prompt,
  answer or provider error body. No answer cache, no routing-context memory, no router call, nothing written to disk.
  A test with a sentinel string asserts that nothing from the request reaches the logger or an error message.
- The question does leave the bridge: it goes to the configured model provider under the operator's key, and
  provider-side retention follows that agreement. State this in `PRIVACY.md` when implemented.

## Compact hui prompt

The full presentation prompt (`app/src/claude/systemPrompt.ts`) is about 66 KB, i.e. well over 15k tokens. Quick uses a
hand-curated, byte-stable prompt of about 6-8 KB (roughly 2k tokens):

- Role, language, short text-first answers, no tools, no live data (say so and point to the normal chat), no memory.
- The presentation table trimmed to the node types that pay off in one shot (`table`, `chart`, `stats`, `steps`,
  `compare`, `checklist`, `choice`/`poll`, `calc`, `timer`, `quiz`) with one minimal valid example each.
- At most one `hui` block, no `hui-html`, no nodes that need web data, never collect secrets, never claim actions.
- Date and time travel with the user turn (not in the system prompt) so the prompt-cache prefix stays stable.

Single source of truth: generate the examples from the skill references and add a test that every example in the
compact prompt passes the existing `hui` validators.

## App side

- **Composer toggle** (bolt icon): off / one-shot / sticky. Only shown when `/bridge/quick/config` reports Quick enabled.
- **Slash command** `/quick <question>` (aliases `/schnell`, `/q`), sends the text to a quick conversation.
- **Chat type**: a flavour of the existing OpenAI-compatible profile pointing at the bridge, with `sendSystemPrompt`
  off, web search and attachments off, model picker hidden. History is held client-side and trimmed to 6 turns.
- Rendering uses the existing stream parser; no new parsing code.
- Handoff: "In Hermes weiterführen" starts a normal Hermes chat seeded with the question and answer (a quick chat has
  no Hermes session to continue).

## UI treatment

- Badge "Schnellfrage" (bolt icon) in the chat header, the conversation list and per answer; a distinct accent colour so
  it is never mistaken for a Hermes chat.
- Persistent one-line note: "Ohne Hermes-Gedächtnis, ohne Werkzeuge und ohne Internetzugriff. Nicht Teil deines
  Hermes-Verlaufs." (English: "No Hermes memory, no tools, no web access. Not part of your Hermes history.")
- Wording must not claim "anonymous": the question still goes to a model provider.
- Optional "Schnellfragen nicht speichern": keep the chat in memory only until it is closed.
- Empty state with three sample questions and a pointer to the normal chat for current data or files.
- Errors: `429` shows "Zu viele Schnellfragen, gleich wieder möglich"; `404` hides all entry points.

## Estimates (not measured for Quick; Hermes figure measured)

| | Normal Hermes turn | Quick via bridge |
|---|---|---|
| Input tokens per call | about 20k (range 16k-26k, mostly uncached) | about 2-2.5k, cached after the first call in the cache window |
| Output tokens | about 500 including reasoning | about 100-250 (cap 1024) |
| Time to first token | seconds (agent init, large prefill, possible tools) | about 0.4-0.9 s |
| Complete short answer | several seconds and up | about 1.5-3 s |
| Hermes session or memory write | yes | no |

The Quick latency is extrapolated from the router's measured small-model latencies (about 1.2 s median for a short
structured reply). Cost is given as token counts only; check the provider's current price list when building. As an order
of magnitude, a Quick turn is a few percent of a Hermes turn.

## Risks

1. Spend surface: any paired device can use the operator's key. Mitigated by per-device and global limits, a token fuse,
   revocable tokens, a small output cap and server-pinned parameters.
2. Quality: fewer node types and less guidance, so more invalid `hui` blocks. The stream parser degrades invalid blocks to
   text; validator test and an eval run on a question set before release.
3. Hallucinated live data: no tools. Prompt and badge say so; "Mit Hermes prüfen" offers a proper answer.
4. Privacy expectations: private with respect to Hermes memory, not with respect to the model provider.
5. Prompt drift between compact and full prompt: generate from the same references and validate.
6. Provider stream differences: normalise in the bridge.

## Build order

1. Bridge module, streaming clients, limits, no-content-log test, config endpoint, compact prompt plus validator test
   (off by default).
2. App: quick chat flavour, badge and note, composer toggle.
3. App: `/quick` command, handoff, optional non-persistent mode.
4. Docs (`ROUTER.md` section, `PRIVACY.md` line), i18n keys.
5. Eval on 30-50 questions: hui-valid rate, first-token and total latency p50/p95, then tune effort and token cap.

Hermes variant, if ever needed: a small upstream-style flag that wires the agent's existing lean options
(skip memory, skip context files, no toolsets, no session store) from a request field. Do not enable gateway-wide profile
multiplexing just for this.
