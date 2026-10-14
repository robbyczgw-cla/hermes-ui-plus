# Meta (titles & follow-ups) – integration guide

Owner: meta workstream (`app/src/meta/`). Bridge side: `bridge/src/meta.mjs`, docs/ROUTER.md "Meta (titles & follow-ups)".
Everything is best-effort: if the bridge has no `ANTHROPIC_API_KEY` (404 `feature_off`) the hooks switch themselves off for the session.

```
core.ts      pure: URLs, buildMetaMessages, hasInteractiveHui, newlyFinished, planMeta, parseMetaResponse, followupsNode
bridge.ts    fetchMeta(bridge, messages, want, {lang, signal, timeoutMs})
hooks.ts     useAutoTitle, useFollowups
core.test.ts node:test (9 tests): scripts/check.sh test src/meta/core.test.ts
```

## Wiring (chat shell / ChatScreen)

```ts
import { metaConnFromProfile, useAutoTitle, useFollowups } from '../meta';

const bridge = metaConnFromProfile(profile);               // null for non-bridge profiles -> hooks do nothing

useAutoTitle(messages, {
  bridge, conversationKey: conversationId, hasTitle: Boolean(conversation.title),
  onTitle: (title) => { setLocalTitle(title); /* hermes-sessions: PATCH the Hermes session title if available */ },
});

const followups = useFollowups(messages, { bridge, conversationKey: conversationId });
// followups: HuiNode ({type:'suggestions', items}) | null -> render under the last assistant message with the
// existing suggestions renderer; a tap sends the text as a user message. It hides itself as soon as a new
// message is added or streaming starts.
```

Rules implemented
- Triggers only on live `streaming -> done` of an assistant message (opening an old chat or switching `conversationKey` never fires).
- Title: once per conversation, after the first completed assistant turn, only if `hasTitle` is false. A failed attempt may retry after the next turn.
- Follow-ups: after every turn, but not when the answer contains an interactive node (`choice`, `form`, `slots`, `confirm`, `checklist`, `calc`, `quiz`; nested and broken JSON are detected too).
- Sent to the bridge: last 4 finished text turns, hui/code fences removed, each at most 1200 chars. `messages` must match `{id, role, text, status}` (ChatMessage).
- Callbacks are read through refs, so inline lambdas are fine.
