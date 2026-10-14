/**
 * Small, dependency-free Markdown parser for assistant answers (CommonMark/GFM subset):
 * headings, paragraphs, (nested/task) lists, fenced code, block quotes, simple tables, hr;
 * inline: **bold**, *italic*, ***both***, ~~strike~~, `code`, [links](url), ![images](url), autolinks, hard breaks.
 * A paragraph made only of images becomes an `images` block (rendered as picture / grid).
 *
 * Streaming-friendly: an unclosed code fence becomes an open code block, and with
 * `partial: true` an unclosed trailing `**`/`` ` `` styles the rest instead of flashing
 * the raw markers. Blocks carry their raw source (`src`) so the renderer can memoize them –
 * while streaming only the last block changes.
 *
 * Pure TS (erasable syntax only) so `node --test` can run it.
 */

export type Inline =
  | { t: 'text'; s: string }
  | { t: 'code'; s: string }
  | { t: 'br' }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'del'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'image'; href: string; alt: string }
  /**
   * footnote reference `[^3]` / `【3】` / (with `cites`) `[3]`, `[1][2]`, `[1, 2]` – 1-based `n`, `raw` = source
   * text for the plain fallback (a group `[1, 2]` → raw on its first node, '' on the others)
   */
  | { t: 'fn'; n: number; raw: string };

export type Align = 'left' | 'center' | 'right' | null;

export type MdListItem = { text: string; checked: boolean | null; children: MdBlock[] };

export type MdBlock =
  | { type: 'heading'; level: number; text: string; src: string }
  | { type: 'paragraph'; text: string; src: string }
  | { type: 'code'; lang: string; code: string; closed: boolean; src: string }
  | { type: 'list'; ordered: boolean; start: number; items: MdListItem[]; src: string }
  | { type: 'quote'; blocks: MdBlock[]; src: string }
  | { type: 'table'; header: string[]; align: Align[]; rows: string[][]; src: string }
  | { type: 'images'; items: { alt: string; href: string }[]; src: string }
  | { type: 'hr'; src: string };

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_RE = /^ {0,3}>[ \t]?/;
const LIST_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const EMPTY_LIST_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]*$/;
const TABLE_SEP_RE = /^[ \t]*\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/;

function indentWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += ch === '\t' ? 4 : 1;
  return w;
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '`') {
      inCode = !inCode;
      cur += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    QUOTE_RE.test(line) ||
    LIST_RE.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_SEP_RE.test(next) && next.includes('-'))
  );
}

export function parseMarkdown(text: string): MdBlock[] {
  return parseLines(splitLines(text));
}

/**
 * Lines of `text` (CRLF / CR normalised). Runs on the re-parsed tail on every streaming update: the CR regex is
 * only applied when there is a CR (Hermes' regex interpreter visits every char even when nothing matches).
 */
function splitLines(text: string): string[] {
  return (text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text).split('\n');
}

/** `s` without one trailing `\n` (same as `s.replace(/\n$/, '')` without a regex scan of the whole string) */
export function dropFinalNewline(s: string): string {
  return s.endsWith('\n') ? s.slice(0, -1) : s;
}

/** Result of `parseMarkdownIncremental`; pass it back in with the grown text. */
export type MdParseState = {
  text: string;
  blocks: MdBlock[];
  /** blocks[0..stable) can no longer change when text is appended */
  stable: number;
  /** char offset in `text` where blocks[stable] starts (re-parse from here) */
  stableOffset: number;
};

/**
 * Streaming variant of `parseMarkdown`: when `text` extends `prev.text`, the stable prefix blocks are
 * reused (same objects) and only the tail from the first unstable block on is re-parsed – O(tail)
 * instead of O(text) per update. Same result as `parseMarkdown(text)`.
 *
 * Why this is exact: `parseLines` carries no state between top-level blocks; block k's extent and
 * content depend only on its own lines plus a lookahead of at most one line past the start of block
 * k+1. Lines before the last one are complete (more text can only extend the last line), so a block
 * is final once `start(k+1) + 1` is a complete line.
 */
export function parseMarkdownIncremental(text: string, prev?: MdParseState | null): MdParseState {
  if (prev && prev.text === text) return prev;
  // CR normalisation could merge across the old end ("\r" + "\n"): rare, take the full path
  const reuse = !!prev && !text.includes('\r') && text.startsWith(prev.text);
  const head = reuse ? prev!.blocks.slice(0, prev!.stable) : [];
  const offset = reuse ? prev!.stableOffset : 0;
  const lines = splitLines(offset ? text.slice(offset) : text);
  const starts: number[] = [];
  const tail = parseLines(lines, starts);
  const lastComplete = lines.length - 2;
  let m = 0;
  while (m < tail.length - 1 && starts[m + 1] + 1 <= lastComplete) m++;
  let off = 0;
  if (m > 0) for (let l = 0; l < starts[m]; l++) off += lines[l].length + 1;
  return { text, blocks: head.length ? head.concat(tail) : tail, stable: head.length + m, stableOffset: offset + off };
}

/** `starts` (optional out): line index where each returned block starts. */
/**
 * Nesting budget for block containers (quotes / list items) and inline spans (links, emphasis …).
 * Deeper content is kept as literal text: `"> ".repeat(5000)` or 3 000 nested link labels used to
 * overflow the stack (and re-parse each level, i.e. quadratic work) and blank the whole message.
 */
export const MAX_BLOCK_DEPTH = 16;
export const MAX_INLINE_DEPTH = 16;

function parseLines(lines: string[], starts?: number[], depth = 0): MdBlock[] {
  const out: MdBlock[] = [];
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    // every non-blank iteration below pushes exactly one block
    if (starts) starts[out.length] = i;

    // fenced code
    const fm = FENCE_RE.exec(line);
    if (fm) {
      const fence = fm[1];
      const ch = fence[0];
      const indent = line.length - line.trimStart().length;
      const body: string[] = [];
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const t = lines[j].trimStart();
        let k = 0;
        while (k < t.length && t[k] === ch) k++;
        if (k >= fence.length && t.slice(k).trim() === '' && lines[j].length - t.length <= 3) {
          closed = true;
          break;
        }
        // strip up to the opening fence's indentation
        let l = lines[j];
        let strip = 0;
        while (strip < indent && l[0] === ' ') {
          l = l.slice(1);
          strip++;
        }
        body.push(l);
        j++;
      }
      out.push({ type: 'code', lang: fm[2] || '', code: body.join('\n'), closed, src: lines.slice(i, closed ? j + 1 : j).join('\n') });
      i = closed ? j + 1 : j;
      continue;
    }

    const hm = HEADING_RE.exec(line);
    if (hm) {
      out.push({ type: 'heading', level: hm[1].length, text: (hm[2] ?? '').trim(), src: line });
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      out.push({ type: 'hr', src: line });
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const body: string[] = [];
      let j = i;
      while (j < n && !isBlank(lines[j])) {
        if (QUOTE_RE.test(lines[j])) body.push(lines[j].replace(QUOTE_RE, ''));
        else if (startsBlock(lines[j], lines[j + 1])) break;
        else body.push(lines[j]); // lazy continuation
        j++;
      }
      const src = lines.slice(i, j).join('\n');
      const blocks: MdBlock[] =
        depth < MAX_BLOCK_DEPTH ? parseLines(body, undefined, depth + 1) : [{ type: 'paragraph', text: body.map((b) => b.trim()).join('\n'), src: body.join('\n') }];
      out.push({ type: 'quote', blocks, src });
      i = j;
      continue;
    }

    // table: header row + separator row
    if (line.includes('|') && i + 1 < n && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitRow(line);
      const align: Align[] = splitRow(lines[i + 1]).map((c) => {
        const l = c.startsWith(':');
        const r = c.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
      });
      const rows: string[][] = [];
      let j = i + 2;
      while (j < n && !isBlank(lines[j]) && lines[j].includes('|')) {
        const cells = splitRow(lines[j]);
        while (cells.length < header.length) cells.push('');
        rows.push(cells.slice(0, header.length));
        j++;
      }
      while (align.length < header.length) align.push(null);
      out.push({ type: 'table', header, align: align.slice(0, header.length), rows, src: lines.slice(i, j).join('\n') });
      i = j;
      continue;
    }

    if (LIST_RE.test(line)) {
      const { block, next } = parseList(lines, i, depth);
      out.push(block);
      i = next;
      continue;
    }

    // paragraph
    const para: string[] = [line];
    let j = i + 1;
    while (j < n && !isBlank(lines[j])) {
      const l = lines[j];
      // setext heading underline
      if (/^ {0,3}=+[ \t]*$/.test(l) || (/^ {0,3}-+[ \t]*$/.test(l) && para.length > 0 && !HR_RE.test(l))) {
        const level = l.trim()[0] === '=' ? 1 : 2;
        out.push({ type: 'heading', level, text: para.join(' ').trim(), src: lines.slice(i, j + 1).join('\n') });
        para.length = 0;
        j++;
        break;
      }
      if (startsBlock(l, lines[j + 1])) break;
      para.push(l);
      j++;
    }
    if (para.length) {
      const text = para.map((p) => p.trim()).join('\n');
      const src = lines.slice(i, j).join('\n');
      const items = standaloneImages(text);
      out.push(items ? { type: 'images', items, src } : { type: 'paragraph', text, src });
    }
    i = j;
  }
  return out;
}

/**
 * Lines inside fenced code (fence lines included), for line-based scanners (citation lists, footnote
 * definitions) that must not read code as prose. Fence rules as in `parseLines`: the closer uses the
 * opener's character with at least its length and nothing after it. Deliberately generous about where a
 * fence may sit (any indentation, inside `>` quotes / list items), erring on the side of "code".
 */
export function fencedLineMask(lines: readonly string[]): boolean[] {
  const mask: boolean[] = new Array(lines.length).fill(false);
  let open: { ch: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/^(?:[ \t]*>)*/, '').trimStart();
    if (open) {
      mask[i] = true;
      let k = 0;
      while (k < t.length && t[k] === open.ch) k++;
      if (k >= open.len && t.slice(k).trim() === '') open = null;
      continue;
    }
    const m = /^(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/.exec(t);
    if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
      open = { ch: m[1][0], len: m[1].length };
      mask[i] = true;
    }
  }
  return mask;
}

/** Paragraph text consisting only of `![alt](url)` tokens (whitespace/newlines between) → the images, else null. */
export function standaloneImages(text: string): { alt: string; href: string }[] | null {
  if (!text.includes('![')) return null;
  const nodes = parseInline(text);
  const items: { alt: string; href: string }[] = [];
  for (const n of nodes) {
    if (n.t === 'image') items.push({ alt: n.alt, href: n.href });
    else if (n.t === 'br' || (n.t === 'text' && n.s.trim() === '')) continue;
    else return null;
  }
  return items.length ? items : null;
}

type RawItem = { indent: number; ordered: boolean; num: number; lines: string[] };

function parseList(lines: string[], start: number, depth = 0): { block: MdBlock; next: number } {
  const first = LIST_RE.exec(lines[start])!;
  const baseIndent = indentWidth(first[1]);
  const ordered = /\d/.test(first[2]);
  const items: { text: string[]; sub: string[]; num: number }[] = [];
  let i = start;
  const n = lines.length;
  // content indent of current item: lines indented >= this belong to it
  let contentIndent = baseIndent + 2;
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) {
      // a blank line continues the list only if the next non-blank line is an item / indented content
      let k = i + 1;
      while (k < n && isBlank(lines[k])) k++;
      if (k >= n) break;
      const m = LIST_RE.exec(lines[k]);
      const ind = indentWidth(lines[k].match(/^[ \t]*/)![0]);
      if ((m && ind === baseIndent && /\d/.test(m[2]) === ordered) || ind >= contentIndent) {
        if (items.length && ind >= contentIndent) items[items.length - 1].sub.push('');
        i = k;
        continue;
      }
      break;
    }
    const m = LIST_RE.exec(line) ?? EMPTY_LIST_RE.exec(line);
    const ind = indentWidth(line.match(/^[ \t]*/)![0]);
    if (m && ind <= baseIndent + 1 && ind >= baseIndent - 1) {
      if (/\d/.test(m[2]) !== ordered && items.length) break; // different list type
      const marker = m[2];
      items.push({ text: [m[3] ?? ''], sub: [], num: parseInt(marker, 10) || 1 });
      contentIndent = ind + marker.length + 1;
      i++;
      continue;
    }
    if (m && ind < baseIndent - 1) break;
    if (!items.length) break;
    const cur = items[items.length - 1];
    if (ind >= contentIndent - 1 || (m && ind > baseIndent)) {
      cur.sub.push(line);
      i++;
      continue;
    }
    // lazy paragraph continuation (only if no sub-blocks yet and line isn't a new block)
    if (!cur.sub.length && !startsBlock(line, lines[i + 1])) {
      cur.text.push(line.trim());
      i++;
      continue;
    }
    break;
  }
  const mdItems: MdListItem[] = items.map((it) => {
    let text = it.text.join('\n');
    let checked: boolean | null = null;
    const tm = /^\[([ xX])\][ \t]+/.exec(text);
    if (tm) {
      checked = tm[1] !== ' ';
      text = text.slice(tm[0].length);
    }
    // de-indent sub lines by their common indent
    const subLines = it.sub;
    let ind = 99; // no Math.min(...): a huge item would exceed the argument limit
    for (const l of subLines) if (!isBlank(l)) ind = Math.min(ind, indentWidth(l.match(/^[ \t]*/)![0]));
    const children: MdBlock[] = !subLines.length
      ? []
      : depth < MAX_BLOCK_DEPTH
        ? parseLines(subLines.map((l) => stripIndent(l, ind)), undefined, depth + 1)
        : [{ type: 'paragraph', text: subLines.map((l) => l.trim()).join('\n'), src: subLines.join('\n') }];
    // a sub-paragraph directly following the item text is merged into it
    if (children[0]?.type === 'paragraph' && it.sub[0] !== '') {
      text += '\n' + children[0].text;
      children.shift();
    }
    return { text, checked, children };
  });
  return {
    block: { type: 'list', ordered, start: items[0]?.num ?? 1, items: mdItems, src: lines.slice(start, i).join('\n') },
    next: i,
  };
}

function stripIndent(line: string, n: number): string {
  let i = 0;
  let w = 0;
  while (i < line.length && w < n && (line[i] === ' ' || line[i] === '\t')) {
    w += line[i] === '\t' ? 4 : 1;
    i++;
  }
  return line.slice(i);
}

// ---------------------------------------------------------------- inline

const PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
/** sticky (`lastIndex` = position): matches in place, no `src.slice(i)` copy per h-word */
const URL_RE = /https?:\/\/[^\s<>()]*(?:\([^\s<>()]*\)[^\s<>()]*)*/y;
/** Every character / URL prefix that can start an inline construct in the scanner below. */
const INLINE_SYNTAX_RE = /[\\\n`!\[【*_~]|https?:\/\//;
/** the same, global: from `lastIndex`, where the next such character is (the scanner copies plain text up to it at once) */
const INLINE_NEXT_RE = new RegExp(INLINE_SYNTAX_RE.source, 'g');

/**
 * Per-call lookup tables that keep `parseInline` linear on adversarial input (long paragraphs
 * with many unclosed `*`/`_`/`~~` or `[`): each built lazily, at most once per call.
 */
class InlineScan {
  private noCloseFrom = new Map<string, number>();
  private lastIdx = new Map<string, number>();
  private brackets: Int32Array | null = null;
  private parens: Int32Array | null = null;
  readonly src: string;
  constructor(src: string) {
    this.src = src;
  }

  /** findDelim with memo: once no closer exists after `from`, none exists after any later start. */
  delim(from: number, delim: string, ch: string): number {
    const known = this.noCloseFrom.get(delim);
    if (known !== undefined && from >= known) return -1;
    const r = findDelim(this.src, from, delim, ch);
    if (r < 0) this.noCloseFrom.set(delim, known === undefined ? from : Math.min(known, from));
    return r;
  }

  /** `src.slice(from).includes(s)` in O(1) after the first call */
  hasAfter(s: string, from: number): boolean {
    let k = this.lastIdx.get(s);
    if (k === undefined) this.lastIdx.set(s, (k = this.src.lastIndexOf(s)));
    return k >= from;
  }

  /** index of the `]` closing the `[` at `i` (escapes skipped, a blank line `\n\n` aborts), or -1 */
  bracketClose(i: number): number {
    if (!this.brackets) {
      const src = this.src;
      const m = new Int32Array(src.length).fill(-1);
      const stack: number[] = [];
      // only the chars that matter, found natively (the live paragraph is re-parsed on every streaming update)
      const re = /[\\[\]\n]/g;
      for (let hit = re.exec(src); hit; hit = re.exec(src)) {
        const k = hit.index;
        const c = src[k];
        if (c === '\\') re.lastIndex = k + 2; // the escaped char is skipped
        else if (c === '[') stack.push(k);
        else if (c === ']') {
          const o = stack.pop();
          if (o !== undefined) m[o] = k;
        } else if (src[k + 1] === '\n') stack.length = 0;
      }
      this.brackets = m;
    }
    return this.brackets[i] ?? -1;
  }

  /** index of the `)` closing the `(` at `i` within the same line (no escapes), or -1 */
  parenClose(i: number): number {
    if (!this.parens) {
      const src = this.src;
      const m = new Int32Array(src.length).fill(-1);
      const stack: number[] = [];
      const re = /[()\n]/g;
      for (let hit = re.exec(src); hit; hit = re.exec(src)) {
        const k = hit.index;
        const c = src[k];
        if (c === '(') stack.push(k);
        else if (c === ')') {
          const o = stack.pop();
          if (o !== undefined) m[o] = k;
        } else stack.length = 0;
      }
      this.parens = m;
    }
    return this.parens[i] ?? -1;
  }
}

export type InlineOptions = {
  partial?: boolean;
  /**
   * Hermes-style numeric citations: `[n]` (also `[1][2]`, `[1, 2]`) with 1 ≤ n ≤ `cites` become fn nodes.
   * Only set when the answer ends with a matching numbered sources list (answers/citations.ts) – plain
   * "[1]" text elsewhere stays text. 0 / undefined = off.
   */
  cites?: number;
  /** @internal nesting level (link labels, emphasis); past MAX_INLINE_DEPTH the rest stays literal text */
  depth?: number;
};

export function parseInline(src: string, opts: InlineOptions = {}): Inline[] {
  const depth = opts.depth ?? 0;
  if (depth >= MAX_INLINE_DEPTH) return src ? [{ t: 'text', s: src }] : [];
  // Ordinary prose is common in the growing last paragraph. Preserve the original string instead
  // of walking and concatenating every character again on each streaming update (and in span bodies).
  if (!INLINE_SYNTAX_RE.test(src)) return src ? [{ t: 'text', s: src }] : [];
  const sub: InlineOptions = { ...opts, depth: depth + 1 };
  const scan = new InlineScan(src);
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) {
      const last = out[out.length - 1];
      if (last && last.t === 'text') last.s += buf;
      else out.push({ t: 'text', s: buf });
      buf = '';
    }
  };
  const push = (node: Inline) => {
    flush();
    out.push(node);
  };
  const n = src.length;
  let i = 0;
  while (i < n) {
    const ch = src[i];

    if (ch === '\\' && i + 1 < n) {
      const nx = src[i + 1];
      if (nx === '\n') {
        push({ t: 'br' });
        i += 2;
        continue;
      }
      if (PUNCT.includes(nx)) {
        buf += nx;
        i += 2;
        continue;
      }
    }

    if (ch === '\n') {
      buf = buf.replace(/ +$/, '');
      push({ t: 'br' });
      i++;
      while (src[i] === ' ') i++;
      continue;
    }

    if (ch === '`') {
      let k = i;
      while (src[k] === '`') k++;
      const ticks = src.slice(i, k);
      const close = findTicks(src, k, ticks.length);
      if (close >= 0) {
        let code = src.slice(k, close).replace(/\n/g, ' ');
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
        push({ t: 'code', s: code });
        i = close + ticks.length;
        continue;
      }
      if (opts.partial && ticks.length === 1) {
        push({ t: 'code', s: src.slice(k) });
        i = n;
        continue;
      }
      buf += ticks;
      i = k;
      continue;
    }

    if (ch === '!' && src[i + 1] === '[') {
      const img = matchLink(scan, i + 1);
      if (img && img.href) {
        push({ t: 'image', href: img.href, alt: inlineToPlain(parseInline(img.label, { depth: depth + 1 })) });
        i = img.end;
        continue;
      }
    }

    if (ch === '[' && src[i + 1] === '^') {
      const fn = matchFootnote(src, i + 2, ']');
      if (fn) {
        push({ t: 'fn', n: fn.n, raw: src.slice(i, fn.end) });
        i = fn.end;
        continue;
      }
    }

    if (ch === '【') {
      const fn = matchFootnote(src, i + 1, '】');
      if (fn) {
        push({ t: 'fn', n: fn.n, raw: src.slice(i, fn.end) });
        i = fn.end;
        continue;
      }
    }

    if (ch === '[' && opts.cites && src.charCodeAt(i + 1) >= 48 && src.charCodeAt(i + 1) <= 57) {
      const c = matchCites(src, i, opts.cites);
      if (c) {
        for (const g of c.groups) g.ns.forEach((n, k) => push({ t: 'fn', n, raw: k === 0 ? src.slice(g.from, g.to) : '' }));
        i = c.end;
        continue;
      }
    }

    if (ch === '[') {
      const link = matchLink(scan, i);
      if (link) {
        push({ t: 'link', href: link.href, c: parseInline(link.label, sub) });
        i = link.end;
        continue;
      }
    }

    if ((ch === 'h' || ch === 'H') && (i === 0 || /[\s(]/.test(src[i - 1]))) {
      URL_RE.lastIndex = i;
      const m = URL_RE.exec(src);
      if (m && m[0].length > 8) {
        const url = m[0].replace(/[.,;:!?'"]+$/, '');
        push({ t: 'link', href: url, c: [{ t: 'text', s: url }] });
        i += url.length;
        continue;
      }
    }

    if (ch === '*' || ch === '_' || ch === '~') {
      let k = i;
      while (src[k] === ch) k++;
      const run = k - i;
      const prev = i > 0 ? src[i - 1] : ' ';
      const next = src[k] ?? ' ';
      const canOpen = next.trim() !== '' && !(ch === '_' && /[A-Za-z0-9]/.test(prev));
      if (ch === '~') {
        if (run === 2 && canOpen) {
          const close = scan.delim(k, '~~', ch);
          if (close >= 0) {
            push({ t: 'del', c: parseInline(src.slice(k, close), sub) });
            i = close + 2;
            continue;
          }
        }
        buf += src.slice(i, k);
        i = k;
        continue;
      }
      if (canOpen && run <= 3) {
        const use = run;
        const delim = ch.repeat(use);
        const close = scan.delim(i + use, delim, ch);
        if (close >= 0) {
          const inner = parseInline(src.slice(i + use, close), sub);
          push(wrap(use, inner));
          i = close + use;
          continue;
        }
        if (opts.partial && use >= 2 && !scan.hasAfter(delim, i + use)) {
          const rest = src.slice(i + use);
          if (rest.trim()) push(wrap(use, parseInline(rest, sub)));
          i = n;
          continue;
        }
      }
      buf += src.slice(i, k);
      i = k;
      continue;
    }

    // plain text: every char up to the next one that can start a construct (INLINE_SYNTAX_RE; an `h` can only start
    // a URL as `http(s)://`) would land here one by one – copy the run at once (native search instead of one
    // interpreted loop turn per char, the live paragraph is re-parsed on every streaming update)
    INLINE_NEXT_RE.lastIndex = i + 1;
    const next = INLINE_NEXT_RE.exec(src);
    const to = next ? next.index : n;
    buf += src.slice(i, to);
    i = to;
  }
  flush();
  return out;
}

function wrap(n: number, c: Inline[]): Inline {
  if (n === 1) return { t: 'em', c };
  if (n === 2) return { t: 'strong', c };
  return { t: 'strong', c: [{ t: 'em', c }] };
}

function findTicks(src: string, from: number, len: number): number {
  let i = from;
  while (i < src.length) {
    if (src[i] === '`') {
      let k = i;
      while (src[k] === '`') k++;
      if (k - i === len) return i;
      i = k;
    } else i++;
  }
  return -1;
}

/** Find a closing delimiter run of exactly `delim` (not preceded by whitespace), skipping code spans. */
function findDelim(src: string, from: number, delim: string, ch: string): number {
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') {
      let k = i;
      while (src[k] === '`') k++;
      const close = findTicks(src, k, k - i);
      i = close >= 0 ? close + (k - i) : k;
      continue;
    }
    if (c === ch) {
      let k = i;
      while (src[k] === ch) k++;
      const run = k - i;
      const prev = src[i - 1] ?? ' ';
      const after = src[k] ?? ' ';
      const okBoundary = ch !== '_' || !/[A-Za-z0-9]/.test(after);
      if (i > from && prev.trim() !== '' && okBoundary) {
        if (run === delim.length) return i;
        // e.g. closing "***" for "**": the delimiter is at the end of the run
        if (run > delim.length && delim.length >= 2) return k - delim.length;
      }
      i = k;
      continue;
    }
    i++;
  }
  return -1;
}

/** `[^12]` / `【12】` body: 1–3 digits (1…999) + the closer at `from`; bounded look-ahead keeps the scan linear */
function matchFootnote(src: string, from: number, close: string): { n: number; end: number } | null {
  let k = from;
  while (k < src.length && k - from < 3 && src.charCodeAt(k) >= 48 && src.charCodeAt(k) <= 57) k++;
  if (k === from || src[k] !== close) return null;
  const n = parseInt(src.slice(from, k), 10);
  return n >= 1 ? { n, end: k + 1 } : null;
}

const MAX_CITE_GROUP = 12;

/**
 * `[1]` / `[1][2]` / `[1, 2]` at `from`: numbers 1…max (≤ 3 digits), groups not followed by `(` (a link
 * label) – bounded look-ahead per group keeps the scan linear. null when the first group does not match.
 */
function matchCites(src: string, from: number, max: number): { groups: { ns: number[]; from: number; to: number }[]; end: number } | null {
  const groups: { ns: number[]; from: number; to: number }[] = [];
  let k = from;
  while (src[k] === '[' && groups.length < MAX_CITE_GROUP) {
    const ns: number[] = [];
    let j = k + 1;
    let ok = false;
    while (ns.length < MAX_CITE_GROUP) {
      const d0 = j;
      while (j < src.length && j - d0 < 3 && src.charCodeAt(j) >= 48 && src.charCodeAt(j) <= 57) j++;
      if (j === d0) break;
      const n = parseInt(src.slice(d0, j), 10);
      if (n < 1 || n > max) break;
      ns.push(n);
      if (src[j] === ']') {
        j++;
        ok = true;
        break;
      }
      if (src[j] !== ',') break;
      j++;
      while (src[j] === ' ') j++;
    }
    if (!ok || src[j] === '(') break;
    groups.push({ ns, from: k, to: j });
    k = j;
  }
  return groups.length ? { groups, end: k } : null;
}

function matchLink(scan: InlineScan, start: number): { label: string; href: string; end: number } | null {
  const src = scan.src;
  const i = scan.bracketClose(start);
  if (i < 0 || src[i + 1] !== '(') return null;
  const label = src.slice(start + 1, i);
  const j = scan.parenClose(i + 1);
  if (j < 0) return null;
  let target = src.slice(i + 2, j).trim();
  // strip optional title: (url "title")
  const tm = /^(\S+)\s+["'(].*["')]$/.exec(target);
  if (tm) target = tm[1];
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  return { label, href: target, end: j + 1 };
}

/** Plain text of inline markdown (for copy / accessibility). */
export function inlineToPlain(nodes: Inline[]): string {
  return nodes
    .map((x) => (x.t === 'text' || x.t === 'code' ? x.s : x.t === 'br' ? '\n' : x.t === 'image' ? x.alt : x.t === 'fn' ? x.raw : inlineToPlain(x.c)))
    .join('');
}

/** Only allow safe link schemes to be opened. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^(https?:|mailto:|tel:)/i.test(h)) return h;
  if (/^www\./i.test(h)) return `https://${h}`;
  return null;
}
