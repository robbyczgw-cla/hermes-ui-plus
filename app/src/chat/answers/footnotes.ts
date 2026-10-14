/**
 * A3 footnote citations: which source does `[^n]` / `【n】` in an answer point to?
 *
 * Priority (first that yields anything wins, numbering is 1-based):
 *  1. the answer's `sources` node items (all `sources` nodes of the answer, in order)
 *  2. markdown footnote definitions `[^n]: [Title](url) – snippet` / `[^n]: Title – https://…`
 *  3. the markdown links of the answer's last block when it is a list of links (a "Quellen:" list at the end)
 *
 * Pure TS (erasable syntax only) so `node --test` can run it.
 */
import type { Segment } from '../../protocol/types';
import { fencedLineMask, parseInline, parseMarkdown, type Inline, type MdBlock } from '../markdown.ts';

export type FootnoteTarget = { n: number; title: string; url?: string; snippet?: string; siteName?: string };

const isHttp = (u: string) => /^https?:\/\/[^\s]+$/i.test(u);

function str(x: unknown): string {
  return typeof x === 'string' ? x.trim() : '';
}

/** links (in order) inside inline nodes */
function linksOf(nodes: Inline[], out: { href: string; text: string }[] = []): { href: string; text: string }[] {
  for (const n of nodes) {
    if (n.t === 'link') out.push({ href: n.href, text: plain(n.c) });
    else if (n.t === 'strong' || n.t === 'em' || n.t === 'del') linksOf(n.c, out);
  }
  return out;
}

function plain(nodes: Inline[]): string {
  return nodes.map((x) => (x.t === 'text' || x.t === 'code' ? x.s : x.t === 'br' ? ' ' : x.t === 'image' ? x.alt : x.t === 'fn' ? '' : plain(x.c))).join('').trim();
}

/** marker on the `sources` node derived from the answer's closing numbered list (citations.ts) */
export const CITED_SOURCES_FLAG = 'citedList';

function fromSources(segments: readonly Segment[]): FootnoteTarget[] {
  const out: FootnoteTarget[] = [];
  // a derived numbered list defines `[n]` by itself: other `sources` nodes of the answer must not shift it
  // (GPT review #12) — when present, number only that list
  const derived = segments.some((s) => s.kind === 'hui' && !!s.node && (s.node as unknown as Record<string, unknown>)[CITED_SOURCES_FLAG] === true);
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (o.type === 'sources' && Array.isArray(o.items)) {
      if (derived && o[CITED_SOURCES_FLAG] !== true) return;
      for (const it of o.items) {
        if (!it || typeof it !== 'object') continue;
        const r = it as Record<string, unknown>;
        const url = str(r.url);
        out.push({ n: out.length + 1, title: str(r.title) || url, url: isHttp(url) ? url : undefined, snippet: str(r.snippet) || undefined, siteName: str(r.siteName) || undefined });
      }
      return;
    }
    // sources nested in cards/stacks/tabs
    for (const k of ['children', 'items', 'tabs', 'sections']) {
      const v = o[k];
      if (Array.isArray(v)) v.forEach(visit);
    }
  };
  for (const s of segments) if (s.kind === 'hui') visit(s.node);
  return out;
}

const DEF_RE = /^ {0,3}\[\^(\d{1,3})\]:[ \t]*(.+)$/;

function fromDefinitions(md: string): FootnoteTarget[] {
  if (!md.includes('[^')) return [];
  const byN = new Map<number, FootnoteTarget>();
  // definitions only from prose lines: a `[^1]: …` example inside fenced code must not win (GPT review #11)
  const lines = md.split('\n');
  const code = fencedLineMask(lines);
  for (let li = 0; li < lines.length; li++) {
    if (code[li]) continue;
    const m = DEF_RE.exec(lines[li]);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n < 1 || byN.has(n)) continue;
    const body = m[2].trim();
    const nodes = parseInline(body);
    const link = linksOf(nodes)[0];
    const url = link && isHttp(link.href) ? link.href : undefined;
    const text = plain(nodes);
    // "Title – snippet": text after the link / dash becomes the snippet
    let title = link?.text || text;
    let snippet: string | undefined;
    if (link && link.text === link.href) {
      // bare URL: "Title – https://…"
      title = text.replace(link.href, '').replace(/^[\s,:;–—-]+|[\s,:;–—-]+$/g, '').trim() || link.href;
    } else if (link) {
      const rest = text.slice(text.indexOf(link.text) + link.text.length).replace(/^[\s,:;–—-]+/, '').trim();
      snippet = rest && rest !== link.href ? rest : undefined;
    } else {
      const parts = text.split(/\s[–—-]\s/);
      if (parts.length > 1) {
        title = parts[0];
        snippet = parts.slice(1).join(' – ');
      }
    }
    if (!url && link) title = link.text || title;
    byN.set(n, { n, title: title || url || `[${n}]`, url, snippet });
  }
  return [...byN.values()].sort((a, b) => a.n - b.n);
}

function fromTrailingLinks(blocks: MdBlock[]): FootnoteTarget[] {
  const last = blocks[blocks.length - 1];
  if (!last || last.type !== 'list') return [];
  const out: FootnoteTarget[] = [];
  for (const item of last.items) {
    const link = linksOf(parseInline(item.text))[0];
    if (!link || !isHttp(link.href)) return []; // only a list made of links counts
    const rest = plain(parseInline(item.text)).replace(link.text, '').replace(/^[\s,:;–—-]+/, '').trim();
    out.push({ n: out.length + 1, title: link.text || link.href, url: link.href, snippet: rest || undefined });
  }
  return out;
}

/** Footnote targets of a whole answer (all segments). */
export function footnoteTargets(segments: readonly Segment[]): FootnoteTarget[] {
  const src = fromSources(segments);
  if (src.length) return src;
  const md = segments
    .filter((s): s is Extract<Segment, { kind: 'markdown' }> => s.kind === 'markdown')
    .map((s) => s.text)
    .join('\n\n');
  if (!md.trim()) return [];
  const defs = fromDefinitions(md);
  if (defs.length) return defs;
  // only when the text cites at all (cheap check first: parsing the whole answer again is O(text))
  if (!/\[\^\d|【\d/.test(md)) return [];
  return fromTrailingLinks(parseMarkdown(md));
}

/** Target for footnote `n` (1-based), if any. */
export function footnoteTarget(targets: readonly FootnoteTarget[], n: number): FootnoteTarget | undefined {
  return targets.find((x) => x.n === n);
}
