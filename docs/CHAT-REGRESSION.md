# Chat regression gate: what a normal user sees

Every bug that real-user testing found in an ordinary chat becomes a permanent test, so it cannot come back unnoticed.
The tests check what the user **sees** (visible text, a tap and what it sends), not only what our code returns. There
are two layers:

| | Model-free (every `scripts/check.sh all`) | Live (on demand, before a release) |
|---|---|---|
| Input | recorded answers from the QA rounds (verbatim model output) | fresh answers from a real model |
| Path | the app's own text pipeline + its real components, drawn in Node | the same, plus the real bridge + Hermes |
| Time / cost | about 25 s of the app test run, no network | about 15 min, a few cents (cheap model, fixed budget) |
| Files | `app/src/regression/`, `app/src/testkit/answerView.ts` | `bridge/eval/conversations/` |

## Model-free layer

`app/src/testkit/answerView.ts` draws one assistant answer the way the chat does: the finished-answer pipeline of
`useAnswerText` in `chat/MessageItem.tsx` (interim notes, hidden tool markup, `MEDIA:` tags, the stream parser, sources)
and the chat's own `SegmentView` for every segment (Markdown with task lists, `HuiSegment` with its fallback note and
raw block, the HTML widget). React renders into a small in-memory DOM (`testkit/miniDom.ts`) through react-native-web
(`testkit/webRender.ts` loads the `.tsx` files and stands in for the native-only packages), so effects run, `onLayout`
reports a phone width (carousels, the agenda grid, charts draw) and taps work:

```ts
const av = await loadAnswerView();
const v = await av.mountAnswer({ role: 'assistant', text, tools: [] }, { lang: 'de' });
v.text();                   // what the user reads
await v.tap('Pasta salad'); // press what shows that text (bubbles to its Pressable)
await v.wait(1700);         // a single choice sends after its 1.5 s undo window
v.sent;                     // what the answer handed to the chat: [{ action: { type: 'send', text: '[choice:…] → Pasta salad' } }]
await v.unmount();
```

Defaults that match a normal setup: image lookups settle as "nothing found" (no image-search key, the lookup gave up),
answer-provided `https` images count as photos. Limits: no CSS (nothing is ever hidden by a style), maps and HTML
widgets in web views draw only their surroundings, timers do not run unless a test waits.
`answerView.test.ts` fails when `useAnswerText` changes its pipeline; update `finishedSegments` to match.

### Checks (`app/src/regression/userChecks.ts`)

| Check | Finding codes | Kind |
|---|---|---|
| The answer or a block shows nothing; a block keeps a loading skeleton; a block crashed | `empty-answer`, `empty-component`, `stuck-placeholder`, `render-crash` | renderer |
| Raw component JSON, a fence marker, tool-call markup or a protocol trailer is visible | `raw-markup` | renderer |
| A "no data" label (from the app's dictionaries) where the model sent content | `no-data-label` | renderer |
| A quiz shows its grading before anything was tapped | `answer-leak` | renderer |
| The screen-reader announcement reads raw markup | `announcement-raw` | renderer |
| Text the model sent that is not on screen even after opening every tab, section and "show all" | `dropped:<type>.<field>` | renderer |
| A reminder / saved memory / routine confirmed while no tool ran (refusals and conditionals are fine) | `claims-reminder`, `claims-memory`, `claims-routine` | agent content |
| Prose promises photos / a map / a table the answer does not contain | `promised-photos`, `promised-map`, `promised-table` | agent content |
| Answered in another language than asked (live only, soft) | `answer-language` | agent content |

Content behind a tap the checks do not make (the back of a flip card, a quiz explanation, an agenda block's sheet, a map
pin's card) is skipped per node type (`BEHIND_TAP`).

### Recorded conversations

- `app/src/regression/fixtures/qa-transcripts.json`: QA rounds 1 to 3 (0.1.4 and 0.2: the twelve everyday journeys,
  Live cards, watchlists, trips, reminders, memory, the round-2 fix re-run, the offline demo). Default bridge, router
  `heuristic`, no image-search key, Hermes v0.22.0, `claude-haiku-4-5`. 86 conversations, 298 answers.

`transcripts-<round>.test.ts` replays every answer of a round (one file per round, so `node --test` runs them in
parallel): each answer must produce exactly the findings `app/src/regression/expected.ts` lists for it, which is none
for almost all. The few listed ones are answers that must trip a check (the original F01 "Erledigt", the round-2
memory claims) or a known, deliberate wording change. The first answer of each component type is also streamed in five
pieces (cut inside JSON and fences): no snapshot may show raw markup or crash.

`journeys.test.ts` pins one test per finding (F01 to F08 of 0.1.4, R2-06 to R2-09, R3-01/R3-03, N-01, typo follow-ups,
the Spanish fallbacks): the recorded answer, the taps the tester made, and what must be on screen or sent. Where the QA
run recorded the app's own follow-up message (`[choice:…] → Morgens`, `[checklist:…] erledigt: …`), the tap must send
exactly that again.

Run them alone: `cd app && node --test src/regression/*.test.ts src/testkit/answerView.test.ts`.

### Adding a case when a user finds a bug

1. Get the conversation as the app stored it (the web app's IndexedDB `hui-store`, the way the QA runs export
   `conversations*.json`), or at least the raw answer text ("Rohdaten anzeigen" under a broken block), and the steps
   (what they typed, what they tapped). Remove anything personal: real
   names, hosts, tokens, addresses that are not public places. Test values must be obviously fake.
2. Add it to `fixtures/qa-transcripts.json` as one conversation: `{ id, source, setup, uiLang, findings, turns: [{ user,
   answer, tools? }] }` with the answer verbatim (never edit the model's text).
3. Run the round's `transcripts-*.test.ts`. If the bug shows up as a finding, the replay already guards it: fix the app
   until it passes. If not, add a test to `journeys.test.ts` that asserts what the user should see or what a tap
   should send, and, when no check catches the class of bug yet, a check in `userChecks.ts` with a test in
   `userChecks.test.ts` (one crafted answer that trips it, one honest answer that does not).
4. Model content the app cannot fix (a false claim) goes into `expected.ts` with the finding code and a one-line why.
5. Add the journey's prompts to `bridge/eval/conversations/scenarios.mjs`, so the live layer asks it again.

## Live layer

### Default bridge on a Hermes test instance

```bash
scripts/test-instance/ti.sh --host linux conversation-test --out "$HUI_PRIVATE_DIR/reports/<release>/live" [--max-tokens 2000000] [--scenario j02-recipe-shopping,n04-reminders]
```

`conversation-test.sh` takes the instance in an exclusive session (lock, start, stop on every exit path), tunnels the
bridge port and runs `bridge/eval/conversations/run.mjs` here (needs `npm ci` in `app/`). The instance has to run the
default bridge: pure pass-through, `ROUTER_BACKEND=heuristic`, no image-search keys (`scripts/test-instance/setup.sh`
writes exactly that). The model is the instance's default profile model (`claude-haiku-5-5`, `TI_MODEL` at setup). After
a bridge or skill change: `ti.sh --host linux sync && ti.sh --host linux setup` first.

What it does, per turn: the request is built by the app's own `buildRequest` (bootstrap and time-zone lines, session
header, idempotency key), the stream is parsed by the app's SSE parser and event mapping (text, text replacements, tool
progress, usage, model), and the answer is drawn and checked like the recorded ones. `{ tap: [...] }` turns in
`scenarios.mjs` press the previous answer's controls and send what the app would send; a missing control (the model chose
another form) is a soft note.

Budget: `--max-turns` (default 80) and `--max-tokens` (default 2 000 000, prompt plus completion as Hermes reports
them); the run stops cleanly and lists what did not run. The full suite is about 76 turns. With `claude-haiku-5-5`
that is a few cents.

Report: `OUT/conversation-report.md` (+ `.json` with every answer). Per turn: renderer findings (app bugs), agent-content
findings (the model claimed something false or broke a promise, a weekday next to a date that is not the calendar's,
an echoed `[hui:quote]` tag), environment (HTTP errors, timeouts, upstream errors:
nothing about the app could be judged), soft notes (expected component missing, wrong language, tap target missing).
Exit 0 pass, 1 renderer or agent-content failure, 2 could not run, 3 environment only.

