# Hermes UI+ – v4: core answer polish + new interactive modules (shared contract)

Extends docs/SPEC.md, SPEC-modules-v2.md, SPEC-modules-v3.md. Same rules as before:
- ```hui JSON nodes. Interactive nodes need a stable `id`. Partial JSON renders as skeletons.
- Answered/locked state lives in `useNodeState`. Replies are user messages with a machine tag plus readable text; the user bubble renders them as a ReplyChip (`chat/replyMessage.ts`; extend its tag map).
- All UI strings go through `t()` in de/en/es. Support every theme (light/dark), 360 px width, haptics and reduce-motion. The code must stay Hermes-engine compatible (`npm run compat`), with no new Intl APIs.
- Stroke icons only, no emoji in chrome. Touch targets are at least 44 pt.
- Every feature in part A has a settings toggle (all default ON) in a new settings group "Antworten".
- Images go through the image trust policy (`images/trust.ts`): `imageQuery` resolves through our own search (trusted). Model URLs from unknown hosts are tap-to-load.
- External links/actions (route, call, website, buy) always go through the confirmed action runner (`actions/`).

## A. Answer polish

### A1 Transform bar ("Umformen"), pref `answers.transformBar`
- Under every finished assistant answer, a horizontally scrollable row of quiet chips sits under the action row: Kürzer · Ausführlicher · Als Liste · Als Tabelle · Einfacher erklärt · Für Experten · Übersetzen ▸ (submenu: Englisch, Spanisch, …).
- Hide it while streaming. Hide it on very short answers (< 200 chars) except for Übersetzen.
- Tapping sends a user message `[reformat:<kind>] <readable instruction>`.
  - kind ∈ `shorter | longer | list | table | simpler | expert | translate:<lang>`.
  - Example: `[reformat:table] Bitte die letzte Antwort als Tabelle.`
  - The ReplyChip shows "↩ Als Tabelle".
- The new answer appears below. The source answer gets a small "umgeformt ↓" marker. No deletion.
- Bridge router: a message starting with `[reformat:table]` forces `format=table` (list → `checklist` only if it was a list of todos, else `text` with lists; simpler/expert/shorter/longer → `text`; translate → `translation` if short, else `text`). The format must stay usable for direct backends too: the app adds the same hint in the system prompt of direct backends.

### A2 TL;DR head, node `summary`, pref `answers.summary`
- Node: `summary` {text, points?: string[] (≤ 4), verdict?: string}.
- Rendered as the answer's first block: an accent-left-bordered card with large text, optional bullet points, and an optional bold verdict line.
- Skill rule: use it ONLY for long answers (> ~250 words, research, comparisons), as the first node, followed by the details.
- When it is present, long markdown sections after it collapse to the first ~12 lines with "Weiterlesen" (pref `answers.collapseLong`).

### A3 Footnote citations, pref `answers.footnotes`
- Markdown `[^1]`, `[^2]` (or `【1】`) map to the answer's `sources` node items (1-based), or to markdown links collected at the end.
- They render as small superscript pills. Tap opens a preview sheet: favicon (trust policy) + title + domain + snippet + "Öffnen".
- The `sources` node shows matching numbers.

### A4 Tappable entities, pref `answers.entities`
- Model-tagged links with the `hui:` scheme in markdown:
  - `[Kolosseum](hui:place?q=Kolosseum%20Rom)` → chip with a pin icon. Tap opens an action sheet: In Karten öffnen · Route · Kopieren.
  - `[12. Okt, 9:00](hui:date?start=2026-10-12T09:00&end=…&title=…)` → In Kalender (confirmed calendar action) · Kopieren.
  - `[+43 660 …](hui:tel?n=%2B43660…)` → Anrufen · SMS · Kopieren.
  - `[€ 249](hui:price?v=249&c=EUR&q=Sony%20WH-1000XM6)` → Kopieren · Produkt suchen.
- Plus light client-side auto-detection when the model didn't tag: phone numbers, e-mail, ISO and German dates with times. Conservative, no false positives in code blocks/tables.

### A5 Motion choreography, pref `answers.motion` (respects reduce-motion)
- Blocks of a streaming answer fade/slide in (staggered 40 ms, UI thread).
- `stats` values count up once when first shown (only for newly streamed blocks, never in history).
- Must not regress the streaming perf work (no per-frame React state).

### A6 Share as image, pref `answers.shareImage`
- Action-row button "Als Bild teilen" renders the answer (or a single card via its overflow) to a PNG with a clean frame (theme background, small app wordmark, no chrome) and opens the share sheet.
- Native: `react-native-view-shot` (add via `npx expo install`). Web: hide the option unless a dependency-free approach is reliable.

## B. New modules

- **`places`** {id?, title?, layout?: 'carousel'|'list' (default carousel), places: {id?, name, category?, address?, lat?, lng?, rating?: number (0–5), reviews?: number, price?: '€'|'€€'|'€€€'|'€€€€', openNow?: boolean, hours?: string[] (weekday lines), hoursToday?: string, phone?, website?, imageQuery?, image?, distance?: string, note?, tags?: string[]}[] (≤ 10), source?, basis?}
  - ChatGPT-class place cards: photo (`imageQuery` → our image search), name, category · price · distance, star rating + count, "Jetzt geöffnet / Geschlossen · öffnet 9:00" (green/red dot), and a short note.
  - Buttons: Route · Anrufen · Website · Merken (adds to a list via the `add_to_list` action).
  - Tap opens a detail sheet with hours, address, a mini map and tags. "Alle auf Karte" opens/expands the existing `map` node renderer with these markers.
  - Provenance chip required when the data comes from tools.
- **`products`** {id?, title?, layout?: 'carousel'|'grid', products: {id?, name, brand?, imageQuery?, image?, price?: number, currency?: string, priceNote?, rating?, reviews?, badge?: string (e.g. "Bester Preis"), verdict?: string (one line), scores?: {label, value 0–10}[] (≤ 5), specs?: {label, value}[] (≤ 6), pros?: string[], cons?: string[], offers?: {merchant, price?, url}[] (≤ 4), url?}[] (≤ 10), compare?: boolean, ranked?: boolean (numbered top list), source?, basis?}
  - Product cards: image, name, brand, price, rating, badge, 3 key specs. Tap opens a detail sheet: all specs, pros/cons, offers (merchant + price + "Zum Shop", confirmed open_url).
  - "Vergleichen": multi-select 2–3 → side-by-side spec table.
  - Optional reply `[products:<id>] Favorit: <name>` via "Das nehme ich".
- **`timer` v2** (extends the existing `timer`, backward compatible): {id, label, seconds?, until?: ISO datetime (countdown to a date/time), mode?: 'countdown'|'stopwatch', timers?: {label, seconds}[] (multi-timer, ≤ 6), autostart?}
  - Big ring/digits, ±1 min, pause/reset.
  - Local notification when done, even in the background (expo-notifications, scheduled), and a sound/vibration toggle.
  - State persists and survives restarts (end timestamp, not ticking state).
- **`guide`** {id, title, intro?, steps: {id?, title, body (markdown), imageQuery?, tip?, warning?, seconds?: number (inline timer)}[] (≤ 20), stuckLabel?}
  - Interactive step-by-step: one step at a time (swipe/next/back), a progress bar, "Erledigt" per step (persisted), and an inline timer when `seconds` is set.
  - "Ich hänge hier fest" sends `[guide:<id>] Schritt 3 („…“): Ich hänge fest – …` with an optional typed detail.
  - Overview mode lists all steps with checkmarks. On finish, a small celebration (reduce-motion aware) and a reply `[guide:<id>] Fertig`.
- **`workout`** {id, title, kind?: 'strength'|'cardio'|'mobility'|'mixed', warmup?: string, exercises: {id?, name, sets?: number, reps?: number|string, seconds?: number, weight?: string, restSeconds?: number, note?, imageQuery?}[] (≤ 20), cooldown?: string}
  - Session view: exercise cards with set bubbles to tap (each tap starts the rest timer with a countdown and a notification). Editable weight/reps per set.
  - "Training beenden" → summary (done sets, duration) → reply `[workout:<id>] 18/20 Sätze · 42 min · Kniebeuge 3×10 @ 60 kg …`. Progress persists.
- **`studyplan`** {id, title, goal?, weeks?: {label, days: {label, tasks: {id?, text, minutes?, kind?: 'learn'|'practice'|'review'|'test'}[]}[]}[]}
  - Learning plan (languages, exams, skills): a week accordion with day rows, checkable tasks, and a progress ring per week + overall.
  - "Heute" jumps to today's day.
  - Reply `[studyplan:<id>] Woche 1: 9/12 erledigt` via "Fortschritt senden".
- **`vocab`** {id, title?, from: lang, to: lang, items: {term, translation, example?, note?, romanization?}[] (≤ 40), mode?: 'cards'|'quiz'|'type'}
  - Language drill: flip cards with 🔊 TTS of the term (voice module, the term's language).
  - Modes: Karten / Multiple Choice / Eintippen (tolerant compare: case/accents).
  - Leitner boxes per item, persisted (correct → next box). Session summary.
  - Reply `[vocab:<id>] 18/20 richtig · schwierig: …`. Reuse the Flashcards/Quiz visuals where sensible.
- **`mindmap`** {id?, title?, root: {id?, label, note?, children?: MindNode[]}} (depth ≤ 4, ≤ 60 nodes)
  - Radial or left-to-right tree, SVG, pan + pinch zoom (gesture-handler + reanimated, UI thread), collapse/expand per node, a fit-to-screen button.
  - Tap a node → sheet with its note + "Vertiefen" → sends `[mindmap] Erkläre „<label>“ genauer` (no id needed).
  - A table/outline fallback view for screen readers (default when a screen reader is on).

## Router / skill
- New route formats: `places`, `products`, `guide`, `workout`, `studyplan`, `vocab`, `mindmap`, `timer` (existing one; now routable), plus the `summary` usage rule.
- Reformat tags force formats (A1).
- Skill references go to `hermes-skill/references/nodes-v4.md` + examples. Update validate.mjs, bridge router heuristic + prompt + eval cases, and the Claude system prompt regen.
- `places`/`products` data must come from tools (web search etc.). The skill tells the model to never invent ratings, prices or opening hours; leave fields out instead.

## Later additions: `paths` and `blocks`
Two display components for explaining setups, added after v4 (same normalizer rules: lenient aliases, typed fence, caps).
Skill references: `hermes-skill/hermes-ui/references/paths.md` and `blocks.md`; router formats: [ROUTER.md](ROUTER.md).

- **`paths`** {id?, title?, items: {id?, title, badge?: {text, tone?: 'neutral'|'good'|'warn'|'bad'} | string, path: {label, icon?, detail?}[] (1-6), note?}[] (2-6), basis?, source?, select?: boolean}
  - 2-6 ways, variants or architectures: one card, each row a bold title, a verdict pill, a centred chain of node pills joined by arrows and one muted note line.
  - Interactive node (has an `id`). `select: true` turns the rows into a single choice with an undo window; the pick is sent as `[paths:<id>] <title>`.
- **`blocks`** {id?, title?, columns: {title?, grid?: 1|2|3, items: {label, sub?, icon?, style?: 'soft'|'framed', tone?}[] (1-12), base?: {label, sub?, icon?}}[] (1-3), caption?, basis?, source?}
  - Architecture or setup at a glance: one card, up to three columns of boxes (soft = filled, framed = outlined), an optional full-width shared base layer per column, a muted caption.
  - Display-only (no id, no tap). Columns sit side by side on wide screens and stack on a phone; a 3-grid drops to 2 when boxes would get too narrow.
- Both use the app's stroke icon set (`laptop desktop phone server cloud disk folder file database network lock user globe app container vm terminal`); unknown icon names are ignored.

## Ownership (v4 build)
| Path | Workstream |
|---|---|
| app/src/protocol (types, validate, partial, tests), RouteFormat, app/src/ui/skeletons.tsx cases, registry scaffolding (registryD1/D2/D3 + HuiView merge), chat/replyMessage.ts tag map | protocol-v4 |
| app/src/ui/components/modules/d1/** (Places, Products) + registryD1.ts | modules-d1 |
| app/src/ui/components/modules/d2/** (Guide, Workout, Timer v2 = replace modules/Timer.tsx) + registryD2.ts | modules-d2 |
| app/src/ui/components/modules/d3/** (StudyPlan, Vocab, Mindmap) + registryD3.ts | modules-d3 |
| A1 transform bar: chat/TransformBar.tsx, the action-row mount in MessageItem.tsx, reformat hint for direct backends, the bridge router reformat override (bridge/src/router/**) | polish-transform |
| A2–A6: summary renderer (ui/components/Summary.tsx + its own `registryPolish.ts`, merged in HuiView by protocol-v4), Markdown.tsx footnotes + `hui:` links + entity auto-detect, Sources numbering, motion, share-as-image, settings group "Antworten" + preferences keys for ALL `answers.*` prefs (incl. transformBar) | polish-answers |
| hermes-skill/**, bridge/src/router heuristic/prompt/eval (except the reformat override) | skill-router-v4 (starts after protocol-v4 types land; re-read before editing) |

Shared files rules:
- i18n `app/src/i18n/ns/ui.{de,en,es}.ts`: add only your own sub-object (`ui.places`, `ui.products`, `ui.guide`, `ui.workout`, `ui.studyplan`, `ui.vocab`, `ui.mindmap`, `ui.timer`, `ui.summary`, `chat.transform`, `settings.answers`). Re-read right before editing.
- `MessageItem.tsx`, `Markdown.tsx`, `HuiView.tsx`, `Gallery.tsx`: minimal edits; re-read right before each edit.
- Gallery: each module agent appends ONE clearly separated section.
- Native deps: run `npx expo install …` only under `flock /tmp/hui-npm.lock` (never two installs at once); report every new dependency.
- Checks: `scripts/check.sh` (tsc | tsc-test | test <files> | all) and `cd app && npm run compat`.
- No APK builds. build-host has no swap. Dev servers only for one final visual check (MemAvailable > 6 GB), on your own port (8111–8116), stopped afterwards.
- Don't commit.
