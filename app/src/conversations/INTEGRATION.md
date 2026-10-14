# Conversations – integration guide (for the chat-shell)

Everything here is self-contained in `app/src/conversations/`; import from `../conversations`
(`index.ts`). Nothing in `hermes/`, `claude/`, `chat/`, `app/`, `settings/` was touched.
The approval sheet comes from `../approvals` (separate workstream, not part of this folder).

## What you get

| Export | Purpose |
|---|---|
| `<ConversationsProvider storage?>` | loads/persists the index (AsyncStorage). Mount once, inside `ThemedRoot` (needs nothing else; `storage` prop is only for tests). |
| `useConversations()` | `{ ready, list, activeId, setActiveId, create(profile), remove(id), rename(id,title), pin(id, pinned?), search(q): Promise<SearchHit[]>, get(id) }` |
| `useConversation(id)` | `{ ready, messages, meta, save(messages), setSessionId(sid) }` |
| `<ConversationDrawer open onClose activeId onSelect onNewChat onDeleted? profileName?>` | left slide-in panel, overlays the chat |
| `<ConversationList …>` | same content without the slide-in (for a dedicated screen) |

Notes on the API
- `list` = non-empty chats, most recent ACTIVITY first (`updatedAt`: a turn sent here, or the server's last activity of a synced
  session – opening a chat or fetching its transcript never moves it, remoteSync `SNAPSHOT_SAVE`; pinned flag is on the meta; the UI
  groups "Angeheftet / Heute / Gestern / Letzte 7 Tage / Älter").
- `create(profile)` accepts a `ConnectionProfile` (`{id, kind}` is enough), generates the conversation id **and** the session id
  (`hui-<hex>` for Hermes, `claude-<hex>` for Claude), sets it active and returns the meta. It re-uses an existing empty draft of
  the same profile so tapping "Neuer Chat" repeatedly does not pile up empty chats. Empty chats are hidden from `list` and pruned on app start.
- `search` is async (message bodies are loaded lazily and cached in memory); matches title first, then message text, case/diacritic-insensitive, all words must match.
- `meta.hermesSessionId` = the `X-Hermes-Session-Id` of that chat. `meta.profileId/profileKind` = the profile it was started with.

## 1. Root layout (`app/src/app/_layout.tsx`)

```tsx
import { ConversationsProvider } from '../conversations';
…
<ConnectionProvider>
  <ConversationsProvider>
    <ToastProvider> … <Stack/> … </ToastProvider>
  </ConversationsProvider>
</ConnectionProvider>
```

## 2. ChatScreen: one session component per conversation

`useHermesChat` / `useClaudeChat` read `sessionId` and `initialMessages` **only on mount**. So: render the session with
`key={conversation.id}` and do not mount it before `useConversation(id).ready` (messages are loaded async).
Sketch of `ChatScreen` (state `drawerOpen` lives here so the header can open it):

```tsx
export function ChatScreen() {
  const { active, profiles, ready: connReady, setActive } = useConnection();
  const convs = useConversations();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // pick / create the open conversation once both stores are loaded
  const activeConv = convs.activeId ? convs.get(convs.activeId) : undefined;
  useEffect(() => {
    if (!connReady || !convs.ready) return;
    if (!activeConv) convs.create(active);          // first start / deleted the open chat
  }, [connReady, convs.ready, activeConv?.id]);     // eslint: add the rest as you like
  if (!connReady || !convs.ready || !activeConv) return <Blank/>;

  const openConversation = (meta: ConversationMeta) => {
    // the chat must run on the profile it was started with (Hermes session lives on that server)
    const profile = profiles.find((p) => p.id === meta.profileId);
    if (profile) { if (profile.id !== active.id) setActive(profile.id); }
    // profile deleted: keep going with the active profile of the same kind, otherwise only read it (see "Edge cases")
    convs.setActiveId(meta.id);
    setDrawerOpen(false);
  };
  const newChat = () => { convs.create(active); setDrawerOpen(false); };   // create() also sets it active

  return (
    <View style={{ flex: 1 }}>
      <Session key={activeConv.id} conversationId={activeConv.id} profile={profileFor(activeConv)} onOpenDrawer={() => setDrawerOpen(true)} />
      <ConversationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}
        activeId={activeConv.id} onSelect={openConversation} onNewChat={newChat}
        profileName={(id) => profiles.find((p) => p.id === id)?.name} />
      {/* approval sheet from ../approvals goes here too, as last child */}
    </View>
  );
}
```

`profileFor(conv)` = the profile with `conv.profileId`, falling back to `active`. Replace the existing
`key={active.id}` on the sessions by `key={conv.id}` (profile switching in Settings should then call `convs.create(newActiveProfile)`
unless the open conversation already belongs to it).

### Session component (Hermes; Claude identical with `useClaudeChat`)

```tsx
function HermesSession({ conversationId, profile, … }) {
  const conv = useConversation(conversationId);
  if (!conv.ready || !conv.meta) return <Blank/>;       // wait for stored messages
  return <HermesSessionInner conv={conv} profile={profile} />;
}

function HermesSessionInner({ conv, profile }) {
  const chat = useHermesChat(conn, {
    sessionId: conv.meta.hermesSessionId,                // continues the SAME Hermes session
    initialMessages: conv.messages,
    onTurnEnd: (messages, sid) => {                      // done / error / stopped (also when unmounted mid-stream)
      conv.save(messages);
      if (sid !== conv.meta?.hermesSessionId) conv.setSessionId(sid);
    },
  });

  // persist the user message immediately (crash safety) – cheap, save() is debounced and skips unchanged lists
  const n = chat.messages.length;
  useEffect(() => { if (n) conv.save(chat.messages); }, [n]);   // eslint-disable-line react-hooks/exhaustive-deps
  …
}
```
- `conv.save` is bound to the conversation id, so the `onTurnEnd` of a chat that is being unmounted because the user switched
  conversation still lands in the right chat (the hook aborts the stream on unmount and fires `onTurnEnd` with `stopped`).
- Streaming messages are stored as `stopped`; `reasoning`, `statusNote`, `approval` are not stored; running tools are closed. Max 300 messages / ~1.5 MB per chat (newest kept; Hermes keeps the full history server-side anyway).
- `save()` sets the auto title from the first user message (≤ 40 chars) as soon as it is called with a user message, updates preview and `updatedAt`.
  A renamed title (`titleSource: 'user'`) is never overwritten.
- Claude profiles: `sessionId` is just a local id; continuity comes entirely from `initialMessages` (the hook sends the full list every turn).

### "Neuer Chat" in `ChatView`/`ChatHeader`

`ChatView.onNewChat` currently calls `newSession()` (new session id in the same component). With conversations that would
keep the old conversation record but swap its session/messages → **do not use `newSession()` any more**. Instead lift the handler:
`onNewChat = () => { if (streaming) stop(); convs.create(active); }` (the `key` change remounts the session with an empty transcript and a fresh session id).
Add a menu button to the header calling `onOpenDrawer` (the header is yours; the drawer does not draw one).

## 3. Hand-off checklist
- [ ] `ConversationsProvider` in root layout
- [ ] ChatScreen: `key={conversation.id}`, wait for `useConversation(id).ready`, pass `sessionId`/`initialMessages`/`onTurnEnd`
- [ ] Header menu button -> `setDrawerOpen(true)`; "Neuer Chat" -> `convs.create(active)`
- [ ] `<ConversationDrawer>` as last child of the chat root View (overlays header + composer); approval sheet next to it
- [ ] Settings: when the user switches the active profile, call `convs.create(profile)` (or open the last chat of that profile)
- [ ] Optional: re-focus composer after `onNewChat`/`onSelect`

## Edge cases
- Opened conversation whose profile was deleted: Hermes chats can continue with any other Hermes profile only if it points to the same server
  (session ids are server-side); otherwise show the transcript read-only or start a new chat. Simplest: fall back to the active profile of the same `kind`
  and accept that a Hermes session unknown to that server starts with empty server-side history (the local transcript is still displayed).
- Deleting the open chat: pass `onDeleted={(id) => id === openId && convs.create(active)}` to the drawer. (`remove` clears `activeId`; the effect in `ChatScreen` above then creates a new chat anyway.)
- Delete without session sync only removes the local copy; with sync see "Hermes-Sitzungen" below (two options).
- Storage layout: `hui.conv.index` `{v, items, activeId}` and `hui.conv.msgs.<id>` `{v, messages}`; schema version `v` = 1, migrations in `migrate.ts`
  (`migrateIndex`, `migrateMessages`). Corrupt index is copied to `hui.conv.index.corrupt` and the store starts empty. Orphaned message keys are removed on start.
  Writes are throttled to 400 ms, message lists are written before the index, and everything is flushed when the app goes to background.

## Later / not implemented
- Smarter titles: after the first answer ask the model for a 3-5 word title and replace it while `titleSource === 'auto'` (reducer already supports it via a new action).
- Swipe-to-delete rows (currently long-press / "⋯" menu).

## Needs from `app/src/hermes`
Nothing blocking. Verified: `useHermesChat(conn, { sessionId, initialMessages, onTurnEnd(messages, sessionId) })` and the same options type on `useClaudeChat`.
Nice-to-have (not required): the hooks ignore changes of `sessionId`/`initialMessages` after mount (documented above: remount via `key`); a `loadConversation(id, messages)`
method would allow switching without remount, but remounting is fine and simpler.

## Hermes-Sitzungen (sessions as source of truth, per-chat options) – wiring for the shell

Owner: sessions workstream (`app/src/hermes/`, `app/src/conversations/`). Wire reference: `docs/HERMES-API.md` → "Sessions API".
Everything degrades by itself: servers without `/api/sessions` (older Hermes, the UI bridge, the mock) answer 404 →
`hermes/support.ts` marks the server unsupported → no list sync, no transcript loads, no tool-detail fetches, drawer delete is local-only.

### 1. Setting `syncSessions` (settings/profiles.ts + profile editor)
- Add `syncSessions?: boolean` to `ConnectionProfile` (Hermes only, **default on** = `undefined`). The hooks read it structurally
  (`SyncProfile`), so nothing else changes. Editor: switch "Hermes-Sitzungen synchronisieren" with the hint
  "Zeigt Chats aus Telegram/CLI in der Liste und lädt Verläufe aus Hermes."

### 2. ChatScreen (list sync + drawer)
```tsx
import { useHermesSessionSync } from '../conversations';
const sync = useHermesSessionSync(profiles);          // syncs on start, on app foreground (≥ 20 s apart) and on refresh()
const openDrawer = useCallback(() => { setDrawerOpen(true); void sync.refresh(); }, [sync.refresh]);
<ConversationDrawer … remote={sync.remote} />          // badges Telegram/CLI/App, rename → PATCH, delete dialog with two options
```
- Sessions shown (per Hermes profile, remoteSync `SyncFilter`): by default ONLY the app's own (`api_server` + id prefix `hui-`). `showForeignChats` adds Telegram/CLI/other API clients, `showCronReports` adds cron reports (drawer, live inbox, push scope). Switching off removes them LOCALLY (index + transcript, `controller.pruneForeign`); foreign sessions are never deleted in Hermes (`RemoteActions.canDeleteRemote`).
  Cron/oneshot runs are not listed. Remote-only chats get ids `r-<sessionId>`, are bound to the profile that listed them and open like any chat.
- Per device (preferences `chatScope`, Settings → Chat → "Chats", `chatScope.ts`): `all` (default) lists the app's chats of every device,
  `device` only those started on this device (`origin !== 'remote'`; a chat from another device stays hidden even after it was opened or
  continued here). View filter for the drawer, its search and the prefetch; Telegram/CLI/cron keep following the profile switches.
- Paging (`sessionPaging.ts`): every sync reads the newest 50 sessions per source; `sync.older` (→ `ConversationList` prop `older`) pages
  further back (100 per request) when the list is scrolled to its end or "Ältere Chats laden" is tapped, until a chat the drawer shows was
  added (≤ 4 requests per step). Respects the profile filter and the chat scope; older pages never prune anything.
- `sync.status` (`off|idle|syncing|error|unsupported`) / `sync.error` can drive a small indicator in the drawer header (optional).

### 3. HermesSession (open → load transcript, continue with X-Hermes-Session-Id)
```tsx
import { useApplyRemoteTranscript, useRemoteTranscript } from '../conversations';
function HermesSession(props) {
  const conv = useConversation(props.conversationId);
  const transcript = useRemoteTranscript(props.conversationId, props.profile);
  if (!conv.ready || !conv.meta || !transcript.settled) return <Blank/>;   // remote-only chats wait ≤ 8 s for the first load
  return <HermesSessionInner {...props} conv={conv} transcript={transcript} />;
}
// inside HermesSessionInner, after useHermesChat:
useApplyRemoteTranscript(chat, transcript, conv);   // merges fresh server transcripts into the LIVE chat (never while streaming) and saves
```
- `transcript.error` (e.g. offline, "Diese Sitzung gibt es in Hermes nicht mehr.") → optional thin banner; the cached transcript stays visible.
- Loads happen on open when the server reports newer activity than the last load (`meta.remote.lastActive > loadedAt`), and again after a
  foreground list sync reports new activity (chat continued on Telegram). One request each (`GET …/messages?order=latest&limit=500&include_compacted=true`).
- Continuing: the session id is the Hermes one (`meta.hermesSessionId`), so `useHermesChat` continues it via `X-Hermes-Session-Id` unchanged.
  Note: the app still sends its own `X-Hermes-Session-Key` (memory scope `hermes-ui`), i.e. a Telegram chat continued in the app uses the app's
  key-scoped memory for those turns (global MEMORY.md/USER.md are shared anyway).

### 4. Tool details after a turn (nothing to wire)
`useHermesChat` fetches the stored messages once after a turn that used tools (`fetchToolDetails`, default true) and fills
`ToolEvent.detail` (arguments, result ≤ 4 KB, summary like "Exit 0", error status) + `reasoning`; `chat/toolTimeline.ts` shows them
(terminal results `{output, exit_code, error}` render as "Ausgabe"/"Fehler"). Reasoning of finished messages is now persisted (≤ 4000 chars).

### 5. Per-chat options: reasoning effort + "Schnell"
```tsx
import { HermesOptionsSheet, chatOptionsSummary, effectiveChatOptions, useHermesCapabilities } from '../hermes';
const caps = useHermesCapabilities(profile.kind === 'hermes' ? profile : undefined);  // GET /v1/capabilities + /api/model/options, cached 10 min
const modelCaps = caps.modelCaps(model);
const chat = useHermesChat(conn, { ...sessionOptions(conv), modelOptions: effectiveChatOptions(conv.meta?.modelOptions, modelCaps) });
// header: a chip/button next to the model name, label chatOptionsSummary(conv.meta?.modelOptions) || 'Optionen'
<HermesOptionsSheet open={optsOpen} onClose={() => setOptsOpen(false)} value={conv.meta?.modelOptions}
  onChange={conv.setModelOptions} caps={modelCaps} subtitle={model} />
```
- Values persist per conversation (`meta.modelOptions`), are read at send time (changing them mid-chat applies to the next turn) and go out as
  `model_options: {reasoning:{enabled, effort}, fast:true}`. Defaults send nothing. Hidden when the model reports no support.
- `caps.caps.flags` (`approval_events`, `reasoning_streaming`, `tool_progress_events`, …) can gate UI where useful; missing endpoint → `null`.

### 6. Outside this folder (for the lead)
- UI bridge (`bridge/src/bridge.mjs`) only proxies `/v1/*` → `/api/sessions*` and `/api/model/options` return 404 via the bridge, so sync and
  the options catalog are off for the bridge profile. To enable: pass through `/api/sessions` (GET/PATCH/DELETE) and `/api/model/options`.
- Mock server has no `/api/sessions` (feature auto-off there).
