# Hermes UI+ – Spec v0 (shared contract for all workstreams)

Goal: native Android + iOS chat app for the user's **Hermes Agent** (instead of Telegram)
with "Intelligent UI" style answers: text + native interactive components + sandboxed
generated HTML, streamed progressively. Reference implementation (web, MIT):
`refs/OpenIntelligentUI` (read-only; never run its scripts). Credit it when porting code.

## Architecture

```
Expo app (Android/iOS, Expo SDK 57, expo-router, TS)      app/
   │ HTTP SSE (OpenAI-compatible + extra events)
   ▼
UI Bridge (Node, on hermes-host)                                 bridge/
   ├─ UI Router: fast LLM picks presentation  → emits `hermes.ui.route`, injects hint
   ▼
Hermes Agent API server (hermes-host, <tailscale-ip>:8645/v1)      (existing, production!)
```
The app MUST also work directly against Hermes (no bridge) – it just gets no route events.
Dev without network: `mock-server/` speaks the same wire format.

**Production safety:** hermes-host runs the user's real Hermes (Telegram etc.). Reading source/config
read-only over `ssh hermes-host` is fine. Do NOT edit config, restart services, install skills or
deploy anything on hermes-host – write deploy steps into docs instead; the lead asks the user.
Secrets: `$HUI_PRIVATE_DIR/.env.local` (outside the repo, docs/BUILD.md "Flavors") (HERMES_BASE_URL, HERMES_API_KEY). Never print,
log, or commit the key. Real API calls against hermes-host: keep them few and tiny.

## Wire format (Hermes side, verify details in Hermes source on hermes-host)
- `POST /v1/chat/completions` with `stream: true` → SSE `data:` chunks (OpenAI format),
  plus named events `event: hermes.tool.progress` (tool lifecycle) and approval events.
- Headers: `Authorization: Bearer <key>`; `X-Hermes-Session-Id` (continue session, server keeps
  history → send only the new user message); `X-Hermes-Session-Key` (memory scope per channel).
  Response returns `X-Hermes-Session-Id`.
- Source of truth: `/opt/hermes/gateway/platforms/api_server*.py` on hermes-host. Documented in
  `docs/HERMES-API.md` (owned by hermes-client workstream).
- Bridge extra event: `event: hermes.ui.route` `data: RouteDecision` (sent before first token).

## Presentation protocol (model output)
The assistant writes normal Markdown. Rich UI is embedded as fenced blocks, so plain clients
(Telegram) degrade gracefully:

````
```hui
{ "type": "chart", ... }          ← one HuiNode JSON (native components)
```
```hui-html
<div>…</div><script>…</script>    ← HTML fragment, rendered in sandboxed WebView
```
````

### HuiNode (v0) — `app/src/protocol/types.ts` is the TS source of truth
Common optional fields on every node: `id?: string`.
- `card` {title?, subtitle?, imageQuery?, children: HuiNode[]}
- `stack` {direction?: 'vertical'|'horizontal', gap?: 's'|'m'|'l', children}
- `text` {text (inline markdown), variant?: 'title'|'body'|'caption'|'mono'}
- `callout` {tone: 'info'|'success'|'warning'|'danger', title?, text}
- `stats` {items: {label, value, delta?, trend?: 'up'|'down'|'flat'}[]}
- `table` {columns: string[], rows: (string|number|null)[][], caption?, source?}  (≤12 cols, ≤200 rows)
- `chart` {kind: 'bar'|'line'|'area'|'pie'|'donut', title?, unit?, xLabel?, yLabel?,
           series: {name, data: {x: string|number, y: number}[]}[]}
- `list` {style?: 'bullet'|'number'|'check', items: {title, subtitle?, trailing?, icon?, imageQuery?}[]}
- `steps` {items: {title, detail?, imageQuery?}[], current?: number}
- `timeline` {items: {time, title, detail?, imageQuery?}[]}
- `compare` {columns: {title, badge?, highlight?: boolean, items: string[] (neutral facts), pros?: string[] (check), cons?: string[] (minus), imageQuery?}[]}
- `image` {query?, lang?, source?: 'web', url?, alt?, caption?, aspect?: number}  (`query` or `url` required; `url` wins)
- `gallery` {items: {query?, url?, caption?}[] (2–6, each needs query or url), aspect?: number (default 4/3), lang?}
- `progress` {label, value, max?}
- `code` {language?, code}
- `buttons` {items: {label, action: HuiAction, style?: 'primary'|'secondary'}[]}
- `suggestions` {items: string[]}   (tap → send as user message)
- `form` {id, title?, fields: HuiField[], submit: {label}}
  HuiField {name, label, kind: 'text'|'number'|'slider'|'select'|'toggle'|'date',
            placeholder?, min?, max?, step?, unit?, options?: string[], default?}
Unknown `type` → render a neutral fallback card showing the JSON (never crash).

### Protocol v2 (modules) – validation contract (`app/src/protocol/`)
Node shapes: docs/SPEC-modules-v2.md; TS types: `types.ts` (`HuiChoice`, `HuiChecklist`/`HuiChecklistItem`,
`HuiCalc`/`HuiCalcInput`/`HuiCalcOutput`/`HuiCalcChart`, `HuiMap`/`HuiMapMarker`, `HuiRecipe`/
`HuiRecipeIngredient`/`HuiRecipeStep`, `HuiTabs`/`HuiTab`, `HuiAccordion`, `HuiQuiz`/`HuiQuizQuestion`,
`HuiFlashcards`, `HuiSources`/`HuiSource`, `HuiTimer`, `HuiSlots`/`HuiSlot`, `HuiConfirm`, `HuiBasis`,
one interface per action). `normalizeNode()` (also applied to partial JSON while streaming) coerces and caps –
it never throws and never rejects a node for a missing field except where noted; excess is dropped silently.
- **Caps**: choice options 12 · checklist items 200 · calc inputs 12 / outputs 12 / select options 30 · expr
  (output + chart.y) 500 chars · map markers 30 · recipe ingredients 60 / steps 40 / tips 10 · tabs 6 ·
  accordion items 20 · quiz questions 30 / options 10 · flashcards 100 · slots 20 · sources 12 ·
  add_to_list items 50 · ask.include 8. Strings are control-char-stripped and length-capped (labels 100–300).
- **Dropped items** (not errors): choice/checklist items without label/text; calc inputs with an invalid or
  duplicate `name` (`[A-Za-z_][A-Za-z0-9_]*`, ≤ 40, not `__proto__`/`constructor`/… / leading `__`);
  calc outputs whose `expr` is not a string or is > 500 chars (never truncated); calc chart without a complete
  `sweep` (`steps` clamped 2..200) or with `y` > 500; map markers with lat ∉ [-90,90] / lng ∉ [-180,180] /
  non-numeric (numeric strings and "41,9" are accepted); recipe ingredients without `item`; quiz questions
  without ≥ 2 usable options or whose `answer` is missing/out of range (`answer`: index, numeric string, letter
  A–J, or array → sorted unique; single-element arrays become a number); sources whose `url` is not an absolute
  http(s) URL with a dotted host and no credentials; slots whose `start` is not a valid ISO 8601 date/time
  (calendar-validated; `end` before `start` is dropped, not the slot).
- **Defaults**: calc input `kind` 'number', `default` = clamped `min ?? 0` (toggle false, select first option);
  recipe `servings` 4 if missing/invalid, free-text ingredient quantities ("eine Prise", "2-3") move into `unit`
  (`qty` is numeric only; "1/2", "1 1/2", "½", "1,5" are parsed); timer `seconds` 0 if unknown (0..86400);
  tab label `Tab n`; accordion title `Abschnitt n`; sources title = host.
- **Provenance**: `basis` ('user'|'sourced'|'calculated'|'estimate'|'illustrative'; anything else dropped) and
  `source` (≤ 300) on table (`source` as before), chart, stats, compare, calc, map.
- **Actions** (`normalizeAction`; invalid → null, the button is dropped): `open_url` http(s) only (no
  `javascript:`/`data:`/`file:`/`intent:`/credentials); `calendar` title + valid ISO `start` (end/allDay/location/notes
  optional); `reminder` title + ISO `at`; `maps` query or valid lat+lng (+ mode driving|walking|transit); `call`/`sms`
  phone cleaned to `+?\d{3,15}`; `email` 1–5 syntactically valid addresses (newlines/header injection impossible),
  subject single line ≤ 200, body ≤ 4000; `timer` integer 1..86400; `add_to_list` 1–50 non-empty strings;
  `ask` text ≤ 2000 + `include` ids. All device actions go through the confirm sheet in the app.
- **Interactive nodes** (`INTERACTIVE_NODE_TYPES`: form, choice, checklist, calc, recipe, quiz, flashcards, timer,
  slots, confirm) always have a string `id` after normalization. Explicit `id` (trimmed, ≤ 100) wins; otherwise the
  deterministic **fallback id** is `<type>-<path>`, where `<path>` = the stream segment key (`seg-3`) plus the
  dot-joined ORIGINAL array indexes down the tree (`card.children[2]` → `.2`; `tabs.tabs[1].children[0]` or
  `accordion.items[1].children[0]` → `.1.0`), e.g. `choice-seg-3`, `quiz-seg-3.1.0`. Without the parser
  (`normalizeNode(x)`) the path root is `n`. Indexes refer to the model's array positions (before dropping invalid
  entries) so they do not shift while a block streams. Duplicate ids within a message (also across segments) get
  `-2`, `-3` … in document order. Sub-item ids (choice option `o<i>`, checklist item `i<i>`, slot `s<i>`) are always
  filled the same way (explicit id if unique). While a block is still streaming, an explicit `id` may be partial –
  persist node state only for completed blocks (`Segment.complete`).
- Unknown node types still pass through unchanged (fallback card).

### Images by query (`app/src/images/`)
The model must never invent image URLs. Instead it names the subject: `image.query`,
`gallery.items[].query`, or `imageQuery` (thumbnail on card / list / steps / timeline items,
photo on compare columns). Query = Wikipedia article title in the user's language
("Kolosseum", "Trevi-Brunnen", "Pixel 10"); `lang` defaults to `de`. `url` is only for URLs
that came from a tool/source.
The app resolves queries (`resolveImage(query, lang)` / `useResolvedImage`) with keyless
Wikimedia APIs: batched exact-title lookup (`{lang}.wikipedia` `titles=A|B&redirects=1`,
`prop=pageimages`) → per-query Wikipedia search → `en.wikipedia` titles → Commons file search
(`filetype:bitmap`); author/license via `prop=imageinfo&extmetadata`. Only raster photos
(jpg/png/webp), no logos/maps/flags/diagrams unless the query asks for one. Header
`Api-User-Agent: HermesUI/0.1 (personal app)` (+ `User-Agent` on native). Concurrency 3,
4 s timeout per request, de-dup, LRU cache (memory + AsyncStorage, 300 entries, 7 days; misses
1 day; errors not cached), 429/503 → pause for Retry-After. Rendering: shimmer → fade-in photo,
credit line "Foto: Autor · Lizenz · Wikimedia" (tap → file page), fullscreen on tap; not found →
omitted (thumbnails: subtle placeholder). While a block streams, a query is only resolved once
it is complete (block finished, or a later sibling/item exists).

**Web image search (second source).** `image`, `gallery` and `gallery.items[]` accept an optional
`source: 'web'` (any other value is dropped by the validator): the app asks the UI bridge
(`GET /bridge/images`, see ROUTER.md "Image search") first and falls back to Wikimedia. Without
`source`, Wikimedia stays first and the web search is only used when Wikimedia finds nothing
(also for `imageQuery` thumbnails). It uses the user's Hermes bridge profile (the active one if it
is a bridge, else the first bridge profile) even when the chat runs on another backend.
Settings → Media → "Image search" → "Via UI bridge (recommended)" (default); the image loading policy
(Always / Wi-Fi only / Never) applies. Bridge 404/401/503 pauses web search for 10 min. Cache: memory, 300
entries, 24 h (misses 1 h). Credit line: "Image: example.com" linking to the source page.
Use `source: 'web'` for products, games, screenshots, current events; Wikipedia titles for places/animals/people.

### HuiAction
- `{type:'send', text}` → send as new user message
- `{type:'submit'}` (forms) → app sends user message `[form:<id>] <compact JSON of values>`
- `{type:'open_url', url}` (http/https only) · `{type:'copy', text}`
- v2 actions (`calendar`, `reminder`, `maps`, `call`, `email`, `sms`, `timer`, `add_to_list`, `ask`): see docs/SPEC-modules-v2.md and the validation contract above ("Protocol v2").

### hui-html sandbox
- Rendered in `react-native-webview`, isolated: no access to app storage, network only to an
  allow-list of CDNs (e.g. cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com), no navigation.
- Injected API: `window.hermes.send(text)`, `window.hermes.copy(text)`, `window.hermes.openUrl(url)`;
  auto-height via ResizeObserver → postMessage.
- Injected CSS variables from the app theme (`--h-bg, --h-surface, --h-text, --h-muted,
  --h-accent, --h-border, --h-radius, --h-font`) + light/dark.
- Progressive rendering while streaming (port the idea of `process-partial-html.ts` +
  idiomorph from refs/OpenIntelligentUI); scripts execute only once the block is complete.

## UI Router (bridge)
`RouteDecision` = `{ format: RouteFormat, component?: string, confidence: number, reason: string, model: string, ms: number }`
`RouteFormat` = `'text' | 'table' | 'chart' | 'stats' | 'compare' | 'steps' | 'timeline' | 'form'
               | 'diagram' | 'calculator' | 'map' | 'interactive' | 'image'`
Mapping: table/chart/stats/compare/steps/timeline/form → native `hui`; diagram/calculator/map/
interactive → `hui-html`; text → plain markdown. Decision model is configurable (any
OpenAI-compatible endpoint), strict JSON output, timeout ≈1.5 s → fallback `text`-neutral (no hint).

## App module boundaries (each workstream owns its folder; don't edit others' files)
| Path | Owner | Exports |
|---|---|---|
| `app/src/protocol/` | protocol | types (`HuiNode`, `HuiAction`, `Segment`, `RouteDecision`), `createStreamParser()`, `parseMessage()` |
| `app/src/ui/` | design | `theme`/`useTheme()`, `<HuiView node onAction streaming/>`, primitives |
| `app/src/sandbox/` | sandbox | `<HtmlBlock html complete onAction/>` |
| `app/src/hermes/` | hermes-client | `streamChat()`, `useHermesChat()`, types `ChatMessage`, `ToolEvent` |
| `app/src/app/`, `app/src/chat/`, `app/src/settings/` | chat-shell | screens, message list, composer, settings |
| `mock-server/` | hermes-client | zero-dep Node mock of Hermes API |
| `bridge/` | router | UI Bridge + router + eval set |
| `hermes-skill/` | skill | Hermes SKILL.md teaching the protocol |
| `scripts/` | build | APK, web, iOS and desktop build scripts, checks, leak guards |

Segment (parser output, stable `key` per position):
```ts
type Segment =
  | { key: string; kind: 'markdown'; text: string }
  | { key: string; kind: 'hui'; complete: boolean; raw: string; node: HuiNode | null; error?: string }
  | { key: string; kind: 'html'; complete: boolean; html: string };
```
`node` is a best-effort parse of partial JSON while streaming (repair unclosed strings/brackets).

ChatMessage (hermes-client; may add fields, never remove):
```ts
type ToolEvent = { id: string; name: string; label: string; status: 'running'|'done'|'error'; startedAt: number; endedAt?: number };
type ChatMessage = { id: string; role: 'user'|'assistant'; text: string; tools: ToolEvent[];
  route?: RouteDecision; status: 'streaming'|'done'|'error'|'stopped'; error?: string; createdAt: number };
useHermesChat(conn: { baseUrl: string; apiKey: string; model?: string; sessionKey?: string })
  → { messages, send(text), stop(), retry(), newSession(), status: 'idle'|'streaming'|'error', sessionId }
```

## Conventions
- TypeScript strict, function components, no class components. Relative imports.
- Deps are pre-installed (see app/package.json). Do NOT run npm/expo install yourself; if you
  truly need a package, write it to `docs/DEPS-REQUESTS.md` with a reason and mention it in your report.
- Pure logic gets tests: `app/src/**/*.test.ts`, run with `node --test` (Node 22 type stripping;
  no TS-only syntax like enums/namespaces in tested files, use `import type`).
- Check: `cd app && npx tsc --noEmit`. Visual check: `npx expo start --web` (react-native-web).
- Don't git commit; the lead commits.
- Expo SDK 57: read app/AGENTS.md; check docs.expo.dev for current APIs, don't trust memory.
