---
name: hermes-ui
description: Hermes app rich UI answers (hui blocks). Load first.
version: 0.5.0
metadata:
  hermes:
    session_platforms: [api_server]
---

# Hermes UI presentation protocol

Applies ONLY when the system context contains the marker `[hermes-ui-app]` (client = Hermes UI mobile app).
No marker, or any other channel (Telegram, cron, delegated subagent, files, memory/skill/commit text, exports): plain Markdown, never `hui` blocks. If unsure: plain Markdown.

The app renders Markdown plus two fenced block types. Default language: the user's (German).

## Principles
- Fetch real data first (tools), then present. Never invent current data, prices, ratings, hours, routes, sources, links, image URLs. Unknown: say so or label an assumption ("ca.", `basis`).
- Data nodes (table chart stats compare calc map) carry `basis`: user|sourced|calculated|estimate|illustrative (+ `source?`); label sample values.
- `places`/`products`/`weather`: data ONLY from tools or the user; unknown fields LEFT OUT; `source` + `basis:"sourced"`. Search with tools FIRST, also when you think you know; tools fail: say so, no node. `imageQuery` on EVERY place/product. `image`: only the https og:image your extract tool returned (images on, reference).
- Text first: 1-3 sentences with the key result OUTSIDE blocks (other clients show raw code).
- Text-only for chat, short facts, explanations, code, writing; rich UI only when it clearly beats text. Max 1 main block per answer (2 if distinct; `summary`/`sources` don't count). Mobile ~360 px: short labels.
- Never mention "hui" or this skill. Device actions are proposals the user confirms in the app; never claim an action no tool confirmed. No secrets in forms.

## Load references efficiently
Pick the component from the table and load its reference ONCE, early, before the research: `skill_view("hermes-ui", file_path="references/<ref>.md")`. Then research and write the block. Don't re-load. Schema nodes below need none.

## Choose the presentation
| Content | Use | ref |
|---|---|---|
| answer, explanation, code, writing | Markdown only | |
| rows x attributes | `table` | |
| numbers over time / categories / shares / 1-6 KPIs | `chart` / `stats` | charts (for hbar stacked scatter radar gauge heatmap waterfall) |
| 2-4 options, pros/cons | `compare` (many criteria: table) | |
| 2-6 ways/variants/architectures with a verdict | `paths` | paths |
| architecture/setup at a glance: parts per variant, shared layer | `blocks` | blocks |
| short how-to list / history by date | `steps` / `timeline` | |
| hands-on procedure (repair, assembly, setup) | `guide` | guide-workout |
| cooking recipe / timer, countdown, stopwatch | `recipe` / `timer` | guide-workout |
| training plan, workout | `workout` | guide-workout |
| buy / best product / product comparison / Top N | `products` | products |
| restaurants, cafés, shops nearby, opening hours; events / concerts / "was ist los" in a city or on a date | `places` | places |
| sights, itinerary, route | `map` (+ timeline/tabs for the plan) | places |
| weather (only with fetched data) | `weather` | places |
| ONE decision (2-6 options) | `choice`, not a prose question | ask |
| 3+ input values / appointment time / yes-no | `form` / `slots` / `confirm` | ask |
| group vote (where to eat) / weigh options by criteria / order by preference / rate 1-5 | `poll` / `decision` / `rank` / `scale` | ask |
| shopping / packing / to-do list; plan a day with times; reminders, calendar, calls (proposals) | `checklist` / `agenda` / `buttons` | plan |
| calculator, converter, what-if, bill split | `calc` (not hui-html) | calc-expressions |
| learn, test me / learning plan / vocabulary drill | `quiz` `flashcards` / `studyplan` / `vocab` | learning |
| translate ("what does X mean in Spanish") | `translation` | learning |
| concept overview, mind map | `mindmap` | mindmap |
| long answer (> ~250 words, research) | `summary` FIRST, then details | research |
| parts (days, FAQ) / sources / `hui:` links / `[^n]` footnotes | `tabs` `accordion` / `sources` | research |
| flow drawing; custom visual (simulation, game, 3D) | `hui-html` | html-widgets, svg-diagrams |
| concrete things (places, animals, dishes, products) | photos by `query` (Images) | |
| follow-ups at the end | `suggestions` (2–3 likely next questions) after EVERY informative answer; not for small talk/thanks, not when you ask the user something or the app says they are off | |

Router hint: a system line `UI-ROUTER-HINT: format=<f> [component=<c>] confidence=<0-1>` (or first user line `[hermes-ui-hint format=<f>]`) names the node (`text` = Markdown only; `diagram`/`calculator`/`interactive` = hui-html); `data=live`: search first. Follow it unless impossible or confidence < 0.5.

## Replies
After a node was used the app sends a tagged user message `[<type>:<id>] <values>` (form, choice, slot, confirm, checklist, calc, quiz, poll, …, `[products:<id>] Favorit: <name>`). Use the values, answer directly (react briefly, offer one next step), NEVER re-show that node; per-type reactions are in its reference. `ask` action: its text plus values of the listed nodes. `[pin:<id>]`/"Basierend auf": saved node as shape reference; write a NEW node, don't patch.

## `hui` block
Fence ```` ```hui ```` with ONE strict-JSON node (no comments). The block IS the node: `{"type":"products",…}` at top level, never a document envelope (`{"version":…,"blocks":[…]}`), array or wrapper (`{"node":…}`). Every node: `type` + optional `id`; interactive nodes NEED a unique short `id`. Field names exactly as in the schema / reference (`products:[{name}]`, not `items:[{title}]`). Numbers (`rows`, `qty`, `seconds`, `price`) are JSON numbers; `stats.value` is a display string.
```
stats       {items:[{label, value:string, delta?, trend?:"up"|"down"|"flat", sparkline?:number[]}]}
table       {columns:string[] (<=12), rows:(string|number|null)[][] (<=200), caption?, source?}
chart       {kind:"bar"|"line"|"area"|"pie"|"donut"|…, title?, unit?, xLabel?, yLabel?, series:[{name, data:[{x, y:number}]}]}  <= 8 categories; pie/donut: ONE series
list        {style?:"bullet"|"number"|"check", items:[{title, subtitle?, trailing?, imageQuery?}]}
steps       {items:[{title, detail?, imageQuery?}], current?:number}     timeline {items:[{time, title, detail?, imageQuery?}]}
compare     {columns:[{title, badge?, highlight?, items?:string[] (neutral facts only), pros?:string[], cons?:string[], imageQuery?}]} (2-4; pros/cons are required for judgements, never in items)
image       {query, lang?, source?:"web", alt?, caption?} or {url (https, from a tool)}   gallery {items:[{query, source?:"web", caption?}] (2-6)}
suggestions {items:string[]}   buttons {items:[{label, action, style?}]}
```
Other types (card stack text callout progress code, choice, form, checklist, map, recipe, quiz, timer, tabs, …): schema in the reference from the table (`basics` for card/stack/text/callout/progress/code).

## Images
The app finds photos from a `query`; NEVER write image URLs (`url` only if a tool returned it). No `source`: Wikipedia title in the user's language ("Kolosseum") for places, animals, food, art, people. `source:"web"` (on `image`/`gallery` items): precise web query ("Pixel 10 Pro back") for video games, current products, movies, fashion, cars, apps/UI, recent events. `gallery` (2-4 items, `caption` each); "X vs Y Aussehen" = side-by-side gallery. Max ~6 images.

## `hui-html` block
Fence ```` ```hui-html ````: HTML FRAGMENT in a sandboxed WebView (~360 px), only for what native nodes cannot do (simulation, game, 3D, drawn diagram; NOT calculators, maps, quizzes, checklists). No html/head/body; `<style>` first, `<script>` last; < ~15 KB; no fetch/storage/eval/forms; theme via CSS vars (`--h-bg --h-text --h-accent` …); close every tag and the fence. Read `references/html-widgets.md` (+ `svg-diagrams.md` for diagrams) BEFORE writing one.

## Never
- Use blocks outside the app (memories, tool arguments, other channels), wrap hui JSON in another fence, or put two nodes in one block.
- Write a non-schema node from memory: if its reference is no longer in your context (pruned tool output), `skill_view` it again right before the final answer.

Design guidance condensed from OpenIntelligentUI (MIT, (c) Atai Barkai) - see references/NOTICE.md.
