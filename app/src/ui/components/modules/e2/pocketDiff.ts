/**
 * Ported from Pi Pocket `web/diff-parse.js` (github.com/TannerMidd/pi-pocket, commit de612d5), MIT,
 * © 2026 Tanner Middleton – see NOTICE.md. Pure, no DOM / React Native.
 *
 * - `unquote` / `headerPaths`: paths as git writes them (C-quoted, spaces in bare `diff --git` paths)
 * - `parseEditCard`: Pi's edit cards (`+12 text`, `-12 text`, ` 12 text`, `...` gaps)
 * - `alignRun`: a run of removed lines paired with the added lines after it BY LIKENESS (Dice coefficient of letter
 *   pairs), not by position, so a changed line sits next to its new version when lines were added around it
 * - `fingerprint` (FNV-1a), `changeCells` (GitHub-style 5-cell bar)
 */

/** The C escapes git writes in a quoted path, besides `\"`, `\\`, and bytes in octal. */
const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

/** UTF-8 bytes of a string (no TextEncoder: not every JS engine of the app has it) */
function utf8(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** UTF-8 bytes → string; an invalid sequence becomes U+FFFD */
function fromUtf8(b: readonly number[]): string {
  let out = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i];
    const n = c < 0x80 ? 0 : c >= 0xf0 && c < 0xf8 ? 3 : c >= 0xe0 ? 2 : c >= 0xc0 ? 1 : -1;
    if (n < 0) {
      out += '\ufffd';
      i++;
      continue;
    }
    let cp = n === 0 ? c : c & (0x3f >> n);
    let ok = true;
    for (let k = 1; k <= n; k++) {
      const x = b[i + k];
      if (x === undefined || (x & 0xc0) !== 0x80) {
        ok = false;
        break;
      }
      cp = (cp << 6) | (x & 63);
    }
    out += ok ? String.fromCodePoint(cp) : '\ufffd';
    i += ok ? n + 1 : 1;
  }
  return out;
}

/** A path as git writes it: in C quotes when it holds odd characters (`"caf\303\251.txt"`), else bare. */
export function unquote(path: string): string {
  if (!/^".*"$/.test(path)) return path;
  // pieces of text, and between them the escapes, each one byte
  const bytes = path
    .slice(1, -1)
    .split(/(\\[0-7]{3}|\\.)/)
    .flatMap((piece, index) => {
      if (index % 2 === 0) return utf8(piece);
      const code = piece.slice(1);
      return [code.length === 3 ? parseInt(code, 8) : (ESCAPES[code] ?? code.charCodeAt(0))];
    });
  return fromUtf8(bytes);
}

/** A path from a `---` / `+++` line or a `diff --git` half: without its `a/` or `b/`, unquoted; null for /dev/null. */
export function cleanPath(raw: string): string | null {
  const path = unquote(raw.replace(/\t.*$/, '').trim());
  if (path === '' || path === '/dev/null') return null;
  return path.replace(/^[ab]\//, '');
}

/**
 * The two paths of a `diff --git` line, as written. Bare paths can hold spaces, so this splits as git does: where the
 * halves name the same file (they do unless the file was renamed; then its `rename` lines say the paths).
 */
export function headerPaths(rest: string): [string, string] {
  const quoted = /^("(?:[^"\\]|\\.)*") (.+)$/.exec(rest) ?? /^(.+) ("(?:[^"\\]|\\.)*")$/.exec(rest);
  if (quoted) return [quoted[1], quoted[2]];
  const half = (rest.length - 1) / 2;
  const left = rest.slice(0, half);
  const right = rest.slice(half + 1);
  if (rest[half] === ' ' && cleanPath(left) === cleanPath(right)) return [left, right];
  const at = rest.indexOf(' b/');
  if (at > 0) return [rest.slice(0, at), rest.slice(at + 1)];
  const parts = rest.split(' ');
  return [parts[0] ?? '', parts[1] ?? ''];
}

export type CardLine = { kind: 'add' | 'del' | 'ctx'; text: string; oldNo?: number; newNo: number | undefined };
export type CardHunk = { oldStart: number; newStart: number; lines: CardLine[] };

/** Pi's edit-card line: sign, line number, text */
const CARD_LINE = /^([+\- ])\s*(\d+)(?: (.*))?$/;

/** Text reads as Pi's edit format (and not as a unified diff). */
export function isEditCard(text: string): boolean {
  return !/^(diff --git |--- |\+\+\+ |@@ -\d)/m.test(text) && /^[+-]\s*\d+(?: |$)/m.test(text);
}

/**
 * Pi's edit cards: `+12 text` added at new line 12, `-12 text` removed from old line 12, ` 12 text` unchanged at old
 * line 12, and a line of only `...` where unchanged lines are left out. Every change is shown, so an unchanged line's
 * new number is its old one moved by the lines added and removed above it.
 */
export function parseEditCard(text: string): CardHunk[] {
  const hunks: CardHunk[] = [];
  let hunk: CardHunk | null = null;
  let shift = 0;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const match = CARD_LINE.exec(line);
    if (!match) {
      // a line of `...` is a gap: the next line starts a new hunk; any other line is not part of the diff
      if (hunk !== null && /^\s*\.\.\.\s*$/.test(line)) hunk = null;
      continue;
    }
    const [, sign, number, body = ''] = match;
    const at = Number(number);
    let entry: CardLine;
    if (sign === '+') {
      entry = { kind: 'add', text: body, newNo: at };
      shift++;
    } else if (sign === '-') {
      entry = { kind: 'del', text: body, oldNo: at, newNo: undefined };
      shift--;
    } else entry = { kind: 'ctx', text: body, oldNo: at, newNo: at + shift };
    if (hunk === null) {
      const oldStart = entry.oldNo ?? at - shift + (sign === '+' ? 1 : 0);
      const newStart = entry.newNo ?? at + shift + (sign === '-' ? 1 : 0);
      hunk = { oldStart, newStart, lines: [] };
      hunks.push(hunk);
    }
    hunk.lines.push(entry);
  }
  return hunks;
}

/** Past this many lines on a side, a run pairs its lines in order instead of by likeness. */
const MAX_ALIGN = 40;
/** How alike two lines must be to pair them, from 0 to 1. */
const PAIR_FROM = 0.45;

type Bigrams = { counts: Map<string, number>; size: number };

/** Pairs of letters in a line, counted: what `likeness` compares. */
function bigrams(text: string): Bigrams {
  const counts = new Map<string, number>();
  const value = text.trim();
  for (let i = 0; i < value.length - 1; i++) {
    const pair = value.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return { counts, size: Math.max(0, value.length - 1) };
}

/** How alike two lines are, from 0 to 1: the share of letter pairs they have in common (Dice's coefficient). */
function likeness(a: Bigrams, b: Bigrams): number {
  if (a.size === 0 || b.size === 0) return a.size === b.size ? 1 : 0;
  let shared = 0;
  for (const [pair, count] of a.counts) shared += Math.min(count, b.counts.get(pair) ?? 0);
  return (2 * shared) / (a.size + b.size);
}

/** Line likeness 0..1 (exported for tests). */
export function lineLikeness(a: string, b: string): number {
  return likeness(bigrams(a), bigrams(b));
}

/**
 * A run of removed lines and the added lines after it, paired where they are alike, as `[removed, added]` index pairs
 * (-1 = pairs with none). Unpaired neighbours still share a row in split view: a removed line, then an added one.
 */
export function alignRun(dels: readonly string[], adds: readonly string[]): [number, number][] {
  if (dels.length === 0 || adds.length === 0 || dels.length * adds.length > MAX_ALIGN * MAX_ALIGN) {
    const count = Math.max(dels.length, adds.length);
    return Array.from({ length: count }, (_, i): [number, number] => [i < dels.length ? i : -1, i < adds.length ? i : -1]);
  }
  const a = dels.map(bigrams);
  const b = adds.map(bigrams);
  const width = adds.length + 1;
  const score = new Float64Array((dels.length + 1) * width);
  const sim = new Float64Array(dels.length * adds.length);
  for (let i = 0; i < dels.length; i++) for (let j = 0; j < adds.length; j++) sim[i * adds.length + j] = likeness(a[i], b[j]);
  const alike = (i: number, j: number) => sim[i * adds.length + j];
  for (let i = 1; i <= dels.length; i++) {
    for (let j = 1; j <= adds.length; j++) {
      const pair = alike(i - 1, j - 1);
      score[i * width + j] = Math.max(score[(i - 1) * width + j], score[i * width + j - 1], pair >= PAIR_FROM ? score[(i - 1) * width + j - 1] + pair : 0);
    }
  }
  const pairs: [number, number][] = [];
  for (let i = dels.length, j = adds.length; i > 0 || j > 0; ) {
    if (i > 0 && j > 0) {
      const pair = alike(i - 1, j - 1);
      if (pair >= PAIR_FROM && score[i * width + j] === score[(i - 1) * width + j - 1] + pair) {
        pairs.push([--i, --j]);
        continue;
      }
    }
    if (j > 0 && (i === 0 || score[i * width + j - 1] >= score[(i - 1) * width + j])) pairs.push([-1, --j]);
    else pairs.push([--i, -1]);
  }
  pairs.reverse();
  const rows: { pair: [number, number]; unpaired?: boolean }[] = [];
  for (const pair of pairs) {
    const last = rows[rows.length - 1];
    if (pair[0] === -1 && last && last.pair[1] === -1 && last.unpaired) {
      last.pair[1] = pair[1];
      last.unpaired = false;
      continue;
    }
    rows.push({ pair: [pair[0], pair[1]], unpaired: pair[1] === -1 });
  }
  return rows.map((r) => r.pair);
}

/** A short, stable fingerprint of text (FNV-1a), to tell whether a file's diff changed since it was marked viewed. */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** The five cells of a change bar, as GitHub draws it: added, removed and unchanged cells, in proportion. */
export function changeCells(added = 0, removed = 0): ('add' | 'del' | '')[] {
  const total = added + removed;
  if (total === 0) return ['', '', '', '', ''];
  const cells = Math.min(5, Math.max(1, Math.ceil(Math.log10(total + 1) * 1.6)));
  // each side that changed at all gets a cell, when there are two to share
  const green = Math.min(cells - (removed > 0 && cells > 1 ? 1 : 0), Math.max(added > 0 ? 1 : 0, Math.round((added / total) * cells)));
  const red = cells - green;
  return [...Array<'add'>(green).fill('add'), ...Array<'del'>(red).fill('del'), ...Array<''>(5 - cells).fill('')];
}
