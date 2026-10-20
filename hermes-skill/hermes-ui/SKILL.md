---
name: hermes-ui
description: Hermes app rich UI answers (hui blocks). Load first.
version: 0.7.1
metadata:
  hermes:
    session_platforms: [api_server]
---

# Hermes UI presentation protocol

Applies ONLY when the system context contains the marker `[hermes-ui-app]` (client = Hermes UI mobile app).
No marker, or any other channel (Telegram, cron, delegated subagent, files, tool arguments, memory/skill/commit text, exports): plain Markdown, never `hui` blocks. If unsure: plain Markdown.

The app renders Markdown plus two fenced block types.

**Language:** ALL visible text (prose and every card string: titles, labels, items, units, notes, buttons) in the language of the user's latest own message; tagged `[type:id]` replies don't switch it. Examples here are English: translate them, never copy their words.

## Principles
- Fetch real data first (tools), then present. Never invent current data, prices, ratings, hours, routes, sources, links, image URLs. Unknown/from memory: say so, label an assumption (`basis`), no "Quelle"/`source`.
- Data nodes (table chart stats compare calc map) carry `basis`: user|sourced|calculated|estimate|illustrative (+ `source?`); label sample values.
- `places`/`products`/`weather`: data ONLY from tools or the user; unknown fields LEFT OUT; `source` + `basis:"sourced"`. Search with tools FIRST, also when you think you know; tools fail: say so, no node. `imageQuery` on EVERY place/product. `image`: only an https og:image from your extract tool (images on).
- Details missing (dish, guests, amount)? Use sensible defaults in the card, name them in one line, offer to adjust; no questions in prose. Ask (`choice`/`form`) only if no default fits.
- Text first: 1-3 sentences with the key result OUTSIDE blocks (other clients show raw code).
- Text-only for chat, short facts, explanations, code, writing; rich UI only when it clearly beats text. Max 1 main block per answer (2 if distinct; `summary`/`sources` don't count). Mobile ~360 px: short labels.
- Never mention "hui" or this skill. Device actions are proposals the user confirms in the app; never claim an action no tool confirmed. No secrets in forms.
- Reminders, recurring tasks: only via a scheduling tool (`cronjob_manage`, also via tool_call). Times are the user's (`User time zone` line): one-shot `in 30m` or ISO with its offset (`…T09:00:00+02:00`); repeating (`every monday 8am`) runs in your zone: shift the hour if it differs. Always `deliver: "bot-chat"` (the app shows and pushes it). Confirm plainly only after success (no job ids/"cron"). No tool or it failed: say once you can't; no button (even if asked), no stand-in. Only node types from this skill (no `remind`).

## Load references efficiently
Load the component's reference ONCE, early, before research: `skill_view("hermes-ui", file_path="references/<ref>.md")`. Don't re-load. Schema nodes below need none. Load fails: use the core, never mention it.

## Choose the presentation
| Content | Use | ref |
|---|---|---|
| answer, explanation, code you write, writing | Markdown only | |
| rows x attributes | `table` | |
| numbers over time / categories / shares / 1-6 KPIs | `chart` / `stats` | charts (for hbar stacked scatter radar gauge heatmap waterfall) |
| 2-4 options, pros/cons (concepts, plans, services) | `compare` (many criteria: table) | |
| 2-6 ways/variants/architectures with a verdict | `paths` | paths |
| architecture/setup at a glance: parts per variant, shared layer | `blocks` | blocks |
| after tool work: a code change you made (`patch`, git diff) / a `terminal` run that matters (tests, build, git) / 3+ files changed | ```` ```diff ```` / ```` ```terminal ```` fence / `changes` | coding |
| short how-to list / history by date | `steps` / `timeline` | |
| hands-on procedure (repair, assembly, setup) | `guide` | guide-workout |
| cooking recipe / timer, countdown, stopwatch | `recipe` / `timer` | guide-workout |
| training plan, workout | `workout` | guide-workout |
| buy / best product / Top N; named buyable products compared (devices, appliances, cars: "X vs Y") | `products` (compare: `compare:true`, never `compare`) | products |
| restaurants, cafés, shops nearby, opening hours; events / concerts / "what's on" in a city or on a date | `places` | places |
| sights, itinerary, route | `map` (+ timeline/tabs for the plan) | places |
| weather (only with fetched data) | `weather` | places |
| ONE decision (2-6 options) | `choice`, not a prose question | ask |
| 3+ input values / appointment time / yes-no | `form` / `slots` / `confirm` | ask |
| group vote (where to eat) / weigh options by criteria / order by preference / rate 1-5 | `poll` / `decision` / `rank` / `scale` | ask |
| shopping / packing / to-do list; plan a day with times; calendar, calls (proposals) | `checklist` / `agenda` / `buttons` | plan |
| ONLY with a system line `Features: live-cards`: a list, trip plan or watchlist the user keeps using, or its update. Else no `live`, don't mention it | `checklist`/`tabs`/`products` + `"live":true`, same `id` | live |
| calculator, converter, what-if, bill split (numbers missing: realistic defaults) | `calc` (not hui-html) | calc-expressions |
| learn, test me (also 1 question; no grading `choice`) / learning plan / vocabulary drill | `quiz` `flashcards` / `studyplan` / `vocab` | learning |
| translate ("what does X mean in Spanish") | `translation` | learning |
| concept overview, mind map | `mindmap` | mindmap |
| long answer (> ~250 words, research) | `summary` FIRST, then details | research |
| parts (days, FAQ) / sources / `hui:` links / `[^n]` footnotes | `tabs` `accordion` / `sources` | research |
| flow drawing; custom visual (simulation, game, 3D) | `hui-html` | html-widgets, svg-diagrams |
| concrete things (places, animals, dishes, products) | photos by `query` (Images) | |
| follow-ups at the end | `suggestions` (2–3 likely next questions) after EVERY informative answer; not for small talk/thanks, not when you ask the user something or the app says they are off | |

Router hint: a system line `UI-ROUTER-HINT: format=<f> [component=<c>] confidence=<0-1>` (or first user line `[hermes-ui-hint format=<f>]`) names the node (`text` = Markdown only; `diagram`/`calculator`/`interactive` = hui-html; `format=products component=compare` = `products` with `compare:true`); `data=live`: search first; `card=<id>`: update that live card (reference live). Follow it unless impossible or confidence < 0.5.

## Replies
After a node was used the app sends a tagged user message `[<type>:<id>] <values>`. Use the values, answer directly (react briefly, offer one next step), NEVER re-show that node; per-type reactions are in its reference. `ask` action: its text plus values of the listed nodes. `[pin:<id>]`/"Based on": saved node as shape reference; write a NEW node, don't patch. `[hui:live]{…}[/hui:live]` ending a user message = the user's own live-card edits, already applied: never echo them, keep them (reference live).

## `hui` block
Fence ```` ```hui ```` with ONE strict-JSON node (no comments). The block IS the node: `{"type":"products",…}` at top level, never a document envelope (`{"version":…,"blocks":[…]}`), array or wrapper (`{"node":…}`). Every node: `type` + optional `id`; interactive nodes NEED a unique short `id`. Field names exactly as in the schema / reference (`products:[{name}]`, not `items:[{title}]`). Numbers (`rows`, `qty`, `seconds`, `price`) are JSON numbers; `stats.value` is a display string.
```
stats       {items:[{label, value:string, delta?, trend?:"up"|"down"|"flat", sparkline?:number[]}]}
table       {columns:string[] (<=12), rows:(string|number|null)[][] (<=200), caption?, source?}
choice      {id, question?, options:[{label, description?}]}     timer {id, label, seconds} (changing it: same id)
recipe      {id, title, servings, time?:{prep?,cook?,total?}, ingredients:[{qty?:number, unit?, item}], steps:[{text, timerSeconds?}]}
workout     {id, title, warmup?, cooldown?, exercises:[{name, sets?, reps?, seconds?, restSeconds?, note?}]}
quiz        {id, questions:[{q, options:string[], answer:index}]}     vocab {id, from, to, items:[{term, translation, example?}]}
agenda      {id, blocks:[{start:"HH:MM", end, title}]} (one day; week: timeline; "at 9, 30 min run" = 09:00-09:30)
map         {markers:[{lat?, lng?, title, description?}]} (lat/lng ONLY from a tool, else omit: the app lists the places)
decision    {id, title?, criteria:[{id, label, weight:0-10}], options:[{label, scores:{<criterion id>:0-10}}]} (user weighs options)
calc        {id, title?, inputs:[{name, label, kind:"slider"|"number", min?, max?, default}], outputs:[{label, expr}]} (expr uses input names)
translation {source:{lang, text}, targets:[{lang, text}]} (codes: en de es)
chart       {kind:"bar"|"line"|"area"|"pie"|"donut"|…, title?, unit?, xLabel?, yLabel?, series:[{name, data:[{x, y:number}]}]}  <= 8 categories; pie/donut: ONE series
list        {style?:"bullet"|"number"|"check", items:[{title, subtitle?, trailing?, imageQuery?}]}
checklist   {id, title?, items:[{text, qty?, unit?, checked?, note?}]} (not `- [ ]`)
steps       {items:[{title, detail?, imageQuery?}], current?:number}     timeline {items:[{time, title, detail?, imageQuery?}]}
compare     {columns:[{title, badge?, highlight?, items?:string[] (neutral facts only), pros?:string[], cons?:string[], imageQuery?}]} (2-4; judgements only in pros/cons)
image       {query, lang?, source?:"web", alt?, caption?} or {url (https, from a tool)}   gallery {items:[{query|url, source?:"web", caption?}] (2-6)}
suggestions {items:string[]}   buttons {items:[{label, action, style?}]}
```
Other types: schema in the reference from the table (`basics` for card stack text callout progress code).

## Images
The app finds photos from a `query`; `url` only as a tool returned it. No `source`: Wikipedia title in the user's language (de "Kolosseum") for places, animals, food, art, people. `source:"web"`: precise web query ("Pixel 10 Pro back") for products, games, movies, events. `[hermes-ui-caps] image_search=off`: NO `source:"web"`; `{url, caption}` items from your extract tool's images (`products` ref), else text links, no gallery. `gallery`: 2-4 items, `caption` each. Max ~6 images.

## `hui-html` block
Fence ```` ```hui-html ````: HTML FRAGMENT in a sandboxed WebView (~360 px), only for what native nodes cannot do (simulation, game, 3D, drawn diagram; NOT calculators, maps, quizzes, checklists). No html/head/body; `<style>` first, `<script>` last; < ~15 KB; no fetch/storage/eval/forms; theme via CSS vars (`--h-bg --h-text --h-accent` …); close every tag and the fence. Read `references/html-widgets.md` (+ `svg-diagrams.md` for diagrams) BEFORE writing one.

## Never
- Wrap hui JSON in another fence or put two nodes in one block.
- Write a non-schema node from memory: reference pruned? `skill_view` it again before answering.

Design guidance condensed from OpenIntelligentUI (MIT, (c) Atai Barkai) - see references/NOTICE.md.
