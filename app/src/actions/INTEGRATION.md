# actions – integration

Executor for the HuiActions of `docs/SPEC-modules-v2.md`: `calendar`, `reminder`, `maps`, `call`,
`email`, `sms`, `timer`, `add_to_list` (all **always confirmed in a sheet**) and pass-through of
`copy` / `open_url` / `send`. `submit` and `ask` are NOT handled here (chat shell keeps them).

## 1. Mount (chat integrator)

```tsx
import { ActionRunnerProvider, useActionRunner, ActiveTimersBar, listBus } from '../actions';

// inside ChatScreen (needs theme + SafeAreaProvider + ToastProvider)
const toast = useToast();
<ActionRunnerProvider conversationId={conversationId} onToast={toast} onSend={(text) => send(text)}>
  <ActiveTimersBar onTimerDone={(t) => toast(`Timer abgelaufen: ${t.label}`)} />   {/* above the list/composer */}
  …messages…
</ActionRunnerProvider>

// HuiAction handler (replaces the calendar/maps/… cases of useHuiActionHandler)
const run = useActionRunner();
const onAction: HuiActionHandler = (action, values, meta) => {
  switch (action.type) {
    case 'submit': case 'ask': /* existing chat logic */ return;
    default: void run(action);          // never rejects → ActionResult
  }
};
```

`run(action, {conversationId?})` → `Promise<ActionResult>`:
`{ok:true,status:'done'|'cancelled',message?}` or `{ok:false,error}` (German; also sent to `onToast`).
Concurrent calls queue (one sheet at a time). `run` accepts raw/unknown JSON: it validates everything
(`validateAction`) — dates must parse (ISO 8601, local time unless an offset is given), reminders must lie in
the future, phone numbers 3–15 digits (no `*`/`#`), e-mail format, maps need a query or lat+lng, timers
1 s … 24 h, URL schemes `http|https|tel|mailto|sms|geo` only (`open_url` itself: http/https only,
no `user@host` URLs). Invalid → error toast, no sheet.

Outside a chat (gallery) mount the provider without `conversationId`/`onSend`: `add_to_list` then only
emits `create_list`, `send` reports "nicht möglich".

## 2. Behaviour per action

| action | sheet text (example) | execution |
|---|---|---|
| calendar | "Termin eintragen: Zahnarzt · Mi 14. Okt, 10:00–11:00 · Praxis Müller" | `expo-calendar/legacy`: permission → pick writable calendar (iOS default calendar; Android primary/own-account) → `createEventAsync`; no permission/calendar/error → system "new event" UI (`createEventInCalendarAsync`). All-day events follow platform conventions (Android UTC midnight, exclusive end). Default length 1 h. |
| reminder | "Erinnerung setzen: Müll · So 11. Okt, 08:00" | local notification (DATE trigger) on channel "Timer & Erinnerungen"; asks for permission; denied → explanatory toast. Date-only → 09:00. |
| timer | "Timer starten: 10 Min · Nudeln" | `TimerStore` (below) + done-notification |
| maps | "In Karten öffnen: …" / "Route öffnen: …" | Android `geo:` (lat/lng: `geo:lat,lng?q=lat,lng(label)`), with `mode` or fallback Google Maps URL; iOS `maps.apple.com` (+ `dirflg`), fallback Google Maps web |
| call / email / sms | "Anrufen: +49…" | `Linking.openURL` with `tel:` / `mailto:` / `sms:` — only opens the app, the user still taps dial/send |
| add_to_list | "Zur Liste hinzufügen: Milch, Eier" | see §4 |
| copy / open_url / send | no sheet | clipboard / `Linking` (http/https) / `onSend` |

## 3. Timers

`getTimerStore()` (singleton, AsyncStorage key `hui.timers`) – multiple concurrent timers, stored with
**absolute end timestamps** so they survive restarts/background; each running timer has a local
notification ("Timer abgelaufen" + label). API: `start({label,seconds,source?})`, `pause(id)`, `resume(id)`,
`reset(id)`, `remove(id)`, `clearDone()`, `tick()`, `getSnapshot()/subscribe()`, hook `useTimers()`.
`<ActiveTimersBar/>`: pills (tap = pause/resume, long-press = reset, x = remove, finished = "Fertig").
Done timers disappear after 1 h. Max 20 timers.

**For the `timer` node (modules-a)**: either call `run({type:'timer',seconds,label})` (with sheet) or, for the
node's own start button (the user already tapped it), `getTimerStore().start({label, seconds, source: \`${messageId}:${nodeId}\`})`.
Same `source` restarts instead of duplicating. The recipe step timers can do the same.

## 4. add_to_list contract (modules agent: checklist/recipe)

`appendToLatestChecklist(conversationId, items, listTitle?) → Promise<AppendResult>` works on the persisted
node state of the conversation. For a checklist to be found **its `useNodeState` value must look like**:

```ts
type ChecklistNodeState = {
  kind: 'checklist';        // marker
  createdAt: number;        // ordering key: epoch ms of the message (preferably message.createdAt), NOT Date.now() on every mount
  title?: string;
  items: { id: string; text: string; checked: boolean; qty?: string|number; unit?: string; category?: string; note?: string }[];
  // …any extra fields you like
};
```

- The checklist component MUST render from `state.items` (the **full** list) and **write the materialised state once on
  mount** if nothing is stored yet (`useNodeState(node.id, undefined)` → set `{kind:'checklist', createdAt, title, items: node.items…}`),
  otherwise an untouched list is invisible to the action. Use `{version: 1}` (the action keeps the stored `v`).
- Appending goes through `store.set`, so a mounted checklist re-renders automatically via its `useNodeState` subscription.
- Latest = highest `createdAt`; with `listTitle` a case-insensitive title match wins. Duplicates (case-insensitive) are skipped;
  a duplicate that is already checked is **un-checked** ("reopened").
- Result: `{status:'appended', key, messageId, nodeId, added[], reopened[], skipped[]}` or
  `{status:'no_checklist', listTitle: 'Einkaufsliste', items}`.
- `listBus` (`subscribe(fn) → unsubscribe`):
  - `{type:'items_added', conversationId, messageId, nodeId, added, reopened, skipped}` – optional hook for
    scrolling/highlighting the list.
  - `{type:'create_list', conversationId?, title, kind:'shopping', items}` – published by the executor when there is no
    checklist. **The chat shell must subscribe** and insert a LOCAL assistant message (not sent to the model) containing a
    ```` ```hui ```` checklist node `{type:'checklist', id:<new>, title, kind, items:[{text}…]}`; ignore events whose
    `conversationId` is not the open conversation.
    ```ts
    useEffect(() => listBus.subscribe((e) => { if (e.type === 'create_list' && (!e.conversationId || e.conversationId === id)) insertLocalChecklist(e); }), [id]);
    ```

## 5. app.json (not edited here – add these)

```jsonc
"plugins": [
  // …existing…
  ["expo-calendar", {
    "calendarPermission": "Hermes trägt Termine in deinen Kalender ein, wenn du es im Chat bestätigst.",
    "remindersPermission": false          // reminders use notifications, not the Reminders app
  }],
  ["expo-notifications", { "color": "#2563EB" }]
],
"android": {
  "permissions": [
    "android.permission.SCHEDULE_EXACT_ALARM"   // optional but recommended: exact timer/reminder times
  ]
}
```

- `expo-calendar` plugin already adds `READ_CALENDAR` / `WRITE_CALENDAR`; `expo-notifications` adds
  `POST_NOTIFICATIONS` (+ `RECEIVE_BOOT_COMPLETED`, so scheduled timers survive a reboot). Do not duplicate them.
- Without `SCHEDULE_EXACT_ALARM` (denied by default on Android 14+) expo-notifications falls back to inexact alarms: a
  timer notification may arrive a few minutes late in Doze. In-app pills stay exact while the app is open. (`USE_EXACT_ALARM`
  is auto-granted but restricted by Play policy to alarm/timer/calendar apps.)
- iOS: `NSCalendarsUsageDescription` / `NSCalendarsFullAccessUsageDescription` come from `calendarPermission`.
- Both libraries contain native code → needs a **development build** (no Expo Go). Run `npx expo prebuild`/EAS build after editing.
- Android channel "Timer & Erinnerungen" (id `timers-reminders`, HIGH importance) is created at first use, before the
  permission prompt (required by Android 13+).

## 6. Tests

`validate.test.ts`, `urls.test.ts`, `describe.test.ts` (formatting + calendar model), `timers.test.ts`
(math, persistence, store), `lists.test.ts`, `executor.test.ts` — all pure node:test.
Not covered by automated tests (needs a device/dev build): the real expo-calendar / expo-notifications /
Linking calls in `calendar.ts`, `notifications.ts`, `env.ts`, and the sheet / pill rendering.
