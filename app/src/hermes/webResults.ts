/**
 * Web search / extract tool results → structured hits (docs/WSP-INTEGRATION.md, "Web Source Contract v1", level 1).
 * Progressive enhancement: detection is by output SHAPE, the tool name only decides whether a plain-text layout is
 * worth trying. Nothing here requires Web Search Plus (WSP); generic search tools that return the same shapes work too.
 *
 *   WSP plugin text (5.1.x)                                         MCP / engine JSON
 *     [Security notice: …]                                            {provider, query, results:[{title,url,snippet}],
 *     [Provider: brave | auto-routed | high confidence | intent_news    cache_status: "hit" | {disposition, age_seconds},
 *        | cached 42s ago | recency query]                              routing_receipt:{selected_provider, …},
 *     [Freshness: week | applied by: brave]                             provider_attempts:[{provider, outcome, …}]}
 *     Extracted source summaries:      (research mode)               Hermes web_search JSON
 *     1. https://example.com/a                                         {success, data:{web:[{title,url,description}]}}
 *        passage … [showing 2 query-ranked passages of 5120 characters]
 *     1. Title [published 2026-10-14]  (search)    1. Title  (extract: URL line, then content or `Error: …`)
 *        https://example.com/a                     https://example.com/a
 *        snippet … (5.1.2: every line indented)    # page text …
 *     Search error: … / - provider: reason / No results found …
 *
 * WSP 5.1.2 appends machine-readable `key=value` bits to the header (`| results=5 | elapsed_ms=842 | fallback_from=serper,
 * brave`, research: `providers=a,b | pages=3`), repeats the routing of the cached search on a cache hit and indents every
 * snippet line. Unknown bits are ignored (unknown keys kept in `extras`, never shown); output without them reads as before.
 *
 * Titles and snippets are untrusted web data: plain text only, http(s) URLs only, clipped. Pure (node:test).
 */
import type { ToolWebMeta } from './types';

export type WebHit = {
  title: string;
  url: string;
  snippet?: string;
  published?: string;
  /** extract: this page failed (`Error: …`), clipped */
  failed?: string;
};

export type WebToolResult = Omit<ToolWebMeta, 'count' | 'error'> & {
  /** hits in result order, http(s) only; search hits de-duplicated by canonical URL, extract pages by exact URL */
  results: WebHit[];
  /** the tool reported an error (`Search error:` / `Extract error:` / `{error}`) */
  error?: boolean;
  /** the error line, clipped */
  errorText?: string;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

const MAX_HITS = 30;
const MAX_LIST = 8;

function clip(s: string, max: number): string {
  // a long text (an extracted page as `content`): only its first `max` chars survive, so collapse a bounded head –
  // the whole-text regex ran per page on every transcript load. Collapsing only shrinks, the head's result is a prefix
  // of the full one: once it is >= max + 2 long (a final space may still be trimmed) the cut is the same.
  if (s.length > 2 * max + 64) {
    const head = s.slice(0, 2 * max + 64).replace(/\s+/g, ' ').trimStart();
    if (head.length >= max + 2) return `${head.slice(0, max - 1)}…`;
  }
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** provider / reason words: short identifier-ish text only (they end up as chips and labels) */
function word(v: unknown, max = 40): string | undefined {
  const s = str(v);
  return s ? clip(s, max) : undefined;
}

/**
 * Page snippets arrive as markdown (`# Title`, `**bold**`, `[PEP 779](https://…)`): the markers go, the words stay.
 * Still plain text afterwards (nothing is rendered), just without syntax noise.
 */
export function plainSnippet(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/(\*\*|__)(?=\S)([^*_]+?)\1/g, '$2')
    .replace(/`+/g, '')
    .replace(/\s*\[TRUNCATED[^\]]*\]/g, '');
}

/** a lead block worth showing: not a heading, not the title again, not a stub like "TL;DR" or a lone nav link */
const MIN_LEAD = 40;

/**
 * Extracted page: the first block is often the page's own `# Title` (or "TL;DR", "Skip to content"). When it is that thin,
 * the snippet is the first real paragraph of the page instead: up to three more blocks after line `from` are looked at,
 * never past the next item (`next. title` + URL line). Undefined when the first block is fine or nothing better follows.
 */
function pageLead(first: string[], lines: string[], from: number, title: string, next: number, frozen: boolean): string | undefined {
  const re = frozen ? ITEM_RE_FROZEN : ITEM_RE;
  const thin = (b: string[]) => {
    const text = plainSnippet(b.join(' ')).trim();
    return text.length < MIN_LEAD || text.toLowerCase() === title.toLowerCase() || (b.length === 1 && /^#{1,6}\s/.test(b[0]));
  };
  if (!first.length || !thin(first)) return undefined;
  let i = from;
  for (let blocks = 0; blocks < 3 && i < lines.length; blocks++) {
    while (i < lines.length && !lines[i].trim()) i++;
    const b: string[] = [];
    for (; i < lines.length && lines[i].trim(); i++) {
      const m = re.exec(lines[i]);
      if (m && Number(m[1]) === next && httpUrl(lines.slice(i + 1).find((l) => l.trim()))) return undefined;
      if (b.length < 12) b.push(lines[i].trim());
    }
    if (b.length && !thin(b) && !/^error:/i.test(b[0])) return plainSnippet(clip(b.join(' '), 300));
  }
  return undefined;
}

function httpUrl(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const u = s.trim().replace(/^<|>$/g, '');
  return /^https?:\/\/[^\s/?#]+[^\s]*$/i.test(u) ? u : undefined;
}

/** host + path without "www.", hash, tracking params and trailing slash – for joining cited and retrieved URLs */
export function canonicalUrl(u: string): string {
  const m = /^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i.exec(u.trim());
  if (!m) return u.trim().toLowerCase();
  const host = m[2].toLowerCase().replace(/^www\./, '').replace(/:(80|443)$/, '');
  const path = m[3].replace(/\/+$/, '');
  const query = (m[4] ?? '')
    .slice(1)
    .split('&')
    .filter((p) => p && !/^(utm_[a-z]+|ref|fbclid|gclid)=/i.test(p))
    .join('&');
  return `${host}${path}${query ? `?${query}` : ''}`;
}

/**
 * Collects hits. Search results are de-duplicated by canonical URL. Extract pages are all kept: WSP 5.1 answers exactly
 * one page per requested URL in request order, failed ones included, and may show two requests (`?ref=1`, `?ref=2`)
 * under the same provider-reported URL; the slot order is what pairs a page with its request (webSources.ts).
 */
function collector(extract: boolean) {
  const out: WebHit[] = [];
  const seen = new Set<string>();
  return {
    out,
    push(hit: WebHit) {
      if (out.length >= MAX_HITS) return;
      if (!extract) {
        const k = canonicalUrl(hit.url);
        if (seen.has(k)) return;
        seen.add(k);
      }
      out.push(hit);
    },
  };
}

/** a v3 text field (`{text, text_sha256, …}`) or a plain string */
const textOf = (v: unknown): string | undefined => str(v) ?? (isObj(v) ? str(v.text) : undefined);
/** a v3 URL (`{observed, canonical}`) or a plain string */
const urlOf = (v: unknown): string | undefined => str(v) ?? (isObj(v) ? (str(v.observed) ?? str(v.canonical)) : undefined);

function hostOf(url: string): string {
  return (/^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url).replace(/^www\./i, '');
}

const NO_TITLE = /^no title$/i;

// ---------------------------------------------------------------- JSON shapes

function attemptsOf(v: unknown): ToolWebMeta['attempts'] {
  if (!Array.isArray(v)) return undefined;
  const out: NonNullable<ToolWebMeta['attempts']> = [];
  for (const a of v) {
    if (!isObj(a)) continue;
    const provider = word(a.provider);
    if (!provider) continue;
    const skip = word(a.skip_reason);
    const outcome = word(a.outcome) ?? (skip ? 'skipped' : 'unknown');
    const ms = num(a.duration_ms);
    const results = num(a.result_count);
    out.push({ provider, outcome: skip && outcome === 'skipped' ? `skipped:${skip}` : outcome, ...(ms !== undefined ? { ms: Math.round(ms) } : {}), ...(results !== undefined ? { results } : {}) });
    if (out.length >= MAX_LIST) break;
  }
  return out.length ? out : undefined;
}

function fromJson(o: Record<string, unknown>, extract: boolean): WebToolResult | null {
  const data = isObj(o.data) ? o.data : undefined;
  const list = Array.isArray(o.results) ? o.results : Array.isArray(data?.web) ? data.web : Array.isArray(o.web) ? o.web : null;
  if (!list) return null;
  const hits = collector(extract);
  let any = false;
  for (const r of list) {
    if (!isObj(r)) continue;
    const url = httpUrl(urlOf(r.url) ?? str(r.link));
    if (!url) continue;
    any = true;
    const snippet = textOf(r.snippet) ?? str(r.description) ?? textOf(r.content) ?? textOf(r.text);
    const published = str(r.published_at) ?? str(r.published) ?? str(r.published_date) ?? str(r.date);
    const failed = str(r.error) ?? (isObj(r.error) ? str(r.error.message) : undefined);
    const title = textOf(r.title);
    hits.push({
      title: clip(title && !NO_TITLE.test(title) ? title : hostOf(url), 160),
      url,
      ...(snippet && !failed ? { snippet: plainSnippet(clip(snippet, 300)) } : {}),
      ...(published ? { published: clip(published, 40) } : {}),
      ...(failed ? { failed: clip(failed, 120) } : {}),
    });
  }
  if (!any && list.length) return null; // an array of something else
  const receipt = isObj(o.routing_receipt) ? o.routing_receipt : undefined;
  const routing = isObj(o.routing) ? o.routing : undefined;
  // Hermes' own web_search with the WSP native backend: `metadata: {backend: "wsp", provider}`
  const meta = isObj(o.metadata) ? o.metadata : undefined;
  const provider = word(o.provider) ?? word(receipt?.selected_provider) ?? word(routing?.provider) ?? word(meta?.provider);
  const cacheObj = isObj(o.cache_status) ? o.cache_status : undefined;
  const cache = (str(o.cache_status) ?? str(cacheObj?.disposition))?.toLowerCase();
  const cached = o.cached === true || cache === 'hit' || cache === 'cached' || cache === 'stale_hit' || cache === 'stale';
  const cacheAge = num(cacheObj?.age_seconds) ?? num(o.cache_age_seconds);
  const errorText = str(o.error) ?? (isObj(o.error) ? str(o.error.message) : undefined);
  const attempts = attemptsOf(o.provider_attempts);
  const elapsed = num(o.elapsed_ms) ?? num(o.duration_ms);
  const auto = routing?.auto_routed === true ? true : routing?.auto_routed === false ? false : undefined;
  const confidence = word(routing?.confidence_level, 12);
  const queryType = intentOf(str(routing?.reason));
  const summaries = Array.isArray(o.source_summaries) ? o.source_summaries.length : undefined;
  return {
    results: hits.out,
    ...(provider ? { provider } : {}),
    ...(cached ? { cached } : {}),
    ...(cached && cacheAge !== undefined ? { cacheAgeS: Math.round(cacheAge) } : {}),
    ...(auto !== undefined ? { auto } : {}),
    ...(confidence ? { confidence } : {}),
    ...(queryType ? { queryType } : {}),
    ...(attempts ? { attempts } : {}),
    ...(elapsed !== undefined ? { elapsedMs: Math.round(elapsed) } : {}),
    ...(summaries !== undefined && str(o.mode) === 'research' ? { research: { pages: summaries } } : {}),
    ...(errorText ? { error: true, errorText: clip(errorText, 200) } : {}),
  };
}

// ---------------------------------------------------------------- WSP plugin text layout

const PROVIDER_RE = /^\[Provider:\s*([^|\]]+?)\s*(?:\|([^\]]*))?\]\s*$/i;
const FRESHNESS_RE = /^\[Freshness:\s*([^|\]]+?)\s*(?:\|([^\]]*))?\]\s*$/i;
const ITEM_RE = /^\s{0,3}(\d{1,2})\.\s+(.+?)\s*$/;
/** WSP 5.1.2 freezes the layout: an item starts in column 0, every snippet line is indented, so an indented `2. …` is page text */
const ITEM_RE_FROZEN = /^(\d{1,2})\.\s+(.+?)\s*$/;
const PUBLISHED_RE = /\s*\[published ([^\]]+)\]\s*$/i;
const ERROR_LINE_RE = /^(search|extract) error:\s*(.*)$/im;
const PROVIDER_ERROR_RE = /^-\s+([\w.-]{1,40}):\s+(.+)$/;
const SUMMARIES_RE = /^extracted source summaries:\s*$/i;

/** `intent_news` → `news` (the router's query type); other routing reasons are internal and not shown */
function intentOf(reason: string | undefined): string | undefined {
  const m = /^intent_([a-z]{2,20})$/i.exec(reason ?? '');
  return m ? m[1].toLowerCase() : undefined;
}

const KEY_VALUE_RE = /^([a-z][a-z0-9_]{0,31})=(.*)$/i;
const MAX_EXTRAS = 8;

/** `a,b,c` → provider ids (short identifier words only, in order, once each) */
function idList(v: string): string[] {
  const out: string[] = [];
  for (const p of v.split(',')) {
    const id = p.trim();
    if (/^[\w.-]{1,40}$/.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

const wholeNumber = (v: string): number | undefined => (/^\d{1,9}$/.test(v) ? Number(v) : undefined);

/**
 * `[Provider: …]` header bits: auto-routed, confidence, reason, cache age, recency, and (WSP 5.1.2) the machine-readable
 * `key=value` bits `results`, `elapsed_ms`, `fallback_from`, `providers`, `pages`. Unknown keys are kept in `extras`
 * (never shown), unknown plain bits and bits with an unusable value are ignored; the first bit of a key wins.
 */
function headerMeta(bits: string): Partial<WebToolResult> {
  const out: Partial<WebToolResult> = {};
  const extras: Record<string, string> = {};
  const seen = new Set<string>();
  for (const raw of bits.split('|')) {
    const b = raw.trim();
    if (!b) continue;
    let m: RegExpExecArray | null;
    if ((m = KEY_VALUE_RE.exec(b))) {
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      if (seen.has(key)) continue;
      seen.add(key);
      if (key === 'results') {
        const n = wholeNumber(value);
        if (n !== undefined) out.reportedCount = n;
      } else if (key === 'elapsed_ms') {
        const n = wholeNumber(value);
        if (n !== undefined) out.elapsedMs = n;
      } else if (key === 'pages') {
        const n = wholeNumber(value);
        if (n !== undefined) out.research = { pages: n };
      } else if (key === 'fallback_from' || key === 'providers') {
        const ids = idList(value);
        if (ids.length) out[key === 'providers' ? 'providers' : 'fallbackFrom'] = ids;
      } else if (Object.keys(extras).length < MAX_EXTRAS) extras[key] = clip(value, 80);
    } else if (/^auto-routed$/i.test(b)) out.auto = true;
    else if ((m = /^(high|medium|low) confidence$/i.exec(b))) out.confidence = m[1].toLowerCase();
    else if ((m = /^cached(?:\s+(\d{1,9})s ago)?$/i.exec(b))) {
      out.cached = true;
      if (m[1]) out.cacheAgeS = Number(m[1]);
    } else if (/^recency query$/i.test(b)) out.recency = true;
    else if (intentOf(b)) out.queryType = intentOf(b);
  }
  if (Object.keys(extras).length) out.extras = extras;
  return out;
}

/** `[Freshness: week | applied by: brave, exa | not supported: keenable]` */
function freshnessOf(m: RegExpExecArray): ToolWebMeta['freshness'] {
  const requested = word(m[1], 24);
  if (!requested) return undefined;
  const list = (re: RegExp) => {
    const hit = re.exec(m[2] ?? '');
    return hit
      ? hit[1]
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p && p !== 'none' && /^[\w.-]{1,40}$/.test(p))
          .slice(0, MAX_LIST)
      : [];
  };
  const appliedBy = list(/applied by:\s*([^|]*)/i);
  const notApplied = list(/not supported:\s*([^|]*)/i);
  return { requested, ...(appliedBy.length ? { appliedBy } : {}), ...(notApplied.length ? { notApplied } : {}) };
}

function fromText(text: string, nameHint: boolean, extract: boolean): WebToolResult | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let header: Partial<WebToolResult> | null = null;
  let frozenLayout = false;
  let provider: string | undefined;
  let freshness: ToolWebMeta['freshness'];
  for (const l of lines.slice(0, 8)) {
    const t = l.trim();
    const m = PROVIDER_RE.exec(t);
    if (m && !header) {
      provider = m[1].trim();
      header = headerMeta(m[2] ?? '');
      frozenLayout = /\|\s*[a-z][a-z0-9_]*=/i.test(m[2] ?? '');
      continue;
    }
    const f = header ? FRESHNESS_RE.exec(t) : null;
    if (f) freshness = freshnessOf(f);
  }
  if (!header && !nameHint) return null;
  const errLine = ERROR_LINE_RE.exec(text);
  const providerErrors: NonNullable<ToolWebMeta['providerErrors']> = [];
  if (errLine) {
    for (const l of lines) {
      const pe = PROVIDER_ERROR_RE.exec(l.trim());
      if (pe && providerErrors.length < MAX_LIST) providerErrors.push({ provider: pe[1], reason: clip(pe[2], 120) });
    }
  }
  const hits = collector(extract);
  let researchPages: number | undefined;
  // Hits are numbered 1, 2, 3 …: an item number is taken when it is the next one (or a small jump confirmed by a URL
  // line, e.g. after an item without URL); a numbered list inside a snippet or page restarts at 1 and is skipped.
  let expected = 1;
  for (let i = 0; i < lines.length; i++) {
    if (SUMMARIES_RE.test(lines[i].trim())) {
      // research mode: "N. url" + one passage line each, until the blank line; the result list follows from 1 again
      researchPages = 0;
      let j = i + 1;
      for (; j < lines.length && lines[j].trim(); j++) {
        const s = (frozenLayout ? ITEM_RE_FROZEN : ITEM_RE).exec(lines[j]);
        if (s && httpUrl(s[2])) researchPages++;
      }
      i = j;
      continue;
    }
    const m = (frozenLayout ? ITEM_RE_FROZEN : ITEM_RE).exec(lines[i]);
    const n = m ? Number(m[1]) : 0;
    if (!m || n < expected || n > expected + 3) continue;
    const head = m[2];
    const direct = httpUrl(head);
    if (direct) {
      // a numbered bare URL (older research summaries): the page itself
      expected = n + 1;
      hits.push({ title: hostOf(direct), url: direct });
      continue;
    }
    // "N. title [published …]" + URL line (+ snippet / extract: page text or `Error: …`)
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    const urlLine = lines[j]?.trim() ?? '';
    const url = httpUrl(urlLine);
    if (!url) {
      // the item's link is no http(s) URL (`javascript:…`): dropped, but it still counts
      if (n === expected && /^[a-z][a-z0-9+.-]{1,15}:\S+$/i.test(urlLine)) expected++;
      continue;
    }
    expected = n + 1;
    const published = PUBLISHED_RE.exec(head)?.[1];
    const rawTitle = clip(head.replace(PUBLISHED_RE, ''), 160);
    const title = rawTitle && !NO_TITLE.test(rawTitle) ? rawTitle : hostOf(url);
    // the snippet (search) / start of the page (extract): the lines up to the blank line. WSP keeps a snippet's own
    // line breaks (continuation lines are not indented), so the whole block is the snippet.
    const block: string[] = [];
    let k = j + 1;
    for (; k < lines.length && lines[k].trim(); k++) if (block.length < 12) block.push(lines[k].trim());
    const failed = block.length ? /^error:\s*(.+)$/i.exec(block[0])?.[1] : undefined;
    const lead = !failed && extract ? pageLead(block, lines, k, title, n + 1, frozenLayout) : undefined;
    const body = failed ? '' : (lead ?? plainSnippet(clip(block.join(' '), 300)));
    hits.push({
      title,
      url,
      ...(body ? { snippet: body } : {}),
      ...(published ? { published: clip(published, 40) } : {}),
      ...(failed ? { failed: clip(failed, 120) } : {}),
    });
    // a search item's block is its snippet; an extracted page continues after blank lines (scanned on, numbered
    // lists in it are out of sequence)
    i = k - 1;
  }
  if (!header && !hits.out.length && !errLine) return null;
  const errorText = errLine ? clip(errLine[2] || errLine[0], 200) : undefined;
  return {
    ...(header ?? {}),
    results: hits.out,
    ...(provider ? { provider: clip(provider, 40) } : {}),
    ...(freshness ? { freshness } : {}),
    // the header's `pages=` is the tool's own count; the summaries are only counted when it did not say
    ...(researchPages !== undefined ? { research: { pages: header?.research?.pages ?? researchPages } } : {}),
    ...(errLine ? { error: true, errorText } : {}),
    ...(providerErrors.length ? { providerErrors } : {}),
  };
}

/** web-ish tool names (generic, WSP plugin, MCP): only these get the plain-text layout tried without a `[Provider:` header */
const WEB_NAME_RE = /(^|_)(web|search|extract|fetch|crawl|wsp)(_|$)/i;
/** extract-ish tool names: pages are kept per exact URL */
const EXTRACT_NAME_RE = /(^|_)(extract|fetch|crawl|read)(_|$)/i;

/**
 * Structured hits of one tool result (parsed JSON object or text), or null when the output has no recognisable
 * search/extract shape. `toolName` only widens the text detection (never needed for JSON or the WSP header) and
 * tells extract tools apart (one page per requested URL).
 */
export function parseWebToolOutput(output: unknown, toolName = ''): WebToolResult | null {
  const extract = EXTRACT_NAME_RE.test(toolName);
  if (isObj(output)) return fromJson(output, extract);
  if (typeof output !== 'string' || (!output.includes('http') && !/\[Provider:|^(search|extract) error:/im.test(output))) return null;
  const t = output.trim();
  if (t.startsWith('{') && t.endsWith('}')) {
    try {
      const j: unknown = JSON.parse(t);
      if (isObj(j)) return fromJson(j, extract);
    } catch {
      /* text */
    }
  }
  return fromText(output, WEB_NAME_RE.test(toolName), extract);
}

/** Storage form of a parsed result (ToolDetail.web): the meta without the hits. */
export function webMetaOf(r: WebToolResult): ToolWebMeta {
  const { results, error: _error, errorText, ...rest } = r;
  // the tool's own `results=N` beats the number of hits this parser could read (cap, non-http links)
  return { ...rest, count: r.reportedCount ?? results.length, ...(errorText ? { error: errorText } : {}) };
}

/** The `[Security notice: …]` line WSP puts on top of every result: hidden in raw views too. */
export function withoutSecurityNotice(output: unknown): unknown {
  return typeof output === 'string' ? output.replace(/^\s*\[Security notice:[^\]\n]*\]\s*\n?/, '') : output;
}
