/**
 * Incremental splitter: Markdown text -> Segment[] around fenced
 * ```hui (native JSON components) and ```hui-html (sandboxed HTML) blocks.
 *
 * - Line based state machine. Only the current (unterminated) line is kept in
 *   `pending`; completed lines are consumed exactly once => O(total) work.
 * - A partial last line that might still turn into a fence marker ("``",
 *   "```hu", ...) is held back from the output so it never flashes as text.
 * - Other fences (```python, ~~~, ...) are tracked so that a "```hui" line
 *   inside e.g. a ```markdown example stays plain markdown.
 * - Segment keys are `seg-<index>`; closed segments are stable objects
 *   (same identity across pushes) so React.memo works.
 *
 * Call end() when the stream is finished (flushes an unterminated last line and
 * finalizes unclosed blocks).
 */
import { isKnownNodeType, type HuiNode, type Segment } from './types.ts';
import { createPartialJsonParser, parseLenientJson, parsePartialJson, prunePartialItems } from './partialJson.ts';
import { collectInteractiveIds, hasListContent, hasReadableContent, isEmptyCollection, isPartialTypeName, normalizeNode, readableFallback } from './validate.ts';
import { isEmptyNode } from './emptyNode.ts';
import { shareStructure } from './structuralShare.ts';
import type { AppendRun } from './appendRun.ts';

export interface StreamParser {
  /** feed a text delta; returns the current segments */
  push(delta: string): Segment[];
  /** stream finished: flush pending text, finalize open blocks */
  end(): Segment[];
  /** current segments without feeding anything */
  segments(): Segment[];
}

const HUI_OPEN_RE = /^ {0,3}(`{3,})(hui|hui-html)[ \t]*$/;
const MD_FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/**
 * Models sometimes label a component fence with the node type instead of `hui` (```suggestions,
 * ```places …). Only names that are never programming-language/markup tags are accepted (except the
 * TEXT_FENCE_TYPES below); the fence name becomes the node `type` when the JSON has none. Invalid JSON
 * falls back to a readable view.
 */
export const TYPED_FENCE_TYPES: ReadonlySet<string> = new Set([
  'suggestions', 'places', 'products', 'weather', 'recipe', 'compare', 'checklist', 'timeline', 'agenda',
  'stats', 'mindmap', 'vocab', 'quiz', 'flashcards', 'workout', 'studyplan', 'gallery', 'decision', 'poll', 'guide', 'paths', 'blocks',
  'changes', 'diff', 'patch', 'terminal', 'translation', 'choice', 'timer', 'map',
]);
/**
 * Typed fences whose plain-text content is the node itself: ```diff / ```patch hold a unified diff (→ `diff` node with
 * `patch`), ```terminal a `$ command` line and its output (→ `terminal`). A JSON object inside still works like any
 * typed fence. The text is handed over verbatim (no JSON parse), so a growing block costs O(1) per update here and
 * the renderer parses only the appended lines.
 */
export const TEXT_FENCE_TYPES: ReadonlySet<string> = new Set(['diff', 'patch', 'terminal']);

/** `$ npm test` / `% make` / `> cargo run` as the first line of a ```terminal fence */
const PROMPT_LINE_RE = /^[ \t]*[$%>❯][ \t]+(.*)$/;
/** optional last line of a ```terminal fence: `[exit 1]` / `[exit 0, 4.2s]` / `[exit 2 · 350ms]` → exitCode (+ duration) */
const EXIT_LINE_RE = /\n?[ \t]*\[exit(?: code)?:? (-?\d{1,9})(?:[ \t]*[,·;][ \t]*([\d.,]+[ \t]*(?:ms|s|min|m|h)(?:[ \t]+[\d.,]+[ \t]*(?:ms|s|min|m|h))?))?\][ \t]*\n?$/;

/** node of a text fence (TEXT_FENCE_TYPES) from its raw content */
export function textFenceNode(fenceType: string, raw: string): Record<string, unknown> {
  if (fenceType !== 'terminal') return { type: 'diff', patch: raw };
  const node: Record<string, unknown> = { type: 'terminal' };
  // the exit line is only looked for in the last 80 chars (a growing output stays O(1) here)
  const tailAt = Math.max(0, raw.length - 80);
  const x = EXIT_LINE_RE.exec(raw.slice(tailAt));
  let body = raw;
  if (x && (tailAt + x.index === 0 || raw[tailAt + x.index] === '\n')) {
    body = raw.slice(0, tailAt + x.index);
    node.exitCode = Number(x[1]);
    if (x[2]) node.duration = x[2];
  }
  const nl = body.indexOf('\n');
  const first = nl === -1 ? body : body.slice(0, nl);
  const m = PROMPT_LINE_RE.exec(first);
  if (!m) {
    if (body) node.output = body;
    return node;
  }
  node.command = m[1];
  if (nl !== -1) node.output = body.slice(nl + 1);
  return node;
}
const TYPED_OPEN_RE = /^ {0,3}(`{3,})([a-z][a-z0-9_-]*)[ \t]*$/;
/** possible start of a closing fence inside a block (held back from content) */
const PARTIAL_HEAD_RE = /^ {0,3}`*[ \t]*$/;
/** fence names that open a component block: `hui`, `hui-html` and the typed names */
const OPENER_NAMES = ['hui', 'hui-html', ...TYPED_FENCE_TYPES];
/** every non-empty prefix of an opener name (incl. the full name) */
const OPENER_NAME_PREFIXES: ReadonlySet<string> = new Set(OPENER_NAMES.flatMap((n) => Array.from({ length: n.length }, (_, k) => n.slice(0, k + 1))));
const OPENER_NAME_SET: ReadonlySet<string> = new Set(OPENER_NAMES);
/** split of a possible opener line: indent ≤ 3, backticks, name, trailing whitespace */
const OPENER_PARTS_RE = /^ {0,3}(`*)([a-z0-9_-]*)([ \t]*)$/;

/**
 * `md`: markdown · `hui` / `html`: component / sandboxed HTML block ·
 * `typed`: a typed fence (```quiz) whose content has no non-whitespace char yet – held back until the first one (a text fence, ```diff, is a component with any content)
 * decides: `{` (or `[` for ARRAY_FENCE_TYPES) → component (`hui`), anything else → plain code block (markdown)
 */
type Mode = 'md' | 'hui' | 'html' | 'typed';

export type StreamParserOptions = {
  /** clock for the rebuild rate limit of large open hui blocks (tests); default Date.now */
  now?: () => number;
};

/** Open hui blocks up to this size are re-parsed on every push (cheap, < ~0.3 ms jitless). */
export const HUI_REBUILD_EVERY_PUSH_MAX = 4096;
/** Above it, a growing block is re-parsed when this many chars arrived since the last build … */
export const HUI_REBUILD_MIN_GROWTH = 2048;

/** … or when this much time passed since the last build: clamp(len / 100, 33, 250) ms. */
export function huiRebuildIntervalMs(len: number): number {
  return Math.min(250, Math.max(33, Math.round(len / 100)));
}

/** Could `line` (incomplete) still become a ```hui / ```hui-html / typed (```quiz) opener? */
function mayBecomeOpener(line: string): boolean {
  if (line === '') return false;
  const m = OPENER_PARTS_RE.exec(line);
  if (!m) return false;
  const [, ticks, name, ws] = m;
  if (ticks.length < 3) return name === '' && ws === '';
  if (name === '') return ws === '';
  // trailing whitespace ends the name: only a complete opener name may continue
  return ws === '' ? OPENER_NAME_PREFIXES.has(name) : OPENER_NAME_SET.has(name);
}

/**
 * A line that is one complete component object outside any fence: `{"type":"suggestions","items":[…]}` (a model that
 * dropped the fence; the direct-Claude live check saw it after a `_suggestions` marker line). Drawn as the component,
 * never as raw JSON text. Only known node types and only JSON that parses as an object on that one line.
 */
const BARE_NODE_RE = /^ {0,3}\{\s*"type"\s*:\s*"([a-z][a-z0-9_-]*)"/;
/** while streaming, a line that may still become such an object is held back (like a fence opener) */
const BARE_START_RE = /^ {0,3}\{\s*(?:"(?:t(?:y(?:p(?:e(?:"\s*(?::\s*"?[a-z0-9_-]*)?)?)?)?)?)?)?$|^ {0,3}\{\s*"type"\s*:\s*"[a-z]/;

function bareNodeType(line: string): string | null {
  const m = BARE_NODE_RE.exec(line);
  if (!m || !isKnownNodeType(m[1]) || !line.trimEnd().endsWith('}')) return null;
  try {
    const v: unknown = JSON.parse(line);
    return v && typeof v === 'object' && !Array.isArray(v) ? m[1] : null;
  } catch {
    return null;
  }
}

/** first non-whitespace char of `s` ('' if none) */
function firstNonWs(s: string): string {
  const m = /\S/.exec(s);
  return m ? m[0] : '';
}

/** `t` (already left-trimmed) is a closing fence: >= len of `ch`, nothing else but whitespace */
function isFenceClose(t: string, ch: string, len: number): boolean {
  let k = 0;
  while (k < t.length && t[k] === ch) k++;
  return k >= len && t.slice(k).trim() === '';
}

function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 160 ? m.slice(0, 160) + '…' : m;
}

/**
 * `reserved` = interactive-node ids of the already committed segments of this message, so that
 * ids stay unique per message (state is stored per conversation:message:node).
 */
function buildHui(key: string, raw: string, complete: boolean, reserved: readonly string[], fenceType?: string, partial?: PartialParse): Segment {
  // never throw out of push()/parseMessage: hostile input (deep nesting, huge trees) becomes an error segment
  try {
    return buildHuiUnsafe(key, raw, complete, reserved, fenceType, partial);
  } catch (e) {
    return { key, kind: 'hui', complete, raw, node: null, error: 'hui-Block konnte nicht gelesen werden: ' + errMsg(e) };
  }
}

/** typed fences whose content may also be a bare JSON array of items (```suggestions ["a","b"]) */
const ARRAY_FENCE_TYPES: ReadonlySet<string> = new Set(['suggestions']);

/** A typed fence (```suggestions) supplies the node type when the JSON object has none. */
function withFenceType(value: unknown, fenceType: string | undefined): unknown {
  if (fenceType && Array.isArray(value) && ARRAY_FENCE_TYPES.has(fenceType)) return { type: fenceType, items: value };
  if (!fenceType || !value || typeof value !== 'object' || Array.isArray(value) || 'type' in value) return value;
  return { type: fenceType, ...(value as Record<string, unknown>) };
}

/** partial-JSON parse of a growing open block (`createPartialJsonParser`, same result as parsePartialJson) */
type PartialParse = (raw: string) => unknown;

function buildHuiUnsafe(key: string, raw: string, complete: boolean, reserved: readonly string[], fenceType?: string, partial?: PartialParse): Segment {
  const opts = { path: key, reservedIds: reserved };
  if (fenceType && TEXT_FENCE_TYPES.has(fenceType) && firstNonWs(raw) !== '{') {
    const node = normalizeNode(textFenceNode(fenceType, raw), opts);
    return { key, kind: 'hui', complete, raw, node };
  }
  if (complete) {
    if (raw.trim() === '') {
      return { key, kind: 'hui', complete: true, raw, node: null, error: 'Leerer hui-Block' };
    }
    let value: unknown;
    let error: string | undefined;
    try {
      value = JSON.parse(raw);
    } catch (e) {
      // lenient: comments, trailing commas, leading prose, several values in one fence
      value = parseLenientJson(raw);
      error = 'Ungültiges JSON: ' + errMsg(e);
    }
    if (value === undefined) return { key, kind: 'hui', complete: true, raw, node: null, error };
    const inferredTerminal = fenceType === 'terminal' && value && typeof value === 'object' && !Array.isArray(value) && !('type' in value);
    value = withFenceType(value, fenceType);
    // normalizeNode also maps harmless variants (top-level arrays, envelopes, wrappers, type aliases)
    let node = normalizeNode(value, opts);
    // A terminal text fence may hold a JSON log line rather than a terminal-node descriptor.
    if (inferredTerminal && node?.type === 'terminal' && !node.command && !node.output && node.status !== 'running') {
      node = normalizeNode(textFenceNode(fenceType!, raw), opts);
    }
    // a list-like node whose entries all failed to normalise (shape written from memory) would
    // render as an empty card: show the block's content readably instead
    // (also any node that would only show the "no data" line of emptyNode.ts while the block has readable content)
    const lost = !!node && ((isEmptyCollection(node) && hasListContent(value)) || (isEmptyNode(node) && (hasListContent(value) || hasReadableContent(value))));
    if (lost) node = null;
    if (node) return error ? { key, kind: 'hui', complete: true, raw, node, error } : { key, kind: 'hui', complete: true, raw, node };
    // still no node: show the content readably instead of only an error line
    const fb = readableFallback(value, opts);
    const why = error ?? (lost ? 'hui-Block ohne verwendbare Einträge' : 'Ungültiger hui-Block: erwartet ein Objekt mit "type"');
    return fb
      ? { key, kind: 'hui', complete: true, raw, node: fb, error: why, fallback: true }
      : { key, kind: 'hui', complete: true, raw, node: null, error: why };
  }
  // streaming: the still-open last item of each array is hidden until it is complete (no
  // half-filled rows jumping between groups); open nodes keep filling in progressively
  const p = partial ? partial(raw) : parsePartialJson(raw, { markOpen: true });
  const pp = p === undefined ? undefined : withFenceType(prunePartialItems(p), fenceType);
  // a root type string that is still streaming ("produ") stays as is → skeleton of the guessed type
  const typing = !!pp && typeof pp === 'object' && typeof (pp as { type?: unknown }).type === 'string' && isPartialTypeName((pp as { type: string }).type);
  const node: HuiNode | null = pp === undefined ? null : typing ? (pp as HuiNode) : normalizeNode(pp, opts);
  return { key, kind: 'hui', complete: false, raw, node };
}

export function createStreamParser(opts: StreamParserOptions = {}): StreamParser {
  const now = opts.now ?? Date.now;
  const committed: Segment[] = [];
  let mode: Mode = 'md';
  let mdText = ''; // completed lines of the current markdown segment
  let mdFence: { ch: string; len: number } | null = null;
  let blockBuf = ''; // completed content lines of the open block (each ends with \n)
  let blockFenceLen = 3;
  let fenceType: string | undefined; // node type of a typed fence (```suggestions), see TYPED_FENCE_TYPES
  let typedOpener = ''; // the opener line of an undecided typed fence (mode `typed`)
  let pending = ''; // current unterminated line
  let scanFrom = 0;
  let ended = false;

  let cache: Segment[] | null = null;
  let lastHuiRaw: string | null = null;
  let lastHuiSeg: Segment | null = null;
  let lastHuiAt = 0; // now() of the last open-block build
  // the open block's raw text only grows: its partial JSON is scanned incrementally (one parser per open block)
  let huiPartial: PartialParse | null = null;
  let lastMd: Segment | null = null;
  // what `lastMd` was built from: `mdText` up to this length + this visible pending text (appendRun.ts)
  let lastMdLen = 0;
  let lastMdPending = '';

  const nextKey = () => `seg-${committed.length}`;
  const usedIds: string[] = []; // interactive ids of committed hui segments

  function visiblePending(): string {
    if (pending === '') return '';
    let p = pending;
    if (p.charCodeAt(p.length - 1) === 13) p = p.slice(0, -1);
    if (ended) return p;
    if (mode === 'md') {
      return !mdFence && (mayBecomeOpener(p) || BARE_START_RE.test(p)) ? '' : p;
    }
    // undecided typed fence: nothing of it shows yet
    if (mode === 'typed') return '';
    // inside a block: hold back a possible closing fence
    return PARTIAL_HEAD_RE.test(p) ? '' : p;
  }

  /**
   * The markdown segment of `mdText` + the visible pending text `vp`. Its text continues the append run of the previous
   * one (same key) when `mdText + vp` extends what that one was built from: `mdText` itself only grows until
   * closeMarkdown resets it (and `lastMd`), so only the old pending part needs a compare (one line). Dropping leading
   * blank lines and trailing whitespace keeps the extension (fuzz-tested in streamParser.test.ts).
   */
  function mdSegment(key: string, md: string, vp = ''): Segment | null {
    const visible = vp ? md + vp : md;
    if (visible.trim() === '') return null;
    const text = visible.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
    if (text === '') return null;
    const prev = lastMd && lastMd.kind === 'markdown' && lastMd.key === key ? lastMd : null;
    const grew = !!prev && md.length >= lastMdLen && pendingContinues(md, vp);
    lastMdLen = md.length;
    lastMdPending = vp;
    if (prev && prev.text === text) return prev;
    const seg: Segment = { key, kind: 'markdown', text };
    mdRuns.set(seg, (grew && prev && mdRuns.get(prev)) || {});
    lastMd = seg;
    return seg;
  }

  /** `md.slice(lastMdLen) + vp` starts with `lastMdPending` */
  function pendingContinues(md: string, vp: string): boolean {
    const old = lastMdPending;
    const added = md.length - lastMdLen;
    if (added >= old.length) return md.startsWith(old, lastMdLen);
    return md.startsWith(old.slice(0, added), lastMdLen) && vp.startsWith(old.slice(added));
  }

  function closeMarkdown() {
    const seg = mdSegment(nextKey(), mdText);
    if (seg) committed.push(seg);
    lastMd = null;
    mdText = '';
    mdFence = null;
  }

  function closeBlock(complete: boolean) {
    const content = blockBuf.endsWith('\n') ? blockBuf.slice(0, -1) : blockBuf;
    const key = nextKey();
    if (mode === 'hui') {
      const seg = buildHui(key, content, complete, usedIds, fenceType);
      if (lastHuiSeg && lastHuiSeg.key === key && lastHuiSeg.kind === 'hui' && seg.kind === 'hui' && seg.node) {
        seg.node = shareStructure(lastHuiSeg.node, seg.node);
      }
      committed.push(seg);
      if (seg.kind === 'hui' && seg.node) collectInteractiveIds(seg.node, usedIds);
    }
    else committed.push({ key, kind: 'html', complete, html: content });
    blockBuf = '';
    mode = 'md';
    lastHuiRaw = null;
    lastHuiSeg = null;
    huiPartial = null;
  }

  /** typed fence decided: `{` → component block; else the opener + content so far go back to markdown as code */
  function decideTyped(asComponent: boolean) {
    if (asComponent) {
      closeMarkdown();
      mode = 'hui';
      return;
    }
    mdText += typedOpener + '\n' + blockBuf;
    mdFence = { ch: '`', len: blockFenceLen };
    mode = 'md';
    blockBuf = '';
    fenceType = undefined;
    typedOpener = '';
  }

  /** the open typed fence's first non-whitespace char (completed lines, then the pending line) decides */
  function maybeDecideTyped(withPending: boolean) {
    if (mode !== 'typed') return;
    let c = firstNonWs(blockBuf);
    if (!c && withPending && !PARTIAL_HEAD_RE.test(pending.replace(/\r$/, ''))) c = firstNonWs(pending);
    if (c) decideTyped(c === '{' || (fenceType !== undefined && (TEXT_FENCE_TYPES.has(fenceType) || (c === '[' && ARRAY_FENCE_TYPES.has(fenceType)))));
  }

  function processLine(rawLine: string) {
    const line = rawLine.charCodeAt(rawLine.length - 1) === 13 ? rawLine.slice(0, -1) : rawLine;
    if (mode === 'typed') {
      const t = line.trimStart();
      if (line.length - t.length <= 3 && isFenceClose(t, '`', blockFenceLen)) {
        // closed before any content: an (empty) code block, not an error component
        mdText += typedOpener + '\n' + blockBuf + line + '\n';
        mode = 'md';
        blockBuf = '';
        fenceType = undefined;
        typedOpener = '';
        return;
      }
      blockBuf += line + '\n';
      maybeDecideTyped(false);
      return;
    }
    if (mode === 'md') {
      if (mdFence) {
        mdText += line + '\n';
        const t = line.trimStart();
        if (line.length - t.length <= 3 && isFenceClose(t, mdFence.ch, mdFence.len)) mdFence = null;
        return;
      }
      const m = HUI_OPEN_RE.exec(line);
      if (m) {
        closeMarkdown();
        mode = m[2] === 'hui' ? 'hui' : 'html';
        blockFenceLen = m[1].length;
        blockBuf = '';
        fenceType = undefined;
        return;
      }
      const bare = bareNodeType(line);
      // only as a block of its own: after a blank line, the start, or the marker line of the lost fence
      // ("_suggestions", "hui", "json"), which goes with it; never inside a paragraph or after indented code
      const body = mdText.endsWith('\n') ? mdText.slice(0, -1) : mdText;
      const cut = body.lastIndexOf('\n') + 1;
      const prevLine = body.slice(cut);
      const marker = !!bare && new RegExp(`^ {0,3}[_*]*(?:hui|json|${bare})[_*:]*[ \\t]*$`, 'i').test(prevLine);
      if (bare && (marker || prevLine.trim() === '')) {
        if (marker) mdText = mdText.slice(0, cut);
        closeMarkdown();
        const seg = buildHui(nextKey(), line.trim(), true, usedIds);
        committed.push(seg);
        if (seg.kind === 'hui' && seg.node) collectInteractiveIds(seg.node, usedIds);
        return;
      }
      const tf = TYPED_OPEN_RE.exec(line);
      if (tf && TYPED_FENCE_TYPES.has(tf[2])) {
        // a component only if the content is a JSON object (didactic ```quiz examples stay code): decided by
        // the first non-whitespace char, until then held back
        mode = 'typed';
        typedOpener = line;
        blockFenceLen = tf[1].length;
        blockBuf = '';
        fenceType = tf[2];
        return;
      }
      const g = MD_FENCE_OPEN_RE.exec(line);
      if (g && !(g[1][0] === '`' && g[2].includes('`'))) {
        mdFence = { ch: g[1][0], len: g[1].length };
      }
      mdText += line + '\n';
      return;
    }
    // inside hui / html block: closing fence?
    const t = line.trimStart();
    if (line.length - t.length <= 3 && isFenceClose(t, '`', blockFenceLen)) {
      closeBlock(true);
      return;
    }
    blockBuf += line + '\n';
  }

  function feed() {
    // lines are cut out by index and the rest is kept ONCE at the end: `pending = pending.slice(nl + 1)` per line
    // copied the remaining text for every line (Hermes has no sliced strings) – quadratic for a big delta (a whole
    // stored answer on mount, a recovered / caught-up answer). processLine never reads `pending`.
    let start = 0;
    let nl: number;
    while ((nl = pending.indexOf('\n', Math.max(scanFrom, start))) !== -1) {
      const line = pending.slice(start, nl);
      start = nl + 1;
      processLine(line);
    }
    if (start > 0) pending = pending.slice(start);
    scanFrom = pending.length;
    maybeDecideTyped(true);
  }

  /**
   * Large open hui block: re-parsing + re-normalising the whole raw JSON on every push is O(n) per
   * update (quadratic per block). Rebuild only when enough new text arrived or enough time passed;
   * in between the previous (slightly stale) segment is returned unchanged. The open last item of
   * each array is hidden anyway (prunePartialItems), so most skipped pushes would not change the view.
   */
  function skipRebuild(content: string): boolean {
    if (lastHuiRaw === null || content.length <= HUI_REBUILD_EVERY_PUSH_MAX) return false;
    if (content.length - lastHuiRaw.length >= HUI_REBUILD_MIN_GROWTH || content.length < lastHuiRaw.length) return false;
    return now() - lastHuiAt < huiRebuildIntervalMs(content.length);
  }

  function build(): Segment[] {
    const out = committed.slice();
    const vp = visiblePending();
    if (mode === 'md' || mode === 'typed') {
      const seg = mdSegment(nextKey(), mdText, vp);
      if (seg) out.push(seg);
    } else {
      // (no `/\n$/` regex: the Hermes interpreter would visit every char of the open block on every update)
      const raw = vp ? blockBuf + vp : blockBuf;
      const content = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
      const key = nextKey();
      if (mode === 'hui') {
        // text fences (```diff) are not parsed here: no rebuild rate limit
        const textFence = fenceType !== undefined && TEXT_FENCE_TYPES.has(fenceType);
        if (lastHuiSeg && lastHuiSeg.key === key && (lastHuiRaw === content || (!textFence && skipRebuild(content)))) out.push(lastHuiSeg);
        else {
          const seg = buildHui(key, content, false, usedIds, fenceType, (huiPartial ??= createPartialJsonParser({ markOpen: true })));
          // keep the identity of unchanged subtrees (rows, points, children) → memo'd renderers skip them
          if (lastHuiSeg && lastHuiSeg.key === key && lastHuiSeg.kind === 'hui' && seg.kind === 'hui' && seg.node) {
            seg.node = shareStructure(lastHuiSeg.node, seg.node);
          }
          lastHuiSeg = seg;
          lastHuiRaw = content;
          lastHuiAt = now();
          out.push(lastHuiSeg);
        }
      } else {
        out.push({ key, kind: 'html', complete: false, html: content });
      }
    }
    return out;
  }

  return {
    push(delta: string): Segment[] {
      if (ended || !delta) return cache ?? (cache = build());
      pending += delta;
      feed();
      cache = null;
      return (cache = build());
    },
    end(): Segment[] {
      if (ended) return cache ?? (cache = build());
      // the final unterminated line counts as a complete line
      if (pending !== '') {
        const last = pending;
        pending = '';
        scanFrom = 0;
        processLine(last);
      }
      ended = true;
      // an unclosed typed fence without any content: plain (code) text
      if (mode === 'typed') decideTyped(false);
      if (mode === 'md') closeMarkdown();
      else closeBlock(true);
      cache = committed.slice();
      return cache;
    },
    segments(): Segment[] {
      return cache ?? (cache = build());
    },
  };
}

/** markdown segment → its append run (appendRun.ts), see mdSegment */
const mdRuns = new WeakMap<Segment, AppendRun>();

/**
 * The append run of a markdown segment from a stream parser: two segments with the same run (same key) have texts
 * where the longer one extends the shorter one. Undefined for segments made anywhere else.
 */
export function segmentAppendRun(seg: Segment): AppendRun | undefined {
  return mdRuns.get(seg);
}

export function parseMessage(text: string): Segment[] {
  const p = createStreamParser();
  p.push(text);
  return p.end();
}
