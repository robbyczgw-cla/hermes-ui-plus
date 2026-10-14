/**
 * B3: Hermes grounded answers (web-search-plus) cite with plain numbers – inline `[1]`, `[1][2]`, `[1, 2]` –
 * and end with a numbered sources list:
 *   [1] https://example.com/a — Title            [1]: https://example.com/a "Title"
 *   [2] Title – https://example.com/b            1. [Title](https://example.com/a) – snippet
 * Only when such a closing list exists (numbers 1…k in order, every line with an http(s) URL, at the very
 * end of the answer, outside code) the answer is treated as cited: the list is cut from the text and shown
 * as the regular `sources` block, and inline `[n]` (n ≤ k) become footnote pills. Plain "[1]" text, array
 * indices in code etc. are never touched without that list.
 *
 * Runs once per finished answer (O(text)); never while streaming.
 * Pure TS (erasable syntax only) so `node --test` can run it.
 */
import type { HuiNode, Segment } from '../../protocol/types';
import { fencedLineMask, parseInline, type Inline } from '../markdown.ts';
import { CITED_SOURCES_FLAG } from './footnotes.ts';

export type CitedSource = { title: string; url: string; snippet?: string };

export type CitationList = {
  /** the markdown without the closing list (and its "Quellen:" heading) */
  body: string;
  /** list text that was cut (copy keeps the full text; this is display only) */
  list: string;
  items: CitedSource[];
  /** inline `[n]` citations found in `body` */
  cited: boolean;
};

/** optional bullet, then `[n]` / `[n]:` */
const BRACKET_RE = /^\s{0,3}(?:[-*+]\s+)?\[(\d{1,3})\]:?\s+(.+?)\s*$/;
/** `n.` / `n)` numbered item with a markdown link */
const NUMBERED_RE = /^\s{0,3}(\d{1,3})[.)]\s+(.*\[[^\]]+\]\(\s*https?:\/\/.+)$/;
const URL_RE = /<?(https?:\/\/[^\s<>]+?)>?(?=[\s)"'”]|[.,;:!?]*$|[.,;:!?]+\s)/;
const MD_LINK_RE = /\[([^\]]*)\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+["'(][^)]*["')])?\s*\)/;
const HEADING_RE = /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:quellen(?:angaben)?|sources?|referenzen|references|belege|links|fuentes)\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i;
const SEP = /^[\s—–\-:|·,]+|[\s—–\-:|·,]+$/g;

function clean(s: string): string {
  return s
    .replace(/\*\*|__|`/g, '')
    .replace(SEP, '')
    .replace(/^["'“„(]+|["'”)]+$/g, '')
    .replace(SEP, '')
    .trim();
}

/** One list line → its number + source, or null. */
function parseLine(line: string): { n: number; src: CitedSource; numbered: boolean } | null {
  let m = BRACKET_RE.exec(line);
  let numbered = false;
  if (!m) {
    m = NUMBERED_RE.exec(line);
    numbered = true;
  }
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const rest = m[2];
  const link = MD_LINK_RE.exec(rest);
  if (link) {
    const after = clean(rest.slice(link.index + link[0].length));
    const before = clean(rest.slice(0, link.index));
    const title = clean(link[1]) || before || link[2];
    const snippet = [before && before !== title ? before : '', after].filter(Boolean).join(' – ') || undefined;
    return { n, src: { title, url: link[2], ...(snippet ? { snippet } : {}) }, numbered };
  }
  if (numbered) return null;
  const u = URL_RE.exec(rest);
  if (!u) return null;
  const url = u[1].replace(/[.,;:!?]+$/, '');
  const title = clean(rest.slice(0, u.index)) || clean(rest.slice(u.index + u[0].length)) || url;
  return { n, src: { title, url }, numbered };
}

/**
 * Inline `[n]` / `[n, m]` with every n in 1…max in PROSE: read with the real Markdown inline parser, so
 * code spans (`array[1]`), fenced code, escapes and link labels/targets never count (GPT review #10).
 */
function hasInlineCites(body: string, max: number): boolean {
  if (!/\[\d/.test(body)) return false;
  const lines = body.split('\n');
  const mask = fencedLineMask(lines);
  const prose = lines.filter((_, i) => !mask[i]).join('\n');
  const isCite = (nodes: Inline[]): boolean =>
    nodes.some((x) => (x.t === 'fn' ? /^\[\d/.test(x.raw) : x.t === 'strong' || x.t === 'em' || x.t === 'del' ? isCite(x.c) : false));
  return isCite(parseInline(prose, { cites: max }));
}

// ---- B3 rest: unnumbered "Quellen:" trailers (Hermes without `[n]`) ----
//   Quellen: [Titel A](https://a), [Titel B](https://b)        **Sources:** https://a · https://b
//   Quellen:                                                   [Titel A](https://a) · [Titel B](https://b)
//   - [Titel A](https://a)                                     (a last line made only of ≥ 2 links)
//   - Titel B – https://b
// Only at the very end of the answer, outside code, and only with the explicit heading word – or a last
// line that holds nothing but ≥ 2 links. A link list the user asked for ("Gute Seiten:") stays a list.

const HEADING_WORDS = '(?:quellen?(?:angaben)?|sources?|referenzen|references|belege|fuentes)';
/** `Quellen: …` / `**Quellen:** …` / `- Sources: …` with the items on the same line (colon required) */
const INLINE_HEADING_RE = new RegExp(`^\\s{0,3}(?:[-*+]\\s+)?(?:\\*\\*|__|\\*|_)?\\s*${HEADING_WORDS}\\s*(?::\\s*(?:\\*\\*|__|\\*|_)?|(?:\\*\\*|__|\\*|_)\\s*:)\\s*(.+)$`, 'i');
const ANY_LINK_RE = /\[([^\]]*)\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+["'(][^)]*["')])?\s*\)|<?(https?:\/\/[^\s<>]+?)>?(?=[\s)"'”,;·|]|[.,;:!?]*$|[.,;:!?]+\s)/g;
const BULLET_RE = /^\s{0,3}(?:[-*+•]|\d{1,3}[.)])\s+/;

/** links of one trailer line → sources, or null when the line holds anything but links + short titles */
function trailerItems(text: string): CitedSource[] | null {
  const line = text.replace(BULLET_RE, '');
  const found: { start: number; end: number; title: string; url: string }[] = [];
  ANY_LINK_RE.lastIndex = 0;
  for (let m = ANY_LINK_RE.exec(line); m; m = ANY_LINK_RE.exec(line)) {
    const url = (m[2] ?? m[3]).replace(/[.,;:!?]+$/, '');
    found.push({ start: m.index, end: m.index + m[0].length, title: m[2] ? clean(m[1]) : '', url });
  }
  if (!found.length) return null;
  const items: CitedSource[] = [];
  let prev = 0;
  for (let i = 0; i < found.length; i++) {
    const f = found[i];
    const before = clean(line.slice(prev, f.start));
    const after = i === found.length - 1 ? clean(line.slice(f.end)) : '';
    // "Titel – url" (text before), "url – Titel" (one link, text after)
    const title = f.title || before || (found.length === 1 ? after : '') || f.url;
    const snippet = f.title && found.length === 1 ? [before, after].filter(Boolean).join(' – ') : '';
    // free prose between links ("siehe auch …, außerdem …") → not a sources line
    if (before.length > 120 || after.length > 160) return null;
    items.push({ title, url: f.url, ...(snippet ? { snippet } : {}) });
    prev = f.end;
  }
  return items;
}

function findSourcesTrailer(lines: string[], end: number): { cut: number; items: CitedSource[] } | null {
  const items: CitedSource[] = [];
  let i = end - 1;
  let first = end;
  // link lines from the end upwards (blank lines between bullets are fine)
  for (; i >= 0; i--) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (HEADING_RE.test(l) || INLINE_HEADING_RE.test(l)) break;
    const its = trailerItems(l);
    if (!its) break;
    items.unshift(...its);
    first = i;
  }
  if (i >= 0 && HEADING_RE.test(lines[i]) && items.length) return { cut: i, items };
  if (i >= 0 && INLINE_HEADING_RE.test(lines[i])) {
    const its = trailerItems(INLINE_HEADING_RE.exec(lines[i])![1]);
    if (its) return { cut: i, items: [...its, ...items] };
  }
  // no heading word: only a last line made of ≥ 2 links and separators
  const last = lines[end - 1];
  if (first === end - 1 && !BULLET_RE.test(last)) {
    const its = trailerItems(last);
    const rest = last.replace(ANY_LINK_RE, '').replace(/[\s,;·|•—–-]+/g, '');
    if (its && its.length >= 2 && !rest) return { cut: end - 1, items: its };
  }
  return null;
}

function dedupeByUrl(items: CitedSource[]): CitedSource[] {
  const seen = new Set<string>();
  return items.filter((x) => {
    const k = x.url.replace(/\/+$/, '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The closing numbered sources list of a markdown answer, or null. `[n] …` lists count on their own;
 * a plain `1. [Title](url)` link list only when the text cites `[n]` (otherwise it is just a list).
 */
export function findCitationList(md: string): CitationList | null {
  if (!md.includes('http')) return null;
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  const parsed: { n: number; src: CitedSource; numbered: boolean }[] = [];
  let start = end;
  for (let i = end - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l.trim()) continue;
    const p = parseLine(l);
    if (!p) break;
    parsed.unshift(p);
    start = i;
  }
  if (!parsed.length || parsed.some((p, i) => p.n !== i + 1 || p.numbered !== parsed[0].numbered)) return findTrailer(lines, end);
  // (numbering 1…k in order, one style – checked above) not inside a fenced block
  if (inFence(lines, start)) return null;
  let cut = start;
  let h = start - 1;
  while (h >= 0 && !lines[h].trim()) h--;
  if (h >= 0 && HEADING_RE.test(lines[h])) cut = h;
  const body = lines.slice(0, cut).join('\n').replace(/\s+$/, '');
  const cited = hasInlineCites(body, parsed.length);
  if (parsed[0].numbered && !cited) return findTrailer(lines, end);
  if (!body.trim()) return null; // the whole answer is a link list: leave it
  return { body, list: lines.slice(cut, end).join('\n'), items: parsed.map((p) => p.src), cited };
}

/** line `at` lies inside fenced code (real fence rules: character + opener length, not a parity count) */
function inFence(lines: string[], at: number): boolean {
  return fencedLineMask(lines.slice(0, at + 1))[at] === true;
}

/** unnumbered "Quellen:" trailer → the same shape as a numbered list (numbered 1…k in order) */
function findTrailer(lines: string[], end: number): CitationList | null {
  const t = findSourcesTrailer(lines, end);
  if (!t || inFence(lines, t.cut)) return null;
  const body = lines.slice(0, t.cut).join('\n').replace(/\s+$/, '');
  if (!body.trim()) return null;
  const items = dedupeByUrl(t.items).slice(0, 30);
  return { body, list: lines.slice(t.cut, end).join('\n'), items, cited: hasInlineCites(body, items.length) };
}

export type CitedSegments = {
  segments: readonly Segment[];
  /** highest citation number for the inline parser (`InlineOptions.cites`); 0 = none */
  cites: number;
  /** long researched answer (> RESEARCH_WORDS words + closing sources list): "Weiterlesen" after the first section */
  research: boolean;
};

export const RESEARCH_WORDS = 250;

function words(s: string): number {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const space = c === 32 || c === 10 || c === 9 || c === 13;
    if (!space && !inWord) n++;
    inWord = !space;
  }
  return n;
}

const cache = new WeakMap<readonly Segment[], CitedSegments>();

/**
 * Finished answer segments with a closing citation list: the list leaves the last markdown segment and a
 * `sources` block follows it (numbered like the inline pills). Unchanged (same array) otherwise.
 */
export function withCitationSources(segments: readonly Segment[]): CitedSegments {
  const hit = cache.get(segments);
  if (hit) return hit;
  let out: CitedSegments = { segments, cites: 0, research: false };
  let idx = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (s.kind === 'markdown' && s.text.trim()) {
      idx = i;
      break;
    }
  }
  const seg = idx >= 0 ? segments[idx] : undefined;
  const found = seg?.kind === 'markdown' ? findCitationList(seg.text) : null;
  if (seg?.kind === 'markdown' && found) {
    // cites in earlier markdown segments count too
    const cited =
      found.cited || segments.some((s, i) => i !== idx && s.kind === 'markdown' && hasInlineCites(s.text, found.items.length));
    // flagged: footnoteTargets numbers `[n]` against this list alone (not every sources node of the answer)
    const node = { type: 'sources', items: found.items, [CITED_SOURCES_FLAG]: true } as unknown as HuiNode;
    const next: Segment[] = segments.slice();
    next.splice(idx, 1, { ...seg, text: found.body }, { key: `${seg.key}:sources`, kind: 'hui', complete: true, raw: found.list, node });
    let total = 0;
    for (const s of next) if (s.kind === 'markdown') total += words(s.text);
    out = { segments: next, cites: cited ? found.items.length : 0, research: total > RESEARCH_WORDS };
  }
  cache.set(segments, out);
  return out;
}
