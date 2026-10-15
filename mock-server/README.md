# Hermes mock server

Zero-dependency Node mock of the Hermes Agent API server (`docs/HERMES-API.md`), same SSE framing as
the real one (captured in `fixtures/`). For offline dev, the web preview and tests.

```bash
node mock-server/server.mjs            # http://localhost:8787/v1
node mock-server/server.mjs --route    # also emits `event: hermes.ui.route` before the first token (bridge behaviour)
node mock-server/server.mjs --port 9000 --host 127.0.0.1 --fast   # --fast: no delays (tests)
node mock-server/server.mjs --route --slow-ms 90   # fixed per-token delay for `langsam`/`slow` (streaming/skeleton checks)
node mock-server/server.mjs --profiles research,work   # Hermes profiles (bots) under /p/<name>/ (default: research)
```

App connection: base URL `http://localhost:8787/v1` (Android emulator: `http://10.0.2.2:8787/v1`),
API key anything except `bad` (-> `401 gateway_auth_failed`, like Hermes).

Endpoints: `GET /health`, `GET /v1/models`, `POST /v1/chat/completions` (stream and non-stream),
`POST /v1/runs/{id}/approval`. CORS is open (more permissive than real Hermes, which has no CORS
configured and blocks browsers). `X-Hermes-Session-Id` / `-Key` are echoed; the plain scenario reports
the per-session turn count so session continuation is visible.

## Scenarios (chosen by keywords in the last user message, case-insensitive)

| Keyword(s) | Scenario | Route format (`--route`) |
|---|---|---|
| (none) | plain Markdown answer, lists the keywords | text |
| `chart`, `diagramm`, `verlauf` | line + bar charts in `hui` blocks | chart |
| `tabelle`, `table` | table | table |
| `kennzahl`, `stats`, `kpi` | stats + callout + progress | stats |
| `vergleich`, `compare` | compare | compare |
| `formular`, `form` | form with all field kinds (reply to `[form:id] {...}` echoes the values) | form |
| `schritt`, `steps`, `anleitung` | steps | steps |
| `timeline`, `zeitleiste`, `ablauf` | timeline | timeline |
| `button`, `vorschl`, `suggest` | buttons + suggestions | text |
| `flugzeug oder bahn`, `reise … bahn/zug/flug` | `choice` node ("Was ist dir wichtig?"); the tap reply `[choice:reise-modus] …` answers with 3 tools + compare (repro of the Hermes plural crash) | choice → compare |
| `kredit`, `darlehen`, `loan` | `hui-html` loan-rate calculator like Claude writes it (style, sliders, SVG, table, script); wins over `rechner` | calculator |
| `rechner`, `calculator` | `hui-html` calculator | calculator |
| `einkauf`, `checkliste`, `shopping` | real answer of `hermes-skill/examples/14-checklist-shopping.md` (one-line JSON) | checklist |
| `rezept`, `recipe` | real answer of example 19 (recipe + buttons) | recipe |
| `quiz` | real answer of example 20 | quiz |
| `auswahl`, `choice`, `entscheid` | real answer of example 13 (choice) | choice |
| `gemischt`, `mixed`, `bericht` | long mixed answer (tool, stats, chart, table, hui-html simulator, suggestions) | interactive |
| `lang`, `long` | very long Markdown (scroll/perf) | text |
| `tool`, `uhr`, `zeit`, `datum`, `spät` | text + `hermes.tool.progress` (terminal `date`) + reasoning | text |
| `tools`, `parallel`, `recherch` | two tools, `hermes.status` line, silence | text |
| `fehler`, `error`, `crash` | text, tool, then final chunk `finish_reason:"error"` + `hermes{}` | text |
| `abbruch`, `drop` | connection destroyed mid-sentence | text |
| `freigabe`, `approval`, `genehmig` | `approval.request`, blocks until the client POSTs `/v1/runs/{id}/approval` (`once|session|always|deny`) | text |
| add `langsam` / `slow` | slow token rate (220-420 ms/token); alone it streams the long answer | |

Token chunking is word/sub-word sized with 12-38 ms jitter; `: keepalive` comments every 10 s of silence.
Client disconnect is logged (`client disconnected`) and stops the scenario.

`app/src/hermes/mock.integration.test.ts` starts this server on a free port and exercises all scenarios.
