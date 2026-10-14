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
import type { HuiNode, Segment } from './types.ts';
import { createPartialJsonParser, parseLenientJson, parsePartialJson, prunePartialItems } from './partialJson.ts';
import { collectInteractiveIds, isPartialTypeName, normalizeNode, readableFallback } from './validate.ts';
import { shareStructure } from './structuralShare.ts';

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
 * ```places …). Only names that are never programming-language/markup tags are accepted; the fence
 * name becomes the node `type` when the JSON has none. Invalid JSON falls back to a readable view.
 */
export const TYPED_FENCE_TYPES: ReadonlySet<string> = new Set([
  'suggestions', 'places', 'products', 'weather', 'recipe', 'compare', 'checklist', 'timeline', 'agenda',
  'stats', 'mindmap', 'vocab', 'quiz', 'flashcards', 'workout', 'studyplan', 'gallery', 'decision', 'poll', 'guide', 'paths', 'blocks',
]);
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
 * `typed`: a typed fence (```quiz) whose content has no non-whitespace char yet – held back until the first one
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
    value = withFenceType(value, fenceType);
    // normalizeNode also maps harmless variants (top-level arrays, envelopes, wrappers, type aliases)
    const node = normalizeNode(value, opts);
    if (node) return error ? { key, kind: 'hui', complete: true, raw, node, error } : { key, kind: 'hui', complete: true, raw, node };
    // still no node: show the content readably instead of only an error line
    const fb = readableFallback(value, opts);
    const why = error ?? 'Ungültiger hui-Block: erwartet ein Objekt mit "type"';
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

  const nextKey = () => `seg-${committed.length}`;
  const usedIds: string[] = []; // interactive ids of committed hui segments

  function visiblePending(): string {
    if (pending === '') return '';
    let p = pending;
    if (p.charCodeAt(p.length - 1) === 13) p = p.slice(0, -1);
    if (ended) return p;
    if (mode === 'md') {
      return !mdFence && mayBecomeOpener(p) ? '' : p;
    }
    // undecided typed fence: nothing of it shows yet
    if (mode === 'typed') return '';
    // inside a block: hold back a possible closing fence
    return PARTIAL_HEAD_RE.test(p) ? '' : p;
  }

  function mdSegment(key: string, visible: string): Segment | null {
    if (visible.trim() === '') return null;
    const text = visible.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
    if (text === '') return null;
    if (lastMd && lastMd.kind === 'markdown' && lastMd.key === key && lastMd.text === text) return lastMd;
    lastMd = { key, kind: 'markdown', text };
    return lastMd;
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
    if (c) decideTyped(c === '{' || (c === '[' && fenceType !== undefined && ARRAY_FENCE_TYPES.has(fenceType)));
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
      const seg = mdSegment(nextKey(), vp ? mdText + vp : mdText);
      if (seg) out.push(seg);
    } else {
      // (no `/\n$/` regex: the Hermes interpreter would visit every char of the open block on every update)
      const raw = vp ? blockBuf + vp : blockBuf;
      const content = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
      const key = nextKey();
      if (mode === 'hui') {
        if (lastHuiSeg && lastHuiSeg.key === key && (lastHuiRaw === content || skipRebuild(content))) out.push(lastHuiSeg);
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

export function parseMessage(text: string): Segment[] {
  const p = createStreamParser();
  p.push(text);
  return p.end();
}
