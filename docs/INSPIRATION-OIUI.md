# Inspiration from OpenIntelligentUI (OIUI)

Source: `refs/OpenIntelligentUI` (MIT, CopilotKit; read-only, nothing was run). Paths below are relative to it
unless prefixed `app/`/`docs/` (ours). Credit OIUI when porting code.

**Honest scope note.** OIUI is a web demo whose "native" interactive set is small. Most of the interactivity
(calculators, quizzes, simulations, maps, recipe scalers) is NOT a component: it is free-form sandboxed
HTML generated per turn, described only as *prompts* (`apps/app/src/components/demo-gallery/demo-data.ts`).
There is no choice/checklist/quiz/recipe/timer/tabs component to copy. What is worth taking is the
interaction contracts, honesty rules, animation specs and the saved-widget loop.

Frontend layer = CopilotKit v2 (`useComponent`, `useRenderTool`, `useDefaultRenderTool`, `useHumanInTheLoop`,
`useFrontendTool`, `useAgent`); agent = LangGraph/Deep Agent with shared state. Hermes has none of that
(plain SSE chat + `approval.request`), so every pattern below is re-expressed over "hui node + next user message".

---
## 1. Inventory of OIUI interactive patterns

| # | Pattern | Files | What it does / data shape | Interaction + state | UX details |
|---|---|---|---|---|---|
| 1 | **Human-in-the-loop: MeetingTimePicker** | `apps/app/src/components/generative-ui/meeting-time-picker.tsx`; `docs/human-in-the-loop.md`; hook in `apps/app/src/hooks/use-generative-ui-examples.tsx` | Agent calls frontend tool `scheduleTime{reasonForScheduling, meetingDuration}`. Slots `{date,time,duration?}[]` (hard-coded defaults in the component; the agent does NOT supply real availability). | `respond(string)` is the tool result; agent run resumes with that text. Local state `selectedSlot`/`declined` swaps the card for a confirmation ("Meeting Scheduled" / "No Time Selected"); buttons only render while `status==="executing"`. Decline sends a *instructive* sentence ("...Please suggest alternative times or ask for their availability."). | Staggered `fadeSlideUp` 0.4 s, 80 ms per row; always a "None of these work" escape row; big emoji hero; hover/active scale. |
| 2 | **PlanCard** (agent "thinking" card) | `generative-ui/plan-card.tsx`; tool `apps/agent/src/plan.py` | `plan_visualization{approach, technology, key_elements[2-4]}`; rendered via `useRenderTool`. Purely informational, optional. | `<details>` auto-opens while `status` is executing/inProgress, auto-collapses when complete. | Spinner -> green check; header "Planning visualization..." -> "Plan: <technology>"; tech as a pill, bullets below. |
| 3 | **ToolReasoning** (default tool renderer) | `components/tool-rendering.tsx` | Any backend tool without custom renderer: name + args summarized as `[n items]`, `{n keys}`, quoted strings. | Same auto-open-while-running / collapse-when-done `<details>`. Noisy tools (`generate_form`) are suppressed by name list. | Never dumps raw args; truncated values. |
| 4 | **Agent state: todos** | `apps/agent/src/todos.py`; `docs/agent-state.md`, `docs/agent-tools.md` | `Todo{id,title,description,emoji,status:'pending'|'completed'}`; `AgentState.todos`. Tools `manage_todos(list)` (full replace, fills missing ids with uuid, replies `Command(update)`+`ToolMessage`) and `get_todos`. | Bidirectional: UI `agent.setState({todos})`, tool reads `runtime.state`. No separate frontend store. Docs say todos are *legacy* and not the product's main experience; no todo UI component ships in the repo. | -- |
| 5 | **Agent state: template library** (saved widgets) | `apps/app/src/components/template-library/{index,template-card,template-chip}.tsx`, `seed-templates.ts`; `apps/agent/src/templates.py` | `UITemplate{id,name,description,html,data_description,created_at,version,component_type?,component_data?}`. Seeds (weather, invoice, dashboard) ship in the frontend and are pushed into `agent.state.templates` on first render. Tools: `save_template`, `list_templates`, `apply_template`, `delete_template`, `clear_pending_template`. | Drawer (380 px, slide-in, backdrop blur). "Apply" sets `state.pending_template={id,name}`; a **chip is portaled above the composer** showing the pending template; on the next prompt the agent calls `apply_template` (pending wins over name/id) and regenerates a NEW widget in the same style using `data_description` as the data contract; then `clear_pending_template`. Seeds not deletable. Templates are *style references*, not live objects (`TEMPLATE_USAGE_NOTE`). | Card = live iframe preview (140 px, `srcdoc`, theme CSS injected) or mini SVG bar/pie preview from `component_data`; empty state teaches "hover a widget -> Save as Template". |
| 6 | **Demo gallery / starter prompts** | `components/demo-gallery/*`; `.chalk/plans/demo-gallery.md`; `explainer-cards.tsx` | `DemoItem{id,title,description,category:'Understand'|'Compare'|'Make a tool',emoji,prompt}`; 7 long, spec-quality prompts (trip animator, Monty Hall, bill splitter, meal/shopping scaler, bicycle gears...). Plan (not shipped): `GalleryItem{prompt,html?,component_type?,size}` masonry of saved outputs, "Try it", "Surprise me", download. | Tap card -> sends prompt. Explainer cards are portaled into the welcome screen and auto-removed once chat starts. | Category pill colours; three-axis taxonomy Understand / Compare / Make a tool doubles as routing guidance. |
| 7 | **Sandboxed widget (`generateSandboxedUi`)** | `generative-ui/open-generative-ui/{renderer.tsx,frame-content.ts,process-partial-html.ts,schema.ts}`; `docs/generative-ui.md`, `docs/architecture.md` | Streaming tool args in fixed order: `initialHeight -> placeholderMessages -> css -> html -> jsFunctions -> jsExpressions`. Activity content has `cssComplete/htmlComplete/...Complete` flags. | CSS-first gating (nothing visible until css done), html previewed through `processPartialHtml` + Idiomorph (no flicker), scripts run only after html complete; render throttled to 1000 ms but flushed immediately on cssComplete/htmlComplete/first js. Host bridge `sendPrompt({text})` (zod: trim, 1-4000 chars, must be "claimed" by a listener else rejects) and `openLink({url})` (https only). Height reported by ResizeObserver, clamped 50-4000 px, non-finite rejected. | Rotating loading phrases every 1.8 s ("Sketching pixels"...), height transition 200 ms, CSP allow-list (4 CDNs + tile host + wikimedia images), hover overlay Export (download .html / copy), fadeSlideIn stagger on first render + `.morph-enter` for later nodes, `prefers-reduced-motion` kills animation. |
| 8 | **Trip animator** | `open-generative-ui/trip-animator.ts` (+ `__tests__/trip-animator.test.ts`); `agent/skills/advanced-visualization/SKILL.md` §Live maps / §Trip itineraries; `agent/src/trip_images.py` | `createTripAnimator({stopCount 2-30, durationMs 1000-120000 (default 6000), pinElements, onFrame, onState})` -> `{play,pause,replay,seek(i),dispose}`. Frame `{progress,pinIndex,pinProgress,activeStop,(fromIndex,toIndex,fraction legacy)}`. Stops come from the agent; photos from `get_trip_stop_images(titles 1-8)` -> `{status:'available', image_url, artist, license, credit_url, article_url, note}` or `{status:'unavailable'}`. | Pure controller, rAF loop, no network. Pins drop 18 px with spring settle during the first 55 % of each slot, rest is hold; line segment revealed as its destination pin settles (>=70 %); **map camera stays still; chat never auto-scrolls**; active card strip scrolled via `scrollLeft` only on stop *change*; tap pin/card -> `seek()` (pauses). | Pause/Resume, Replay, polite status text updated per stop change only; starts once after first tile loaded; pauses on `visibilitychange`; reduced motion = jump to completed state; never loops. |
| 9 | **A2UI Table catalog** | `generative-ui/table-catalog.tsx`; `docs/visualization-routing.md` | `{title<=300, columns 1-12, rows<=200 x <=12 cells (<=2000 chars), source<=1000}`; `source` is REQUIRED ("user-provided, calculated, sourced, or explicitly illustrative"). | Validation: any row width != column count -> `role="alert"` "invalid rows or columns. Ask the assistant to regenerate it." Cells rendered as text only. | Caption, `scope=col`, focusable horizontal scroller, provenance line under table. |
| 10 | **Charts (typed components)** | `generative-ui/charts/{bar,pie}-chart.tsx`, `config.ts` | `{title, description, data:[{label,value}]}` zod schema (`useComponent`). Empty data -> "No data available" card. | Recharts, 800 ms ease-out draw, tooltip, 7-colour palette. `ExportOverlay` -> standalone HTML. | -- |
| 11 | **Export / share** | `generative-ui/export-overlay.tsx`, `export-utils.ts` | Hover menu: download as `.html` (slugified name) or copy code; works for sandbox widgets and charts. | Copy state "copied" 1.8 s; clipboard failure swallowed. | Only when `ready` (complete). |
| 12 | **Answer reveal** | `components/chat/reveal-blocks.ts`, `chat/answer-markdown.tsx`, `app/chat.css:174` | IntersectionObserver marks each markdown block `pending -> visible` once (live or offscreen). | 6 px rise + fade 320 ms; reduced motion = none. | Reader owns the scroll (`reader-scroll-view.tsx`: no resize-driven auto-scroll). |
| 13 | **Routing ("Jev")** | `apps/agent/src/visualization_router.py`; `docs/visualization-routing.md` | One typed choice per user message from 13 ids: `text, table, bar_chart, line_chart, scatter_plot, distribution, part_to_whole, flowchart, static_diagram, interactive_diagram, animated_route, map, calculator`. Input: last 4 text messages, each cut at 6000 chars, no tool output/system prompt. | Decision keyed by *user message id* (a repeated prompt is a new turn), reused across tool continuations; tool list is filtered to the matching renderer. **No silent fallback**: invalid/timeout fails the turn, retryable. | Renderer derived from choice (no contradictory pairs). |
| 14 | **Form (A2UI)** | `apps/agent/src/form.py` | A non-functional login form schema ("demonstration only"; prompt forbids credential collection and claiming it authenticates). | -- | Lesson: never present mock controls as functional. |

### How results return to the agent (the three mechanisms)
1. **Tool result** (`respond(text)` in HITL): UI is the tool call; the string *is* the tool output. Free text written for the model, including a recovery instruction on decline.
2. **Shared state** (`agent.setState` <-> `Command(update)`): todos/templates/`pending_template`. Agent reads `runtime.state`. The state flag is also the UI (chip shown iff `pending_template`).
3. **Explicit user message** (`sendPrompt` from a sandbox button): only on a user click, includes the *current validated selections*, button disabled while awaiting, error -> visible retryable status, `finally` re-enables. Never on load/timer/input change (`docs/interactive-answers.md`, `agent/src/prompt.py`).

Hermes mapping: only (3) exists (our `[form:<id>] {json}` message and `window.hermes.send`) plus the *real*
blocking `approval.request` (`docs/HERMES-API.md` §approval; answered via `POST /v1/runs/{run_id}/approval`).
There is no frontend-tool/state sync, so persisted things (checklists, pins) live on the device and are
shown to the agent only as text in a user message or by a tool the user later enables.

---
## 2. Not planned yet by us, worth adopting (ranked for a mobile personal assistant)

Our planned set already covers choice/checklist/calc/map/recipe/tabs/quiz/source/actions/timer.
Not yet planned:

1. **`slots` (slot/time picker)** - OIUI #1. Highest value: scheduling is core assistant work and it needs the "answered" state.
   `{type:'slots', id, title, subtitle?, slots:[{id, label, sublabel?, start?:ISO, durationMin?, note?}], multi?:false, declineLabel?, reply?:{template?:string}}`
   Tap -> locks the node (collapses to confirmation, persisted per message), sends `[slot:<id>] <slot.id> | <label>`; decline sends `[slot:<id>] none` (the skill tells the model to then ask for availability). Optional "Add to calendar" follow-up action.
2. **Answered/locked state for every input node** (form, choice, slots, confirm). OIUI swaps the control for a confirmation after `respond`; we should store `answers[messageId][nodeId]` and render read-only "You chose X" after reload. Add `status:'open'|'answered'` to the render context, not to the model's JSON.
3. **`provenance` on all data nodes** - OIUI makes `source` mandatory on tables and labels sample data *inside the UI*.
   Extend `HuiBase` with `source?: string; basis?: 'user'|'sourced'|'calculated'|'estimate'|'illustrative'` rendered as a small chip/caption (works for table, chart, stats, compare, list, map, calc, recipe). Parser warns when a table/chart/stats has neither.
4. **`confirm` (approval card)** - model-proposed side-effecting action.
   `{type:'confirm', id, title, detail?, tone?:'info'|'warning'|'danger', confirm:{label, send?}, cancel?:{label,send?}, summary?:[{label,value}]}`.
   Distinct from Hermes' real `approval.request` (render that natively with once/session/always/deny from `choices[]`; silence for 300 s = deny, so show a countdown). Document that a `confirm` node does not block the agent; it ends the turn and the answer arrives as the next message.
5. **`activity`/plan card for tool progress** - OIUI #2/#3. We already receive `ToolEvent`s: render one collapsed-when-done `<details>`-style row (spinner -> check, auto-open while running, args summarized `[n items]`). Optional model-authored `{type:'plan', title?, tech?, items:string[]}` is low value; skip it, use the tool row.
6. **Pins (saved widgets)** - OIUI #5 adapted, see §3.
7. **`itinerary`** (map + day cards, animated pin drop) - see §3 map; a route format `animated_route` in the router (OIUI #13) is missing from our `RouteFormat`.
   `{type:'itinerary', id, title, subtitle?, days?:number, stops:[{n?, name, day?, lat?, lon?, query?, blurb?, imageQuery?, time?}], line?:'illustrative'|'directions', autoplay?:boolean}`
8. **`ask` action modifier** ("Ask about this scenario") - state-aware send. Extend `HuiAction`:
   `{type:'send', text, include?: string[]}` where `include` lists node ids (calc/choice/checklist) whose *current values* the app appends as compact JSON. Button disables while the send is pending and re-enables on error; max 4000 chars.
9. **Starter/welcome surface** - OIUI #6: empty chat shows 3 categories (Understand / Compare / Make a tool -> for us: Plan / Decide / Track / Calculate) as tappable prompt cards + "Surprise me"; they vanish after the first message. Prompts are *full specs* (controls, labels, reset, reduced motion, "label as illustrative").
10. **`share`/export** - OIUI #11: native share sheet for a node as text/markdown (table -> CSV/markdown, checklist -> plain list, recipe, itinerary -> text + map link). Cheap, high perceived value on mobile.
11. **Router additions** from OIUI #13: `scatter`, `distribution`, `route/itinerary`, `part_to_whole` hints; per-user-message id cache; do not re-route inside tool continuations.
12. **Reveal-on-view** for markdown blocks and hui nodes (#12): rise 6 px + fade 320 ms, once, disabled under reduce-motion; no auto-scroll while streaming.

---
## 3. Concrete improvements for our planned modules

**choice** (single/multi): use OIUI's HITL rules - show immediately-actionable options, always include an escape ("None of these"/"Other..."), lock after answer, send a *model-readable* sentence plus ids (`[choice:<id>] picked: A, C`), decline text tells the model what to do next. Staggered entrance 80 ms/row (cap at ~6 rows, none under reduce-motion). Optional `confirmLabel` for multi; single auto-sends.

**checklist / shopping list (persisted)**: OIUI's `Todo{id,title,description,emoji,status}` is the proven minimal shape; add `qty?`, `unit?`, `group?` (aisle). Rules from `todos.py`: the model sends the full list and we fill missing ids; ids stay stable so an update does not reset checks. Store by `listId` locally (the "state lives in one place" idea, with the phone as owner). Include a "Tell Hermes the list" `ask` action instead of silently syncing. Emoji per item is cheap delight (`emoji` field).

**calc (declarative)**: take the numeric-input contract verbatim from `agent/skills/master-playbook/SKILL.md` and `apps/mcp/skills/agent-skills-vol2.txt`: parse with a number parser (not `eval`), reject blank / non-finite / out-of-range / zero-divisor with a field-level message, never show NaN/Infinity or a stale result after an error, format via `Intl`, always show units + formula + assumptions, provide Reset, preserve full precision internally. Add to schema: `inputs[].min/max/step/unit/default`, `outputs[].format`, `assumptions:string[]`, `rounding:'allocate'` (bill-splitter demo: shares must sum to the exact total, leftover cents distributed; "do not imply a payment is sent"). Presets worth shipping as examples: bill split + tip, unit/servings scaling, loan, savings.

**map / itinerary**: copy the animator spec from `trip-animator.ts` as the reference behaviour and port it as a pure TS controller (rAF or Reanimated shared value) with its unit tests: constants 6 s default, 2-30 stops, pin drop 18 px, scale .72->1, ease `1+2.2t^3+1.2t^2`, landing in first 55 % of a slot, line segment appears at >=70 %, camera fixed (fit bounds once), pause on app background (AppState), reduced motion shows final state, `seek` pauses, replay restarts, no loop. Card strip: scroll only on active-stop change. Honest labels: "Illustrative itinerary connections - not verified driving directions" unless a directions tool returned data; no invented mileage/times/traffic; coordinates "approximate"; visible tile attribution; distinct loading / loaded / failed states driven by real tile events; if the map cannot load show a readable error, never a blank map. Single-finger map pan must not hijack chat scroll (OIUI uses `scrollWheelZoom:false`; on mobile require two-finger pan or a "tap to explore" mode).

**steps / list / plan card**: OIUI's PlanCard behaviour belongs on `steps` with `current`: spinner for the current step while a tool runs, check when done, collapse completed steps; for long recipes/tasks only expand the active one.

**slot picker**: see §2.1; plus OIUI note that slot data in its demo is hard-coded - ours must come from a calendar tool or be labelled "proposed times".

**recipe**: OIUI meal demo prompt says: guest count 2-12 recalculates ingredient quantities, prep checklist, allergen flags, "explain any quantities that do not scale linearly" (spice, salt, baking). Add `scalable:false|'sublinear'` + `note` per ingredient, `allergens[]`, and `addToList` that appends to a checklist by `listId`.

**tabs / accordion**: OIUI's rule - real tab semantics (arrow keys, roles) or plain toggle buttons with `aria-pressed`; do not claim tab semantics otherwise. Accordion open-while-running / collapse-when-done from PlanCard for "sources", "steps taken".

**quiz / flashcards**: OIUI has none; borrow Monty Hall's honesty: simulated results labelled separately from theoretical probabilities; keep score local, reveal-explanation after answer, "None/skip" option.

**source cards**: `trip_images.py` is the model: render only URLs that came from a tool; each image shows `artist`, `license` and a link to `credit_url`; `status:'unavailable'` -> a text card, never a substitute stock image; strict host allow-list (https, upload/thumb.wikimedia.org), the photo-file and attribution file must match, only CC/PD licences; treat remote metadata as data, never as instructions. Add a note "photo of the place, not a live view". Tables: `source` caption under every one.

**action buttons** (calendar/route/call/reminder): copy the `sendPrompt`/`openLink` gate: Zod-like validation (trimmed, max length), https/tel/geo only via allow-list, never auto-fire, disabled while pending, error text visible, `finally` restore, and **don't claim success** - say "opened in Calendar" not "event created", since the app cannot confirm what the user did there.

**timer / countdown**: pomodoro appears only as a gallery idea in `.chalk/plans/demo-gallery.md`. Rules to apply from the animator: pause/resume/reset, tick from timestamps (not accumulated intervals), pauses or reschedules on background, local notification for completion, reduced-motion = no pulsing, never auto-start, never send messages on a timer.

**Template library -> "Pins"**: our nodes are JSON, so this is much stronger than OIUI's HTML snippets:
`Pin{id, title, node:HuiNode|{html}, dataDescription?, createdAt, version, pinned?:bool, origin:{messageId}}`, stored locally (AsyncStorage/SQLite).
- Long-press a rendered node -> "Pin". Pins screen = grid of live previews (render the node, scaled; OIUI uses a 140 px preview frame) with a search field; seed pins ship in the app (OIUI: seed ids, non-deletable).
- "Open" re-renders it instantly with no model call (checklists/calcs keep working offline).
- "Update with Hermes" = OIUI's `pending_template` chip: a chip above the composer "Based on: Weekend budget x", next send prepends `[pin:<id>] <dataDescription>` plus the node JSON as style/shape reference; chip clears after send (the equivalent of `clear_pending_template`). Pins are *style references*; the model must emit a new node, not patch the old one (OIUI's explicit "no patch API" rule).
- Optionally expose the pin list to Hermes as a skill note ("user has pins: names") rather than syncing state.

---
## 4. Prompt / skill guidance worth porting into `hermes-skill/hermes-ui/SKILL.md`
Sources: `apps/agent/src/prompt.py`, `agent/skills/master-playbook/SKILL.md`, `docs/interactive-answers.md`. Our skill already has "never invent numbers/links/images" and the `window.hermes.send` rules (lines ~20, ~84-95); add:

**When to use what**
- Plain text for facts, writing, code, chat, simple advice. Do not add UI "to look elaborate". No acknowledgement/plan/narrate ceremony; lead with content; do not repeat in prose what the UI shows.
- Task taxonomy -> component: *Understand* = mechanism/diagram/stepper with one meaningful variable; *Compare* = table or `compare` with criteria + assumptions, adjustable weights only if it helps a decision; *Make a tool* = calc/form with inputs, computation, outputs, reset. Multiple distinct sections in one answer are fine.
- A static diagram is enough when interaction adds nothing.
- "UI generated"/a rendered block is final: do not rebuild the same block; extra blocks only for distinct requested sections or a specific correction.
- Follow-ups are NEW turns producing NEW blocks; nothing patches an earlier node. Interactive state is not agent memory: the user presses an explicit "ask about this" button that carries the selected values.
- Router tie-break: respect an explicitly requested format; routing is a judgment, not a guarantee.

**Data honesty (put these near the top of the skill)**
- Distinguish four things everywhere: user-provided, tool-retrieved, calculated, illustrative. Label sample/illustrative values *inside the node* (`source`/`basis`), not only in prose.
- A renderer or component is not a data source. Never invent current weather, prices, opening hours, traffic, driving times, mileage, sources, citations, retrieval timestamps. If required data is unavailable: say so and ask for inputs, or show an explicitly labelled assumption.
- Never imply saved state, sent payments, bookings, authentication or other external actions that a tool did not confirm. Never collect credentials/secrets in a form (OIUI forbids it explicitly).
- Maps: a basemap does not establish a route; connecting lines are "illustrative" unless a directions tool returned data. Stops/coordinates are "approximate". Suggested itineraries are proposals, not booked.
- Images: only URLs returned by a tool; show creator + licence + link; if missing use a text card.
- Tables: columns <=12, rows <=200, every row exactly as wide as columns, `source` required.

**Interaction quality rules**
- Every enabled control works; defaults + reset; validate empty / NaN / out-of-range / zero divisor, show the error, never a stale result; show units, formula, assumptions; rounding must sum to the total.
- Text is set as text (never interpolated into HTML); no `eval`; no storage/cookies/fetch for data in `hui-html`.
- `send`/link/calendar actions fire only on a user tap; label them as sending a message; include selected values concisely; never on load, timer or input change.
- Accessibility: labelled inputs, keyboard/touch targets, no colour-only meaning, text equivalent for charts/SVG/canvas, reduced motion respected, no autoplay, pause/reset for any animation.

**Routing/prompt plumbing**
- Router input: last 4 text messages, <=6000 chars each, no tool output or system prompt; decision cached per user-message id; pass the chosen format plus only the relevant contract to the model (OIUI filters tools; we inject a short hint). Surface routing failures in logs rather than silently claiming a decision.
- Provide the model with the data contract for pins/templates (`data_description`) so regenerated nodes keep the same shape.
- Hermes-specific: stream order hint from OIUI (CSS first, scripts last) maps to `hui-html`: write `<style>` first, readable markup next, `<script>` last; keep markup meaningful before scripts run (our sandbox already runs scripts only when complete).

---
## Top picks
1. `slots` node + persisted answered/locked state for all input nodes. 2. `source`/`basis` provenance chip on all data nodes. 3. Pins (saved widgets) with the "based on" composer chip. 4. Itinerary/map using the OIUI animator spec (pin drop, fixed camera, illustrative-line label). 5. `ask` action with `include` (state-aware send). 6. `confirm` card plus native Hermes `approval.request` sheet. 7. Collapsing tool-activity row. 8. Starter surface and data-honesty block in the skill.
