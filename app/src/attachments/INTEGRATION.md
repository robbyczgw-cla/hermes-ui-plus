# Attachments – integration guide

Owner: attachments workstream (`app/src/attachments/`). This module is self-contained and
already type-checked and tested. Wiring it in touches files owned by others: chat-shell, hermes, claude,
conversations, and `app.json`. Each step below says exactly what to change. Import everything from
`../attachments`.

```
app/src/attachments/
  types.ts            Attachment, RemoteRef, AttachmentTarget, AttachmentReader, AttachmentError, LIMITS
  mime.ts             mime normalisation, classifyFile, formatBytes ("1,2 MB")
  validate.ts         per-backend checks + size budgets (validateForTarget)
  encodeHermes.ts     buildHermesContent()       → string | OpenAI content parts       (pure)
  encodeClaude.ts     encodeClaudeAttachments(), buildClaudeUserContent(),
                      resolveClaudeAttachmentBlocks(), createCachedReader()           (pure)
  uploadCore.ts       bridge upload contract (URL, headers, response parsing)        (pure)
  draft.ts            composer draft reducer                                          (pure)
  store.ts            image prep (2048 px / JPEG 0.8), persistent copies, fileReader, cleanup
  pickers.ts          camera / gallery (≤ 6) / documents, permissions, German messages
  upload.ts           uploadAttachment() (expo-file-system File.upload, progress), detectBridge()
  share.ts            shareAttachment() (expo-sharing)
  useAttachmentDraft.ts  composer state hook (pick → prepare → eager upload → takeForSend)
  pendingUploads.ts   upload tasks + "send while uploading" (PendingUploads, handed to the chat)  (pure)
  queuedFilesCore.ts  bytes of a send queued when the app stopped mid-upload: web → IndexedDB, native → existence check  (pure)
  queuedFiles.ts      its platform wiring (IndexedDB `hui-queued-files`, expo-file-system)
  components/         AttachmentButton, AttachmentTray, MessageAttachments, ImageViewer, icons
  *.test.ts           node:test (46 tests): `node --test src/attachments/*.test.ts`
```

Data model (stored on the user `ChatMessage`; no base64 ever lives in state or storage):
```ts
type Attachment = { id; kind: 'image'|'file'; name; mimeType; size; uri; width?; height?;
  status: 'ready'|'uploading'|'error'; remoteRef?: {id, path, name, size, mimeType}; progress?; error? };
```
`uri` points to a copy in `<documents>/attachments/<id>.<ext>`. That copy is persistent: it feeds
the thumbnails and the Claude history replay after an app restart. Images are already prepared:
long edge ≤ 2048 px, JPEG quality 0.8 (0.6 if the result is still larger than 3.75 MB). Small
JPEG/PNG originals are kept as they are.

---

## 0. `app.json` (owner: chat-shell / lead), required before a native build

Add the image-picker config plugin. On iOS the camera crashes without `NSCameraUsageDescription`.
```jsonc
"plugins": [
  // … existing …
  ["expo-image-picker", {
    "photosPermission": "Hermes braucht Zugriff auf deine Fotos, um Bilder an Nachrichten anzuhängen.",
    "cameraPermission": "Hermes braucht die Kamera, um Fotos für deine Nachrichten aufzunehmen.",
    "microphonePermission": false
  }]
]
```
`microphonePermission: false` keeps the unused RECORD_AUDIO permission out of the Android build.
expo-document-picker needs no plugin (iCloud is not used). expo-sharing is already listed. All
packages need a new dev build; Expo Go also works for testing.

## 1. Types (owner: hermes-client), additive only

`app/src/hermes/types.ts`:
```ts
import type { Attachment } from '../attachments/types';
export type ChatMessage = { …existing…;
  /** user messages only: images/files sent with this turn (metadata + local uri, never base64) */
  attachments?: Attachment[];
};
export type HermesConn = { …existing…;
  /** baseUrl is the UI bridge → files are uploaded via POST /bridge/uploads (profile.bridge) */
  bridge?: boolean;
};
```
`app/src/hermes/chatState.ts`:
```ts
export function createUserMessage(text: string, now: number, attachments?: Attachment[]): ChatMessage {
  return { id: newId('u'), role: 'user', text, tools: [], status: 'done', createdAt: now,
           ...(attachments?.length ? { attachments } : {}) };
}
```

## 2. Composer (owner: chat-shell, `chat/Composer.tsx` + `chat/ChatView.tsx`)

The hook lives in the composer. It needs the send target and the bridge connection from the profile.
```tsx
import { AttachmentButton, AttachmentTray, useAttachmentDraft, type Attachment, type AttachmentTarget } from '../attachments';

// props: onSend(text: string, attachments: Attachment[]): void; profile: ConnectionProfile; history?: Attachment[]
const target: AttachmentTarget = profile.kind === 'claude' ? { kind: 'claude' } : { kind: 'hermes', bridge: !!profile.bridge };
const draft = useAttachmentDraft({
  target,
  conn: profile.kind === 'hermes' && profile.bridge ? { baseUrl: profile.baseUrl, apiKey: profile.apiKey } : null,
  history,   // Claude only: all attachments already in this chat (shared 30 MB request budget)
});

const hasContent = !!text.trim() || draft.attachments.length > 0;
const canSend = hasContent && !disabled && !streaming && draft.canSend;

const submit = async () => {
  if (!canSend) return;
  const atts = await draft.prepareForSend(); // validates, waits for uploads (draft stays)
  if (atts && onSend(text, atts) !== false) draft.commitSend(atts); // refused → draft kept
  if (atts === null) return;                // draft.error explains why (show it, see below)
  onSend(text.trim(), atts);
  setText('');
};
```
Layout inside the rounded `box` (ChatGPT style). The tray sits above the input row and spans the
full width. The ＋ button goes to the left of the input.
```tsx
<View style={[styles.box, { flexDirection: 'column', paddingLeft: 7 }]}>
  <AttachmentTray attachments={draft.attachments} onRemove={draft.remove} onRetry={draft.retry} pending={draft.picking} />
  <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
    <AttachmentButton onSelect={(s) => void draft.add(s)} disabled={!draft.canAdd || streaming} busy={draft.picking} />
    <TextInput … />
    <SendButton … />
  </View>
</View>
{draft.error ? <Text onPress={draft.clearError} style={{ color: t.colors.danger, fontSize: 13, paddingHorizontal: 18, paddingTop: 4 }}>{draft.error}</Text> : null}
```
(You can show `draft.error` as a toast instead. Clear it on tap.)
- New chat or conversation switch: call `draft.discard()`. It deletes the files of the unsent draft.
- `history` for Claude: `messages.flatMap((m) => m.attachments ?? [])`.
- When the profile changes, the hook re-checks every chip. Example: a PDF that was fine on Hermes
  with the bridge shows "Dateien brauchen die UI-Bridge" on a profile without the bridge.

## 3. Message rendering (owner: chat-shell, `chat/MessageItem.tsx` `UserMessage`)

```tsx
import { MessageAttachments } from '../attachments';

<View style={styles.userRow}>
  <MessageAttachments attachments={message.attachments} align="end" />
  {message.text.trim() ? <Pressable …existing bubble…/> : null}
</View>
```
`userRow` must be a column with `alignItems: 'flex-end'` (or wrap it). Tapping an image opens a
fullscreen viewer: pinch zoom, double-tap zoom, swipe down to close, share button. Tapping a file
opens the system share sheet.
`conversations/messages.ts`: in `previewOf` / `firstUserText`, fall back for messages that have
attachments but no text, e.g. `m.attachments?.length ? (m.attachments[0].kind === 'image' ? '[Bild]' : '[Datei]') : ''`.
`stripMessage` already keeps `attachments`. They are small (metadata only).

## 4. Hermes send path (owner: hermes-client)

`stream.ts`: the user message content may now be a parts array.
```ts
import type { HermesContentPart } from '../attachments/encodeHermes.ts';
export type StreamChatParams = { …; text: string; /** overrides `text` as message content */ content?: string | HermesContentPart[] };
export function buildRequest(conn, content: string | HermesContentPart[], sessionId) { … { role: 'user', content } … }
// streamChatCore: buildRequest(params.conn, params.content ?? params.text, params.sessionId)
```
`useHermesChat.ts`:
```ts
import { buildHermesContent, fileReader, isAttachmentError, type Attachment } from '../attachments';

send(text: string, attachments: Attachment[] = []) {
  const t = text.trim();
  if ((!t && !attachments.length) || runningRef.current) return;
  messagesRef.current = [...messagesRef.current, createUserMessage(t, now, attachments), createAssistantMessage(now)];
  …; void run(t, attachments);
}
// in run(text, attachments): before streamChat
const content = attachments.length
  ? await buildHermesContent(text, attachments, { reader: fileReader, bridge: !!connRef.current.bridge })
  : text;   // AttachmentError → finalize the assistant placeholder as 'error' with e.message
await streamChat({ conn, text, content, sessionId: sid, … });
// retry(): reuse list[ui].attachments (bridge files keep their remoteRef; the server keeps them 7 days)
```
`ChatScreen.tsx` `HermesSession`: add `bridge: !!profile.bridge` to `conn`.
Wire facts (verified read-only in `/opt/hermes/gateway/platforms/api_server.py`, v0.21.4):
- Only `text` and `image_url` parts are accepted (`file` / `input_file` → 400 `unsupported_content_type`).
  Image data URLs must be `data:image/…`.
- Each text part is capped at 65 536 chars, so inline files are split at 60 000 chars on line
  boundaries. An array of only text parts is joined with "\n" by Hermes.
- Body ≤ 10 MB (aiohttp `client_max_size`). The module budgets 9 MB for encoded attachments per message.
- Hermes' `read_file` tool extracts PDF, DOCX, XLSX, PPTX and others to text by itself, so the
  file reference text is enough: `[Datei angehängt: name (mime, size) – Pfad auf dem Server: /…]`.
- Without the bridge, only images and text files ≤ 200 KB work. Everything else gets the error
  "Dateien brauchen die UI-Bridge…" on its chip.

Bridge detection: `profile.bridge` already exists. Optionally, the settings "Verbindung testen"
button can call `detectBridge(baseUrl)` (`GET {origin}/health` → header `X-Hermes-UI-Bridge: 1`)
and set `bridge` automatically.

## 6. Conversations / cleanup (owner: conversations)

- When a conversation is deleted: `deleteAttachmentFiles(messages.flatMap((m) => m.attachments ?? []))`.
- Optional, once on app start after the index has loaded: `pruneAttachmentFiles(allUrisOfAllStoredMessages)`.
  It deletes orphaned files in `<documents>/attachments/`, matched by file name.
- `capMessages` can drop old messages. Their files then become orphans and the prune step above
  removes them.

## 7. Bridge upload endpoint (owner: bridge-uploads agent, not in this module)

The app is coded against this fixed contract (see `uploadCore.ts`):
`POST {origin}/bridge/uploads` (origin = baseUrl without `/v1`). Headers: `Authorization: Bearer
<BRIDGE_TOKEN>`, `Content-Type: <mime>`, `X-Filename: encodeURIComponent(name)`. The body is the raw
file bytes (no multipart), max 20 MB. On success: 201 `{id, path, name, size, mimeType}`. Errors:
400/401/413/415 with `{error:{message,type}}`. Native uploads stream from disk with real progress
(`File.upload`, `UploadType.BINARY_CONTENT`). On web the progress is indeterminate.
Web dev against the bridge needs `BRIDGE_CORS_ORIGINS`. Its preflight must allow `X-Filename`, and
`X-Hermes-UI-Bridge` must be exposed for `detectBridge`.

## 8. OpenAI-compatible servers (profile kind `openai`)

Target `{kind:'openai', caps}` (validation and caps parsing; the backend that uses it is not part of this build).

Wire shape (user message `content` becomes an array when it carries attachments; otherwise it stays a string):
- images → `{type:'image_url', image_url:{url:'data:image/jpeg;base64,…'}}` (prepared by store.ts: ≤ 2048 px,
  JPEG 0.8; each ≤ 5 MB of base64)
- text-like files ≤ 200 KB → `{type:'text'}` fenced block (same text as the Hermes no-bridge path)
- other files → `{type:'file', file:{filename, file_data:'data:<mime>;base64,…'}}` only if the server lists the
  mime type in `attachments.files`; otherwise the chip shows "Dieser Server unterstützt nur Bilder und Textdateien."
- order: files, images, user text, `<context>` date. Budget per message: `caps.maxBytes` (default 9 MB).

### Capability document (server side, optional)
`GET {baseUrl}/capabilities` (Bearer like the other calls; 404/non-JSON/errors are tolerated → defaults):
```jsonc
{ "attachments": {
    "images": true,                 // image_url data-URL parts accepted
    "files": ["application/pdf"],   // mime patterns of NON-text files accepted as `file` parts ("text/*" is implicit)
    "maxBytes": 9000000             // encoded attachment payload per message
} }
```
Legacy flag `"images_in": true|false` is read as `attachments.images`. Defaults for servers without the
endpoint: `{images:true, files:["text/*"], maxBytes:9000000}`. A server that takes inline images ≤ 5 MB
should advertise `{"attachments":{"images":true,"files":[],"maxBytes":9000000}}`. Parser: `openaiCaps.ts`.
Profile switch "Anhänge erlauben" (`attachmentsEnabled`, default on) hides the ＋ button entirely.

### History replay
The client resends the whole list every turn. A message's parts are byte-identical on every turn (append-only,
server prefix caches stay valid) while it is inside the replay window: the newest 6 image/file-carrying user
messages and ≤ 20 MB of replayed base64. Older images/files are replaced by a one-line placeholder
`[Bild angehängt: name – nicht erneut gesendet]` (text files stay inlined, they are cheap). Files that no longer
exist (e.g. web blob URLs after a reload) become `… – nicht mehr verfügbar` in old messages; in the message being
sent they abort the turn with an error. Retry re-encodes the stored attachments. Constants: `REPLAY_KEEP_IMAGE_TURNS`,
`REPLAY_BUDGET` in `encodeOpenAI.ts`.

### Web / iPhone Safari (PWA)
`expo-image-picker` / `expo-document-picker` web implementations use a hidden `<input type=file accept=…>`:
- Fotos: opens the iOS photo library / Android picker. Multi-select works.
- Datei: iOS Files sheet (accept list incl. text/pdf/images).
- Kamera: shown only on touch devices (`pointer: coarse`); the picker sets `capture="environment"`, which makes iOS
  Safari and Android Chrome open the camera directly. Desktop browsers ignore `capture`, so the entry is hidden there.
  Limitation: iOS PWAs in standalone mode sometimes reload the page when returning from the camera; an unsent draft
  is lost then. HEIC photos are converted to JPEG by iOS when picked through `accept="image/*"`; the image manipulator
  (canvas on web) re-encodes/downscales them. Attachment files live as blob URLs and do not survive a page reload.
