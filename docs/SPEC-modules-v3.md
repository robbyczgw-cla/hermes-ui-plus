# Hermes UI+ – Interactive modules v3 (shared contract)

Extends docs/SPEC.md and docs/SPEC-modules-v2.md (same rules: ```hui JSON, interactive nodes need a
stable `id`, partial JSON → skeletons, answered/locked state via `useNodeState`, replies as user messages
with a machine tag + readable text, all UI strings via `t()` in de/en/es, light/dark/all themes, 360 px,
haptics, reduce-motion, Hermes-engine compatible — run `npm run compat`).

## New nodes
- `translation` {id?, source: {lang, text}, targets: {lang, text, romanization?}[] (1–4), note?}
  — side-by-side/stacked cards per language with language name + flag-free label, 🔊 speak per text
  (voice module: device TTS / bridge TTS with the text's language), copy per text, "Tauschen" (swap
  source/target view). Not interactive (no reply).
- `poll` {id, question, options: {id?, label, emoji?}[] (2–8), multiple?: boolean, voters?: string[]
  (names for pass-the-phone voting), allowAdd?: boolean, anonymous?: boolean}
  — votes persisted in node state; with `voters`: pick your name, then vote (one vote set per voter,
  editable until sent); live bar results; "Ergebnis senden" → `[poll:<id>] Pizza 3 · Sushi 1 (4 Stimmen)`.
- `agenda` {id, date? (ISO date), title?, blocks: {id?, start (HH:MM or ISO), end, title, location?,
  kind?: 'work'|'meal'|'travel'|'free'|'event'|'sport'|'focus', note?}[] (≤ 30), editable?: boolean (default true)}
  — vertical day timeline with time ruler, colored blocks by kind, now-line if today; edit: drag to move
  (15-min snap) or ± buttons, resize end, delete, add block; per block "In Kalender" (calendar action,
  confirmed) and "Alle in Kalender"; after edits "Plan übernehmen" → `[agenda:<id>] 09:00–10:00 Fokus · …`.
- `weather` {location, unit?: 'C'|'F', current?: {temp, condition, feelsLike?, wind?, humidity?, precip?},
  hourly?: {time, temp, condition, precip?}[] (≤ 24), daily?: {date, min, max, condition, precip?}[] (≤ 10),
  source?, basis?} — `condition` ∈ clear | sunny | partly | cloudy | overcast | fog | drizzle | rain |
  showers | thunder | snow | sleet | wind | clear-night | partly-night; animated condition icons (svg,
  subtle), hourly strip (horizontal scroll), daily rows with min/max bar; data comes from the agent's tools
  — provenance chip required.
- `decision` {id, title?, criteria: {id?, label, weight (0–10)}[] (2–8), options: {id?, label,
  scores: Record<criterionId|label, 0–10>, note?}[] (2–6), note?}
  — weighted decision matrix: weight sliders, live total score per option (Σ weight·score / Σ weight,
  0–10, 1 decimal), ranked bars, winner highlight, tap option to see per-criterion breakdown;
  "Entscheidung senden" → `[decision:<id>] Gewinner: Wohnung B (7,8) · Gewichte: Preis 8, Lage 6, …`.
- `rank` {id, prompt?, items: {id?, label, description?}[] (2–10), submitLabel?}
  — drag to reorder (long-press drag on native; up/down buttons always available for a11y) →
  `[rank:<id>] 1. A · 2. B · 3. C`.
- `scale` {id, question, min (default 1), max (default 5), step?, style?: 'slider'|'stars'|'emoji'|
  'segments', labels?: {min?, max?}, emojis?: string[]} — single answer; tap/drag; sends immediately with
  undo window (like choice) → `[scale:<id>] 4/5` (+ label if any).

## Chart extensions (existing `chart` node)
`kind` adds: `hbar` (horizontal bars, ranking), `stacked` (stacked bars), `scatter` (data {x:number, y:number,
label?}), `radar` (series × categories, 3–8 axes, 0..max), `gauge` ({value, min?, max?, target?, unit?} via
`series[0].data[0].y` or top-level `value` — define one, document), `heatmap` (calendar heatmap: data
{x: ISO date, y: number}, GitHub-style weeks, or matrix {x: category, y2: category, y}), `waterfall`
(data {x, y: delta} + optional `total: true` points). `stats.items[].sparkline?: number[]` (tiny line).
All with tap-to-inspect, table view, provenance chip, legend, partial-data skeletons.

## Router / skill
New route formats: `translation`, `poll`, `agenda`, `weather`, `decision`, `rank`, `scale`; chart
components: `radar`, `gauge`, `heatmap`, `waterfall`, `hbar`, `stacked`, `scatter`.

## Ownership (v3 build)
| Path | Workstream |
|---|---|
| app/src/protocol (types, validate, tests), RouteFormat + app/src/ui/skeletons.tsx cases | protocol-v3 |
| app/src/ui/components/modules/c1/** (Translation, Poll) + registryC1.ts | modules-c1 |
| app/src/ui/components/modules/c2/** (Agenda, Weather) + registryC2.ts | modules-c2 |
| app/src/ui/components/modules/c3/** (Decision, Rank, Scale) + registryC3.ts | modules-c3 |
| app/src/ui/components/Chart.tsx (+ chart helpers), stats sparkline in content.tsx | charts-v3 |
| hermes-skill/, bridge/src/router*, bridge/eval, app/src/claude/systemPrompt.ts (regen only) | skill-router-v3 |
Gallery (app/src/ui/Gallery.tsx): each module agent appends ONE clearly separated section block; re-read
before editing. i18n: each module agent uses keys under `ui.<module>.*` in app/src/i18n/ns/ui.{de,en,es}.ts
— ui.*.ts is shared: re-read right before editing and only add your own sub-object.
