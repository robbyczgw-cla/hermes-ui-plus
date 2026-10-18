# Web Search Plus (WSP) integration: design summary

Status: tool table, result parser, chips, derived sources and the web result card are implemented (see "State in the
app"); the rest is design. Audience: app/bridge developers and the maintainers of WSP.
WSP is a third-party-style Hermes plugin ("Web Search Plus": multi-provider web search and page extraction). Checked
against real WSP 5.1.1 output (2026-10-17, throwaway Hermes v0.22.0 test instance, keyless Keenable tier, plugin from
the public v5.1.1 tag); the 5.0.1 shapes are still parsed. WSP 5.1.2 was checked live on 2026-10-18 (same kind of
instance, plugin from the public 5.1.2 release commit, keyless Keenable): the header bits, the indented snippet lines and
the extract `not tried` slots look exactly as documented, the parser needed no change, and the 5.1.2 fixtures are now
anonymized live captures (only the two-provider fallback chain and `results=0` are still built from the docs).

## Principle: strictly optional, progressive enhancement

- The app and the bridge work fully **without** WSP. Generic `web_search` / `web_extract`, other search plugins and the bridge's own Serper/Brave keys stay the default path.
- When WSP is detected (tool names in the stream, the shape of a tool result, a bridge capability probe) nicer features light up. Detection is by output shape first, tool name only picks the icon. Nothing may require WSP.
- Everything is built on a neutral, documented contract ("Web Source Contract v1", below) that any search plugin can implement. WSP is the first implementation, not a dependency.

## What WSP offers

- **Tools (Hermes plugin):** `web_search_plus` (query, provider, count, freshness, news vertical, domain filters, country/language, `mode=research`, quality report, cache control) and `web_extract_plus` (urls, provider, markdown/html, JS rendering, spans). There is no images tool; research is a mode of search (one blocking call, up to 75 s, no progress events). A separate MCP package exposes the same engine as `web_search` / `web_extract` (Hermes names: `mcp__web_search_plus__web_search`, `..._web_extract`) and returns JSON. An opt-in native backend can also route Hermes' own `web_search` through WSP; then the tool names are generic.
- **Providers:** 15 search providers (Serper, Brave, Tavily, Exa, Linkup, Firecrawl, You.com, Parallel, Keenable, SearXNG, Querit, SerpBase, TinyFish, Octen, a local DonSeTch sidecar) and 9 extraction providers. Automatic routing by query type (Brave general/news/local, Exa docs/academic, Serper security/shopping), fast fallback to the next provider after at most about 2.5 s, response cache, language detection, spam and duplicate filtering. Some providers are explicit-only.
- **Result format (plugin, 5.1.1):** plain text for the model. Line 1 is always an untrusted-data notice
  (`[Security notice: …]`), then a header `[Provider: keenable | auto-routed | low confidence | intent_general]`
  (`auto-routed`, `<level> confidence` and the routing reason id only when auto-routed; a cache hit reads just
  `[Provider: keenable | cached 7s ago]`, plus `| recency query` for cached recency queries), an optional
  `[Freshness: week | applied]` / `applied by: a | not supported: b` line, then per result `N. title [published
  2026-09-14]` (ISO date, UTC, omitted when unknown), the URL and the snippet, each indented by three spaces, and a blank
  line. Snippets up to 1200 characters keep their own line breaks (continuation lines are NOT indented); longer ones are
  flattened and end in `… [TRUNCATED: showing first N of M characters]`. 5.1.1 has no result count, no timing, and a
  fallback is invisible in the text (the header names only the provider that served).
  - **5.1.2 header** (layout frozen by a golden test on WSP's side): after the human bits come machine-readable
    `key=value` bits, order `… | results=N | elapsed_ms=N | fallback_from=a,b`; clients must ignore bits they do not know.
    `results` counts the results in this output (also `0` for a search that found nothing), `elapsed_ms` is the wall time
    of the call (for a cache hit the lookup), `fallback_from` lists the providers that failed or came back empty before
    the serving one, in order (cancelled hedges left out, absent without a fallback). Research adds `providers=a,b,c`
    (merged) and `pages=N` before `results`. A cache hit repeats how the cached search was routed
    (`[Provider: serper | cached 7s ago | auto-routed | low confidence | intent_general | results=1 | elapsed_ms=3]`);
    entries cached before 5.1.2 show no routing. Every snippet line is indented by three spaces and empty lines inside a
    snippet are dropped, so page text can no longer pose as the next numbered result.
    Extract (5.1.2): URLs the batch did not reach (limit of 10 URLs per call, provider rate limit, out of credits,
    authentication failed) keep their slot as `Error: not tried: <cause>` instead of vanishing; HUI+ shows them as
    failed pages with that cause. Seen live: `5. No title` / URL / `Error: not tried: limit of 4 URLs per call reached`
    (operator limit `bounded_context.max_urls: 4`). A long page ends in WSP's truncation footer (`[Content truncated: …]`,
    `Full cleaned text stored at: <path>`, a `read_file(…)` hint for the model); it never reaches the card's snippet.
  - **Research mode:** header `[Provider: research | …]`, `Quality: …` lines, an `Extracted source summaries:` block of
    `N. <url>` + one passage line, then the result list numbered from 1 again.
  - **Extract:** notice, `[Provider: x]` without routing bits, then per page a blank line, `N. title`, the URL and the
    page text (both NOT indented) or `Error: <message>` (e.g. `API error (HTTP 404)`, `Rate limit exceeded. … (HTTP
    429)`). Exactly one slot per requested URL in request order. The URL shown is the one the PROVIDER reported: a
    `?ref=1` request can show the canonical page, so two requests may show the same URL; the requested spelling is not in
    the text.
  - **Errors:** no notice and no header: `Search error: <message>` followed by up to six `- provider: reason` lines;
    providers that were not tried are absent. Whole-call extract failures read `Extract error: <message>`.
  - **MCP:** web-search-plus-mcp 5.0.1 bundles its own engine (it cannot run on the 5.1.1 engine) and returns a
    contract v3 response plus `provider`, `query` and flattened `results[{title,url,snippet}]`: `routing_receipt
    {candidate_order, selected_provider, fallback_reason, candidate_decisions}`, `provider_attempts[{provider, outcome,
    duration_ms, result_count, error}]`, `cache_status {disposition, age_seconds}`. The 5.1.1 engine's own v3 results
    carry `url {observed, canonical}` and `title/snippet {text, …}`.
  - **Native backend** (`web.search_backend: wsp`, Hermes 0.22): Hermes' own `web_search` returns `{success,
    data:{web:[{url,title,description,position}]}, metadata:{backend:"wsp", provider}}` (no dates, no routing);
    `web_extract` returns `{results:[{url,title,content,error}]}` with the REQUESTED URL and a generic error text.
  - **Stored calls on Hermes 0.22:** with lazy tool discovery the model calls `tool_search` → `tool_describe` →
    `tool_call`; the stored call is `tool_call` with `{calls:[{name:"web_search_plus", arguments:{…}}]}` and the result
    row carries `tool_name: "web_search_plus"` and the plain text above.
- **No citations from WSP:** it is source-only. The model writes `[n]` markers and a closing list; the app already parses that (`citations.ts`).
- **Configuration:** behaviour in a plugin `config.json` (routing, priority, disabled providers, locale, max results) and in the Hermes Desktop plugin settings. Keys: up to 5.0.1 from `.env` files; **5.1 (unreleased)** reads them only through Hermes' profile-scoped secret store, the plugin no longer loads `.env`, setup only prints `hermes config set` commands, and the standalone CLI needs the variables exported.
- **Outside Hermes:** a CLI (`search.py --query ... --compact`, JSON on stdout), the MCP stdio server, and a separate thin REST wrapper (`POST /v1/search`, `POST /v1/extract`, `GET /health`). No HTTP route inside the Hermes plugin API.

## State in the app

Implemented (app, pure modules with tests; fixtures in `app/src/hermes/webResults.fixtures.ts` are the real 5.1.1
layouts with example data, and the 5.1.2 layouts as anonymized live captures: WSP's own lines verbatim, hosts mapped to
example.*, every other word replaced by a neutral word of the same length):

- **Tool table** (`chat/hermesTools.ts`): `web_search_plus`, `web_extract_plus`, the MCP names and the generic
  `web_search` / `web_extract`; `tool_search` / `tool_describe` get a quiet "looked up a tool" row, and a single
  `tool_call` wrapper is unwrapped to the tool it ran (`hermes/sessions.ts`), so chips and the card see the real name and
  arguments.
- **Parser** (`hermes/webResults.ts`): plugin text, MCP / v3 JSON, Hermes JSON (native backend included). Header bits
  (auto-routed, confidence, query type, cache age, recency), freshness line, research pages, per-page `Error:` slots,
  provider errors, MCP attempts, multi-line snippets, markdown stripped from snippets. Extract pages are kept per slot.
  **5.1.2 header bits:** `key=value` bits are parsed generically (`results` → `reportedCount`, `elapsed_ms` →
  `elapsedMs`, `fallback_from` → `fallbackFrom`, research `providers` / `pages`); the tool's own numbers win over what the
  parser counted (chip and card use `results=N`, the card uses `elapsed_ms` before the gap between the stored rows, and
  research `pages=N` before the counted summaries). Unknown keys are kept in `extras` and never shown, unknown plain
  bits, malformed values and a repeated key (the first wins) are ignored, provider lists keep identifier words only.
  When a header carries such bits the layout is the frozen one: items start in column 0 and an indented numbered line
  is snippet text. A cache hit's repeated routing needs no special case (the bits parse the same in any position).
  Output without the bits (5.0.x, 5.1.1, other plugins) parses exactly as before.
- **Chips**: "Keenable · 5 results · cached" after the turn; a finished web chip opens the card.
- **Derived sources** (`chat/answers/webSources.ts`): the answer's `[n]` list joined with the retrieved hits by canonical
  URL (snippets filled in, "cited but not retrieved" marked). A page whose extract failed is not "retrieved"; the
  requested spelling and the provider's URL both count for a page that loaded (slot pairing, 5.1 keeps request order).
- **Web result card** (`chat/webCard.ts`, `chat/WebResultCard.tsx`): query, provider and how it was chosen (auto /
  explicit, confidence), query type, fallback chain ("Serper → Brave → Exa": the `fallback_from` providers, then the serving one; MCP / v3 JSON
  shows the richer attempts with outcome and time instead), duration (the tool's `elapsed_ms` when it gave one), cache
  age or "fetched live", freshness filter and newest result date, research summary (pages read, results, duration,
  providers used), the result list with
  favicon, domain, date and the answer's citation number, failed pages with their reason. Only facts the output really
  carried are shown; a generic `web_search` gives query + results, a tool without a parsed result keeps the plain detail
  view. Titles and snippets stay plain text, links http(s) only, the security notice is hidden (also in the raw view).
- **Favicons** (`images/favicon.ts`): through the bridge image proxy when it has one (the bridge accepts ICO for this),
  directly only for trusted hosts or "Always load", else a letter avatar; nothing when images are off. Checked on a paired web run
  against a test bridge (2026-10-18): classic ICO and PNG-in-ICO `favicon.ico` files come back as `image/x-icon` and show;
  the letter stays while an icon is still loading.
- **Offline demo**: "Research jet lag tips …" replays a WSP search and extract with fictional results and a cited answer.
- **Card during the turn** (`hermes/toolDetails.ts` `wantsLiveDetails`, `useHermesChat`): the live `completed` frame
  carries no result, but Hermes 0.22 stores each tool row as soon as the tool returns (seen live: about half a second
  after the frame, the stored call id equals the frame's `toolCallId`, the frame names the inner tool even when the
  stored call is the `tool_call` wrapper). So a finished web tool triggers one fetch of the stored rows right away (one
  job at a time; a web tool finishing meanwhile re-runs it once); chip and card get provider, hits and facts while the
  model is still writing. Other tools still wait for the end of the turn.
- **Extract snippets:** when a page starts with its own `# Title`, the title again or a stub ("TL;DR"), the snippet is the
  page's first real paragraph (never text of the next page).

## Web Source Contract v1 (neutral)

1. **Level 0, nothing required:** any tool, any text. Closing citation list in the answer, generic chip.
2. **Level 1, parseable tool result:** either JSON `{provider?, query?, cached?, elapsed_ms?, results:[{title, url, snippet?, published_at?, site?}]}` or the text layout above (`[Provider: <id> | ...]`, `N. title [published X]`, URL line, snippet line). The app parses by shape.
3. **Level 2, optional extras:** a one-line trailer or JSON keys `provider, results, cached, elapsed_ms`; a capability probe for the bridge.

Sources shown in the answer are **derived by the app from tool results** (zero extra tokens, joined with the model's `[n]` list by canonical URL), not emitted by the search plugin. Items the model cites that no tool retrieved are marked as such. The existing `sources` node stays something the model may emit itself. Snippets and titles are untrusted data: plain text only, http(s) links only, the plugin's security notice line is hidden in the UI.

**Bridge search endpoint (neutral):** `POST <configured url>` with `{query, max_results, type: web|news|images, language, country}` returns `{results:[{title,url,snippet,published_at?,site?,image?}], provider?}` with an optional bearer token. Capability probe `GET /bridge/web/config` (modelled on `/bridge/images/config`) returns `{available, backends, providers, types}`. Backends: `builtin` (own Serper/Brave keys, default), `rest` (any server implementing the contract, WSP's REST wrapper is one), optional `cli`.

## Integration ideas

| Idea | Value | Effort | Needs WSP change | State |
|---|---|---|---|---|
| Add the plugin tool names to the tool table (icon, "Websuche"/"Seite lesen") | medium | XS | no | done |
| Rich tool chips: provider badge, query, result count, cached, latency (latency from start/end times, rest from the parsed result) | high | S | no (optional header keys make it exact) | done |
| Sources derived from tool results; enrich the model's list (snippet, date, favicon); mark "cited but not retrieved"; fixes per-call numbering ambiguity | high | S-M | no (ISO dates would help) | done (5.1 has ISO dates) |
| Web result card: query, provider and routing, cache age, freshness, results with cited markers, research summary | high | M | no; fallback/attempts in the text need header keys | done |
| Live research card (searching, sources found, reading, writing) from generic tool events; WSP research mode is one blocking call, so the card shows elapsed time and a post-turn summary | high | M | no; live counts need a Hermes stream change | partly: research summary in the card as soon as the call returns (mid-turn) |
| Quick-question web option (globe) via the bridge `webSearch` module: `builtin` default, `rest`/`cli` optional, top results as untrusted context, derived sources, query-leaves-the-bridge notice | high | M | no; CLI route under WSP 5.1 needs keys exported into the bridge process, so prefer `builtin`/`rest` | open |
| Image search via WSP | low | M | yes (no images tool; raw URLs only); keep the bridge's own providers | open, parked |
| Link preview cards from extract results inside a turn; standalone previews through a small bridge fetch, not through extract | medium | S / M | no | partly: pages read are listed in the card |
| Per-chat "web search off/on" for Hermes turns | medium | S soft / L hard | not WSP: soft = system hint plus notice; hard needs a Hermes per-request toolset switch | open |
| Capability line "Web search: WSP detected (providers ...)" | low-medium | S | optional status JSON (5.1.1 has `status --json`) | open |

Suggested order for the rest: bridge `builtin` search plus probe, live research progress, soft per-chat switch, link
previews, `rest`/`cli` adapters, images last.

## Requests to WSP (all optional, the app works without them)

1. Freeze the tool names and parameter names (`web_search_plus`, `web_extract_plus`, and the MCP `web_search`, `web_extract`); keep an alias for one minor version after any rename.
2. Freeze the text layout of search and extract results and cover it with the golden tests; the app will ship fixtures so a layout change fails a test instead of silently breaking the UI. Done in 5.1.2 (golden test, indented snippet lines).
3. Add machine-readable keys to the header line and JSON: `results=N`, `elapsed_ms=N`, `fallback_from=<provider>`.
   Done in 5.1.2 (text header, research `providers` / `pages`, routing repeated on cache hits); the JSON / MCP side is
   unchanged. In 5.1.1 a fallback is invisible in the text and a cache hit drops the routing bits.
4. Emit absolute ISO dates (`[published 2026-10-09]` or `published_at`) in addition to relative text. Done in 5.1.1.
5. Keep structured sources available outside the model's context (JSON over MCP or a host-readable sidecar). The app does not ask WSP to emit UI nodes; WSP stays source-only.
6. A stable standalone entry point: document the CLI JSON as a versioned schema, keep the REST wrapper in step with the plugin engine, and add a secret-free `status --json` capability output (version, tools, providers configured/auto). 5.1.1 has `hermes web-search-plus status --json` (secret fields only as set / not set); a documented, versioned schema is still open.
7. Document how a sidecar, CLI or REST process obtains keys under the 5.1 credential model (no `.env` loading), and keep status output free of key material.
8. Low priority: structured image results (`image_url, thumbnail_url, width, height, source_page, title`) if images ever join the tool or REST surface; a one-line research summary (providers used, pages read, elapsed time, skip reasons).
9. Keep the native-backend output identical to the plugin layout, since shape is the only detection signal there.

## Not verified

- Which of the plugin tools and the MCP tools are exposed to the model together on a given deployment (the parser handles both).
- A hard per-request tool switch in Hermes (not available in the version checked for the quick-question design).
- The image result shape of the CLI/REST path (read in code only).
- A live `results=0` search and a two-provider fallback chain: keyless Keenable always returned hits and only one
  provider can fail before it; both fixtures are built from the 5.1.2 docs.
- A real provider rate limit: the 429 layouts are WSP's own formatter run on a hand-made 429 (not provoked live).
