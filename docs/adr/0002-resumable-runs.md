# ADR 0002: Idempotent send, stream resume and steer with Hermes v0.22

- Status: accepted for 0.1 (bridge-side idempotency + resume, implemented); proposed for 0.2 (steer, runs transport)
- Date: 2026-10-14
- Wire details: docs/HERMES-API.md "v0.22 additions"; bridge behaviour: docs/BRIDGE.md "Idempotent send and resume"

## Context

The app sends every turn as a streaming `POST /v1/chat/completions` through the UI-Bridge. The bridge keeps a turn
running when the phone's connection drops (detached turn); the app then waits for the answer via the live inbox or the
stored session (`app/src/hermes/recovery.ts`). Two gaps remained:

1. **Duplicate turns.** A send whose connection broke before any answer arrived looks failed in the app, but the
   bridge may already have started the Hermes turn. "Erneut" then asked Hermes the same thing a second time.
2. **No resume.** A stream lost mid-answer could only be completed from the stored session once Hermes finished, so
   the user saw nothing live until then.

Hermes v0.22 adds `/v1/runs` with durable idempotency (`Idempotency-Key`, 24 h), an event stream with sequence numbers
and replay (`Last-Event-ID`), `steer` and `stop`. None of it applies to streaming chat completions: they ignore
`Idempotency-Key`, have no replay buffer, and their agent is not registered for steer/stop (409 `run_not_accepting_steer`
/ `run_not_active`).

## Decision for 0.1 (implemented)

The bridge records keyed chat turns itself (`bridge/src/replay.mjs`), within its existing detached-turn design:

- The app sends one `Idempotency-Key` per message; a retry of a send that never showed an answer re-uses it
  (`app/src/hermes/idempotency.ts`).
- The bridge records the bytes of a `200` SSE turn per device token + key. The same key re-attaches instead of starting
  a turn; `X-Hermes-UI-Resume-Offset: <bytes>` continues a broken stream at the byte the app has. The app keeps its SSE
  parser state across the reconnect, so each event is applied once (`app/src/hermes/stream.ts`: attempts for up to
  2 min, at once on foreground / network back), and falls back to the existing inbox / session recovery only when the
  bridge refuses (`409 resume_unavailable` / `turn_unrecorded`). An answer still unfinished after that, or persisted
  unfinished by an app that was killed, re-attaches at byte 0 and is replayed into a fresh copy of the message
  (`app/src/hermes/reattach.ts`), so it continues live after a restart too.
- A keyed turn whose upstream stream broke (`aborted`) gave no answer: a plain retry with the same key (no resume
  offset) runs it anew. A turn that ran but has no recording (over the per-turn buffer, bytes evicted) answers
  `409 turn_unrecorded`: never a second turn; the app runs session recovery. A plain send refused with
  `resume_unavailable` / `idempotency_key_conflict` stores a fresh key, so "Erneut" is never stuck on a dead key.
- Steer is **not** offered: on the chat-completions transport Hermes cannot steer.

Why this way: no change of transport or event vocabulary, works with Hermes v0.21 as well, about 200 lines in the
bridge with tests, and every limit is explicit (2 MB per turn, 32 MB in total, 10 min after the end, memory only).

Limits accepted for 0.1: records are lost when the bridge restarts (its turns are aborted then too); a turn larger
than the per-turn buffer stays live but cannot be resumed; direct connections (no bridge) get neither feature.

## Plan for 0.2

Option A (preferred, small): **upstream Hermes change** – register the chat-completion agent under its completion id
(`active_run_id=completion_id` in `_spawn_stream_agent`, the run id the app already knows from approvals). Steer and
stop then work for chat completions without any transport change. The app would add "Nachsteuern" next to
"Stopp & neu" while a turn runs (`POST /v1/runs/{completionId}/steer {input}`, allow-listed exactly in the bridge,
feature-detected via `run_steer` plus a probe answer other than 409 `run_not_accepting_steer`). To propose upstream; not
patched locally on a production Hermes.

Option B (larger): **switch the bridge's upstream transport to `/v1/runs`** and translate run events into the
chat-completion SSE the app parses. Gains: steer/stop by run id, Hermes-side durable idempotency (survives bridge
restarts), sequence-based replay. Gaps to close first:

- runs stream no reasoning deltas (only `reasoning.available` previews) – a regression for the live "Gedankengang";
- no `hermes.status` events (provider wait, retry countdown, compaction);
- `tool.started` / `tool.completed` carry no tool-call id – the app keys its timeline by `toolCallId` and matches it to
  stored session messages;
- the run's event buffer is dropped 5 min after the start when nobody is subscribed – the bridge would still have to
  subscribe and keep its own record for long detached turns;
- the bootstrap / router hint would move from system messages to `instructions` (prompt-cache parity to measure).

Option C: `/api/sessions/{id}/chat/stream` registers its agent (steer works) but has no replay or idempotency and a
third event vocabulary; not pursued.

Decision for 0.2: pursue A; revisit B only if Hermes adds reasoning deltas and tool-call ids to run events.

## Consequences

- The bridge holds a bounded amount of recent answer bytes in memory; `BRIDGE_RESUME=off` disables it.
- The app's retry is safe against duplicate turns behind a current bridge; behind an older bridge or direct Hermes the
  behaviour is unchanged (no resume header → no resume; the key is ignored on streaming requests).
