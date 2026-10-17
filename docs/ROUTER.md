# UI Bridge + Router (`bridge/`)

Status 2026-10-10: implemented and tested locally (52 node:test tests incl. uploads), heuristic + Claude + Jev
evaluated. **Not deployed.** Deployment steps below need the user's OK.

The design follows the decision-model idea from OpenIntelligentUI (MIT,
`refs/OpenIntelligentUI/apps/agent/src/visualization_router.py`, `docs/visualization-routing.md`):
one typed presentation decision per user message, made by a separate fast model *before* the
answer model runs. Our version is provider-pluggable (Claude, Jev/TypeSafe, any OpenAI-compatible
endpoint, deterministic heuristic) and never fails the turn: if routing fails, the answer still
streams (heuristic or neutral fallback).

## Architecture

```
app ──HTTPS (tailscale serve)──► bridge 127.0.0.1:8790 ──HTTP──► Hermes <hermes-host>:8642
        Authorization: Bearer BRIDGE_TOKEN                Authorization: Bearer HERMES_API_KEY
```

Per `POST /v1/chat/completions`:
1. Auth: constant-time compare of the app's `BRIDGE_TOKEN` (the Hermes key never leaves the server).
2. Routing context: last ≤4 user/assistant turns, each truncated to 2000 chars (head 70 % + tail 30 %).
   The app continues sessions with `X-Hermes-Session-Id` and sends only the new message, so the bridge
   keeps a small in-memory context per session id (last 4 turns, LRU 500 sessions, TTL 24 h) filled
   from the streamed answer (side-channel SSE parser; the byte stream itself is not modified).
3. Router (`src/router/router.mjs`): **reformat override** first (`src/router/reformat.mjs`, SPEC-modules-v4
   A1: a latest user message starting with `[reformat:<kind>]` forces the format, confidence 0.95, reason
   `reformat`, no cache/model call: table → `table`; list → `checklist`/todo only if the previous answer was
   a to-do list, else `text`; shorter/longer/simpler/expert → `text`; translate:<lang> → `translation` if the
   previous answer is ≤ 300 plain chars, else `text`; the heuristic returns the same decision) →
   cache (sha256 of prompt version + backend + context) →
   heuristic **fast path** (heuristic confidence ≥ 0.85 → no model call) → primary backend or
   fallback chain within one time budget (default 2000 ms) → heuristic fallback on timeout/error.
   If the model returns no component and the heuristic agrees on the format, its component is used.
4. System messages (see Hermes findings): the constant skill **bootstrap** message
   (`hermes-skill/bootstrap-system-message.txt`, marker `[hermes-ui-app]`) is prepended first unless
   the client already sent the marker; right after it the constant **skill core** (`hermes-ui/SKILL.md`
   without front matter, `src/skillInline.mjs`, docs/BRIDGE.md "Skill core inline"); the **hint** goes after all
   leading system messages:
   `UI-ROUTER-HINT: format=<f> [component=<c>] confidence=<0.6|0.9>`.
   No hint for low confidence (< 0.5; text < 0.75) and none for header-less multi-turn clients.
5. Upstream request (Node `http`, keep-alive, `accept-encoding: identity`). When Hermes answers
   with the SSE head, the bridge writes the head (upstream status + headers, plus
   `X-Hermes-UI-Route` and `X-Hermes-UI-Bridge: 1`), then **`event: hermes.ui.route`** as the first
   frame, then pipes Hermes' bytes verbatim (named events `hermes.tool.progress`, `hermes.status`,
   `approval.request`, `: keepalive` comments, `[DONE]`).
   The route event is sent as soon as Hermes' headers arrive (Hermes prepares the SSE response before
   the agent starts, so this is still well before the first token). Waiting for the upstream head is
   deliberate: it keeps `X-Hermes-Session-Id`/`X-Hermes-Session-Key` and upstream error statuses
   (401/403/429/5xx) intact.
6. Client disconnect while routing aborts the router call (nothing goes upstream). Once the request is
   upstream, a client disconnect (network switch, app in the background) does NOT stop the Hermes run:
   the bridge logs one line (`http … status: client_closed, ms`, no content), drains the rest of the
   stream and marks the turn detached, so the push watcher delivers the answer via live inbox / push and
   the app completes the interrupted message (app/src/hermes/recovery.ts). A deliberate stop is
   `POST /bridge/chat/stop {"sessionId": "<X-Hermes-Session-Id>", "profile": "<bot>"|null}` → `{stopped: n}`; it
   closes the upstream connection(s) of that session in that profile (none / `default` = the unprefixed one; session
   ids are only unique per profile), which makes Hermes interrupt the agent
   (`_write_sse_chat_completion`).

Other endpoints: `GET /health` and `/v1/health` (no auth, proxied), `GET`/`HEAD /bridge/live` (no auth, answers "ok"
while the bridge process runs; no Hermes call, no state: the Docker healthcheck), `GET /bridge/status` (auth;
router kind/model, cache size, sessions). Under `/v1` only an explicit allow-list is a streaming pass-through (auth):
`GET /v1/models`, `GET /v1/capabilities`, `GET /v1/skills`, `GET /v1/runs/{id}` and `POST /v1/runs/{id}/approval`
(needed to answer `approval.request` events); any other `/v1` path → 404 (e.g. `POST /v1/runs`, `/v1/responses`,
`/v1/toolsets`), wrong method → 405 + `Allow`. `/health/detailed` is not forwarded. WebSocket upgrades are rejected (501).
Upstream URLs append the request path to the path of `HERMES_BASE_URL` (sub-path deployments keep their prefix).
**Turn budget:** a chat turn holds its slot until the upstream request ends (also while detached after a client
disconnect): `BRIDGE_MAX_CONCURRENT_TURNS` (8) per credential, `BRIDGE_MAX_TURNS_TOTAL` (16) overall → 429 + `retry-after`.
**Path check (security review M1, 2026-10-11):** before any routing the raw request path is decoded once and refused
with 400 `invalid_path` if it contains a dot segment (`/./`, `/../`), an empty segment (`//`), a backslash, a control
character or an encoded dot/slash/backslash/NUL/percent (`%2e %2f %5c %00 %25`). The bridge routes on exactly the path
it forwards, so `/v1/../api/jobs` or `/v1/%2e%2e/api/jobs` can no longer reach Hermes' `/api/*` past the allow-list.
`/api/*` paths with any `%`-escape are refused (session ids are plain `[A-Za-z0-9._:-]`).
Non-streaming chat requests are routed too (header only) unless `BRIDGE_ROUTE_NONSTREAM=0`.
Client opt-out per request: header `X-Hermes-UI-Route: off` (bootstrap still added, no routing).
`Origin`, `Referer`, `Cookie` are not forwarded (Hermes' CORS check would reject browser origins);
the bridge answers CORS itself if `BRIDGE_CORS_ORIGINS` is set (only needed for `expo start --web`).

### Wire additions (for the app)
- `event: hermes.ui.route` / `data: RouteDecision` – exactly the SPEC fields
  `{format, component?, confidence, reason, model, ms}`; ASCII-escaped JSON like Hermes' frames.
  `model` is e.g. `heuristic-v1`, `jev-latest`, `claude-haiku-5-5/low/disabled`; `reason` starts with
  `fast path:` or `fallback (timeout|error):` when applicable.
- Response header `X-Hermes-UI-Route: <same JSON>` (also on non-streaming responses) and
  `X-Hermes-UI-Bridge: 1` on every response (lets the app detect the bridge via `/health`).
- Note for local dev: start `mock-server` **without** `--route` behind the bridge, otherwise the
  stream contains two route events (the app should use the first one anyway).

## Hermes findings (read-only, `/opt/hermes` on hermes-host, v0.21.4)

`gateway/platforms/api_server_openai_routes.py::_handle_chat_completions`:
- All `role: system` messages of the request are concatenated (`"\n"`) into `system_prompt` and
  passed as `ephemeral_system_prompt`; `user`/`assistant` messages become history + the new message.
- A new `AIAgent` is created per request (`api_server.py::_create_agent`), so the ephemeral prompt
  applies to exactly this turn (including all its tool iterations) and nothing else.
- **Not persisted**: `agent/system_prompt.py` – "ephemeral_system_prompt is injected at API-call time
  only, never cached"; `agent/turn_context.py` appends it to the cached system prompt when building the
  wire messages; the session DB only stores `_cached_system_prompt` (`hermes_state_sessions.py::update_system_prompt`).
  The persisted history therefore never contains the hint or the bootstrap; it does not bloat.
- By contrast, context injected into the *user* message is persisted (the `api_content` sidecar in
  `turn_context.py` stores "what you send" for byte-stable replay) – so user-side injection is not an option.
- With `X-Hermes-Session-Id`, history comes from `state.db` and the response echoes the same id.
- **Session-id caveat:** without `X-Hermes-Session-Id`, Hermes derives the session id from
  `sha256(system_prompt + first user message)` (`api_server.py::_derive_chat_session_id`). A per-turn
  hint would therefore fork header-less multi-turn conversations. The bridge only injects the hint when
  the request has a session header or is a fresh conversation (no assistant messages); the first turn's
  derived id (which includes the hint) is returned in `X-Hermes-Session-Id` and the app continues with it.
  Override with `BRIDGE_HINT=on|off`.
- **Prompt-cache cost:** the ephemeral prompt is appended at the *end* of the system prompt, i.e. before
  the whole conversation. Any change in its bytes between turns invalidates the provider prompt cache
  for the history on that turn. Therefore the hint text is deterministic per (format, component,
  confidence bucket), contains no reason by default, and the bootstrap and the inline skill core are
  byte-identical on every request.
  Remaining cost: a cache miss on turns where the hint changes (e.g. text → chart). Text turns below
  0.75 confidence get no hint.
- SSE: Hermes writes `: keepalive\n\n` every 0.5 s idle check (10 s cadence), frames via `_sse_frame`
  (`ensure_ascii`), headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
  `X-Accel-Buffering: no`, `X-Hermes-Session-Id`, `X-Hermes-Session-Key`. On client disconnect it
  calls `_abandon_agent_task` (interrupts the agent).
- Approval answers go to `POST /v1/runs/{completion_id}/approval` → proxied by the bridge.

### Hint format vs. skill (proposed alignment)
`hermes-skill/hermes-ui/SKILL.md` documents `UI-ROUTER-HINT: format=<f> [component=<c>] confidence=<0-1> - <reason>`.
The bridge emits the same line **without** `- <reason>` by default and with confidence bucketed to
`0.6` / `0.9` (cache stability, see above). Proposed SKILL.md change: mark the reason as optional
(`[- <reason>]`). `BRIDGE_HINT_REASON=1` restores the reason. For confident text decisions
(≥ 0.75) the bridge sends `format=text`, which the skill already handles ("text = Markdown only").

## Router

**Taxonomy v4 (prompt version `r4`, skill-router-v4, SPEC-modules-v4).** Seven new formats on top of v3; `timer` (existing) is now routed for more cues:

| format | renderer | component hints | routed when |
|---|---|---|---|
| **places** | `hui` places | – | local businesses via tools: restaurants/cafés/shops/pharmacies "in der Nähe", `Öffnungszeiten`, `cerca de mí`, "find a coffee shop near …" (sights/itineraries stay `map`; one fact about one place stays `text`) |
| **products** | `hui` products | `compare` (r7) | buying advice: `kaufen`, `Kaufberatung`, `Preisvergleich`, "bestes … unter 200 €", "which robot vacuum should I buy", `mejores auriculares por menos de 100 €`. Named buyable products compared ("iPhone 17 vs Pixel 11", "Sony XM6 vs Bose QC", a list of handheld models) get `component=compare` = a `products` node with `compare:true` (photos, prices, specs table): the heuristic's `looksLikeProductComparison()` (product lines, maker + model token, or a category with a shopping cue) also upgrades a backend's `compare`. Concepts, plans, services and places ("Kubernetes vs Nomad", "Miete vs Kauf") stay `compare` |
| **guide** | `hui` guide | – | hands-on procedures: `Schritt für Schritt`, `Anleitung`, `wie wechsle ich …`, `paso a paso` (software install / admin steps stay `steps`) |
| **workout** | `hui` workout | – | `Trainingsplan`, `Workout`, `HIIT`, `rutina de ejercicios` (fitness theory stays `text`) |
| **studyplan** | `hui` studyplan | – | `Lernplan`, `in 4 Wochen … lernen`, `study plan`, `plan de estudio` |
| **vocab** | `hui` vocab | – | `Vokabeln`, `vocabulary`, `vocabulario` (replaces quiz/flashcards for language drills; other flashcards stay `quiz`) |
| **mindmap** | `hui` mindmap | – | `Mindmap`, `mind map`, `mapa mental`, `Übersicht der Zusammenhänge` (was `diagram`+`mindmap`; `normalizeDecision` rewrites that old pair to `mindmap`) |
| timer (extended) | `hui` timer | – | also stopwatch/`Stoppuhr`, `temporizador`, `Countdown bis …`, and reminders after a DURATION (`Erinnere mich in 10 Minuten`, `remind me in 10 minutes`); reminders at a clock time/date and alarms stay `text` |

Heuristic v4 (still model name `heuristic-v1`): the new explicit rules sit before `quiz`/`steps`/`compare` and after the explicit `map` rule ("Cafés in Ulm auf einer Karte" is still `map`); they are skipped when the
user asks to be questioned first (`stell mir vorher Fragen` → `form`) and `places`/`products` are skipped for writing tasks ("Schreib eine Bewertung für das Café"). Suffix boundaries use a letter-aware lookahead (`\b>`),
because JS `\b` treats `é`/`ü` as non-word characters. Widget replies `[guide|workout|studyplan|vocab|products:id] …` and `[mindmap] Erkläre „…“ genauer` are text (confidence 0.3, no hint).
The model prompt (`r4`) lists the formats with definitions, decision rule 11 ("module formats"), a changed timer rule (duration reminders = timer) and counterexamples. Decision cache keys contain the prompt version, so `r4` does not reuse `r3` entries.
Skill/bridge pairing: ship the v4 skill (per-topic references `products.md`, `places.md`, …, SKILL.md >= 0.4.0) together with this router; an older skill would receive `format=places` etc. that it does not know.

**Taxonomy v5 (prompt version `r5`).** One new native format:

| format | renderer | component hints | routed when |
|---|---|---|---|
| **paths** | `hui` paths | – | 2-6 ways / variants / architectures, each a chain `A → B → C` with a verdict: "wo sollen die Dateien liegen: Mac, VM-Disk oder geteilter Ordner", "where should my files live … or …", `dónde deberían estar los archivos … o …`, `Backup-Wege`, three-way "Docker vs VM vs bare metal" (two-way "Docker oder VM" and "Vergleiche …" stay `compare`) |

The heuristic rule sits right before `compare` and only fires on these clear cues; everything else reaches `paths` through the
LLM router (definition + one counterexample). Widget reply `[paths:id] <title>` is text (confidence 0.3, no hint). The `r5`
prompt is ~20.3k chars (router.test.mjs budget 21k).

**Prompt `r6` (still taxonomy v5).** One more native format:

| format | renderer | component hints | routed when |
|---|---|---|---|
| **blocks** | `hui` blocks | – | architecture / setup at a glance, boxes without arrows: `Blockdiagramm` / `block diagram` / `diagrama de bloques`, "Aufbau / Architektur / setup … auf einen Blick / at a glance", "aus welchen Bausteinen / Komponenten besteht …", "unterscheiden sich … im Aufbau", "differ in architecture", `de qué componentes se compone` ("Vergleiche den Aufbau …" stays `compare`, "Zeichne ein Architekturdiagramm" and "wie funktioniert die Architektur" stay `diagram`) |

Two heuristic rules: the explicit block-diagram rule sits before the `diagram`/`chart` "…diagramm" rules, the "at a glance /
im Aufbau" rule right before `compare` (and before `stats`' "auf einen Blick"). The `diagram` definition now points at
`blocks` for parts at a glance; `blocks` is display-only, so there is no widget reply. A follow-up after a blocks answer
keeps the format. The `r6` prompt is ~21.0k chars (router.test.mjs budget 21.5k); eval cases bl01-bl08.

**Prompt `r7` (still taxonomy v5).** Three coding views (display-only `hui` nodes, no component hints; skill reference `coding.md`):

| format | renderer | routed when |
|---|---|---|
| **diff** | `hui` diff / ```` ```diff ```` fence | show a code change: "Zeig mir den Diff", "show me the patch", `git diff`, "what would change in this file", before/after of code or config, `muestra el diff` |
| **terminal** | `hui` terminal / ```` ```terminal ```` fence | run a command / the tests / a build and show the output: "Führ die Tests aus", "Zeig mir die Ausgabe von npm test", "run the tests", `ejecuta git status` |
| **changes** | `hui` changes | files changed after an agent task: "Welche Dateien hast du geändert?", "which files did you touch", `git status`, "¿qué archivos cambiaste?" |

The heuristic checks these three before the generic coding guard (which otherwise sends every `git`/code message to `text`), with
"how do I run …", "was macht …", "wie funktioniert …" and "schreib/write …" questions staying `text`. `text` is now "code and
programming help without running commands or showing changes". No new hint syntax: the skill's `UI-ROUTER-HINT` only knows
`data=live` ("search first"), which does not fit "content must come from a tool run", so these formats get the plain
`format=<f> confidence=<c>` line; the skill reference already says real output only. The `r7` prompt is ~22.7k chars
(router.test.mjs budget 23k); eval cases cd01-cd16.

**Multilingual heuristic (2026-10-16, no prompt change).** The heuristic now covers English and Spanish where they missed
and French / Italian / Portuguese for the high-value classes only: shopping / packing / to-do lists (`liste de courses`,
`lista della spesa`, `lista de compras`, `lista de la compra`), products and product comparisons (`meilleurs écouteurs à
moins de 100 €`, `Confronta iPhone 17 e Pixel 11`, `qual fone vale a pena até 300 reais`), places (`boulangerie près
d'ici`, `pizzeria qui vicino`, `padaria aqui perto`, "where can I eat …" in all six languages), weather (`quel temps fera-t-il`,
`che tempo fa`, `vai chover`) and timers (`minuteur`, `Rappelle-moi dans 15 minutes`, `ricordami tra mezz'ora`). The word
lists are per language (`PLACE_NOUN_ML`, `NEAR_ML`, `PRODUCT_NOUN_ML`, `PRICE_PREP`, `MONEY` in `heuristic.mjs`). Two named
products joined by "or" (en/es/fr/it/pt; a question or a short message, not a how-to) are `products:compare`; German `oder`
is left to the compare rules. Guards: phone numbers are not device lookups, "près de / perto de / pas loin de" alone are
not "near" (they also mean "nearly"), Italian `libreria` is not a shop, writing requests in fr/it/pt stay text, weather
explanations (`¿por qué…?`, `pourquoi`, `perché`) stay text. Not covered on purpose: fr/it/pt recipes and coding views,
Dutch, Polish, Turkish (heuristic-first sends those to the model). Tests: `test/router-multilingual.test.mjs` (positives
and negatives per language, and no unwanted visual on any eval set).

**Taxonomy v3 (prompt version `r3`, skill-router-v3).** Seven new formats and seven chart components on top of v2:

| format | renderer | component hints |
|---|---|---|
| **translation** | `hui` translation | – (short phrase / "how do you say X in <language>"; long documents stay text) |
| **poll** | `hui` poll | – (several people vote: family, team) |
| **agenda** | `hui` agenda | – (day/week with clock times; history stays `timeline`) |
| **weather** | `hui` weather | – (the agent must fetch real data; climate facts stay text) |
| **decision** | `hui` decision | – (weighted multi-criteria matrix; plain options → compare/choice) |
| **rank** | `hui` rank | – (user orders items by own preference) |
| **scale** | `hui` scale | – (ONE rating question) |
| chart (extended) | `hui` chart | line, bar, area, pie, donut + **hbar, stacked, scatter, radar, gauge, heatmap, waterfall** |

`scatter` moved from `interactive:scatter` to `chart:scatter` (the native chart has the kind now); `normalizeDecision`
rewrites a model's `interactive`+`scatter` to `chart`+`scatter`. Heuristic v3 (still model name `heuristic-v1`): German/English/Spanish
triggers for translation (`übersetze … ins Spanische`, `was heißt/wie lautet X auf …`, `how do you say X in …`, `¿cómo se dice X en …`;
not for >220 chars / multi-paragraph text), poll (`Abstimmung`, `Familienumfrage`, `wir können uns nicht einigen`, `hagamos una votación`),
agenda (`Tagesplan`, `plane meinen Samstag`, `Zeitplan für …`, `planifica mi día`), weather (`Wetter`, `Regenschirm`, `¿qué tiempo hará…`; not "warum/wie entsteht"),
decision (`Entscheidungsmatrix`, `nach Kriterien … gewichtet`, `matriz de decisión`), rank (`sortiere … nach Wichtigkeit`, `priorisiere meine …`),
scale (only "ask me …" phrasings, so "rate my poem 1-10" stays text), chart kinds (`Netzdiagramm`, `Tacho`, `Heatmap`, `Wasserfall`, `gestapelt`, `horizontale Balken`, `Ranking-Balken`)
plus implicit cues (`wohin geht mein Geld` → waterfall, `wie weit bin ich bei meinem Ziel` → gauge). Widget replies `[poll|agenda|decision|rank|scale:id] …` are text (confidence 0.3).
Bridge deploy note: the decision cache key contains the prompt version, so `r3` does not reuse `r2` entries.

Taxonomy v2 (`src/router/taxonomy.mjs`, prompt version `r2`), matching `RouteFormat` in `app/src/protocol/types.ts`
(the app type must list the six new formats, see "App-side RouteFormat" below):

| format | renderer | component hints |
|---|---|---|
| text | Markdown | – |
| table, stats, compare, steps, timeline, form | `hui` | – |
| chart | `hui` | line, bar, area, pie, donut |
| image | `hui` image | generate, photo |
| **choice** (new) | `hui` choice / slots / confirm | slots, confirm, multiple |
| **checklist** (new) | `hui` checklist | shopping, packing, todo |
| **recipe** (new) | `hui` recipe | – |
| **quiz** (new) | `hui` quiz / flashcards | quiz, flashcards |
| **calc** (new) | `hui` calc | free slug (loan, savings, bmi, tip, vat, …) |
| **timer** (new) | `hui` timer | – |
| map | `hui` map (was `hui-html`) | markers, route |
| diagram | `hui-html` | flowchart, sequence, architecture, tree, cycle, state, org (mind maps are the native `mindmap` format since v4; parts of a setup at a glance without arrows are the native `blocks` format since `r6`) |
| calculator | `hui-html` | **only clearly custom/visual tools** (animated or drawn result); ordinary calculators are `calc` |
| interactive | `hui-html` | simulation, game, scatter, explorer, 3d (quiz moved to `quiz`) |

Scatter/correlation plots go to `interactive` (component `scatter`) because the native chart has no
scatter kind. The prompt (`src/router/prompt.mjs`) contains definitions, ordered decision rules
(explicit request wins; follow-ups re-present the previous content; German "Diagramm" alone = data
chart; native beats custom: calc over calculator, quiz over interactive, map for places and trip plans;
a decision among 2-6 options = choice, 3+ inputs = form, user-named options = compare; lists =
checklist, cooking = recipe, non-cooking how-to = steps, countdown = timer, reminders/alarms = text;
`[choice:x] …`-style widget replies = text; simplest fitting format; text when unsure), an explicit
"when NOT to use a visual" list (short facts incl. one-off arithmetic and food facts, chit-chat,
personal/emotional, coding, writing, agent actions, opinions, missing data), counterexample pairs for
every new format, and a prompt-injection guard. Output: strict JSON `{format, component, confidence,
reason}` (JSON schema, enum-constrained format).

Heuristic v2 additions (`backends/heuristic.mjs`; model name still `heuristic-v1` for log compatibility):
explicit rules for checklist (Einkaufsliste, Packliste, To-do-Liste, Checkliste, "was muss ich einpacken"),
recipe (Rezept, "wie backe/koche ich"), quiz (Quiz, Karteikarten, Vokabeln üben, "teste mich", "frag mich zu … ab"),
timer (Timer, Countdown, Eieruhr; "Wecker"/"Erinnere mich" stay text), choice ("hilf mir zu entscheiden",
"ich kann mich nicht entscheiden", "schlag mir zwei Termine vor" → component `slots`), map for trip plans
("Plane einen Tag in Prag", "3-Tages-Route durch Wien"), `calc` for Rechner/Umrechner and implicit cues
(Kredit, Trinkgeld, Rechnung teilen, MwSt, Rabatt, BMI), `calculator` only with animation/3D/graphics wording.
Widget replies (`[choice:id] …`, `[checklist:id] …`, `[calc:id] …`, `[quiz:id] …`, `[slot:id] …`, `[confirm:id] …`,
`[form:id] …`, `[pin:id] …`) are text with confidence 0.3 (no hint). A follow-up keeps a previous
checklist/recipe/calc/map node.

Backends (`src/router/backends/`):
- `anthropic.mjs` – official `@anthropic-ai/sdk` (lazy import; the only npm dependency).
  `claude-haiku-5-5`, `output_config: {effort, format: {type: 'json_schema', schema}}`,
  `thinking: {type: adaptive|disabled|between_tools}`, system prompt with `cache_control`, no
  sampling params (Haiku 5.5 rejects them), `maxRetries: 0`. Refusal / max_tokens → error → fallback.
- `systemone.mjs` – shared System One client used by `jev.mjs` and `nace.mjs` (provider preset: base URL, key env,
  default model; optional own timeout on top of the router budget; HTTP errors report the status only; Drex
  `usage.input_tokens` is passed through for the eval's cost estimate). Since 2026-10-16 its choice set covers the
  full taxonomy (v4/v5 added: `places`, `products`, `products_compare`, `guide`, `workout`, `studyplan`, `vocab`,
  `mindmap`, `paths`, `blocks`, `diff`, `terminal`, `changes`); a test keeps every RouteFormat reachable.
- `nace.mjs` – Nace.AI Drex, same API: `POST https://console.nace.ai/v1/systemone`, `Authorization: Bearer
  $NACE_API_KEY`, model `drex-v2.0` pinned (`drex-latest` would move on announced dates). Hosted models (2026-10-16):
  drex-v1.0 (32k state), drex-v1.5, drex-v2.0 (131k state; MoE 3B active). Billing: input tokens only, $0.04 / 0.05 /
  0.06 per 1M; one routing call is ~3.1k input tokens (criteria + instructions dominate). Free tier 120 RPM / 8 in
  flight, paid 600 / 16; 429 and 529 (capacity) carry `retry-after-ms`; the bridge does not retry inside its budget,
  the chain moves on. Eval results: section "Nace Drex eval (2026-10-16)" below.
- `jev.mjs` – TypeSafe System One `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`, one
  `choice` question whose options are flattened `format[_component]` ids (`chart_line`, `route_map`, …),
  `state: {conversation: [...]}`. Shape verified against docs.typesafe.ai/api.md and exercised live (eval).
  Jev has no fixed label set: the `criteria` map we send (id → description) *is* the label set, so the
  ids map 1:1 onto our taxonomy (no lossy translation). v2 mapping:

  | Jev choice id | format : component |
  |---|---|
  | `text`, `table`, `stats`, `compare`, `steps`, `timeline`, `form`, `image`, `interactive` | same name |
  | `chart_line/bar/pie/area` | chart : line/bar/pie/area |
  | `flowchart`, `structure_diagram` | diagram : flowchart / architecture |
  | `map`, `route_map` | map : markers / route (route_map also covers "plan a day in <city>") |
  | `calc` (new; replaces `calculator`) | calc |
  | `custom_calculator` (new) | calculator (clearly animated/drawn tools only) |
  | `choice`, `choice_slots` (new) | choice / choice : slots |
  | `checklist_shopping`, `checklist_packing`, `checklist_todo` (new) | checklist : shopping / packing / todo |
  | `recipe` (new) | recipe |
  | `quiz`, `flashcards` (new) | quiz : quiz / quiz : flashcards |
  | `timer` (new) | timer |
  | `translation`, `poll`, `agenda`, `weather`, `decision`, `rank`, `scale` (v3) | same name |
  | `chart_hbar/stacked/scatter/radar/gauge/heatmap/waterfall` (v3) | chart : hbar/stacked/scatter/radar/gauge/heatmap/waterfall |

  The instruction string also tells Jev that widget replies (`[choice:x] …`) are text. Components Jev does
  not return are filled from the heuristic when both agree on the format (router behaviour, unchanged).
- `openai.mjs` – any OpenAI-compatible `/chat/completions` (json_schema → json_object → none auto-downgrade,
  tolerant JSON extraction). For Groq/OpenRouter/OpenCode Go/Concentrate/local models.
- `heuristic.mjs` – deterministic German/English regex router (explicit requests, negations, text guards,
  implicit cues, follow-up inheritance from the previous `hui` block). Fast path + fallback.
- `chain.mjs` – `ROUTER_BACKEND=jev,claude` (or `nace,claude`, `nace,jev`): next link on error, all within one budget; heuristic last.
- Heuristic-first (`ROUTER_BACKEND=heuristic,jev`, `router.mjs` `mode: 'heuristic-first'`): the heuristic decides whenever
  one of its rules fired (its default "no visual cue" decision carries `fallthrough: true`); the model chain is asked only
  for those fall-through turns, or when `lang.mjs` sees a clearly non-de/en/es message (function-word counts, a few µs) and
  the heuristic is below 0.85. Same budget and heuristic fallback as model-first; the cache key includes the mode.

Logging (JSON lines on stdout → journald): `route` events with reqId, format, component, confidence,
model, ms, cached, fallback; `http` access lines; `route_backend_failed` with status/error class.
No message content at info level (the model's `reason` is only logged at debug).

### App-side `RouteFormat` (v5: 38 values = the 26 below + `places products guide workout studyplan vocab mindmap` + `paths blocks` + `diff terminal changes`)
See `app/src/protocol/types.ts` (`ROUTE_FORMATS`); the bridge `taxonomy.mjs` list must stay identical.

### App-side `RouteFormat` (v3)
The app's `RouteFormat` union and `ROUTE_FORMATS` array must be exactly (26 values):
`'text' | 'table' | 'chart' | 'stats' | 'compare' | 'steps' | 'timeline' | 'form' | 'diagram' | 'calculator' | 'map' | 'interactive' | 'image' | 'choice' | 'checklist' | 'recipe' | 'quiz' | 'calc' | 'timer' | 'translation' | 'poll' | 'agenda' | 'weather' | 'decision' | 'rank' | 'scale'`
(v3 additions: `translation poll agenda weather decision rank scale`; chart components are free string hints: radar gauge heatmap waterfall hbar stacked scatter).
Skeletons for the seven new formats are the protocol-v3 agent's business.

### App-side `RouteFormat` (v2, owned by the protocol agent)
`app/src/protocol/types.ts` must list exactly these six additional formats, in `RouteFormat` and in the `ROUTE_FORMATS`
array: `'choice' | 'checklist' | 'recipe' | 'quiz' | 'calc' | 'timer'` (`'map'` already exists; its renderer is now
the native `map` node instead of `hui-html`). `calculator` stays (custom hui-html tools only). The hint line the
skill sees is unchanged in shape, e.g. `UI-ROUTER-HINT: format=checklist component=packing confidence=0.9`.
Components are free hints, never required by the app.

### Deploying the v2 router (NOT done; needs the user's OK)
Bridge change only: copy `bridge/src/router/**` (taxonomy, prompt `r2`, heuristic, jev) and restart `hermes-ui-bridge`; the
decision cache key contains the prompt version, so old cached decisions are not reused. Ship it together with the
v2 skill (`hermes-skill/hermes-ui/`, see INSTALL.md): the v2 skill understands `format=choice|checklist|recipe|quiz|calc|timer`;
an old skill would receive hints it does not know and fall back to its own table.

## Evaluation

**Multilingual set (2026-10-16).** `eval/multilingual.jsonl` (source `multilingual.src.mjs`, same format and tags as the
holdout): 209 everyday requests written natively, not translated (en 38, es 38, fr 37, it 36, pt 36, nl / pl / tr 8 each),
covering products and product comparisons vs. concept comparisons, shopping / packing / to-do lists, places, weather,
timers vs. alarms and clock-time reminders, recipes, coding views, live data, chit-chat and widget replies. 40 cases are
tagged `blind`: written together with the rest but never looked at while the heuristic was extended (tune with
`--skip blind`, measure with `--only blind`). Hosted runs: one paced pass per model (`--rpm 100` Jev, `--rpm 80` Drex,
`--concurrency 4`), latency from a dev machine; heuristic-first via the router replay as above.

| backend | multilingual 209 | blind 40 | unwanted visual | errors | p50 / p95 ms | model-first | heuristic-first: acc. / model asked / added ms mean, p95 | $ / 1000 calls |
|---|---|---|---|---|---|---|---|---|
| heuristic before | 49.8 % | 40.0 % | 0 | 0 | <1 | – | – | 0 |
| heuristic now | **82.3 %** | **95.0 %** | 0 | 0 | <1 | – | – | 0 |
| jev-latest | 99.0 % | 100 % | 2 | 0 | 325 / 418 | 99.0 % | **100 % / 92 / 147, 375** | 0.16 |
| drex-v2.0 | 99.0 % | 100 % | 2 | 0 | 507 / 622 | 99.0 % | 100 % / 92 / 219, 548 | 0.18 |

Heuristic per language before → now: en 31 → 37/38, es 23 → 37/38, fr 15 → 31/37, it 16 → 31/36, pt 14 → 31/36, nl 2/8,
pl 2/8, tr 1/8 (not extended). Per class: checklist 9 → 21/24, products 8 → 30/36, places 2 → 19/23, weather 4 → 15/19,
timer 13 → 16/18, compare 7 → 8/8; recipe 3/12 and coding views 6/15 stay low because fr/it/pt are not covered there. Text
cases 44/44 before and after (no unwanted visual). `cases` 100 % and holdout 95.3 % are unchanged, as are model-first and
heuristic-first on the recorded cases/holdout runs (holdout heuristic-first asks the model once less, 22 instead of 23).
- Both models get every class right on this set; their only errors are the two `[poll:…]` widget replies (→ poll / chart).
  Model-first sends those to the model (the widget-reply rule is 0.3); heuristic-first keeps them as text.
- With the old heuristic, heuristic-first would ask the model on 158/209 turns (24 % stay under 1 ms, mean +255 ms with Jev)
  and reach 98.1 %; with the extended rules it asks on 92/209 (56 % under 1 ms, mean +147 ms) and reaches 100 %. Model
  asked per language: en 3/38, es 12/38, fr 19/37, it 17/36, pt 18/36, nl 7/8, pl 8/8, tr 8/8. Model-first's fast path
  (≥ 0.85) covers 77/209 turns (was 25).
- Caveat: the multilingual set has clearer cues than the German holdout (the models score 99 % here vs. 94-96 % there), so
  it mainly shows coverage per language; it is not a harder benchmark.

**Jev / Nace Drex eval and heuristic-first (2026-10-16).** One hosted pass per set and model (`--rpm 100 --concurrency 4`,
latency from a dev machine), with the System One choice set extended to the full v5 taxonomy ("jev v3 set" = the old
choice set from before that fix, holdout only). `cases.jsonl` is the set the heuristic was tuned on (its 100 % is not a
fair comparison); **the holdout is the fair number**. The two right-hand columns are what the bridge would emit, computed by
replaying each recorded model answer through the real router (`eval/run.mjs --replay <run.json>`, no extra calls):
*model-first* = `ROUTER_BACKEND=<model>` (heuristic fast path at confidence ≥ 0.85, model otherwise), *heuristic-first* =
`ROUTER_BACKEND=heuristic,<model>` (model only when no heuristic rule fired or the language is not de/en/es). Both fall back
to the heuristic on errors. All errors were HTTP 429 from the Drex free tier (120 RPM) despite pacing at 100 RPM.

| backend | set | lenient (raw) | unwanted visual | errors | p50 / p95 ms | model-first | heuristic-first: acc. / model asked / added ms mean, p95 | $ / 1000 calls |
|---|---|---|---|---|---|---|---|---|
| heuristic | holdout 129 | 95.3 % | 0 (6 missed) | 0 | <1 | – | – | 0 |
| jev-latest | holdout 129 | **96.1 %** | 3 | 0 | 314 / 388 | 96.1 % | 96.1 % / 23 / 57, 324 | 0.16 |
| jev-latest, v3 set | holdout 129 | 87.6 % | 0 (7 missed) | 0 | 286 / 364 | 96.1 % | 96.9 % / 23 / 52, 301 | ~0.14 |
| drex-v1.5 | holdout 129 | 95.3 % | 5 | 0 | 445 / 559 | 95.3 % | 96.1 % / 23 / 78, 471 | 0.15 |
| drex-v2.0 | holdout 129 | 93.8 % | 3 | 0 | 540 / 728 | 94.6 % | 96.1 % / 23 / 99, 586 | 0.18 |
| heuristic | cases 338 | 100 % | 0 | 0 | <1 | – | – | 0 |
| jev-latest | cases 338 | 95.3 % | 12 | 0 | 316 / 436 | 95.9 % | 99.1 % / 30 / 28, 308 | 0.16 |
| drex-v1.5 | cases 338 | 90.8 % | 22 | 4 | 439 / 593 | 93.5 % | 99.1 % / 30 / 35, 425 | 0.15 |
| drex-v2.0 | cases 338 | 86.7 % | 12 | 27 | 517 / 683 | 96.4 % | 99.4 % / 30 / 44, 503 | 0.17 |

Costs: Jev bills input only at $0.042 per 1M tokens (~3.8k tokens per routing call), Drex $0.05 / $0.06 (~3.0k tokens).
Findings:
- **The old Jev choice set was a real bug**: raw holdout 87.6 % → 96.1 % with the full set. Before the fix Jev could not
  answer places (→ map ×3), products (→ text/compare), guide, workout, studyplan, vocab or mindmap. In the bridge this was
  mostly hidden because the heuristic fast path catches the explicit v4 requests first (model-first 96.1 % either way).
- Important classes (cases + holdout), Jev: products 13/13, compare 12/15 (`compare` → `products` for `h20` MacBook vs
  ThinkPad, which arguably is products:compare, and `h40` Hetzner vs Netcup VPS, a real miss), coding views diff/terminal/
  changes 11/11, places 10/10, weather 10/10, timer 13/13, checklist 10/10. Drex: products 12-13/13, compare 13/15, coding
  views 11/11, places 10/10, weather 10/10.
- Remaining model errors are mostly visuals for text cases: clock-time reminders and alarms → timer (Drex v1.5), a
  `[poll:…]` widget reply → poll/chart (all three), "Was heißt ubiquitär?" → translation (Drex v2.0).
- **Heuristic-first** asks the model for only 18 % (holdout) / 9 % (cases) of the turns, so the mean added latency is
  30-100 ms, and it is at least as accurate as model-first on both sets. Differences between the backends on the holdout are
  one or two cases (0.8-1.6 points); they are within noise. Not yet measured on non-German messages: the eval sets are
  ~77 % German, and heuristic-first sends clearly non-de/en/es messages to the model (`src/router/lang.mjs`), which is
  where it should matter most.

**Taxonomy v4 (2026-10-11).** `cases.jsonl` is now 302 cases and `holdout.jsonl` 129 (431 total); 101 are tagged `v4` (73 in cases, 28 in the holdout: per new format 7-10 cases in `cases` incl. negatives, DE/EN/ES, widget replies, plus 2-4 independently phrased holdout cases per format).
Nine older cases were relabelled because the taxonomy changed (`ta09` opening hours → places, `ta11` training plan → workout, `st02`/`st08` "Schritt für Schritt" → guide, `d03` mind map → mindmap, `qz02` vocab cards → vocab, `tm03` duration reminder → timer, holdout `h23` → guide and `h36` → vocab), each keeping the old label as accepted alternative where sensible.
The v4 holdout cases were written after the first heuristic pass but before checking them against it; the first holdout run found one real gap that is **left unfixed on purpose** (`hv401` "Wo kann ich … gut vegetarisch essen? Restaurant mit Terrasse" → text) so the holdout stays honest; two generalisable bugs were fixed on the way (JS `\b` after `é` found on `pl01`; the product rule firing on spec questions, caught by the old holdout case `h12` "Welche Akkus haben die E-Bikes …").
Haiku ran once on the 101 `v4` cases only (`--only v4`, low / thinking disabled). Caveat: the `r4` prompt counterexamples share topics with some eval texts (Fahrradschlauch, Photosynthese, Kopfhörer), so read 100 % as "no systematic hole", not as production accuracy.

| backend (config) | set | strict | lenient | unwanted visual | component | latency p50 / p95 |
|---|---|---|---|---|---|---|
| heuristic v4 | all 431 | 93.3 % | 98.6 % | 0 (6 missed visuals) | 83/91 | <1 ms |
| heuristic v4 | cases 302 / holdout 129 | 95.7 % / 87.6 % | 100 % / 95.3 % | 0 / 0 | – | <1 ms |
| heuristic v4 | v4 101 (cases 73 / holdout 28) | 97.0 % (98.6 % / 92.9 %) | 99.0 % (100 % / 96.4 %) | 0 | 4/4 | <1 ms |
| heuristic v4 | non-v4 330 (older cases) | 92.1 % | 98.5 % | 0 (5 missed visuals, all pre-existing) | 79/87 | <1 ms |
| claude-haiku-5-5 low / thinking disabled | v4 101 | 99.0 % | 100 % | 0 | 4/4 | 1239 / 1764 ms (4 of 101 over the 2000 ms budget; 59 of 101 would take the heuristic fast path at >= 0.85) |

**Taxonomy v3 (2026-10-11).** `cases.jsonl` is now 234 cases and `holdout.jsonl` 103 (337 total); 95 are tagged `v3`
(58 new cases `v301-v358` + 33 new holdout cases `hv301-hv333` = 91 new, 13 Spanish and 16 English, 8 multi-turn; plus 4 relabelled older cases: `t08` translation, `s03` weather, `tl01`/`h26` agenda (timeline accepted), `i04` scatter → chart; includes multi-turn follow-ups, widget replies and counterexamples such as long letters, climate facts, "rate my poem", "sort alphabetically").
The 34 v3 holdout cases (33 new + `h26`) were written before running the new rules on them; the first run scored **67.6 % lenient** (23/34), then 8 generalisable
gaps were fixed (phrasing variants such as `wie lautet`, `wie man … sagt`, `Poll:`, `Regen am Samstag`, `gestapelt`, `Gewinnbrücke`, `priorisiere`, `1 bis 5 Sterne`), reaching 97.1 % (33/34);
read the holdout number as optimistic (same annotator). The paid backends ran once on the 95 `v3` cases (`--only v3`, concurrency 4).

| backend (config) | set | strict | lenient | unwanted visual | component | latency p50 / p95 |
|---|---|---|---|---|---|---|
| heuristic v3 | all 337 | 92.3 % | 98.5 % | 0 (5 missed visuals) | – | <1 ms |
| heuristic v3 | cases 234 / holdout 103 | 94.4 % / 87.4 % | 100 % / 95.1 % | 0 / 0 | 59/62 · 22/27 | <1 ms |
| heuristic v3 | v3 95 / legacy 242 | 96.8 % / 90.5 % | 98.9 % / 98.3 % | 0 / 0 | 17/18 | <1 ms |
| heuristic v3 | v3 holdout 34 (first run → after fixes) | 61.8 % → 91.2 % | 67.6 % → 97.1 % | 0 | – | <1 ms |
| claude-haiku-5-5 low / thinking disabled | v3 95 | 97.9 % | 98.9 % | 1 (`v345` "Bewerte mein Gedicht 1 bis 10" → scale) | 19/19 | 1210 / 1816 ms (4 of 95 over the 2000 ms budget) |
| jev-latest (run on hermes-host, key only there, temp dir removed) | v3 95 | 96.8 % | 97.9 % | 2 (`v325` `[agenda:…]` reply → agenda; `v345` → scale) | 17/19 | 255 / 374 ms |

Notes: Haiku and Jev both route all seven new formats and all seven chart kinds correctly on this set; the only lenient misses are
text-expected counterexamples (rating request to the assistant, an `[agenda:…]` widget reply for Jev). The single heuristic miss is
`hv320` (three phone contracts weighted by price: expects decision/compare/choice, heuristic says text with low confidence, so no hint).
The Jev `calc` criterion edit from the v2 run is still not re-measured. The v2 results below are kept for reference (they predate the 26-format taxonomy).

`bridge/eval/cases.jsonl` (176 labeled cases: 151 German, 25 English, 24 multi-turn follow-ups, 22 ambiguous
with accepted alternatives, counterexamples, negation, injection, widget replies) and
`bridge/eval/holdout.jsonl` (70 cases: the original 42 written after the first heuristic tuning, plus 28 v2
cases written before the v2 rules). Taxonomy v2 added 70 labeled cases (tag `v2`: 42 in cases, 28 in holdout;
checklist 10, recipe 6, choice 7, map 7, quiz 7, calc 9 + 1 custom calculator, timer 4, 19 text/compare
counterexamples and widget replies; 11 of the 70 are multi-turn) and relabeled 10 older ones whose best answer changed
(`calculator` → `calc` ×8, quiz `interactive` → `quiz` ×2, recipe `steps` → `recipe` ×2 with `steps` still accepted).
Sources: `eval/*.src.mjs`, regenerate with `npm run eval:cases`. "Lenient" = expected or an accepted
alternative; "unwanted visual" = a visual where text was expected.

**Taxonomy v2 results (2026-10-10).** Eval sample for the paid backends = the 70 v2 cases + a deterministic
30-case spread of the legacy cases (`--only v2`, `--skip v2 --sample 30`), 100 cases, one pass each, concurrency 4.

| backend (config) | set | strict | lenient | unwanted visual | latency p50 / p95 |
|---|---|---|---|---|---|
| heuristic (old rules, new labels) | all 246 | 66.7 % | 82.5 % | – | <1 ms |
| heuristic (old rules, new labels) | v2 70 | 21.4 % | 55.7 % | – | <1 ms |
| heuristic v2 | cases 176 | 92.6 % | 100 % (tuned) | 0 | <1 ms |
| heuristic v2 | **holdout 70** | 85.7 % | 94.3 % (first run 91.4 %, see caveat) | 0 (4 missed visuals) | <1 ms |
| heuristic v2 | all 246 | 90.7 % | 98.4 % | 0 (4 missed visuals) | <1 ms |
| heuristic v2 | v2 cases 70 | 90.0 % | 100 % | 0 | <1 ms |
| claude-haiku-5-5 low / thinking disabled | sample 100 (70 v2 + 30 legacy) | 97.0 % | 100 % | 0 | 1233 / 1944 ms |
| – of which v2 70 / legacy 30 | | 98.6 % / 93.3 % | 100 % / 100 % | 0 / 0 | 1213 / 2450 · 1323 / 1855 ms |
| jev-latest (run on hermes-host) | sample 100 (same) | 92.0 % | 98.0 % | 2 (`Wie viel sind 100 Dollar in Euro?`, `Rechne 17 mal 23.` → calc) | 250 / 385 ms |
| – of which v2 70 / legacy 30 | | 92.9 % / 90.0 % | 100 % / 93.3 % | 0 / 2 | 252 / 430 · 246 / 385 ms |

Previous table (taxonomy v1, 134 + 42 cases; not comparable one-to-one, kept for reference):

| backend (config) | set | strict | lenient | unwanted visual | latency p50 / p95 |
|---|---|---|---|---|---|
| heuristic (before tuning) | cases 134 | 87.3 % | 93.3 % | 2 | <1 ms |
| heuristic (tuned on cases) | cases 134 | 93.3 % | 100 % | 0 | <1 ms |
| heuristic | holdout 42 | 81.0 % | 90.5 % | 0 (4 missed visuals) | <1 ms |
| heuristic | sample 80* | 90.0 % | 97.5 % | 0 | <1 ms |
| claude-haiku-5-5 low / adaptive | sample 80* | 96.3 % | 100 % | 0 | 1222 / 2519 ms |
| claude-haiku-5-5 medium / adaptive | sample 80* | 95.0 % | 98.8 % | 0 | 1161 / 1770 ms |
| claude-haiku-5-5 low / thinking disabled | sample 80* | 97.5 % | 100 % | 0 | 1243 / 1820 ms |
| jev-latest (run on hermes-host) | sample 80* | 93.8 % | 100 % | 0 | 247 / 334 ms |

\* sample 80 = deterministic evenly spread subset of cases + holdout (`--cases eval/cases.jsonl,eval/holdout.jsonl --sample 80`),
one pass per config (concurrency 4). Haiku sequential check (12 cases, no thinking): p50 1545 / p95 1784 ms.

Reading the v2 numbers:
- The old heuristic scores 55.7 % lenient on the v2 cases (it cannot emit the new formats) and 93.2 % on the legacy
  cases with new labels: the taxonomy change is what the new rules buy. The heuristic fast path (≥ 0.85) covers
  105 of the 246 cases (34 of the 70 v2 cases) with no wrong decision.
- Component accuracy (format right): Haiku 92 % on v2 (23/25), 88 % legacy (7/8); Jev 88 % v2 (22/25) and 50 % legacy raw
  (4/8, the router fills the rest from the heuristic).
- Haiku misses nothing leniently; its one strict miss on v2 is `ch05` (`Ich weiß nicht, ob ich Python oder Rust lernen
  soll` → choice, labeled compare/choice/text) and the legacy misses are accepted alternatives (`k06`, `cmp07`).
- Jev's two real misses are one-off arithmetic/conversion questions routed to `calc` (`t24`, `t30`). Its criterion for
  `calc` now says "not for one-off arithmetic or a single quick conversion"; **that edit was made after the live run and is
  not re-measured** (Jev was run once, as agreed).
- Holdout caveat: the 28 v2 holdout cases were written before the v2 heuristic rules, but by the same annotator who then wrote
  the rules, and the first holdout run (91.4 % lenient) led to two fixes (`ich weiß nicht, wie ich damit umgehen soll` must not be
  choice; `Wie backe ich ein Sauerteigbrot?` relabeled recipe with `steps` accepted), so the holdout number is a slightly
  optimistic estimate. Likewise the Haiku prompt's counterexamples were deliberately reworded away from the eval texts, but the
  same annotator wrote both; treat 100 % lenient as "no systematic hole found", not as a production accuracy.
- Latency: Haiku from this machine, Jev from hermes-host (as before). With the 2000 ms budget 5 of 70 v2 Haiku calls overran
  (fallback to the heuristic); the fast path avoids the call for about half of the messages.

Commands:
```
cd bridge
npm test                    # 108 tests: routing (incl. v2 formats), hint, SSE pass-through (every chunk boundary), headers, abort, uploads, voice
npm run eval                # heuristic on cases.jsonl
npm run eval:holdout        # heuristic on holdout.jsonl
# Claude matrix (haiku low/adaptive, medium/adaptive, low/disabled); key from an env file, never printed:
(set -a; . "${HUI_PRIVATE_DIR:-$HOME/work/hermesiui-private}/.env.local"; set +a; node eval/run.mjs --backend heuristic,anthropic \
   --cases eval/cases.jsonl,eval/holdout.jsonl --sample 80 --json /tmp/eval-claude.json)
#   other configs: --anthropic claude-haiku-5-5:low:disabled,claude-sonnet-5-5:low:between_tools
# Jev (key only exists on hermes-host): copy to a temp dir, run once, delete. Inside `ssh hermes-host` (v3 run: --only v3):
#   D=/tmp/hui-eval; mkdir -p $D   (then from the laptop: tar -C bridge -cf - package.json src eval | ssh hermes-host tar -C /tmp/hui-eval -xf -)
#   cd $D && export TYPESAFE_API_KEY="$(sed -n 's/^TYPESAFE_API_KEY=//p' /root/.hermes/.env | tr -d "\"'")"
#   node eval/run.mjs --backend jev --cases eval/cases.jsonl,eval/holdout.jsonl --sample 80; cd / && rm -rf $D
# Nace Drex (key in the private env file, never printed); --rpm keeps the free tier (120 RPM) free of 429s:
(set -a; . <(grep -E '^NACE_API_KEY=' "${HUI_PRIVATE_DIR:-$HOME/work/hermesiui-private}/.env.local"); set +a; \
   node eval/run.mjs --backend heuristic,nace --models drex-v1.5,drex-v2.0 --cases eval/holdout.jsonl --rpm 100 --concurrency 4)
# Any OpenAI-compatible model:
BRIDGE_ROUTER_BASE_URL=... BRIDGE_ROUTER_API_KEY=... node eval/run.mjs --backend openai --models m1,m2
```
Options: `--budget <ms>` (fallback simulation, default 2000), `--fastpath <conf|0>`, `--concurrency`,
`--only <tag>`, `--skip <tag>` (e.g. `--only v2`, `--skip v2 --sample 30`), `--verbose` (prints model reasons for misses), `--json <file>` (per-case results).

## Install & pairing

Status 2026-10-10: implemented + tested locally (`bin/hermes-ui-bridge.mjs`, `src/cli.mjs`, `src/pair.mjs`,
`test/pair-cli.test.mjs`), **not published, not deployed**. User-facing guide: `bridge/README.md`.

**CLI**: `npx hermes-ui-bridge [--env-file .env] [--pair] [--port n] [--host a] [--state-dir d] [--no-check] [--strict]`.
Env files are merged under the real environment. If `BRIDGE_TOKEN` is unset a token is generated once and stored in
`<state-dir>/state.json` (0600). `BRIDGE_STATE_DIR` default: `$XDG_STATE_HOME/hermes-ui-bridge` or
`~/.local/state/hermes-ui-bridge`; `BRIDGE_UPLOAD_DIR` defaults to `<state-dir>/uploads` in the CLI. Startup checks:
`GET /health`, then `GET /v1/models` with the key. Unreachable Hermes = warning (exit 1 with `--strict`), 401/403 = exit 1.
Then it prints router backend, uploads, voice, meta and pairing status.

**Docker**: `bridge/Dockerfile` (node:22-alpine, user `node`, volume `/var/lib/hermes-ui-bridge`, healthcheck on
`/bridge/voice/config`, entrypoint = the CLI, `skill/` from `npm run bundle-skill` copied in and checked at build time),
`bridge/docker-compose.example.yml`. Not built or pushed here.

**Pairing** (`GET /bridge/pair`, `.svg`, `.png`): QR payload `hermesuiplus://pair?u=<BRIDGE_PUBLIC_URL>&c=<one-time pair code, redeemed via POST /bridge/pair/redeem>&n=<BRIDGE_NAME>`
(percent-encoded, `t` omitted without auth). Access (security review H3, 2026-10-11):
- **local** = direct loopback peer **and** no proxy header (`X-Forwarded-*`, `Forwarded`, `Via`, `X-Real-IP`,
  `X-Client-IP`, `Tailscale-*`, `CF-Connecting-IP`, `True-Client-IP`) **and** a loopback `Host`
  (`127.0.0.1`, `localhost`, `[::1]`, any port) **and** no cross-site fetch metadata (`Sec-Fetch-Site` absent, `none` or
  `same-origin`). A plain `proxy_pass`/socat/`ssh -L` keeps the public `Host` and a DNS-rebinding page sends its own
  name, so neither counts as local any more;
- anything else needs `BRIDGE_PAIRING=1` plus the one-time code from the startup log (`?code=XXXX-XXXX`, 10 min,
  single use, 5 wrong tries lock pairing for 10 min);
- when `BRIDGE_PUBLIC_URL` or `BRIDGE_ALLOWED_HOSTS` is set, a request whose `Host` is neither loopback, the public
  URL's host nor listed is refused with 421 before anything else (anti DNS rebinding).
Otherwise 404/401/403/421/429 without token. Responses are `no-store`. The app registers the `hermesuiplus://` scheme,
parses `u`, `c`, `n`, redeems the one-time code `c` for its device token (`POST /bridge/pair/redeem`) and stores base URL,
device token and display name; the code itself is not kept.

**Per-device tokens** (security review M5, `src/devices.mjs`, `src/auth.mjs`, `src/device-admin.mjs`): with a state
directory (`BRIDGE_STATE_DIR`, else systemd's `$STATE_DIRECTORY`; the CLI always has one) every QR (page, `.svg`,
`.png`, `--pair`) carries a **one-time pair code** (never a token, never `BRIDGE_TOKEN`). The app exchanges it once for a
fresh device token (`hbd_…`, 256 bit) with `POST /bridge/pair/redeem`; the token is created only at that moment. Codes and
tokens are stored as sha256 in `<state-dir>/devices.json` (0600, atomic writes, re-read within 2 s when another process
changes it). A code that no app redeems within 1 h expires (old screenshots / log lines with a QR are worthless), and a
used code is worthless too. `BRIDGE_TOKEN` stays the
admin/bootstrap credential: full API access plus the admin endpoints; device tokens get the normal API (chat, `/api`
allow-list, uploads, voice, meta, images, push, inbox) but 403 on `/bridge/devices`. Revoking ends a device's open inbox
stream within 30 s.
```
GET    /bridge/devices                 (BRIDGE_TOKEN)  {devices:[{id,label,createdAt,lastUsedAt,status:pending|active|expired|revoked}]}
POST   /bridge/devices {"label":"…"}   (BRIDGE_TOKEN)  201 {id, pairUri, webPairUri, expiresAt}   (one-time code in the link)
DELETE /bridge/devices/<id>            (BRIDGE_TOKEN)  204
hermes-ui-bridge devices list | add [label] | revoke <id>   [--env-file f] [--state-dir d]   (QR on the terminal)
```
Migration: existing apps keep working with `BRIDGE_TOKEN`. Re-pair each device (it then holds its own token), then
rotate `BRIDGE_TOKEN` and keep it only on the server. `BRIDGE_DEVICE_TOKENS=0` turns device tokens off (pairing then refuses, see below).
Only `BRIDGE_PAIR_ADMIN_TOKEN=1` without a device store (no state directory, or `BRIDGE_DEVICE_TOKENS=0`) puts a token
into a link (`t=<BRIDGE_TOKEN>`, a permanent admin credential; unsafe). Without it such a bridge refuses to pair.

| variable | default | meaning |
|---|---|---|
| `BRIDGE_PUBLIC_URL` | local address | URL the app uses (HTTPS recommended) |
| `BRIDGE_NAME` | `Hermes` | label |
| `BRIDGE_PAIRING` | off | `1` allows pairing from non-local clients with a code |
| `BRIDGE_PAIR_SCHEME` | `hermesuiplus` | scheme of the QR / pair links: `hermesuiplus` (official app), `hermesui` (personal builds), `hermesiui` (apps from before the rename) |
| `BRIDGE_ALLOWED_HOSTS` | – | extra `Host` names (comma separated) the pairing page may be reached under, besides loopback and the public URL host |
| `BRIDGE_STATE_DIR` | see above (`$STATE_DIRECTORY` under systemd) | token, uploads, `devices.json`, push state |
| `BRIDGE_DEVICE_TOKENS` | on (with a state dir) | `0` = no per-device tokens; pairing refuses unless `BRIDGE_PAIR_ADMIN_TOKEN=1` (QR then carries `BRIDGE_TOKEN`, unsafe) |

## Running locally

```
cd bridge
# against the mock (port 8787, started without --route):
HERMES_BASE_URL=http://127.0.0.1:8787/v1 HERMES_API_KEY=any BRIDGE_TOKEN=devtoken node src/server.mjs
# against real Hermes with the repo env file (HERMES_*, ANTHROPIC_API_KEY):
BRIDGE_TOKEN=devtoken node --env-file="${HUI_PRIVATE_DIR:-$HOME/work/hermesiui-private}/.env.local" src/server.mjs
curl -N http://127.0.0.1:8790/v1/chat/completions -H 'Authorization: Bearer devtoken' \
  -H 'Content-Type: application/json' \
  -d '{"model":"hermes-agent","stream":true,"messages":[{"role":"user","content":"Zeig das als Tabelle"}]}'
```
App settings: base URL = bridge URL, API key = `BRIDGE_TOKEN`.
Verified locally: bridge in front of the mock server (route event + pass-through) and in front of the
real Hermes for `/health` and `/v1/models` only (no real chat turn was sent through the bridge).

## Configuration (env)

| variable | default | meaning |
|---|---|---|
| `HERMES_BASE_URL` | – (required) | e.g. `http://127.0.0.1:8642/v1` (`/v1` optional) |
| `HERMES_API_KEY` | – | Hermes `API_SERVER_KEY`, sent upstream only |
| `BRIDGE_TOKEN` | – (required) | token the app sends; `BRIDGE_ALLOW_NO_AUTH=1` for local dev only |
| `BRIDGE_HOST` / `BRIDGE_PORT` | `127.0.0.1` / `8790` | listen address |
| `ROUTER_BACKEND` (alias `BRIDGE_ROUTER`) | `heuristic` (provider keys alone never select a model router) | `claude`\|`jev`\|`nace`\|`openai`\|`heuristic`\|`off`, a chain `jev,claude` / `nace,claude`, or heuristic-first `heuristic,jev` (model only when no heuristic rule fired or the language is not de/en/es) |
| `ANTHROPIC_API_KEY` | – | Claude backend key |
| `ROUTER_CLAUDE_MODEL` | `claude-haiku-5-5` | Claude model (`BRIDGE_ROUTER_MODEL` also applies if no openai link) |
| `ROUTER_EFFORT` | `low` | `low`\|`medium`\|`high` |
| `BRIDGE_ROUTER_THINKING` | `adaptive` | `adaptive`\|`disabled`\|`between_tools` (Sonnet 5.5 needs `between_tools`, not `disabled`) |
| `BRIDGE_ROUTER_MAX_TOKENS` | 2048 adaptive / 256 otherwise | |
| `TYPESAFE_API_KEY`, `JEV_MODEL`, `JEV_BASE_URL` | –, `jev-latest`, `https://api.typesafe.ai` | Jev backend |
| `NACE_API_KEY`, `NACE_MODEL`, `NACE_BASE_URL` | –, `drex-v2.0`, `https://console.nace.ai` | Nace Drex backend (same System One API; base URL may point to a self-hosted Drex `serve.py`) |
| `BRIDGE_ROUTER_BASE_URL`, `BRIDGE_ROUTER_API_KEY`, `BRIDGE_ROUTER_MODEL`, `BRIDGE_ROUTER_JSON_MODE`, `BRIDGE_ROUTER_EXTRA_BODY` | –, –, –, `schema`, – | OpenAI-compatible backend |
| `BRIDGE_ROUTER_TIMEOUT_MS` | `2000` | total model budget per message, then heuristic |
| `BRIDGE_ROUTER_FASTPATH_MIN` | `0.85` | heuristic confidence that skips the model (`off` disables) |
| `BRIDGE_ROUTER_FALLBACK` | `heuristic` | or `neutral` (text, confidence 0, no hint) |
| `BRIDGE_ROUTER_CACHE_SIZE` / `_TTL_MS` | 2000 / 3600000 | decision cache |
| `BRIDGE_ROUTE_NONSTREAM` | `1` | also route `stream:false` requests |
| `BRIDGE_HINT` | `auto` | `auto` (see session caveat) \| `on` \| `off` (route event only) |
| `BRIDGE_HINT_MIN_CONFIDENCE` / `BRIDGE_HINT_TEXT_MIN_CONFIDENCE` | 0.5 / 0.75 | hint thresholds |
| `BRIDGE_HINT_REASON` | `0` | append `- <reason>` to the hint |
| `BRIDGE_BOOTSTRAP` / `BRIDGE_BOOTSTRAP_FILE` | on / `../hermes-skill/bootstrap-system-message.txt` | skill bootstrap system message (`off` disables) |
| `BRIDGE_SKILL_INLINE` / `BRIDGE_SKILL_FILE` | on / `hermes-ui/SKILL.md` next to the bootstrap file, repo `hermes-skill/`, bundled `skill/` | skill core as a system message after the bootstrap on app turns (`off` disables; missing file: warning, no injection) |
| `BRIDGE_CONTEXT_MEMORY`, `BRIDGE_CONTEXT_MAX_SESSIONS`, `BRIDGE_CONTEXT_TTL_MS`, `BRIDGE_CONTEXT_MAX_CHARS` | 1, 500, 86400000, 2000 | per-session routing context (in memory only) |
| `BRIDGE_CORS_ORIGINS` | – | comma list or `*` (web dev only) |
| `BRIDGE_WEB_DIR` | – | serve a built web app at `/` (same origin; `src/static.mjs`, see bridge/README.md "Serving the web app") |
| `BRIDGE_MAX_CONCURRENT_TURNS` / `BRIDGE_MAX_TURNS_TOTAL` | 8 / 16 | concurrent chat turns per credential / for the whole bridge (a turn counts until Hermes finished it) → 429 |
| `BRIDGE_MAX_BODY_BYTES` | 25 MB | limit for the buffered `/v1/chat/completions` body only; **not** applied to uploads |
| `BRIDGE_UPLOAD_DIR` / `_MAX_BYTES` / `_RETENTION_DAYS` | `/var/lib/hermes-ui-bridge/uploads` / 20 MB / 7 | file uploads, see "File uploads" |
| `BRIDGE_UPLOAD_ALLOWED_MIME` / `BRIDGE_UPLOAD_PUBLIC_DIR` | built-in list / – | comma list (`type` or `prefix/*`), path prefix reported to the client |
| `BRIDGE_MEDIA_DIRS` / `BRIDGE_MEDIA_MAX_BYTES` | – (endpoint off) / 100 MB | Hermes media files for the app, see "Media files" |
| `BRIDGE_LOG_LEVEL` | `info` | `debug` adds model reasons |
| `BRIDGE_PROFILES` | `auto` if the Hermes home is readable, else any valid name | Hermes profiles (bots) reachable under `/p/<name>/`: `auto` (`HERMES_HOME/profiles/`), comma list (`research,work=Label`) or `off`; listed at `GET /bridge/profiles` |

## Media files (`GET /bridge/media?path=`)

Hermes announces generated files as `MEDIA:<server path>` in the answer text (streamed deltas carry the raw tag). The app
shows a file chip / inline image instead of the path and fetches the bytes through this read-only endpoint
(`src/media.mjs`, `test/media.test.mjs`). Without `BRIDGE_MEDIA_DIRS` the endpoint answers `404 media_disabled` and the
app shows "Datei liegt auf dem Server" with a copy-path button.

- Auth: same Bearer check as every bridge route (`401` otherwise). `GET` and `HEAD` (the app probes with `HEAD`).
- `path` = the absolute path exactly as in the tag (query parameter, decoded once). Refused with `400 invalid_path`: not absolute, `.`/`..`/empty
  segments, backslash, NUL/control characters, > 4096 chars.
- Served only below `BRIDGE_MEDIA_DIRS` (comma/colon separated absolute dirs, e.g. the Hermes cache dirs
  `/root/.hermes/cache/images,/root/.hermes/cache/documents`): lexical check first (outside -> `403 path_not_allowed`, no fs access, so no
  existence oracle), then `realpath` (symlinks resolved) and the same check against the real roots. Dot-files / dot-directories below a root
  are never served; the root itself and directories are not files.
- Extension allow-list = Hermes' deliverable types (`415 unsupported_type` otherwise). Active content (`svg html htm xml`) is sent as
  `application/octet-stream` + `attachment`; everything carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`.
  Larger than `BRIDGE_MEDIA_MAX_BYTES` -> `413`.
- Deployment (NOT done): the production unit runs `DynamicUser=yes` + `ProtectHome=yes`, and the Hermes cache dirs are `0700 root`. The bridge
  can only read what is exposed explicitly, e.g. a drop-in with `BindReadOnlyPaths=/root/.hermes/cache/images:/var/lib/hermes-ui-bridge/media/images`
  (+ readable permissions) and `BRIDGE_MEDIA_DIRS=/var/lib/hermes-ui-bridge/media`. The `MEDIA:` path Hermes writes is the host path, so
  either mirror the same path inside the unit (`BindReadOnlyPaths=/root/.hermes/cache`) or keep the app on "Datei liegt auf dem Server".

## File uploads (`POST /bridge/uploads`)

Status 2026-10-10: implemented + tested locally (`src/uploads.mjs`, `test/uploads.test.mjs`, 21 tests), **not deployed**.
The app uploads an attachment first, then mentions the returned `path` in the chat message so Hermes
(which runs as root on the same host) can read the file with its file tools.

### Contract
```
POST /bridge/uploads
Authorization: Bearer <BRIDGE_TOKEN>
Content-Type: <mime>                 # must be in the allow-list, parameters (; charset=..) are ignored
X-Filename: <encodeURIComponent(name)>
<raw bytes>                          # no multipart; Content-Length or chunked
```
- `201 {"id","path","name","size","mimeType"}` – `id` = 16 hex chars; `name` = the *sanitized* name as stored;
  `size` = bytes written; `mimeType` = normalized (lowercase, no parameters); `path` = absolute path **as Hermes must read it**.
- Errors, always `{"error":{"message","type","code"}}` (`type` = `invalid_request_error`, 500: `bridge_error`):
  `400` missing/blank/undecodable `X-Filename`, or empty body; `401` bad/missing token (checked first, same
  constant-time compare as the rest of the bridge); `413` more than `BRIDGE_UPLOAD_MAX_BYTES`; `415` mime not allowed
  (also: no Content-Type); `500` disk error.
- Size limit: a declared `Content-Length` over the limit is rejected before any byte is read; otherwise the body is
  streamed to disk and counted, and the upload is aborted with 413 as soon as the limit is crossed (partial file removed,
  connection closed after the answer). Memory use is flat. A client that disconnects mid-upload leaves nothing behind.
- Default allow-list: `image/{png,jpeg,gif,webp,heic,heif,bmp,tiff}`, `application/pdf`, `text/*` (plain, csv, markdown, html, ...),
  `application/json`, docx/xlsx/pptx (`application/vnd.openxmlformats-officedocument.*`). **Not** allowed by default: zip, svg, `application/octet-stream`
  (so the app must send a real type, e.g. `text/markdown` for `.md`). Override with `BRIDGE_UPLOAD_ALLOWED_MIME`,
  e.g. `...,application/zip` (the list *replaces* the default, so repeat the defaults you want to keep).
- The route is hooked in `src/server.mjs` before the bridge handler (only `POST /bridge/uploads`); everything else is unchanged.
  CORS: if `BRIDGE_CORS_ORIGINS` allows the origin, the answer carries `Access-Control-Allow-Origin` (preflight is the bridge's).

### Storage
- Layout `<BRIDGE_UPLOAD_DIR>/<yyyy-mm-dd UTC>/<id>-<sanitized-name>`; written as `.<id>.part` and renamed when complete, so
  readers never see partial files. Files are chmod 0600 explicitly (not umask dependent), dirs 0700 (root Hermes reads them);
  a non-root Hermes sharing a group: `BRIDGE_UPLOAD_GROUP_READ=1` -> 0640 / 0750.
- Sanitizing: NFC, basename only (splits on `/` and `\`), control/bidi/zero-width characters removed, everything except
  letters/digits (any script) and `._-+()[]@,` becomes `_` (so spaces and emoji do not survive), no leading dots/`..`, name capped at 120
  UTF-8 bytes with the extension (max 16 chars) kept, never empty (`file`). `../../etc/passwd` -> `passwd`, `Übersicht – größe.pdf` -> `Übersicht_größe.pdf`.
- Retention: files with mtime older than `BRIDGE_UPLOAD_RETENTION_DAYS` (7) are deleted at startup and every 24 h; old empty day
  directories are removed. Cleanup only touches regular files in `yyyy-mm-dd` directories directly below the upload dir (no symlink following).

### Deployment delta (NOT deployed – needs the user's OK)
The unit in "Deployment on hermes-host" uses `DynamicUser=yes` + `ProtectSystem=strict`, so the bridge cannot write anywhere. Add to `[Service]`:
```ini
StateDirectory=hermes-ui-bridge
# optional (defaults): StateDirectoryMode=0755
Environment=BRIDGE_UPLOAD_DIR=/var/lib/hermes-ui-bridge/uploads
```
(`Environment=` line is optional, this is the default; then `systemctl daemon-reload && systemctl restart hermes-ui-bridge`. No rsync of
`/opt` content other than the new `src/uploads.mjs`, `src/server.mjs`. Hermes is not restarted.)

**Real path / readability (checked against `man systemd.exec`, systemd 255):** with `DynamicUser=yes` the state directory is created as
`/var/lib/private/hermes-ui-bridge` (owned by the dynamic uid) and `/var/lib/hermes-ui-bridge` is only a symlink to it ("Symbolic links are
created to hide this difference"). `/var/lib/private` itself is root-only (`drwx------ root`, verified on this machine: permission denied
for non-root), which is the point: no other unprivileged user can reach uploads via uid recycling. Hermes runs as root, so it can traverse
`/var/lib/private` and read the 0600 files. The bridge therefore returns `realpath(BRIDGE_UPLOAD_DIR)` in `path`, i.e. in production
`/var/lib/private/hermes-ui-bridge/uploads/<day>/<id>-<name>` (the symlink path would also work for root, but the real path is
what survives if Hermes ever resolves or sandboxes paths). If Hermes sees the directory under a different path (container, bind mount), set
`BRIDGE_UPLOAD_PUBLIC_DIR` to that prefix; it replaces the realpath in the response.
Things to verify after deployment (could not be tested here, systemd dynamic users need root on hermes-host):
`ls -ld /var/lib/private /var/lib/private/hermes-ui-bridge`, upload a file, `ssh hermes-host 'cat <returned path>'` as root, and make sure
Hermes' file tools are not restricted to an allowed-roots list that excludes `/var/lib/private/...` (not checked in `/opt/hermes`).
Rollback: remove the `StateDirectory=` line; stored files stay in `/var/lib/private/hermes-ui-bridge` until deleted manually.

**`BRIDGE_MAX_BODY_BYTES` interplay:** that limit (25 MB) is enforced only by the chat route's buffered `readBody`. Uploads bypass it and are limited
solely by `BRIDGE_UPLOAD_MAX_BYTES` (20 MB), streamed, so raising either does not affect the other. The chat body must stay small: the app
sends only the file *path* in the message text, never the bytes. `tailscale serve` imposes no body limit of its own; `server.requestTimeout`
is 0, so slow mobile uploads are not cut off (a stalled one holds a socket until the client disconnects).

## Voice (STT/TTS)

Status 2026-10-10: implemented + tested locally (`src/voice.mjs`, `test/voice.test.mjs`), **not deployed**. Live-checked once on hermes-host
against Groq and Deepgram (temporary copy in `/tmp`, deleted afterwards; the running bridge and Hermes were not touched).
Provider keys never leave the bridge. Hooked into `src/server.mjs` next to uploads (own Bearer check, not subject to `BRIDGE_MAX_BODY_BYTES`).

### Contract
```
GET  /bridge/voice/config            Authorization: Bearer <BRIDGE_TOKEN>
  -> 200 {"stt":{"provider","model","languages":[..],"available","maxBytes"},
          "tts":{"provider","model","voices":[{"id","name","lang","provider"}],"defaultVoice","available","maxChars"}}

POST /bridge/stt                     Authorization: Bearer ...
  Content-Type: audio/m4a | audio/mp4 | audio/aac | audio/webm | audio/ogg | audio/wav | audio/mpeg   (parameters ignored; x-m4a/x-wav/mp3 aliases accepted)
  X-Language: de                     (optional ISO 639-1; omitted = auto-detect)
  <raw audio bytes>                  (Content-Length or chunked, max BRIDGE_STT_MAX_BYTES = 25 MB)
  -> 200 {"text","language","durationMs","provider","model"}

POST /bridge/tts                     Authorization: Bearer ...   Content-Type: application/json
  {"text": "...", "voice"?: "<id from config>", "format"?: "mp3"}      text <= 4000 chars
  -> 200 audio/mpeg (chunked, piped from the provider as it arrives), headers X-TTS-Provider, X-TTS-Voice
```
- Errors always `{"error":{"message","type","code"}}`: `400` empty/invalid body, bad `X-Language`, malformed `voice`, `format` other than mp3,
  or audio the provider cannot decode (`invalid_audio`); `401` bad/missing token (checked first); `413` audio over the limit
  (rejected from `Content-Length` before reading, otherwise as soon as the streamed count crosses it; connection closed after the answer) or text over 4000 chars;
  `415` content type not in the list; `502` provider unreachable / key rejected (`upstream_auth`) / rate limited (`upstream_rate_limited`) / other error /
  key missing (`stt_not_configured`, `tts_not_configured`); `504` provider timeout. Provider response bodies and keys are never forwarded (only logged, truncated, without keys).
- `language` = the `X-Language` value if sent, else the detected language mapped to ISO (Whisper says `"german"` -> `de`). `durationMs` = audio duration reported by the
  provider (`verbose_json`; `null` if the provider does not return it, e.g. `gpt-4o-*-transcribe`).
- TTS streaming: the response headers are written together with the first audio chunk (so errors before any audio are still clean JSON errors); after that the bytes
  are piped with backpressure and a client disconnect cancels the upstream request. A provider stall longer than `BRIDGE_TTS_TIMEOUT_MS` or an error after audio started
  cuts the connection (the client sees a truncated stream).
- `voice` selects the provider too: a curated voice id of any provider that has a key goes to that provider (so the app can offer one list); any other well-formed id
  (`[A-Za-z0-9._-]{1,64}`, e.g. a custom ElevenLabs voice) goes to the default provider. No `voice` = `defaultVoice`. The config lists the voices of all providers with a key, default provider first.
- CORS: if `BRIDGE_CORS_ORIGINS` allows the origin, answers carry `Access-Control-Allow-Origin` and expose `X-TTS-Provider, X-TTS-Voice` (preflight is the bridge's).

### Providers (request shapes checked against the official docs, 2026-10)
| | endpoint | auth | notes |
|---|---|---|---|
| STT `groq` (default) | `POST https://api.groq.com/openai/v1/audio/transcriptions` multipart `file` (`audio.<ext>`), `model`, `response_format=verbose_json`, `language?` | `Bearer GROQ_API_KEY` | model `whisper-large-v3-turbo`; `verbose_json` instead of `json` because only it returns `language` + `duration`; `audio/aac` is sent as `.m4a` |
| STT `openai` | `POST https://api.openai.com/v1/audio/transcriptions`, same form | `Bearer OPENAI_API_KEY` | model `whisper-1` (`gpt-4o-*-transcribe` -> plain `json`) |
| TTS `deepgram` | `POST https://api.deepgram.com/v1/speak?model=<voice>&encoding=mp3` body `{"text"}` | `Token DEEPGRAM_API_KEY` | the voice id *is* the model (`aura-2-<name>-<lang>`); Aura limit 2000 chars/request -> longer text is split at sentence ends (<= 1800) and the mp3 parts are streamed back to back |
| TTS `elevenlabs` | `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream?output_format=mp3_44100_128` body `{"text","model_id"}` | `xi-api-key: ELEVENLABS_API_KEY` | model `eleven_multilingual_v2` (no `language_code`, unsupported for that model) |
| TTS `openai` | `POST https://api.openai.com/v1/audio/speech` body `{"model","input","voice","response_format":"mp3"}` | `Bearer OPENAI_API_KEY` | model `gpt-4o-mini-tts` |

Curated voices: Deepgram Aura-2 German `elara` (default), `fabian`, `aurelia`, `lara`, `julius`, `kara`, `viktoria` (+ `aura-2-thalia-en`, which Hermes itself uses);
ElevenLabs `pNInz6obpgDQGcFmaJgB` (Adam, Hermes' voice), Rachel, Antoni, Bella (premade, multilingual, **unverified**: no key on hermes-host);
OpenAI `marin`, `cedar`, `alloy` (Hermes' voice), `coral`, `nova`, `onyx`, `sage`, `shimmer` (**unverified**).

### Configuration (env)
| variable | default | meaning |
|---|---|---|
| `GROQ_API_KEY`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY` | – | provider keys (a provider without key is simply unavailable) |
| `BRIDGE_STT_PROVIDER` / `BRIDGE_STT_MODEL` | `groq` / `whisper-large-v3-turbo` (`whisper-1` for openai) | |
| `BRIDGE_TTS_PROVIDER` | first provider with a key in the order deepgram, elevenlabs, openai (`deepgram-aura` accepted as alias) | default TTS provider |
| `BRIDGE_TTS_VOICE` / `BRIDGE_TTS_MODEL` | provider default (`aura-2-elara-de` / `pNInz6obpgDQGcFmaJgB` / `marin`) / provider default | `BRIDGE_TTS_MODEL` does not apply to Deepgram (voice = model) |
| `BRIDGE_STT_MAX_BYTES` | 25 MB | |
| `BRIDGE_TTS_MAX_CHARS` | 4000 | |
| `BRIDGE_STT_TIMEOUT_MS` / `BRIDGE_TTS_TIMEOUT_MS` | 30000 / 15000 | STT: whole provider call; TTS: until the first byte, then max silence between chunks |
| `GROQ_BASE_URL`, `DEEPGRAM_BASE_URL`, `ELEVENLABS_BASE_URL`, `OPENAI_BASE_URL` | the official hosts | overrides (tests / proxies); `GROQ_BASE_URL`/`OPENAI_BASE_URL` include `/openai/v1` resp. `/v1` |

### Deployment delta (NOT deployed – needs the user's OK)
Files to copy to `/opt/hermes-ui-bridge`: new `src/voice.mjs`, changed `src/server.mjs` (and `src/uploads.mjs`, which voice imports `normalizeMime` from). No new dependency.
Add to the bridge env file (`/root/.hermes-ui-bridge/.env`; the keys already exist in `/root/.hermes/.env`, copy the values there, never into the repo):
```
GROQ_API_KEY=...            # STT
DEEPGRAM_API_KEY=...        # TTS (default)
BRIDGE_TTS_PROVIDER=deepgram
BRIDGE_TTS_VOICE=aura-2-elara-de
# optional, only if you add keys: ELEVENLABS_API_KEY=..., OPENAI_API_KEY=...
```
then `systemctl restart hermes-ui-bridge`. Outbound HTTPS to api.groq.com / api.deepgram.com is required (works from hermes-host, see below). Nothing else changes; Hermes is not restarted.
Hermes itself uses Deepgram `aura-2-thalia-en` (English) for TTS; the bridge uses the German Aura-2 voices for the app instead.

### Live check on hermes-host (2026-10-10)
Sentence "Hallo, ich bin Hermes. Wie kann ich dir heute helfen?" through the real bridge code path (loopback), Deepgram Aura-2 mp3 (24 kHz mono 48 kbps), time to first audio byte / total:
| voice | first byte | total |
|---|---|---|
| `aura-2-elara-de` | 756 ms (cold, first call) / 297 ms | 2396 / 1980 ms |
| `aura-2-fabian-de` | 305 ms | 2156 ms |
| `aura-2-aurelia-de` | 293 ms | 1822 ms |

Groq `whisper-large-v3-turbo` transcribed the Elara sample back exactly ("Hallo, ich bin Hermes. Wie kann ich dir heute helfen?", detected `de`, 3984 ms audio) in 394 ms
with `X-Language: de` and 195 ms with auto-detect. ElevenLabs and OpenAI were **not** compared: neither key exists on hermes-host. Samples: `docs/voice-samples/deepgram-aura-2-{elara,fabian,aurelia}-de.mp3`.
Recommendation for German: Deepgram `aura-2-elara-de` (default) – fastest first byte (~300 ms), already paid for/used by Hermes; judge naturalness by ear from the samples. If it
does not convince, add an `ELEVENLABS_API_KEY` (`eleven_multilingual_v2` is the usual quality benchmark for German, at the cost of higher latency and price) and switch with `BRIDGE_TTS_PROVIDER=elevenlabs`.

## Image search (`GET /bridge/images`)

Web image search as second image source for the app (Wikimedia stays first for places/animals; web for
products, games, screenshots, current events). Code: `bridge/src/images.mjs`, tests `bridge/test/images.test.mjs`.

### Contract
`GET /bridge/images?q=<query>&n=<1..8, default 4>&lang=de` (Bearer `BRIDGE_TOKEN`) ->
`{results:[{url, thumbnailUrl, width, height, title, sourcePage, sourceDomain, provider}]}` (`width/height` 0 =
unknown). Errors: 400 invalid query, 401, 429 (`retry-after`), 502 all providers failed, 503 no provider key.
Zero hits is `200 {results:[]}`. `GET /bridge/images/config` -> `{available, providers, maxResults, cacheSize}`.
Filter: https only (image and thumbnail), no svg/gif, known size < 300 px dropped, dedupe by image url,
max 2 per source domain. SafeSearch strict (Serper `safe:"active"`, Brave `safesearch=strict`).
Cache: LRU 500, 24 h per (lang, n, query), empty results cached too. Timeout 4 s per provider; rate limit 30
uncached requests/min. Queries are never logged at info level (only provider failures at warn, without query).

### Providers (fallback chain `BRIDGE_IMAGE_PROVIDERS`, default `serper,brave`)
- Serper: `POST https://google.serper.dev/images`, header `X-API-KEY`, body `{q, gl, hl, num, safe}`; response
  `images[]` {title, imageUrl, imageWidth, imageHeight, thumbnailUrl, source, domain, link}.
- Brave: `GET https://api.search.brave.com/res/v1/images/search?q&count&safesearch=strict&search_lang&country`,
  header `X-Subscription-Token`; response `results[]` {title, url (page), source (domain), thumbnail.src,
  properties.{url,width,height}}. (Brave's docs page does not spell out the JSON keys; parsing is tolerant, verified live below.)

### Configuration (env)
`SERPER_API_KEY`, `BRAVE_API_KEY`, `BRIDGE_IMAGE_PROVIDERS` (default `serper,brave`), `BRIDGE_IMAGE_TIMEOUT_MS` (4000),
`BRIDGE_IMAGE_CACHE_SIZE` (500), `BRIDGE_IMAGE_CACHE_TTL_MS` (24 h), `BRIDGE_IMAGE_RATE_LIMIT` (30/min).

### Deployment delta (NOT deployed – the lead does it)
1. Copy `SERPER_API_KEY` and `BRAVE_API_KEY` from `/root/.hermes/.env` into the bridge env file (never print them).
2. Deploy the new `bridge/src/images.mjs` + `server.mjs`, restart the bridge. No new dependencies.
3. Check: `curl -H "Authorization: Bearer $BRIDGE_TOKEN" 127.0.0.1:8790/bridge/images/config`.
The app needs no config: it uses the existing Hermes bridge profile.

## Hermes sessions pass-through

Strict allow-list in `src/bridge.mjs` (after the bridge-token check) so the app can sync Hermes sessions. Upstream gets `HERMES_API_KEY`; the client's `Authorization` is never forwarded.

```
GET /api/sessions            GET|PATCH|DELETE /api/sessions/{id}
GET /api/sessions/{id}/messages            POST /api/sessions/{id}/fork            GET /api/model/options
(GET /v1/capabilities: /v1 allow-list, see above)
```

- `{id}`: `[A-Za-z0-9._:-]{1,128}`, no `..`, no percent-encoding; anything else under `/api/` -> 404 (never forwarded). Wrong method -> 405 + `Allow`.
- Query string forwarded verbatim; PATCH body max 64 KB (else 413); upstream status and body piped back, hop-by-hop headers stripped; 30 s upstream timeout -> 504, unreachable -> 502. Bodies are not logged.
- CORS preflight now also advertises `PATCH`. Tests: `test/sessions-proxy.test.mjs`.
- Hermes profiles: `/p/<profile>/<path>` gets exactly the same allow-list as `<path>` and is forwarded with the prefix (profile name `[a-z0-9][a-z0-9_-]{0,63}`, literal in the raw path, known per `BRIDGE_PROFILES`; unknown → 404 after the token check). Bridge routes (`/bridge/*`) have no profile form. Tests: `test/profiles.test.mjs`.

## Meta (titles & follow-ups)

`src/meta.mjs` – chat titles and follow-up chips from Claude Haiku. Own auth check (Bearer `BRIDGE_TOKEN`), no message content in logs.

```
POST /bridge/meta   {messages:[{role:'user'|'assistant', content}], want:['title','followups'], lang?:'de'|'en'}
                    -> {title?, followups?, model, ms, cached?}
GET  /bridge/meta/config -> {available, model, timeoutMs}
```

- Input: only the last 4 turns are used, text only, each truncated to 1200 chars (head + tail).
- Output (clamped server side): `title` 3-6 words, no quotes/emoji; `followups` at most 3, each at most 60 chars, deduplicated, phrased as the user would type them.
- Backend: `claude-haiku-5-5` (`META_MODEL` overrides), thinking disabled, `output_config.effort: low`, structured output (JSON schema), `max_tokens: 200`, `maxRetries: 0`.
- Cache: LRU (500 entries, 1 h) keyed by hash of (turns, want, lang); a hit returns `cached: true`, `ms ~ 0`. Failures are not cached.
- Timeout `META_TIMEOUT_MS` (default 2500) -> `504 {error.code:'timeout'}`; other backend failures -> `502`. The SDK is preloaded at startup (a cold dynamic import alone cost ~1 s).
- On only with `BRIDGE_META=on` and `ANTHROPIC_API_KEY` (a key alone is not enough). Otherwise: `POST` -> `404 {error.code:'feature_off'}`; `/bridge/meta/config` -> `available:false`. Invalid body -> 400, wrong token -> 401, body > 64 KB -> 413.
- Tests: `test/meta.test.mjs` (fake Anthropic client / backend). App client: `app/src/meta/`.

## Deployment on hermes-host (NOT done – needs the user's OK)

Hermes runs as root (`hermes-gateway.service`), listens on `<tailscale-ip>:8645`. Port 8790 and https
port 8790 are free (checked 2026-10-10). The bridge has its own env file `/root/.hermes-ui-bridge/.env`
(chmod 600, already contains `ANTHROPIC_API_KEY`); never put bridge keys into `/root/.hermes/.env`
(could change Hermes' provider resolution).

1. Copy code (no build step; only dependency `@anthropic-ai/sdk`):
   ```
   cd <repo>
   rsync -a --delete --exclude node_modules bridge/ hermes-host:/opt/hermes-ui-bridge/
   rsync -a hermes-skill/bootstrap-system-message.txt hermes-host:/opt/hermes-ui-bridge/bootstrap-system-message.txt
   ssh hermes-host 'cd /opt/hermes-ui-bridge && npm ci --omit=dev || npm install --omit=dev'
   ```
   (`bridge/package-lock.json` exists, so `npm ci` should work.)
2. Env file – append (keep existing `ANTHROPIC_API_KEY`). With the user's OK, copy **only**
   `TYPESAFE_API_KEY` from the Hermes env file, without printing it:
   ```
   ssh hermes-host 'umask 077; f=/root/.hermes-ui-bridge/.env
     grep -q "^HERMES_BASE_URL=" $f || echo "HERMES_BASE_URL=http://<tailscale-ip>:8645/v1" >> $f
     grep -q "^BRIDGE_TOKEN=" $f || echo "BRIDGE_TOKEN=$(openssl rand -hex 32)" >> $f
     grep -q "^TYPESAFE_API_KEY=" $f || grep -E "^TYPESAFE_API_KEY=" /root/.hermes/.env >> $f
     cat >> $f <<EOF
   ROUTER_BACKEND=jev,claude
   ROUTER_EFFORT=low
   BRIDGE_ROUTER_THINKING=disabled
   BRIDGE_ROUTER_TIMEOUT_MS=2000
   BRIDGE_BOOTSTRAP_FILE=/opt/hermes-ui-bridge/bootstrap-system-message.txt
   EOF
     chmod 600 $f'
   ```
   Hermes' API key lives in `/root/.hermes/config.yaml` → `platforms.api_server.extra.key` (not in `.env`).
   Copy the same key from `$HUI_PRIVATE_DIR/.env.local` without echoing it:
   ```
   ssh hermes-host 'grep -q "^HERMES_API_KEY=" /root/.hermes-ui-bridge/.env' || \
     grep -E '^HERMES_API_KEY=' "$HUI_PRIVATE_DIR/.env.local" | ssh hermes-host 'umask 077; cat >> /root/.hermes-ui-bridge/.env'
   ```
   Alternative to `jev,claude`: `ROUTER_BACKEND=claude` (the lead's default) – see recommendation below.
   The app later uses the generated `BRIDGE_TOKEN` (read it once on hermes-host; do not paste it into chat logs).
3. systemd unit `/etc/systemd/system/hermes-ui-bridge.service`:
   ```ini
   [Unit]
   Description=Hermes UI+ Bridge (presentation router + SSE proxy)
   After=network-online.target tailscaled.service hermes-gateway.service
   Wants=network-online.target

   [Service]
   Type=simple
   WorkingDirectory=/opt/hermes-ui-bridge
   EnvironmentFile=/root/.hermes-ui-bridge/.env
   Environment=BRIDGE_HOST=127.0.0.1 BRIDGE_PORT=8790 NODE_ENV=production
   ExecStart=/usr/bin/node src/server.mjs
   Restart=on-failure
   RestartSec=2
   DynamicUser=yes
   NoNewPrivileges=yes
   ProtectSystem=strict
   ProtectHome=yes
   PrivateTmp=yes
   MemoryMax=256M

   [Install]
   WantedBy=multi-user.target
   ```
   (With uploads: add `StateDirectory=hermes-ui-bridge`, see "File uploads". `DynamicUser` runs it unprivileged; systemd reads the root-owned `EnvironmentFile` before dropping
   privileges, and `/opt/hermes-ui-bridge` must be world-readable. Without uploads the bridge writes nothing to disk.)
   ```
   ssh hermes-host 'systemctl daemon-reload && systemctl enable --now hermes-ui-bridge && systemctl status --no-pager hermes-ui-bridge'
   ```
   This does not touch or restart Hermes.
4. HTTPS on the tailnet (tailnet-only, like the existing serves):
   ```
   ssh hermes-host 'tailscale serve --bg --https=8790 http://127.0.0.1:8790 && tailscale serve status'
   ```
   App base URL: `https://hermes-host.example.ts.net:8790/v1`.
5. Checks: `curl -s https://hermes-host.example.ts.net:8790/health` (expects `X-Hermes-UI-Bridge: 1`);
   `curl -s -H "Authorization: Bearer $BRIDGE_TOKEN" .../bridge/status`; one tiny chat turn;
   `journalctl -u hermes-ui-bridge -f` shows `route` lines without message content.
6. Rollback: `tailscale serve --https=8790 off; systemctl disable --now hermes-ui-bridge;
   rm /etc/systemd/system/hermes-ui-bridge.service; rm -rf /opt/hermes-ui-bridge` (+ optionally the env
   file). Hermes is unaffected; the app can talk to Hermes directly (no route events).

## Recommendation

- **2026-10-16 (multilingual): switch to `ROUTER_BACKEND=heuristic,jev` when the user OKs a bridge change.** On the
  multilingual set heuristic-first with Jev reached 100 % (heuristic alone 82.3 %, Jev alone 99.0 %) while 56 % of the turns
  stay under 1 ms and the mean added latency is ~150 ms (p95 ~0.4 s); on the German holdout it equals Jev's best (96.1 %).
  Drex gives the same accuracy but ~1.5× the latency. Until then the extended heuristic alone already lifts non-German
  routing from ~50 % to ~82 % at zero cost.
- **2026-10-16 (Jev, Drex, heuristic-first): keep `heuristic` until the multilingual holdout is measured; the next
  candidate is `ROUTER_BACKEND=heuristic,jev`.** Heuristic-first with Jev matched or beat every other setup on both sets
  (96.1 % holdout, 99.1 % cases) while calling the model on only 9-18 % of the turns (mean added latency ~30-60 ms, p95 ~0.3 s);
  Jev is faster than Drex (p50 ~0.3 s vs 0.45-0.55 s), similarly priced and had no rate-limit errors. A second link
  (`heuristic,jev,claude`) only adds value as an outage fallback; the router's own heuristic fallback already covers errors.
  Drex (`nace`) stays available but is not recommended: no accuracy gain over Jev, slower, and 429s on the free tier.
- **Jev as primary, Claude Haiku as second link, heuristic last** (`ROUTER_BACKEND=jev,claude`):
  Jev matched Haiku on format accuracy here (100 % lenient on the 80-case sample) at ~5× lower latency
  (p50 247 ms vs ~1.2 s, measured from hermes-host vs. this machine – Haiku latency from hermes-host not measured).
  Haiku stays as an automatic fallback if Jev errors.
- If only Claude: `claude-haiku-5-5`, effort `low`, **thinking disabled** – best accuracy in this run and the
  lowest-latency variant; adaptive thinking gave no accuracy gain. Budget 2000 ms (p95 ~1.8 s), the
  heuristic covers overruns. Cost ≈ 2k input tokens (system prompt cached) + ~50 output per routed
  message ≈ $0.0001–0.0002.
- Other OpenAI-compatible candidates already configured in Hermes' config (names only, keys not read):
  Groq (`GROQ_API_KEY` exists; very low latency, small open models), OpenCode Go `mimo-v2.6-flash`
  (already Hermes' auxiliary model for approval/title), Concentrate `gemini-3.7-flash` /
  `deepseek-v4-flash-0731`. Runnable via `--backend openai`; not evaluated.

## Open questions
1. Primary backend: Jev-first chain (faster) vs. Claude-only (lead's earlier choice)? Both are configured by one env var.
2. SKILL.md: accept the optional `- <reason>` and bucketed confidence (proposal above)?
3. Is the `hermes.ui.route` event arriving with Hermes' headers (not before the upstream head) acceptable,
   or should the bridge write its own head immediately (would lose upstream error statuses)?
4. Budget: 2000 ms adds up to 2 s before the first token for ~60 % of messages with Claude-only
   (fast path covers the rest); with Jev ~0.3 s. Is that acceptable for the user?
5. Should the bridge also persist its per-session routing context (currently in memory; after a restart the
   first follow-up like "und jetzt als Diagramm" is routed without context)?


