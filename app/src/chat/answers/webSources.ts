/**
 * WSP / web-search sources joined to the model's citation list (docs/WSP-INTEGRATION.md, "derived sources").
 *
 * After a turn the stored tool rows carry the parsed hits of every web search / extract call (`detail.links`,
 * hermes/webResults.ts). The answer's closing `[n]` / "Quellen:" list (citations.ts) stays the numbering; each item
 * is joined by canonical URL with what the tools actually retrieved:
 *  - retrieved → the item gains the search snippet when it had none
 *  - not retrieved, while every web call of the turn has a parsed result → `unverified: true` (subtle hint in
 *    Sources.tsx: the model cited something no search returned)
 * Without parsed web results (live turn, generic tools with unknown output, other backends) nothing changes.
 * Pure TS (node:test).
 */
import type { ToolEvent } from '../../hermes/types.ts';
import { canonicalUrl } from '../../hermes/webResults.ts';
import type { HuiNode, Segment } from '../../protocol/types';
import { hermesToolKind, toolInput } from '../hermesTools.ts';

export type RetrievedHit = { title: string; url: string; snippet?: string };
export type Retrieved = {
  /** canonical URL → hit */
  hits: Map<string, RetrievedHit>;
  /** every finished web call of the turn has a parsed result → "not retrieved" is meaningful */
  complete: boolean;
};

/** Hits of the turn's web tools, or null when the turn used no web tool. */
export function retrievedSources(tools: readonly ToolEvent[] | undefined): Retrieved | null {
  if (!tools?.length) return null;
  const hits = new Map<string, RetrievedHit>();
  let web = 0;
  let complete = true;
  for (const ev of tools) {
    const name = ev.detail?.tool ?? ev.name;
    if (hermesToolKind(name) !== 'web' && !ev.detail?.web) continue;
    web++;
    if (ev.detail?.cancelled) continue;
    if (!ev.detail?.web && !ev.detail?.links?.length && ev.status !== 'error') complete = false;
    const links = ev.detail?.links ?? [];
    for (const l of links) {
      // a page the extract could not read (404, rate limit) was not retrieved
      if (l.failed) continue;
      const k = canonicalUrl(l.url);
      if (!hits.has(k)) hits.set(k, { title: l.title, url: l.url, ...(l.snippet ? { snippet: l.snippet } : {}) });
    }
    // pages the model asked an extract tool to read count as retrieved too, under the spelling it asked for (the
    // result may show the provider's URL instead: `?ref=1` → the canonical page). WSP 5.1 answers one page per
    // requested URL in request order, so with as many pages as URLs a failed slot keeps its URL out.
    const input = toolInput(ev);
    const urls = (Array.isArray(input?.urls) ? input.urls : typeof input?.url === 'string' ? [input.url] : []).filter((u): u is string => typeof u === 'string');
    const paired = links.length === urls.length;
    urls.forEach((u, i) => {
      if (!/^https?:\/\//i.test(u) || (paired && links[i].failed)) return;
      const k = canonicalUrl(u);
      if (!hits.has(k)) hits.set(k, { title: u, url: u });
    });
  }
  if (!web) return null;
  return { hits, complete: complete && hits.size > 0 };
}

type Item = { title: string; url: string; snippet?: string; unverified?: true };

/** The cited items joined with the retrieved hits (same order and numbering). Same array when nothing changes. */
export function joinSources<T extends Item>(items: readonly T[], r: Retrieved | null): readonly (T & { unverified?: true })[] {
  if (!r || !r.hits.size) return items;
  let changed = false;
  const out = items.map((it) => {
    const h = r.hits.get(canonicalUrl(it.url));
    if (h) {
      if (!it.snippet && h.snippet) {
        changed = true;
        return { ...it, snippet: h.snippet };
      }
      return it;
    }
    if (!r.complete) return it;
    changed = true;
    return { ...it, unverified: true as const };
  });
  return changed ? out : items;
}

/**
 * Segments with the derived citation `sources` block (key `…:sources`, citations.ts) joined to the turn's web
 * results. A `sources` node the model wrote itself is left alone. Same array when nothing changes.
 */
export function withRetrievedSources(segments: readonly Segment[], tools: readonly ToolEvent[] | undefined): readonly Segment[] {
  const i = segments.findIndex((s) => s.kind === 'hui' && s.key.endsWith(':sources') && (s.node as { type?: unknown } | undefined)?.type === 'sources');
  if (i === -1) return segments;
  const r = retrievedSources(tools);
  if (!r) return segments;
  const seg = segments[i] as Extract<Segment, { kind: 'hui' }>;
  const node = seg.node as unknown as { type: 'sources'; items: Item[] };
  const items = joinSources(node.items, r);
  if (items === node.items) return segments;
  const next = segments.slice();
  next[i] = { ...seg, node: { ...node, items } as unknown as HuiNode };
  return next;
}
