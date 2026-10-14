# Hermes UI+ – Interactive modules v2 (shared contract)

Extends docs/SPEC.md. All new nodes are ```hui JSON nodes. Interactive nodes MUST carry a stable
`id` (unique within the message). Unknown fields are ignored; partial JSON while streaming must
render skeletons, never crash. German UI copy, 360 px, light/dark, haptics on native.

## Node state (persisted)
Interactive state (checked items, chosen options, calc inputs, quiz progress, timer) is stored per
`conversationId:messageId:nodeId` in `app/src/nodestate/` (AsyncStorage, debounced, capped ~32 KB
per node, deleted with the conversation). Components use
`useNodeState<T>(nodeId, initial: T) → [state, setState]`; the ids come from `HuiContext`
(`conversationId`, `messageId` — the chat shell provides them). Outside a chat (gallery) state is
in-memory.

## Replies to the model
User interactions that should reach the model send a normal user message. Format: a machine tag
plus human-readable text, e.g.
- choice: `[choice:<id>] <question> → <label>, <label>` (+ `Andere: <text>`)
- checklist (only via its "An Hermes senden" button): `[checklist:<id>] erledigt: a, b · offen: c`
- calc ("Ergebnis übernehmen"): `[calc:<id>] Kredit 20.000 € · Zins 4,5 % · 60 Monate → Rate 372,86 €`
- quiz (on finish, optional): `[quiz:<id>] 4/5 richtig`
- form (existing): `[form:<id>] {json}`

## New HuiActions (any `buttons` item or node may use them; ALWAYS confirmed by the user in a sheet)
- `{type:'calendar', title, start, end?, allDay?, location?, notes?}` (ISO 8601 local time)
- `{type:'reminder', title, at}` → local notification (or calendar alarm)
- `{type:'maps', query?, lat?, lng?, mode?: 'driving'|'walking'|'transit'}` → opens Google Maps/Apple Maps URL
- `{type:'call', phone}` · `{type:'email', to, subject?, body?}` · `{type:'sms', to, body?}`
- `{type:'timer', seconds, label}` → starts an in-app timer (+ notification when done)
- `{type:'add_to_list', items: string[], listTitle?}` → appends to the conversation's latest checklist or creates one
- `{type:'copy', text}` · `{type:'open_url', url}` · `{type:'send', text}` (existing)

## New nodes
- `choice` {id, question?, options: {id?, label, description?, icon?(emoji), imageQuery?}[],
  multiple?: boolean, min?, max?, allowOther?: boolean, layout?: 'list'|'grid'|'chips',
  submitLabel?} — single select sends immediately on tap (with undo window ~1.5 s); multi select
  needs the submit button. After sending: locked, shows the chosen answer.
- `checklist` {id, title?, kind?: 'shopping'|'todo'|'packing'|'generic', groupBy?: 'category'|'none',
  editable?: boolean (default true), items: {id?, text, qty?, unit?, category?, checked?, note?}[]}
  — check/uncheck, swipe/long-press delete, add item field, move checked to bottom, progress
  "3/12", share as text, "An Hermes senden". Shopping: category headers (Obst & Gemüse, Kühlregal …).
- `calc` {id, title?, inputs: {name, label, kind: 'slider'|'number'|'select'|'toggle', min?, max?,
  step?, default, unit?, options?: {label, value}[]}[], outputs: {name?, label, expr, format?:
  'number'|'currency'|'percent'|'duration'|'integer', decimals?, unit?, emphasis?: boolean}[],
  chart?: {kind: 'line'|'bar', sweep: {input, from, to, steps}, y: string /*expr*/, label?},
  note?} — evaluated natively by a SAFE expression engine (`app/src/calc/`, no eval/Function):
  numbers, + - * / ^ %, parentheses, unary minus, comparisons, `&& || !`, ternary `c ? a : b`,
  functions min max round(x, d?) floor ceil abs sqrt pow log ln exp clamp, constants pi e;
  identifiers = input names + earlier output `name`s. Division by zero / NaN → "–".
- `map` {id?, title?, markers: {lat, lng, title, description?, number?, imageQuery?}[],
  route?: boolean (polyline in marker order), animate?: boolean (drop pins one by one),
  center?: {lat, lng}, zoom?} — trusted built-in Leaflet template (not model HTML) in the sandbox
  WebView with OSM tiles, plus a native list of stops below (tap ↔ highlight), "In Maps öffnen".
  Routes are illustrative, never claimed as driving directions.
- `recipe` {id, title, imageQuery?, servings, time?: {prep?, cook?, total?} (minutes),
  ingredients: {qty?, unit?, item, plural?, group?}[], steps: {text, timerSeconds?}[], tips?: string[]}
  — servings stepper scales quantities (smart rounding, fractions ½ ¼), step timers, "Zutaten auf
  Einkaufsliste" (add_to_list), cooking mode (keep awake, large step view).
- `tabs` {tabs: {label, children: HuiNode[]}[]} · `accordion` {items: {title, children: HuiNode[]}[], open?: number}
- `quiz` {id, title?, questions: {q, options: string[], answer: number|number[], explanation?}[]}
- `flashcards` {id, title?, cards: {front, back}[]} — flip, swipe, "gewusst / nochmal".
- `sources` {items: {title, url, snippet?, siteName?}[]} — compact cards with favicon + domain.
- `timer` {id, label, seconds, autostart?: false} — start/pause/reset, notification when done.
(Inspiration-driven additions get appended below by the lead after the OpenIntelligentUI scan.)

## Router taxonomy additions (bridge + skill)
`choice` (the assistant needs a decision/preference from the user), `checklist`, `recipe`, `map`,
`quiz`, `calc` (replaces most `calculator` → hui-html), `timer`. hui-html stays for genuinely custom
interactive visuals (simulations, 3D, games, complex diagrams).

## Ownership (v2 build)
| Path | Workstream |
|---|---|
| app/src/protocol (types, validate, tests for all v2 nodes + actions) | protocol-v2 |
| app/src/calc (expression engine, pure, heavily tested) | calc-engine |
| app/src/nodestate, app/src/actions (action executor + confirm sheet: calendar, notifications, maps, call, timer, add_to_list) | state-actions |
| app/src/ui/components/modules/{Choice,Checklist,Tabs,Accordion,Quiz,Flashcards,Sources,Timer}.tsx + registryA.ts + HuiView registry wiring | modules-a |
| app/src/ui/components/modules/{Calc,Recipe,MapNode}.tsx + registryB.ts | modules-b |
| hermes-skill/, app/src/claude/systemPrompt.ts (regenerate only), bridge/src/router*, bridge/eval | skill-router |

## Additions from the OpenIntelligentUI scan (docs/INSPIRATION-OIUI.md)
- **Answered/locked state for every input node** (form, choice, slots, confirm, quiz): the answer is
  stored via nodestate; after sending (and after app reloads) the node shows the chosen answer
  read-only with "Geändert? Neu beantworten" only if the user explicitly re-opens it.
- `slots` {id, title?, slots: {id?, start, end?, label?, note?}[], timezone?, noneLabel?} — time/slot
  picker (OIUI meeting-time-picker): always a "Keiner passt" row; sends `[slot:<id>] <label>` or
  `[slot:<id>] keiner passt`; locks after answering.
- `confirm` {id, title, text?, confirmLabel?, cancelLabel?, tone?} — model-proposed decision card;
  sends `[confirm:<id>] ja|nein`. (Does not block Hermes; real blocking approvals stay ApprovalSheet.)
- **Provenance** on data nodes (table, chart, stats, compare, calc, map): optional `basis:
  'user'|'sourced'|'calculated'|'estimate'|'illustrative'` + `source?`; rendered as a small chip
  ("Beispielwerte", "Schätzung", "Quelle: …"). Illustrative data must be labelled inside the node.
- **ask action** `{type:'ask', text, include?: string[] /*node ids*/}` — sends text plus the current
  values of the named calc/choice/checklist nodes (≤ 4000 chars), only on tap, disabled while a
  turn is running.
- **Pins (saved widgets)**: long-press any hui node → "Anheften"; pins list in the drawer; reopen a
  pin without a model call; "Mit Hermes aktualisieren" puts a "Basierend auf: <pin title>" chip
  above the composer and sends the pinned node JSON as context. Stored locally (app/src/pins/).
- **map / itinerary animation spec** (OIUI trip-animator): ~6 s, pins drop 18 px with a spring settle,
  camera fixed, no auto-scroll, pauses when backgrounded, reduced-motion → final state; routes
  labelled "Route zur Orientierung, keine Wegbeschreibung" unless a directions tool provided data.
- **Starter surface**: empty chat shows prompt cards grouped Verstehen / Vergleichen / Werkzeug
  bauen + "Überrasch mich".
- **Skill honesty + numeric-tool rules** (port into SKILL.md): never invent current data, prices,
  routes, mileage, sources or image URLs; never claim an action succeeded without a confirmation
  result; calculators show units, formula/assumptions, a reset, reject blank/zero-divisor input,
  rounded shares must sum to the total.

## Ownership additions
| Path | Workstream |
|---|---|
| app/src/ui/components/modules/{Slots,Confirm,ProvenanceChip}.tsx | modules-a |
| app/src/pins/, starter surface (app/src/chat EmptyState — integration step) | modules-c (after integration) |
