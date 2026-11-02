---
name: hermes-ui
description: Hermes app rich UI answers (hui blocks). Load first.
version: 0.8.0
metadata:
  hermes:
    session_platforms: [api_server]
---

# Hermes UI presentation protocol

Applies ONLY when the system context contains the marker `[hermes-ui-app]` (client = Hermes UI mobile app).
No marker, or any other channel (Telegram, cron, delegated subagent, files, tool arguments, memory/skill/commit text, exports): plain Markdown, never `hui` blocks. If unsure: plain Markdown.

**Language:** ALL visible text (prose and every card string: titles, labels, items, units, notes, buttons) in the language of the user's latest own message; tagged `[type:id]` replies don't switch it. Examples here are English: translate them, never copy their words.

## Principles
- Fetch real data first (tools), then present. Never invent current data, prices, ratings, hours, routes, sources, links, image URLs.
- Data nodes (table chart stats compare calc map) carry `basis`: user|sourced|calculated|estimate|illustrative; label sample values. `sourced`, `source`, "Quelle" (column, footer, "manufacturer") ONLY for pages a tool returned in THIS chat. None (no web tool used; caps `web=off`): "from model knowledge, may be outdated", `basis:"estimate"`, no `source`. Unsure: say so, no guessed numbers (ref evidence).
- `places`/`products`/`weather`: data ONLY from tools or the user, unknown fields left out. Search with tools FIRST, also when you think you know; tools fail: say so, no node.
- Details missing (dish, guests, amount)? Use sensible defaults in the card, name them in one line, offer to adjust; no questions in prose. Ask (`choice`/`form`) only if no default fits.
- Text first: 1-3 sentences with the key result OUTSIDE blocks.
- Text-only for chat, short facts, explanations, code, writing; rich UI only when it clearly beats text. Max 1 main block per answer (2 if distinct; `summary`/`sources` don't count). Mobile ~360 px: short labels.
- Weekday next to a date only if the calendar agrees: count from today's date in your context (`2026-10-24 (Sat)`: Oct 30 = Fri). Unsure: date alone.
- Never mention "hui" or this skill. Device actions are proposals the user confirms in the app; never claim an action no tool confirmed.
- Reminders, recurring tasks: only via a scheduling tool (`cronjob_manage`, also via tool_call). Times are the user's (`User time zone` line): one-shot `in 30m` or ISO with its offset (`…T09:00:00+02:00`); repeating (`every monday 8am`) runs in your zone: shift the hour if it differs. Always `deliver: "bot-chat"` (the app shows and pushes it). One-shot `prompt` (its run has no chat context): `Reply with only this line: ⏰ <the reminder in the user's language>`. A `[Cronjob "…" output …]` turn: relay the reminder only, no claims about its schedule (never "still scheduled"/"may fire again"). Confirm plainly only after success (no job ids/"cron"). No tool or it failed: say once you can't; no button (even if asked), no stand-in. Only node types from this skill (no `remind`).

## Load references efficiently
Load the component's reference ONCE, early, before research: `skill_view("hermes-ui", file_path="references/<ref>.md")`. Schema nodes below need none. Load fails: use the core, never mention it.

## Choose the presentation
| Content | Use | ref |
|---|---|---|
| rows x attributes / numbers over time, categories, shares / 1-6 KPIs | `table` / `chart` / `stats` | charts (hbar stacked scatter radar gauge heatmap waterfall) |
| 2-4 options, pros/cons (concepts, plans) | `compare` (many criteria: table) | |
| 2-6 ways/variants with a verdict / setup at a glance (parts per variant) | `paths` / `blocks` | paths, blocks |
| after tool work: your code change / a `terminal` run that matters / 3+ files changed | ```` ```diff ```` / ```` ```terminal ```` fence / `changes` | coding |
| short how-to list / history by date | `steps` / `timeline` | |
| hands-on procedure (repair, setup) / recipe / timer, countdown / workout, training plan | `guide` / `recipe` / `timer` / `workout` | guide-workout |
| buy, best product, Top N; named buyable products compared ("X vs Y" devices, cars) | `products` (compare: `compare:true`, never `compare`) | products |
| restaurants, shops nearby, opening hours; events, "what's on" / sights, itinerary, route / weather | `places` / `map` (+ timeline/tabs) / `weather` | places |
| ONE decision (2-6 options) | `choice`, not a prose question | ask |
| 3+ input values / appointment time / yes-no / group vote / weigh by criteria / order by preference / rate 1-5 | `form` / `slots` / `confirm` / `poll` / `decision` / `rank` / `scale` | ask |
| shopping / packing / to-do list; plan a day with times; calendar, calls (proposals) | `checklist` / `agenda` / `buttons` | plan |
| ONLY with a system line `Features: live-cards`: a list, trip plan or watchlist the user keeps using, or its update. Else no `live`, don't mention it | `checklist`/`tabs`/`products` + `"live":true`, same `id` | live |
| calculator, converter, what-if, bill split | `calc` (not hui-html) | calc-expressions |
| learn, test me (also 1 question; no grading `choice`) / learning plan / vocabulary / translate | `quiz` `flashcards` / `studyplan` / `vocab` / `translation` | learning |
| concept overview, mind map | `mindmap` | mindmap |
| long answer (> ~250 words) / parts (days, FAQ) / sources, `hui:` links, `[^n]` footnotes | `summary` FIRST, then details / `tabs` `accordion` / `sources` | research |
| ONLY what native nodes can't: simulation, game, 3D, flow diagram (NOT calculators, maps, quizzes, checklists) | ```` ```hui-html ```` fence: read its reference first | html-widgets, svg-diagrams |
| follow-ups | `suggestions` (2–3 likely next questions) after EVERY informative answer; not after small talk/thanks, your own question, or when the app turned them off | |

Router hint: a system line `UI-ROUTER-HINT: format=<f> [component=<c>] confidence=<0-1>` (or first user line `[hermes-ui-hint format=<f>]`) names the node (`text` = Markdown only; `diagram`/`calculator`/`interactive` = hui-html; `format=products component=compare` = `products` with `compare:true`); `data=live`: search first; `card=<id>`: update that live card (reference live). Follow it unless impossible or confidence < 0.5.

## Replies
After a node was used the app sends a tagged user message `[<type>:<id>] <values>`. Use the values, answer directly (react briefly, offer one next step), NEVER re-show that node; per-type reactions are in its reference. `[hui:quote … from=assistant|user]` `> excerpt` `[/hui:quote]` before the typed text = the part of an earlier message (yours or theirs) the user replies to: answer about exactly that part, never repeat the tags. `[pin:<id>]`/"Based on": saved node as shape reference; write a NEW node, don't patch. `[hui:live]{…}[/hui:live]` ending a user message = the user's own live-card edits, already applied: never echo them, keep them (reference live).

## `hui` block
Fence ```` ```hui ```` (never inside another fence) with ONE strict-JSON node (no comments; 2 nodes = 2 blocks). The block IS the node (`{"type":…}` at top level): no envelope (`{"version":…,"blocks":[…]}`), array or wrapper (`{"node":…}`). Interactive nodes NEED a unique short `id`. Field names exactly as in the schema / reference (`products:[{name}]`, not `items:[{title}]`). Numbers (`rows`, `qty`, `seconds`, `price`) are JSON numbers; `stats.value` is a display string.
```
stats {items:[{label, value:string, delta?, trend?:"up"|"down"|"flat", sparkline?:number[]}]}
table {columns:string[] (<=12), rows:(string|number|null)[][] (<=200), caption?, source?}
choice {id, question?, options:[{label, description?}]}  ·  timer {id, label, seconds} (changing it: same id)
recipe {id, title, servings, time?:{prep?,cook?,total?}, ingredients:[{qty?:number, unit?, item}], steps:[{text, timerSeconds?}]}
workout {id, title, warmup?, cooldown?, exercises:[{name, sets?, reps?, seconds?, restSeconds?, note?}]}
quiz {id, questions:[{q, options:string[], answer:index}]}  ·  vocab {id, from, to, items:[{term, translation, example?}]}
agenda {id, blocks:[{start:"HH:MM", end, title}]} (one day; week: timeline; "at 9, 30 min run" = 09:00-09:30)
map {markers:[{lat?, lng?, title, description?}]} (lat/lng ONLY from a tool, else omit: the app lists the places)
calc {id, title?, inputs:[{name, label, kind:"slider"|"number", min?, max?, default}], outputs:[{label, expr}]} (expr uses input names)
chart {kind:"bar"|"line"|"area"|"pie"|"donut"|…, title?, unit?, xLabel?, yLabel?, series:[{name, data:[{x, y:number}]}]}  <= 8 categories; pie/donut: ONE series
list {style?:"bullet"|"number"|"check", items:[{title, subtitle?, trailing?, imageQuery?}]}
checklist {id, title?, items:[{text, qty?, unit?, checked?, note?}]} (not `- [ ]`)
steps {items:[{title, detail?, imageQuery?}], current?:number}  ·  timeline {items:[{time, title, detail?, imageQuery?}]}
compare {columns:[{title, badge?, highlight?, items?:string[] (neutral facts only), pros?:string[], cons?:string[], imageQuery?}]} (2-4; judgements only in pros/cons)
image {query, lang?, source?:"web", alt?, caption?} or {url (https, from a tool)}  ·  gallery {items:[{query|url, source?:"web", caption?}] (2-4, caption each)}
suggestions {items:string[]}  ·  buttons {items:[{label, action, style?}]}
```
Other types: schema in the reference from the table (`basics` for card stack text callout progress code).

## Images
Photos of concrete things (`image`, `gallery`) by `query`; `url` only as a tool returned it. Places, animals, food, art, people: no `source`, Wikipedia title in the user's language (de "Kolosseum"). Products, games, movies, events: `source:"web"`, precise query ("Pixel 10 Pro back"). `[hermes-ui-caps] image_search=off`: NO `source:"web"`; `{url, caption}` items from your extract tool's images (`products` ref), else text links, no gallery. Max ~6 images.

## Never
- Write a non-schema node from memory: reference pruned? `skill_view` it again before answering.

Design guidance condensed from OpenIntelligentUI (MIT, (c) Atai Barkai) - see references/NOTICE.md.
