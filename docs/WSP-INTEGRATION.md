# Web Search Plus (WSP) integration: design summary

Status: research and design only, nothing implemented. Audience: app/bridge developers and the maintainers of WSP.
WSP is a third-party-style Hermes plugin ("Web Search Plus": multi-provider web search and page extraction). Checked against WSP 5.0.1 (the 5.1 credentials rework was still in progress and is described only where it matters).

## Principle: strictly optional, progressive enhancement

- The app and the bridge work fully **without** WSP. Generic `web_search` / `web_extract`, other search plugins and the bridge's own Serper/Brave keys stay the default path.
- When WSP is detected (tool names in the stream, the shape of a tool result, a bridge capability probe) nicer features light up. Detection is by output shape first, tool name only picks the icon. Nothing may require WSP.
- Everything is built on a neutral, documented contract ("Web Source Contract v1", below) that any search plugin can implement. WSP is the first implementation, not a dependency.

## What WSP offers

- **Tools (Hermes plugin):** `web_search_plus` (query, provider, count, freshness, news vertical, domain filters, country/language, `mode=research`, quality report, cache control) and `web_extract_plus` (urls, provider, markdown/html, JS rendering, spans). There is no images tool; research is a mode of search (one blocking call, up to 75 s, no progress events). A separate MCP package exposes the same engine as `web_search` / `web_extract` (Hermes names: `mcp__web_search_plus__web_search`, `..._web_extract`) and returns JSON. An opt-in native backend can also route Hermes' own `web_search` through WSP; then the tool names are generic.
- **Providers:** 15 search providers (Serper, Brave, Tavily, Exa, Linkup, Firecrawl, You.com, Parallel, Keenable, SearXNG, Querit, SerpBase, TinyFish, Octen, a local DonSeTch sidecar) and 9 extraction providers. Automatic routing by query type (Brave general/news/local, Exa docs/academic, Serper security/shopping), fast fallback to the next provider after at most about 2.5 s, response cache, language detection, spam and duplicate filtering. Some providers are explicit-only.
- **Result format (plugin):** plain text for the model: a `[Provider: ... | cached ...]` header, then `N. title [published ...]`, a URL line and a snippet line per result; errors as `Search error: ...`; an untrusted-data notice on top. Dates are relative text, there is no result count or timing. The MCP variant returns JSON (`provider`, `results[{title,url,snippet}]`, routing receipt, provider attempts, cache status).
- **No citations from WSP:** it is source-only. The model writes `[n]` markers and a closing list; the app already parses that (`citations.ts`).
- **Configuration:** behaviour in a plugin `config.json` (routing, priority, disabled providers, locale, max results) and in the Hermes Desktop plugin settings. Keys: up to 5.0.1 from `.env` files; **5.1 (unreleased)** reads them only through Hermes' profile-scoped secret store, the plugin no longer loads `.env`, setup only prints `hermes config set` commands, and the standalone CLI needs the variables exported.
- **Outside Hermes:** a CLI (`search.py --query ... --compact`, JSON on stdout), the MCP stdio server, and a separate thin REST wrapper (`POST /v1/search`, `POST /v1/extract`, `GET /health`). No HTTP route inside the Hermes plugin API.

## Current gaps in the app

- `hermesTools.ts` knows `web_search`, `web_extract` and `mcp_*` WSP names, but **not** the plugin names `web_search_plus` / `web_extract_plus`, so they currently render with the generic tool look.
- Plugin results are text and are not parsed; only JSON results (MCP) feed `toolOutput()`.
- The live stream's `completed` frame carries no result, so provider/count/cached are available only after the turn (elapsed time is available live).

## Web Source Contract v1 (neutral)

1. **Level 0, nothing required:** any tool, any text. Closing citation list in the answer, generic chip.
2. **Level 1, parseable tool result:** either JSON `{provider?, query?, cached?, elapsed_ms?, results:[{title, url, snippet?, published_at?, site?}]}` or the text layout above (`[Provider: <id> | ...]`, `N. title [published X]`, URL line, snippet line). The app parses by shape.
3. **Level 2, optional extras:** a one-line trailer or JSON keys `provider, results, cached, elapsed_ms`; a capability probe for the bridge.

Sources shown in the answer are **derived by the app from tool results** (zero extra tokens, joined with the model's `[n]` list by canonical URL), not emitted by the search plugin. Items the model cites that no tool retrieved are marked as such. The existing `sources` node stays something the model may emit itself. Snippets and titles are untrusted data: plain text only, http(s) links only, the plugin's security notice line is hidden in the UI.

**Bridge search endpoint (neutral):** `POST <configured url>` with `{query, max_results, type: web|news|images, language, country}` returns `{results:[{title,url,snippet,published_at?,site?,image?}], provider?}` with an optional bearer token. Capability probe `GET /bridge/web/config` (modelled on `/bridge/images/config`) returns `{available, backends, providers, types}`. Backends: `builtin` (own Serper/Brave keys, default), `rest` (any server implementing the contract, WSP's REST wrapper is one), optional `cli`.

## Integration ideas

| Idea | Value | Effort | Needs WSP change |
|---|---|---|---|
| Add the plugin tool names to the tool table (icon, "Websuche"/"Seite lesen") | medium | XS | no |
| Rich tool chips: provider badge, query, result count, cached, latency (latency from start/end times, rest from the parsed result) | high | S | no (optional header keys make it exact) |
| Sources derived from tool results; enrich the model's list (snippet, date, favicon); mark "cited but not retrieved"; fixes per-call numbering ambiguity | high | S-M | no (ISO dates would help) |
| Live research card (searching, sources found, reading, writing) from generic tool events; WSP research mode is one blocking call, so the card shows elapsed time and a post-turn summary | high | M | no; live counts need a Hermes stream change |
| Quick-question web option (globe) via the bridge `webSearch` module: `builtin` default, `rest`/`cli` optional, top results as untrusted context, derived sources, query-leaves-the-bridge notice | high | M | no; CLI route under WSP 5.1 needs keys exported into the bridge process, so prefer `builtin`/`rest` |
| Image search via WSP | low | M | yes (no images tool; raw URLs only); keep the bridge's own providers |
| Link preview cards from extract results inside a turn; standalone previews through a small bridge fetch, not through extract | medium | S / M | no |
| Per-chat "web search off/on" for Hermes turns | medium | S soft / L hard | not WSP: soft = system hint plus notice; hard needs a Hermes per-request toolset switch |
| Capability line "Web search: WSP detected (providers ...)" | low-medium | S | optional status JSON |

Suggested order: tool table, parser and chips, derived sources, bridge `builtin` search plus probe, research card, soft per-chat switch, link previews, `rest`/`cli` adapters, images last.

## Requests to WSP (all optional, the app works without them)

1. Freeze the tool names and parameter names (`web_search_plus`, `web_extract_plus`, and the MCP `web_search`, `web_extract`); keep an alias for one minor version after any rename.
2. Freeze the text layout of search and extract results and cover it with the golden tests; the app will ship fixtures so a layout change fails a test instead of silently breaking the UI.
3. Add machine-readable keys to the header line and JSON: `results=N`, `elapsed_ms=N`, `fallback_from=<provider>`.
4. Emit absolute ISO dates (`[published 2026-10-09]` or `published_at`) in addition to relative text.
5. Keep structured sources available outside the model's context (JSON over MCP or a host-readable sidecar). The app does not ask WSP to emit UI nodes; WSP stays source-only.
6. A stable standalone entry point: document the CLI JSON as a versioned schema, keep the REST wrapper in step with the plugin engine, and add a secret-free `status --json` capability output (version, tools, providers configured/auto).
7. Document how a sidecar, CLI or REST process obtains keys under the 5.1 credential model (no `.env` loading), and keep status output free of key material.
8. Low priority: structured image results (`image_url, thumbnail_url, width, height, source_page, title`) if images ever join the tool or REST surface; a one-line research summary (providers used, pages read, elapsed time, skip reasons).
9. Keep the native-backend output identical to the plugin layout, since shape is the only detection signal there.

## Not verified

- Which of the plugin tools and the MCP tools are exposed to the model together on a given deployment (the parser handles both).
- A hard per-request tool switch in Hermes (not available in the version checked for the quick-question design).
- The image result shape of the CLI/REST path (read in code only). No searches were run.
