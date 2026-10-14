/**
 * Web search / extract tool results → structured hits (docs/WSP-INTEGRATION.md, "Web Source Contract v1", level 1).
 * Progressive enhancement: detection is by output SHAPE, the tool name only decides whether a plain-text layout is
 * worth trying. Nothing here requires Web Search Plus (WSP); generic search tools that return the same shapes work too.
 *
 *   WSP plugin text   [Security notice: …]                       MCP / engine JSON
 *                     [Provider: brave | auto-routed | cached 42s ago]   {provider, query, cache_status,
 *                     1. Title [published 3 days ago]              results:[{title,url,snippet}],
 *                        https://example.com/a                     routing_receipt:{selected_provider}}
 *                        snippet …                               Hermes web_search JSON
 *                     Search error: … / No results found …       {success, data:{web:[{title,url,description}]}}
 *
 * Titles and snippets are untrusted web data: plain text only, http(s) URLs only, clipped. Pure (node:test).
 */

export type WebHit = { title: string; url: string; snippet?: string; published?: string };

export type WebToolResult = {
  provider?: string;
  cached?: boolean;
  /** hits in result order, http(s) only, de-duplicated by URL */
  results: WebHit[];
  /** the tool reported an error (`Search error:` / `Extract error:` / `{error}`) */
  error?: boolean;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const MAX_HITS = 30;

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

function push(out: WebHit[], seen: Set<string>, hit: WebHit) {
  const k = canonicalUrl(hit.url);
  if (seen.has(k) || out.length >= MAX_HITS) return;
  seen.add(k);
  out.push(hit);
}

function hostOf(url: string): string {
  return (/^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url).replace(/^www\./i, '');
}

// ---------------------------------------------------------------- JSON shapes

function fromJson(o: Record<string, unknown>): WebToolResult | null {
  const data = isObj(o.data) ? o.data : undefined;
  const list = Array.isArray(o.results) ? o.results : Array.isArray(data?.web) ? data.web : Array.isArray(o.web) ? o.web : null;
  if (!list) return null;
  const out: WebHit[] = [];
  const seen = new Set<string>();
  let any = false;
  for (const r of list) {
    if (!isObj(r)) continue;
    const url = httpUrl(str(r.url) ?? str(r.link));
    if (!url) continue;
    any = true;
    const snippet = str(r.snippet) ?? str(r.description) ?? str(r.content);
    const published = str(r.published_at) ?? str(r.published) ?? str(r.date);
    push(out, seen, {
      title: clip(str(r.title) ?? hostOf(url), 160),
      url,
      ...(snippet ? { snippet: clip(snippet, 300) } : {}),
      ...(published ? { published: clip(published, 40) } : {}),
    });
  }
  if (!any && list.length) return null; // an array of something else
  const receipt = isObj(o.routing_receipt) ? o.routing_receipt : undefined;
  const provider = str(o.provider) ?? str(receipt?.selected_provider);
  const cache = str(o.cache_status)?.toLowerCase();
  const cached = o.cached === true || cache === 'hit' || cache === 'cached';
  return {
    results: out,
    ...(provider ? { provider: clip(provider, 40) } : {}),
    ...(cached ? { cached } : {}),
    ...(str(o.error) ? { error: true } : {}),
  };
}

// ---------------------------------------------------------------- WSP plugin text layout

const PROVIDER_RE = /^\[Provider:\s*([^|\]]+?)\s*(?:\|([^\]]*))?\]\s*$/i;
const ITEM_RE = /^\s{0,3}(\d{1,2})\.\s+(.+?)\s*$/;
const PUBLISHED_RE = /\s*\[published ([^\]]+)\]\s*$/i;

function fromText(text: string, nameHint: boolean): WebToolResult | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let provider: string | undefined;
  let cached = false;
  let header = false;
  for (const l of lines.slice(0, 8)) {
    const m = PROVIDER_RE.exec(l.trim());
    if (m) {
      header = true;
      provider = m[1].trim();
      cached = /\bcached\b/i.test(m[2] ?? '');
      break;
    }
  }
  if (!header && !nameHint) return null;
  const error = /^(search|extract) error:/im.test(text);
  const out: WebHit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const m = ITEM_RE.exec(lines[i]);
    if (!m) continue;
    const head = m[2];
    const direct = httpUrl(head);
    if (direct) {
      // research summaries / extract without title: "1. https://…"
      push(out, seen, { title: hostOf(direct), url: direct });
      continue;
    }
    // "N. title [published …]" + URL line (+ snippet line)
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    const url = httpUrl(lines[j]?.trim());
    if (!url) continue;
    const published = PUBLISHED_RE.exec(head)?.[1];
    const title = clip(head.replace(PUBLISHED_RE, ''), 160) || hostOf(url);
    const next = lines[j + 1]?.trim();
    const snippet = next && !ITEM_RE.test(lines[j + 1]) && !httpUrl(next) && !/^error:/i.test(next) ? clip(next.replace(/\[TRUNCATED[^\]]*\]/g, ''), 300) : undefined;
    push(out, seen, { title, url, ...(snippet ? { snippet } : {}), ...(published ? { published: clip(published, 40) } : {}) });
    i = j;
  }
  if (!header && !out.length && !error) return null;
  return { results: out, ...(provider ? { provider: clip(provider, 40) } : {}), ...(cached ? { cached } : {}), ...(error ? { error } : {}) };
}

/** web-ish tool names (generic, WSP plugin, MCP): only these get the plain-text layout tried without a `[Provider:` header */
const WEB_NAME_RE = /(^|_)(web|search|extract|fetch|crawl|wsp)(_|$)/i;

/**
 * Structured hits of one tool result (parsed JSON object or text), or null when the output has no recognisable
 * search/extract shape. `toolName` only widens the text detection (never needed for JSON or the WSP header).
 */
export function parseWebToolOutput(output: unknown, toolName = ''): WebToolResult | null {
  if (isObj(output)) return fromJson(output);
  if (typeof output !== 'string' || (!output.includes('http') && !/\[Provider:|^(search|extract) error:/im.test(output))) return null;
  const t = output.trim();
  if (t.startsWith('{') && t.endsWith('}')) {
    try {
      const j: unknown = JSON.parse(t);
      if (isObj(j)) return fromJson(j);
    } catch {
      /* text */
    }
  }
  return fromText(output, WEB_NAME_RE.test(toolName));
}
