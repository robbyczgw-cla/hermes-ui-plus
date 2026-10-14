# nodestate – integration

Persisted per-node interactive state (checked items, chosen options, quiz progress, …).
Storage: AsyncStorage, **one record per conversation** under `hui.nodestate.<conversationId>`:
`{"f":1,"nodes":{"<messageId>:<nodeId>":{"v":<schemaVersion>,"data":…,"updatedAt":<ms>}}}`.
Writes are debounced (300 ms) and flushed when the app goes to `background`/`inactive`.
Limits: 32 KB per node (a larger write is refused, the old value stays, `console.warn`), 512 KB per
conversation (least recently updated nodes are evicted first, never the node just written).

## 1. Chat shell (chat integrator)

```tsx
import { NodeStateProvider, NodeScope, deleteConversationState } from '../nodestate';

// app root (once):
<NodeStateProvider>…</NodeStateProvider>

// around EACH assistant message (MessageItem):
<NodeScope conversationId={conversationId} messageId={message.id}>
  …segments / <HuiView/> / <HtmlBlock/>…
</NodeScope>

// when a chat is deleted (ConversationsProvider.remove):
void deleteConversationState(id);
// optional: regenerate / delete a single message → deleteMessageState(conversationId, messageId)
```

Use the **stable message id** (not the list index). Outside any `NodeScope` (gallery, tests)
`useNodeState` is plain in-memory React state, so components work unchanged.

## 2. Components (modules agents)

```tsx
import { useNodeState } from '../../../nodestate';
const [picked, setPicked] = useNodeState<string[]>(node.id, []);               // value or updater
const [qs, setQs] = useNodeState<QuizState>(node.id, { i: 0, answers: [] }, { version: 2 });
```

- `nodeId` must be the node's stable `id` (unique within the message). Never call it conditionally.
- `initial` is only used while nothing is stored; the setter takes a value or an updater
  (`setS(prev => …)`); the updater always sees the latest stored value (safe for rapid taps).
- State must be JSON-serialisable, small, and treated as immutable.
- Bump `{version}` when the shape of `T` changes: stored state with another version is ignored (→ `initial`).
- Reads before the AsyncStorage load finishes return `initial`, then switch to the stored value
  (a few ms); writes made in between are merged, not lost.

## 3. Misc API

| export | purpose |
|---|---|
| `deleteConversationState(conversationId)` | remove cache + storage (call on chat deletion) |
| `deleteMessageState(conversationId, messageId)` | drop all nodes of one message |
| `exportNodeState(conversationId)` / `exportAllNodeState()` | `{conversationId, nodes}` / `{conversations}` for backup/export |
| `getNodeStateStore()` | process-wide `NodeStateStore` (non-React code, e.g. `appendToLatestChecklist`) |
| `NodeStateStore` | class with injectable storage (tests) |

Pure logic (`model.ts`, `store.ts`) has no React/RN imports and is covered by `model.test.ts`, `store.test.ts`.
