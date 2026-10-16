/**
 * `diff` – pure model (node:test). Parses standard unified diff text (git diff / diff -u, several files, also a bare
 * `-`/`+` snippet without headers) INCREMENTALLY: a growing patch only parses its new complete lines and every finished
 * file / hunk / line keeps its object identity, so memoized rows skip re-rendering while an answer streams. Structured
 * `files` (hunks, a per-file patch or before / after texts → Myers line diff) map onto the same model.
 *
 * Render helpers: unified rows with long unchanged runs folded ("… 42 unchanged lines"), split (side-by-side) rows,
 * cheap intra-line word highlight for paired -/+ lines, and the patch text of one file for copying.
 *
 * The pairing of a change's lines (alignRun) and the per-pair word highlight with its token pattern follow Pi Pocket's
 * `hunkRows` / `wordDiff` (web/diff-parse.js, github.com/TannerMidd/pi-pocket, commit de612d5), MIT,
 * © 2026 Tanner Middleton – see NOTICE.md.
 */
import type { HuiDiffFile, HuiDiffHunk, HuiFileStatus } from '../../../types';
import { DEL, EQ, INS, editScript } from './myers.ts';
import { alignRun, cleanPath, headerPaths } from './pocketDiff.ts';
import { extendsText } from './appendCheck.ts';

export type DiffLineKind = 'add' | 'del' | 'ctx' | 'meta';
/** one diff line; `oldNo` / `newNo` are absent in a snippet without hunk headers */
export type DiffLine = { kind: DiffLineKind; text: string; oldNo?: number; newNo?: number };
export type DiffHunkModel = {
  key: string;
  /** the `@@ -a,b +c,d @@` part ('' for a headerless snippet) */
  range: string;
  /** function context after the second `@@` */
  section?: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
  /** no more lines can arrive (next hunk / file started, counts used up, stream ended) */
  closed: boolean;
};
export type DiffFileModel = {
  key: string;
  path: string;
  oldPath?: string;
  status: HuiFileStatus;
  language?: string;
  binary: boolean;
  hunks: DiffHunkModel[];
  additions: number;
  deletions: number;
  /** line numbers known (hunk headers present) */
  numbered: boolean;
};

const HUNK_RE = /^@@+ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@+ ?(.*)$/;
/** first lines that mean "this is real unified diff text" (else: an edit card or a headerless `-`/`+` snippet) */
const HEADER_START_RE = /^(diff |--- |\+\+\+ |@@ |Index: |commit |From |index |new file mode|deleted file mode|similarity index|rename from|Binary files )/;
/** a file header pair as git / diff -u write it (`--- a/x`, `+++ b/x`, /dev/null, `--- x<TAB>date`) */
const OLD_HEADER_RE = /^--- (a\/|\/dev\/null$|\S+\t)/;
const NEW_HEADER_RE = /^\+\+\+ (b\/|\/dev\/null$|\S+\t)/;
/** Pi edit-card line: sign, line number, text (pocketDiff.parseEditCard) */
const CARD_LINE_RE = /^([+\- ])\s*(\d+)(?: (.*))?$/;

function stripPath(p: string): string | undefined {
  return cleanPath(p) ?? undefined;
}

type MutFile = {
  key: string;
  path: string;
  oldPath?: string;
  status?: HuiFileStatus;
  binary: boolean;
  hunks: MutHunk[];
  additions: number;
  deletions: number;
  numbered: boolean;
  /** --- seen, waiting for +++ */
  sawOld: boolean;
  version: number;
  snap?: DiffFileModel;
  snapVersion: number;
};
type MutHunk = {
  key: string;
  range: string;
  section?: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
  oldLeft: number;
  newLeft: number;
  oldNo: number;
  newNo: number;
  closed: boolean;
  version: number;
  snap?: DiffHunkModel;
  snapVersion: number;
};

export type DiffParser = {
  /** model of `text` (the whole patch so far); `final` = no more text follows (the last line counts) */
  update(text: string, final: boolean): DiffFileModel[];
};

/**
 * Incremental unified-diff parser. `update` with a text that extends the previous one parses only the new complete
 * lines; any other text starts over. Results share unchanged files / hunks / lines with the previous result.
 */
export function createDiffParser(): DiffParser {
  let src = '';
  let consumed = 0; // chars of `src` fed as complete lines
  let finalized = false;
  let files: MutFile[] = [];
  let mode: 'unknown' | 'unified' | 'card' | 'loose' = 'unknown';
  let cardShift = 0; // edit cards: added − removed lines so far (new number of an unchanged line)
  let cur: MutFile | null = null;
  let hunk: MutHunk | null = null;
  let lastSnap: DiffFileModel[] = [];
  let prevRaw = ''; // the previous line (a `--- a/x` taken as a removed line, see processLine)

  function reset() {
    src = '';
    consumed = 0;
    finalized = false;
    files = [];
    mode = 'unknown';
    cardShift = 0;
    cur = null;
    hunk = null;
    lastSnap = [];
    prevRaw = '';
  }

  function newFile(path: string, oldPath?: string): MutFile {
    closeHunk();
    const f: MutFile = { key: `f${files.length}`, path, oldPath, binary: false, hunks: [], additions: 0, deletions: 0, numbered: mode !== 'loose', sawOld: false, version: 1, snapVersion: 0 };
    files.push(f);
    cur = f;
    return f;
  }

  function closeHunk() {
    if (hunk && !hunk.closed) {
      hunk.closed = true;
      hunk.version++;
      if (cur) cur.version++;
    }
    hunk = null;
  }

  function newHunk(f: MutFile, range: string, oldStart: number, oldLen: number, newStart: number, newLen: number, section?: string) {
    closeHunk();
    const h: MutHunk = {
      key: `${f.key}h${f.hunks.length}`,
      range,
      section: section || undefined,
      oldStart,
      newStart,
      lines: [],
      oldLeft: oldLen,
      newLeft: newLen,
      oldNo: oldStart,
      newNo: newStart,
      closed: false,
      version: 1,
      snapVersion: 0,
    };
    f.hunks.push(h);
    f.version++;
    hunk = h;
  }

  function addLine(h: MutHunk, f: MutFile, kind: DiffLineKind, text: string) {
    let l: DiffLine;
    if (!f.numbered) l = { kind, text };
    else if (kind === 'add') l = { kind, text, newNo: h.newNo++ };
    else if (kind === 'del') l = { kind, text, oldNo: h.oldNo++ };
    else if (kind === 'ctx') l = { kind, text, oldNo: h.oldNo++, newNo: h.newNo++ };
    else l = { kind, text };
    if (kind === 'add') {
      f.additions++;
      h.newLeft--;
    } else if (kind === 'del') {
      f.deletions++;
      h.oldLeft--;
    } else if (kind === 'ctx') {
      h.oldLeft--;
      h.newLeft--;
    }
    h.lines.push(l);
    h.version++;
    f.version++;
    // counts used up: finished now (memo'd rows settle without waiting for the next header)
    if (f.numbered && h.oldLeft <= 0 && h.newLeft <= 0) h.closed = true;
  }

  /** a numbered hunk with both counts used up takes no more +/-/space lines (a following `--- x` is a header) */
  function hunkFull(h: MutHunk | null): boolean {
    return !h || (cur?.numbered === true && h.oldLeft <= 0 && h.newLeft <= 0);
  }

  function processLine(raw: string) {
    const line = raw.charCodeAt(raw.length - 1) === 13 ? raw.slice(0, -1) : raw;
    const before = prevRaw;
    prevRaw = line;
    if (mode === 'unknown') {
      if (line.trim() === '') return;
      mode = HEADER_START_RE.test(line) ? 'unified' : /^[+-]\s*\d+(?: |$)/.test(line) || CARD_LINE_RE.test(line) ? 'card' : 'loose';
    }
    if (mode === 'loose') return looseLine(line);
    if (mode === 'card') return cardLine(line);
    // a hunk whose `@@` counts were too big (models miscount) swallowed the next file's `--- a/x` as a removed line:
    // `+++ b/x` right after it is that file's header – take the line back and start the file
    if (hunk && !hunkFull(hunk) && OLD_HEADER_RE.test(before) && NEW_HEADER_RE.test(line)) {
      const h = hunk;
      const f = cur!;
      const last = h.lines[h.lines.length - 1];
      if (last?.kind === 'del') {
        h.lines.pop();
        f.deletions--;
        h.version++;
        f.version++;
        closeHunk();
        processLine(before);
        prevRaw = line;
      }
    }
    // inside a numbered hunk: body lines first (a "--- foo" deletion is not a header while counts remain)
    if (hunk && !hunkFull(hunk)) {
      const c = line[0];
      if (c === '+') return addLine(hunk, cur!, 'add', line.slice(1));
      if (c === '-') return addLine(hunk, cur!, 'del', line.slice(1));
      if (c === ' ') return addLine(hunk, cur!, 'ctx', line.slice(1));
      if (c === '\\') return addLine(hunk, cur!, 'meta', line.slice(1).trim());
      // tools that trim trailing whitespace turn an empty context line into ''
      if (line === '') return addLine(hunk, cur!, 'ctx', '');
    }
    if (hunk && line[0] === '\\') return addLine(hunk, cur!, 'meta', line.slice(1).trim());
    if (hunk && hunkFull(hunk)) closeHunk();
    let m: RegExpExecArray | null;
    if (line.startsWith('diff --git ')) {
      const [l, r] = headerPaths(line.slice(11));
      const a = stripPath(l);
      const b = stripPath(r);
      newFile(b ?? a ?? '', a && b && a !== b ? a : undefined);
      return;
    }
    if (line.startsWith('--- ')) {
      // a new file unless this --- belongs to the `diff --git` header just opened
      const p = stripPath(line.slice(4));
      if (!cur || cur.hunks.length > 0 || cur.sawOld) newFile(p ?? '');
      const f = cur!;
      f.sawOld = true;
      if (p === undefined) f.status = 'added';
      else if (!f.path) f.path = p;
      else if (p !== f.path && !f.oldPath) f.oldPath = p;
      f.version++;
      return;
    }
    if (line.startsWith('+++ ') && cur && cur.hunks.length === 0) {
      const p = stripPath(line.slice(4));
      if (p === undefined) {
        cur.status = 'deleted';
        if (!cur.path && cur.oldPath) cur.path = cur.oldPath;
      } else {
        if (cur.path && cur.path !== p && !cur.oldPath) cur.oldPath = cur.path;
        cur.path = p;
      }
      cur.version++;
      return;
    }
    if ((m = HUNK_RE.exec(line))) {
      const f = cur ?? newFile('');
      const oldLen = m[2] === undefined ? 1 : Number(m[2]);
      const newLen = m[4] === undefined ? 1 : Number(m[4]);
      const range = line.slice(0, line.length - m[5].length).trim();
      newHunk(f, range, Number(m[1]), oldLen, Number(m[3]), newLen, m[5].trim());
      return;
    }
    if (!cur) return; // preamble (commit message, index lines before any file)
    if (line.startsWith('new file mode')) cur.status = 'added';
    else if (line.startsWith('deleted file mode')) cur.status = 'deleted';
    else if (line.startsWith('rename from ')) {
      cur.oldPath = line.slice(12).trim();
      cur.status = 'renamed';
    } else if (line.startsWith('rename to ')) {
      cur.path = line.slice(10).trim();
      cur.status = 'renamed';
    } else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) cur.binary = true;
    else return;
    cur.version++;
  }

  /** Pi edit card (ported from Pocket's parseEditDiff): `+12 x` new line 12, `-12 x` old line 12, ` 12 x` unchanged, `...` gap */
  function cardLine(line: string) {
    const m = CARD_LINE_RE.exec(line);
    if (!m) {
      if (hunk && /^\s*\.\.\.\s*$/.test(line)) closeHunk();
      return;
    }
    const f = cur ?? newFile('');
    const sign = m[1];
    const at = Number(m[2]);
    const text = m[3] ?? '';
    if (!hunk) {
      const oldStart = sign === '+' ? at - cardShift : at;
      const newStart = sign === '-' ? at + cardShift : sign === '+' ? at : at + cardShift;
      newHunk(f, `@@ -${oldStart} +${newStart} @@`, oldStart, Infinity, newStart, Infinity);
    }
    const h = hunk!;
    let l: DiffLine;
    if (sign === '+') {
      l = { kind: 'add', text, newNo: at };
      cardShift++;
      f.additions++;
    } else if (sign === '-') {
      l = { kind: 'del', text, oldNo: at };
      cardShift--;
      f.deletions++;
    } else l = { kind: 'ctx', text, oldNo: at, newNo: at + cardShift };
    h.lines.push(l);
    h.version++;
    f.version++;
  }

  /** headerless snippet: one file, one hunk, no line numbers; `+`/`-` lines change, everything else is context */
  function looseLine(line: string) {
    const f = cur ?? newFile('');
    if (!hunk) newHunk(f, '', 0, 0, 0, 0);
    const c = line[0];
    if (c === '+') addLine(hunk!, f, 'add', line.slice(1));
    else if (c === '-') addLine(hunk!, f, 'del', line.slice(1));
    else if (c === '\\') addLine(hunk!, f, 'meta', line.slice(1).trim());
    else addLine(hunk!, f, 'ctx', c === ' ' ? line.slice(1) : line);
  }

  function snapshot(): DiffFileModel[] {
    let changed = files.length !== lastSnap.length;
    const out = files.map((f, i) => {
      if (!f.snap || f.snapVersion !== f.version) {
        const hunks = f.hunks.map((h) => {
          if (!h.snap || h.snapVersion !== h.version) {
            h.snap = { key: h.key, range: h.range, section: h.section, oldStart: h.oldStart, newStart: h.newStart, lines: h.lines.slice(), closed: h.closed };
            h.snapVersion = h.version;
          }
          return h.snap;
        });
        const status: HuiFileStatus = f.status ?? (f.oldPath && f.oldPath !== f.path ? 'renamed' : 'modified');
        f.snap = { key: f.key, path: f.path, oldPath: f.oldPath, status, binary: f.binary, hunks, additions: f.additions, deletions: f.deletions, numbered: f.numbered };
        f.snapVersion = f.version;
      }
      if (f.snap !== lastSnap[i]) changed = true;
      return f.snap;
    });
    // nothing changed → the same array (memo'd consumers skip)
    if (!changed) return lastSnap;
    lastSnap = out;
    return out;
  }

  return {
    update(text: string, final: boolean): DiffFileModel[] {
      if (text !== src && !(text.length > src.length && !finalized && extendsText(text, src))) reset();
      else if (text === src && (finalized || !final)) return snapshot();
      src = text;
      let nl: number;
      while ((nl = text.indexOf('\n', consumed)) !== -1) {
        processLine(text.slice(consumed, nl));
        consumed = nl + 1;
      }
      if (final) {
        if (consumed < text.length) processLine(text.slice(consumed));
        consumed = text.length;
        closeHunk();
        for (const f of files) {
          for (const h of f.hunks) if (!h.closed) {
            h.closed = true;
            h.version++;
            f.version++;
          }
        }
        finalized = true;
      }
      return snapshot();
    },
  };
}

/** One-shot parse of a complete unified diff. */
export function parseUnifiedDiff(text: string): DiffFileModel[] {
  return createDiffParser().update(text, true);
}

// ───────────────────────── structured files ─────────────────────────

/** context lines around a change in a hunk built from before / after texts */
export const DIFF_CONTEXT = 3;

/** hunks (like `diff -u`, DIFF_CONTEXT lines of context) from two full texts */
export function hunksFromTexts(before: string, after: string, keyPrefix = 'f'): DiffHunkModel[] {
  const a = before === '' ? [] : before.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const b = after === '' ? [] : after.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  // past 1000 edits the middle is a rewrite anyway: shown as removed + added (bounded time and memory)
  const ops = editScript(a, b, 1000)!;
  // walk the ops: positions in a / b per op
  const pos: { op: number; ai: number; bi: number }[] = [];
  let ai = 0;
  let bi = 0;
  for (const op of ops) {
    pos.push({ op, ai, bi });
    if (op !== INS) ai++;
    if (op !== DEL) bi++;
  }
  const hunks: DiffHunkModel[] = [];
  let i = 0;
  while (i < pos.length) {
    while (i < pos.length && pos[i].op === EQ) i++;
    if (i >= pos.length) break;
    let start = Math.max(0, i - DIFF_CONTEXT);
    // extend over changes closer than 2 × context
    let end = i;
    while (end < pos.length) {
      while (end < pos.length && pos[end].op !== EQ) end++;
      let eq = end;
      while (eq < pos.length && pos[eq].op === EQ) eq++;
      if (eq < pos.length && eq - end <= 2 * DIFF_CONTEXT) end = eq;
      else {
        end = Math.min(pos.length, end + DIFF_CONTEXT);
        break;
      }
    }
    if (hunks.length && start < 0) start = 0;
    const lines: DiffLine[] = [];
    let oldNo = pos[start].ai + 1;
    let newNo = pos[start].bi + 1;
    const oldStart = oldNo;
    const newStart = newNo;
    let oldLen = 0;
    let newLen = 0;
    for (let k = start; k < end; k++) {
      const p = pos[k];
      if (p.op === EQ) {
        lines.push({ kind: 'ctx', text: a[p.ai], oldNo: oldNo++, newNo: newNo++ });
        oldLen++;
        newLen++;
      } else if (p.op === DEL) {
        lines.push({ kind: 'del', text: a[p.ai], oldNo: oldNo++ });
        oldLen++;
      } else {
        lines.push({ kind: 'add', text: b[p.bi], newNo: newNo++ });
        newLen++;
      }
    }
    const os = oldLen === 0 ? oldStart - 1 : oldStart;
    const ns = newLen === 0 ? newStart - 1 : newStart;
    hunks.push({ key: `${keyPrefix}h${hunks.length}`, range: `@@ -${os},${oldLen} +${ns},${newLen} @@`, oldStart: os, newStart: ns, lines, closed: true });
    i = end;
  }
  return hunks;
}

/** structured hunks (`{oldStart, newStart, lines:["+x"," y"]}`) → numbered model hunks */
export function hunksFromJson(hs: readonly HuiDiffHunk[], keyPrefix = 'f'): DiffHunkModel[] {
  return hs.map((h, i) => {
    let oldNo = h.oldStart || 1;
    let newNo = h.newStart || 1;
    let oldLen = 0;
    let newLen = 0;
    const lines: DiffLine[] = (h.lines ?? []).map((s) => {
      const c = s[0];
      const text = s.slice(1);
      if (c === '+') {
        newLen++;
        return { kind: 'add', text, newNo: newNo++ };
      }
      if (c === '-') {
        oldLen++;
        return { kind: 'del', text, oldNo: oldNo++ };
      }
      if (c === '\\') return { kind: 'meta', text: text.trim() };
      oldLen++;
      newLen++;
      return { kind: 'ctx', text: c === ' ' ? text : s, oldNo: oldNo++, newNo: newNo++ };
    });
    return { key: `${keyPrefix}h${i}`, range: `@@ -${h.oldStart},${oldLen} +${h.newStart},${newLen} @@`, section: h.header, oldStart: h.oldStart, newStart: h.newStart, lines, closed: true };
  });
}

function countLines(hunks: readonly DiffHunkModel[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const h of hunks) for (const l of h.lines) {
    if (l.kind === 'add') additions++;
    else if (l.kind === 'del') deletions++;
  }
  return { additions, deletions };
}

const fileCache = new WeakMap<object, DiffFileModel>();

/**
 * Model of one structured file (hunks / patch / before + after). Cached per file object: the stream parser keeps
 * the identity of unchanged files (structural sharing), so finished files are built once.
 */
export function fileFromJson(f: HuiDiffFile, index: number): DiffFileModel {
  const hit = fileCache.get(f);
  if (hit && hit.key === `j${index}`) return hit;
  const key = `j${index}`;
  let hunks: DiffHunkModel[] = [];
  let numbered = true;
  let binary = f.binary === true;
  let status = f.status;
  let oldPath = f.oldPath;
  if (f.hunks?.length) hunks = hunksFromJson(f.hunks, key);
  else if (typeof f.patch === 'string') {
    const parsed = parseUnifiedDiff(f.patch);
    hunks = parsed.flatMap((p) => p.hunks).map((h, i) => ({ ...h, key: `${key}h${i}` }));
    numbered = parsed.every((p) => p.numbered);
    binary = binary || parsed.some((p) => p.binary);
    const p0 = parsed[0];
    if (p0 && !status && p0.status !== 'modified') status = p0.status;
    if (p0 && !oldPath && p0.oldPath) oldPath = p0.oldPath;
  } else if (typeof f.before === 'string' || typeof f.after === 'string') {
    hunks = hunksFromTexts(f.before ?? '', f.after ?? '', key);
    if (!status && f.before === undefined) status = 'added';
    if (!status && f.after === undefined) status = 'deleted';
  }
  const model: DiffFileModel = {
    key,
    path: f.path,
    oldPath,
    status: status ?? (oldPath && oldPath !== f.path ? 'renamed' : 'modified'),
    language: f.language,
    binary,
    hunks,
    ...countLines(hunks),
    numbered,
  };
  fileCache.set(f, model);
  return model;
}

// ───────────────────────── render rows ─────────────────────────

/** one text run of a line, `hl` = changed part (intra-line highlight) */
export type WordSeg = { text: string; hl: boolean };
export type LineRow = { t: 'line'; key: string; line: DiffLine; words?: WordSeg[] };
export type FoldRow = { t: 'fold'; key: string; count: number; lines: DiffLine[]; oldFrom?: number; newFrom?: number };
export type HunkRow = { t: 'hunk'; key: string; range: string; section?: string };
export type DiffRow = LineRow | FoldRow | HunkRow;
/** split view: old side left, new side right (`fold` / `hunk` rows span both) */
export type SplitRow = { t: 'pair'; key: string; left?: LineRow; right?: LineRow } | FoldRow | HunkRow;

/** unchanged runs longer than this fold to CONTEXT lines on each side of the fold */
export const FOLD_MIN = 10;

const TOKEN_RE = /\w+|\s+|[^\w\s]/gu;
const MAX_WORD_LINE = 400;
const MAX_WORD_TOKENS = 160;

/**
 * Intra-line highlight of a changed line pair: token Myers diff (words / spaces / punctuation). `null` when the
 * lines are long, very different (more than 60 % changed) or identical – a highlight would be noise there.
 */
export function wordDiff(a: string, b: string): { a: WordSeg[]; b: WordSeg[] } | null {
  if (a === b || a.length > MAX_WORD_LINE || b.length > MAX_WORD_LINE) return null;
  const ta = a.match(TOKEN_RE) ?? [];
  const tb = b.match(TOKEN_RE) ?? [];
  if (ta.length > MAX_WORD_TOKENS || tb.length > MAX_WORD_TOKENS) return null;
  const ops = editScript(ta, tb, 80, true);
  if (!ops) return null;
  const sa: WordSeg[] = [];
  const sb: WordSeg[] = [];
  let i = 0;
  let j = 0;
  let changed = 0;
  const push = (out: WordSeg[], text: string, hl: boolean) => {
    const last = out[out.length - 1];
    if (last && last.hl === hl) last.text += text;
    else out.push({ text, hl });
  };
  for (const op of ops) {
    if (op === EQ) {
      push(sa, ta[i++], false);
      push(sb, tb[j++], false);
    } else if (op === DEL) {
      changed += ta[i].length;
      push(sa, ta[i++], true);
    } else {
      changed += tb[j].length;
      push(sb, tb[j++], true);
    }
  }
  if (changed > 0.6 * (a.length + b.length)) return null;
  // whitespace-only highlights are invisible: un-highlight them
  for (const s of [...sa, ...sb]) if (s.hl && s.text.trim() === '') s.hl = false;
  return { a: sa, b: sb };
}

const alignCache = new WeakMap<DiffLine, { dels: number; adds: number; last: DiffLine; pairs: [number, number][] }>();

/**
 * alignRun of the change ls[i..d) (removed) + ls[d..a) (added), cached by its first line: the rows of a hunk that is
 * still streaming are rebuilt on every update, its finished changes are not aligned again (lines keep their identity).
 */
function alignAt(ls: readonly DiffLine[], i: number, d: number, a: number): [number, number][] {
  const hit = alignCache.get(ls[i]);
  if (hit && hit.dels === d - i && hit.adds === a - d && hit.last === ls[a - 1]) return hit.pairs;
  const pairs = alignRun(
    ls.slice(i, d).map((l) => l.text),
    ls.slice(d, a).map((l) => l.text),
  );
  alignCache.set(ls[i], { dels: d - i, adds: a - d, last: ls[a - 1], pairs });
  return pairs;
}

const wordCache = new WeakMap<DiffLine, { other: DiffLine; segs: WordSeg[] | null }>();
const rowCache = new WeakMap<DiffLine, LineRow>();

function pairWords(del: DiffLine, add: DiffLine): { a?: WordSeg[]; b?: WordSeg[] } {
  const hit = wordCache.get(del);
  if (hit && hit.other === add) return { a: hit.segs ?? undefined, b: wordCache.get(add)?.segs ?? undefined };
  const w = wordDiff(del.text, add.text);
  wordCache.set(del, { other: add, segs: w ? w.a : null });
  wordCache.set(add, { other: del, segs: w ? w.b : null });
  return { a: w?.a, b: w?.b };
}

/** the row object of a line, reused while its highlight does not change (memo'd chunks compare rows by identity) */
function lineRow(key: string, line: DiffLine, words?: WordSeg[]): LineRow {
  const hit = rowCache.get(line);
  if (hit && hit.words === words && hit.key === key) return hit;
  const r: LineRow = words ? { t: 'line', key, line, words } : { t: 'line', key, line };
  rowCache.set(line, r);
  return r;
}

/**
 * Rows of one hunk: a hunk header row (unless the file is a headerless snippet), line rows with intra-line highlight
 * for -/+ pairs (i-th removed line of a change ↔ i-th added line), unchanged runs ≥ FOLD_MIN folded to DIFF_CONTEXT
 * lines around the changes (a trailing run of a still-open hunk stays open). `expanded` = keys of opened folds.
 */
export function hunkRows(h: DiffHunkModel, expanded?: ReadonlySet<string>, withHeader = true): DiffRow[] {
  const rows: DiffRow[] = [];
  if (withHeader && h.range) rows.push({ t: 'hunk', key: h.key, range: h.range, section: h.section });
  const ls = h.lines;
  // a change = removed lines + the added lines after them, paired BY LIKENESS (pocketDiff.alignRun); pairs get the
  // intra-line highlight, split view puts them side by side (runs[first removed / added index])
  const words = new Map<number, WordSeg[] | undefined>();
  const runs = new Map<number, [number, number][]>();
  for (let i = 0; i < ls.length; ) {
    if (ls[i].kind !== 'del' && ls[i].kind !== 'add') {
      i++;
      continue;
    }
    let d = i;
    while (d < ls.length && ls[d].kind === 'del') d++;
    let a = d;
    while (a < ls.length && ls[a].kind === 'add') a++;
    const pairs = alignAt(ls, i, d, a).map(([x, y]): [number, number] => [x < 0 ? -1 : i + x, y < 0 ? -1 : d + y]);
    runs.set(i, pairs);
    for (const [x, y] of pairs) {
      if (x < 0 || y < 0) continue;
      const w = pairWords(ls[x], ls[y]);
      words.set(x, w.a);
      words.set(y, w.b);
    }
    i = a;
  }
  for (let i = 0; i < ls.length; ) {
    if (ls[i].kind !== 'ctx') {
      rows.push(lineRow(`${h.key}:${i}`, ls[i], words.get(i)));
      i++;
      continue;
    }
    let e = i;
    while (e < ls.length && ls[e].kind === 'ctx') e++;
    const atStart = i === 0;
    const atEnd = e === ls.length;
    const open = atEnd && !h.closed;
    const keepHead = atStart ? 0 : DIFF_CONTEXT;
    const keepTail = atEnd ? 0 : DIFF_CONTEXT;
    const foldKey = `${h.key}~${i}`;
    if (!open && e - i >= FOLD_MIN && e - i - keepHead - keepTail >= 4 && !expanded?.has(foldKey)) {
      for (let k = i; k < i + keepHead; k++) rows.push(lineRow(`${h.key}:${k}`, ls[k]));
      const from = i + keepHead;
      const to = e - keepTail;
      rows.push({ t: 'fold', key: foldKey, count: to - from, lines: ls.slice(from, to), oldFrom: ls[from].oldNo, newFrom: ls[from].newNo });
      for (let k = to; k < e; k++) rows.push(lineRow(`${h.key}:${k}`, ls[k]));
    } else for (let k = i; k < e; k++) rows.push(lineRow(`${h.key}:${k}`, ls[k]));
    i = e;
  }
  // split view: the pairs of each change, by the row of its first line
  const byLine = new Map<DiffLine, LineRow>();
  for (const r of rows) if (r.t === 'line') byLine.set(r.line, r);
  for (const [start, pairs] of runs) {
    const first = byLine.get(ls[start]);
    if (first) changePairs.set(first, pairs.map(([x, y]) => [x < 0 ? undefined : byLine.get(ls[x]), y < 0 ? undefined : byLine.get(ls[y])]));
  }
  return rows;
}

/** first row of a change → its [removed, added] row pairs (written by hunkRows, read by splitRows) */
const changePairs = new WeakMap<LineRow, [LineRow | undefined, LineRow | undefined][]>();

const hunkRowCache = new WeakMap<DiffHunkModel, { withHeader: boolean; rows: DiffRow[] }>();

/** all rows of a file; hunks without an opened fold are cached per hunk object */
export function fileRows(f: DiffFileModel, expanded?: ReadonlySet<string>): DiffRow[] {
  const out: DiffRow[] = [];
  const withHeader = f.numbered;
  for (const h of f.hunks) {
    let rows: DiffRow[];
    const opened = !!expanded?.size && [...expanded].some((k) => k.startsWith(h.key + '~'));
    const hit = opened ? undefined : hunkRowCache.get(h);
    if (hit && hit.withHeader === withHeader) rows = hit.rows;
    else {
      rows = hunkRows(h, expanded, withHeader);
      if (!opened) hunkRowCache.set(h, { withHeader, rows });
    }
    for (const r of rows) out.push(r);
  }
  return out;
}

/** unified rows → side-by-side rows: context on both sides, a change's i-th removed line beside its i-th added line */
export function splitRows(rows: readonly DiffRow[]): SplitRow[] {
  const out: SplitRow[] = [];
  for (let i = 0; i < rows.length; ) {
    const r = rows[i];
    if (r.t !== 'line') {
      out.push(r);
      i++;
      continue;
    }
    if (r.line.kind === 'ctx' || r.line.kind === 'meta') {
      out.push(r.line.kind === 'ctx' ? { t: 'pair', key: r.key, left: r, right: r } : { t: 'pair', key: r.key, left: r });
      i++;
      continue;
    }
    const pairs = changePairs.get(r);
    const run: LineRow[] = [];
    while (i < rows.length && rows[i].t === 'line' && ((rows[i] as LineRow).line.kind === 'del' || (rows[i] as LineRow).line.kind === 'add')) run.push(rows[i++] as LineRow);
    if (pairs && pairs.every(([x, y]) => (!x || run.includes(x)) && (!y || run.includes(y)))) {
      for (const [left, right] of pairs) out.push({ t: 'pair', key: (left ?? right)!.key, left, right });
    } else {
      // no recorded alignment: in order
      const dels = run.filter((x) => x.line.kind === 'del');
      const adds = run.filter((x) => x.line.kind === 'add');
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k++) out.push({ t: 'pair', key: (dels[k] ?? adds[k]).key, left: dels[k], right: adds[k] });
    }
  }
  return out;
}

/** a fold opened: its lines as plain line rows (no highlight: folds are context only) */
export function foldLines(f: FoldRow): LineRow[] {
  return f.lines.map((l, i) => lineRow(`${f.key}.${i}`, l));
}

// ───────────────────────── header / copy helpers ─────────────────────────

/** "src/ui/" + "App.tsx" (directory muted, file name strong) */
export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/');
  return i < 0 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
}

/** lock files / generated / minified files start collapsed (long, rarely read) */
export function collapsedByDefault(f: Pick<DiffFileModel, 'path' | 'status' | 'binary'>): boolean {
  if (f.status === 'deleted' || f.binary) return true;
  return /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|composer\.lock|poetry\.lock|go\.sum|Podfile\.lock)$|\.min\.(js|css)$|\.map$/.test(f.path);
}

/** the unified patch text of one file (copy) */
export function filePatchText(f: DiffFileModel): string {
  const out: string[] = [];
  if (f.path || f.oldPath) {
    out.push(f.status === 'added' ? '--- /dev/null' : `--- a/${f.oldPath ?? f.path}`);
    out.push(f.status === 'deleted' ? '+++ /dev/null' : `+++ b/${f.path}`);
  }
  for (const h of f.hunks) {
    if (h.range) {
      let o = 0;
      let n = 0;
      for (const l of h.lines) {
        if (l.kind !== 'add' && l.kind !== 'meta') o++;
        if (l.kind !== 'del' && l.kind !== 'meta') n++;
      }
      out.push(`@@ -${h.oldStart},${o} +${h.newStart},${n} @@${h.section ? ' ' + h.section : ''}`);
    }
    for (const l of h.lines) out.push(l.kind === 'add' ? '+' + l.text : l.kind === 'del' ? '-' + l.text : l.kind === 'meta' ? '\\ ' + l.text : ' ' + l.text);
  }
  return out.join('\n') + '\n';
}

/** what the screen reader reads for one line: "line 12 added: const x = 1" */
export function lineA11y(l: DiffLine, labels: { add: string; del: string; ctx: string }): string {
  const no = l.newNo ?? l.oldNo;
  const kind = l.kind === 'add' ? labels.add : l.kind === 'del' ? labels.del : labels.ctx;
  return `${no !== undefined ? no + ' ' : ''}${kind}: ${l.text}`;
}

/** widest line (chars) of the given rows – sizes the scroll content of an unwrapped diff */
export function maxLineChars(rows: readonly DiffRow[]): number {
  let max = 0;
  for (const r of rows) {
    if (r.t === 'line') {
      if (r.line.text.length > max) max = r.line.text.length;
    } else if (r.t === 'fold') {
      for (const l of r.lines) if (l.text.length > max) max = l.text.length;
    }
  }
  return max;
}

/** rows split into chunks of `size` (memo'd chunk renderers; full chunks keep their rows) */
export function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** same rows by identity (memo comparator of a chunk) */
export function sameRows<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** totals over files */
export function diffTotals(files: readonly Pick<DiffFileModel, 'additions' | 'deletions'>[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
  }
  return { additions, deletions };
}
