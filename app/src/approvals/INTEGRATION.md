# Approvals – integration (chat shell, push)

Wire facts and gaps: summarized in `hermes/approvals.ts` and docs/HERMES-API.md (the original research notes are maintainer-private). Pure logic: `hermes/approvals.ts` (queue, deadline, restore, history),
`approvals/approvalModel.ts` (card view model), `approvals/stackModel.ts` (stack key, push entry point).

## Hook (`useHermesChat`)

- `approvals: ApprovalRequest[]` – every pending request of the chat, oldest first (parallel tool calls → several).
  Expired ones stay (marked `expired`) until closed or the run ends. `approval` = first answerable one (compat).
- `respondApprovalFor(approval, choice)` – answers ONE request (`POST /v1/runs/{runId}/approval {choice, request_id}`).
  Late tap guard: past the deadline it rejects with `code: 'approval_expired'` and sends **nothing**.
  Other rejections: `approval_not_pending` / `approval_not_active` / 404 (gone), network (retryable).
  Success → removed from the queue + history row + timeline step.
- `dismissApproval(approval)` – close an expired / gone card (no request).
- `checkApprovals(runId?)` – `GET /v1/runs/{completionId}` of the open / interrupted turns; rebuilds pending cards.
  Runs automatically on chat open (also after an app restart), on foreground, on `recoverNow` (inbox reconnect) and right
  after a lost stream. A request whose deadline already passed is logged as `expired`, not shown live.
- `openApproval(runId?)` / `approvalFocus` – used by the push entry point below.
- option `approvalTimeoutSeconds` – the server's `approvals.timeout` when advertised (ChatScreen passes
  `caps.approvalTimeoutSeconds` from `/v1/capabilities`; Hermes v0.21 does not advertise it → event `timeout` → 300 s).

Deadline (`resolveDeadline`): server `expires_at` (exact, countdown without "ca.") → server timestamp (or receipt) +
event / advertised timeout → + 300 s. Restored requests measure their age on the server clock (HTTP `Date` header).

## UI

```tsx
<ApprovalStack approvals={chat.approvals} onRespond={chat.respondApprovalFor} onClose={chat.dismissApproval} focus={chat.approvalFocus} />
<ApprovalHistory log={message.approvalLog} />   // inside the assistant message (persisted)
```

- Stack: one card at a time, "Freigabe 1 von 3" with ‹ › (44 pt) and a count badge; hidden → chip with the count. A new
  request reveals the stack and is announced (VoiceOver/TalkBack).
- Card: server reason ("Grund laut Hermes"), command in a scrollable mono box with copy, risk pill (client heuristic,
  labelled "geschätzt"; smart-denied = Hermes' own verdict), countdown, high risk → "Ablehnen" primary.
  At the deadline: "Abgelaufen – abgelehnt", buttons disabled, "Schließen".
- Scopes (only those the server sends): `once` "Einmal erlauben"; `session` "Für diesen Auftrag" (on the API path the
  approval key is the completion id – the next message asks again); `always` "Immer erlauben (überall, auch Telegram)"
  (Hermes' global `command_allowlist`, also Telegram/cron) – at high risk a second confirmation step.
- History rows (`message.approvalLog`, persisted; also `approval_answer` steps in the tool timeline):
  "✓ Erlaubt (einmal): rm -rf build/", "✓ Erlaubt (für diesen Auftrag)", "✓ Immer erlaubt (überall)", "✕ Abgelehnt",
  "⏱ Abgelaufen – abgelehnt", "– Nicht beantwortet – Lauf beendet" (run ended / stopped without an answer).

## Push entry point (team C)

```ts
import { openPendingApproval } from '../approvals';

// notification tap "Hermes braucht eine Freigabe" (data: conversationId, runId = completion id `chatcmpl-…`):
controller.setActive(conversationId);   // as PushHost does for `turn` targets
router.navigate('/');
openPendingApproval(conversationId, runId);
```

The chat of `conversationId` (mounted now or on its next mount, ≤ 10 min) checks `GET /v1/runs/{runId}` at once,
reveals the stack and shows that run's card (`usePendingApprovalTarget` in ChatScreen). If the bridge only knows the
Hermes session id, map it to the conversation first (`pickConversation` in PushHost); `runId` may be omitted (then
all open turns of the chat are checked). Collapse key / cancel the notification on `request_id`.

## Limits (Hermes v0.21)

- `GET /v1/runs/{id}` carries only the LATEST request; after answering one of two parallel requests the status reads
  `running` → a second hidden request can only come back from the live stream (or a later `waiting_for_approval`).
- No deadline in the event; an expired request stays in the run status until the run ends (client deadline decides).
- Direct Hermes (no bridge) interrupts the agent when the stream drops → nothing to restore there.

## Demo

`ApprovalDemo` (normal, dangerous multi-line with one failing send, smart-denied with 409) can be mounted from a route
file, e.g. `src/app/approvals-demo.tsx`: `export { ApprovalDemo as default } from '../approvals';`
