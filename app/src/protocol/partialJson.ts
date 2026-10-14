/**
 * Best-effort parser for incomplete JSON (streamed LLM output).
 *
 * Strategy: single linear scan that re-emits the text while tracking an
 * explicit container stack. At EOF the innermost incomplete entry is repaired:
 *  - unterminated string value  -> closed (partial escapes dropped)
 *  - dangling key / `"k":` / `"k"` / partial literal (`tru`, `-`, `nul`) -> entry dropped
 *  - trailing comma             -> removed
 *  - open arrays/objects        -> closed
 * Also tolerates trailing commas before `}`/`]` and raw control characters
 * inside strings, and drops a closing `]`/`}` that does not match the innermost open container
 * (models sometimes write `"cons":["a","b"]]}`; a missing closer is added at EOF). Never throws; returns `undefined` if nothing usable.
 */

type Frame = {
  kind: '{' | '[';
  /** object: 'key' | 'colon' | 'value' | 'comma'; array: 'value' | 'comma' */
  state: 'key' | 'colon' | 'value' | 'comma';
  /** index in `out` right after the opening bracket / last comma */
  entryStart: number;
};

const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function escapeControl(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

function isWs(c: string): boolean {
  return c === ' ' || c === '\n' || c === '\r' || c === '\t';
}

/**
 * Scan a string starting at the opening quote at `start`.
 * Returns the index after the closing quote if closed, else the safe end of the
 * raw content (never ending in the middle of an escape sequence).
 */
function scanString(raw: string, start: number): { closed: boolean; end: number } {
  const n = raw.length;
  let i = start + 1;
  while (i < n) {
    const c = raw.charCodeAt(i);
    if (c === 34 /* " */) return { closed: true, end: i + 1 };
    if (c === 92 /* \ */) {
      if (i + 1 >= n) return { closed: false, end: i };
      if (raw[i + 1] === 'u') {
        if (i + 6 > n) return { closed: false, end: i };
        i += 6;
      } else {
        i += 2;
      }
      continue;
    }
    i++;
  }
  return { closed: false, end: n };
}

/** Key added to objects that were still open at EOF (only with `markOpen`). */
export const PARTIAL_MARK = '__huiPartial';

export type PartialJsonOptions = {
  /**
   * Mark every object that was still open (unterminated) at EOF with `"__huiPartial": true`,
   * see `prunePartialItems`. Complete JSON is never marked.
   */
  markOpen?: boolean;
};

/** Deeper nesting is not repaired (nothing usable): bounds the scan and the closing suffix on hostile input. */
export const PARTIAL_MAX_DEPTH = 200;

export function parsePartialJson(raw: string, opts?: PartialJsonOptions): unknown | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    // fall through to repair
  }
  try {
    raw = skipToJson(stripJsonComments(raw));
    const repaired = repair(raw, !!opts?.markOpen);
    if (repaired === undefined) return undefined;
    return JSON.parse(repaired);
  } catch {
    return undefined;
  }
}

function repair(raw: string, markOpen: boolean): string | undefined {
  const n = raw.length;
  const stack: Frame[] = [];
  // output as tokens (one per char / string / literal): truncating = setting the length, so cutting entries and
  // dropping trailing commas never copies the text built so far (linear on hostile input)
  const out: string[] = [];
  let i = 0;
  let topDone = false; // top-level value finished
  let topStarted = false;

  const top = (): Frame | undefined => stack[stack.length - 1];

  /** value finished in current container */
  const valueDone = () => {
    const f = top();
    if (f) f.state = 'comma';
    else topDone = true;
  };

  /** drop trailing whitespace tokens */
  const trimWs = () => {
    while (out.length && isWs(out[out.length - 1])) out.pop();
  };

  /** drop trailing whitespace and one trailing comma */
  const dropTrailingComma = () => {
    trimWs();
    if (out[out.length - 1] === ',') out.pop();
  };

  /** cut current innermost entry; strip trailing comma/space */
  const cutEntry = () => {
    const f = top();
    out.length = f ? f.entryStart : 0;
    if (f) dropTrailingComma();
  };

  while (i < n) {
    const ch = raw[i];
    if (isWs(ch)) {
      out.push(ch);
      i++;
      continue;
    }
    if (topDone) {
      // trailing garbage after a complete top-level value: ignore
      break;
    }
    const f = top();

    if (ch === '"') {
      const { closed, end } = scanString(raw, i);
      const isKey = !!f && f.kind === '{' && f.state === 'key';
      if (!f && topStarted) return undefined;
      if (f && !isKey && f.state !== 'value') return undefined; // missing comma/colon
      if (f && f.kind === '{' && f.state === 'colon') return undefined;
      topStarted = true;
      if (!closed) {
        if (isKey) {
          cutEntry();
        } else {
          out.push(escapeControl(raw.slice(i, end)) + '"');
          valueDone();
        }
        i = n;
        break;
      }
      out.push(escapeControl(raw.slice(i, end)));
      i = end;
      if (isKey) f!.state = 'colon';
      else valueDone();
      continue;
    }

    if (ch === ':') {
      if (!f || f.kind !== '{' || f.state !== 'colon') return undefined;
      f.state = 'value';
      out.push(ch);
      i++;
      continue;
    }

    if (ch === ',') {
      if (!f || f.state !== 'comma') return undefined;
      out.push(ch);
      f.state = f.kind === '{' ? 'key' : 'value';
      f.entryStart = out.length;
      i++;
      continue;
    }

    if (ch === '{' || ch === '[') {
      if (f && f.state !== 'value') return undefined;
      if (!f && topStarted) return undefined;
      // hostile nesting: nothing usable (validators cap depth far lower), and no stall closing thousands of levels
      if (stack.length >= PARTIAL_MAX_DEPTH) return undefined;
      topStarted = true;
      out.push(ch);
      stack.push({ kind: ch, state: ch === '{' ? 'key' : 'value', entryStart: out.length });
      i++;
      continue;
    }

    if (ch === '}' || ch === ']') {
      if (!f) return undefined;
      if (f.kind !== (ch === '}' ? '{' : '[')) {
        // stray closer of the wrong kind (`["a"]]}`, `[1,2}`): drop it, the open container stays open
        i++;
        continue;
      }
      // tolerate trailing comma, e.g. [1,2,]
      if (f.state === 'key' || (f.kind === '[' && f.state === 'value')) {
        dropTrailingComma();
      } else if (f.state !== 'comma') {
        return undefined;
      }
      out.push(ch);
      stack.pop();
      valueDone();
      i++;
      continue;
    }

    // literal token (number / true / false / null)
    let j = i;
    while (j < n) {
      const c = raw[j];
      if (c === ',' || c === '}' || c === ']' || c === ':' || c === '"' || isWs(c)) break;
      j++;
    }
    let tok = raw.slice(i, j);
    if (f && f.state !== 'value') return undefined;
    if (!f && topStarted) return undefined;
    topStarted = true;
    const atEof = j >= n;
    let valid = tok === 'true' || tok === 'false' || tok === 'null' || NUMBER_RE.test(tok);
    if (!valid && atEof) {
      // partial number: drop trailing `.`, `e`, `E`, `+`, `-`
      const t2 = tok.replace(/[.eE+-]+$/, '');
      if (t2 && NUMBER_RE.test(t2)) {
        tok = t2;
        valid = true;
      }
    }
    if (!valid) {
      if (atEof) {
        // partial literal like `tru`, `nu`, `-`: drop the dangling entry
        cutEntry();
        i = n;
        break;
      }
      return undefined;
    }
    out.push(tok);
    i = j;
    valueDone();
  }

  // ---- EOF repair ----
  const f = top();
  if (f) {
    if (f.kind === '{' && (f.state === 'colon' || f.state === 'value')) {
      cutEntry();
    } else if (f.state === 'key' || (f.kind === '[' && f.state === 'value')) {
      // after comma (or right after open): strip trailing comma
      dropTrailingComma();
    }
  }
  if (!topStarted) return undefined;
  trimWs();
  if (!out.length) return undefined;
  // closing suffix in its own array, joined once
  const suffix: string[] = [];
  let last = out[out.length - 1];
  for (let k = stack.length - 1; k >= 0; k--) {
    if (stack[k].kind === '{' && markOpen) suffix.push((last === '{' ? '' : ',') + `"${PARTIAL_MARK}":true`);
    last = stack[k].kind === '{' ? '}' : ']';
    suffix.push(last);
  }
  return out.join('') + suffix.join('');
}

// ---------------------------------------------------------------- incremental (streaming) variant

/** scan state of `createPartialJsonParser`: every token before `i` is final (more text can only come after it) */
type Scan = {
  /** the text scanned so far (a new text must extend it to resume) */
  raw: string;
  i: number;
  stack: Frame[];
  /** output tokens without whitespace (insignificant for JSON.parse) */
  out: string[];
  topDone: boolean;
  topStarted: boolean;
  /** the committed tokens are not repairable / contain a comment: every extension takes the full path */
  full: boolean;
};

/** `scanString` + whether `raw[start, end)` holds a raw control char anywhere (then it needs `escapeControl`) */
function scanStringCtrl(raw: string, start: number): { closed: boolean; end: number; ctrl: boolean } {
  const n = raw.length;
  let ctrl = false;
  let i = start + 1;
  while (i < n) {
    const c = raw.charCodeAt(i);
    if (c === 34 /* " */) return { closed: true, end: i + 1, ctrl };
    if (c === 92 /* \ */) {
      if (i + 1 >= n) return { closed: false, end: i, ctrl };
      const step = raw[i + 1] === 'u' ? 6 : 2;
      if (step === 6 && i + 6 > n) return { closed: false, end: i, ctrl };
      // the chars an escape skips count too (escapeControl rewrites them wherever they are)
      for (let k = i + 1; k < i + step; k++) if (raw.charCodeAt(k) < 32) ctrl = true;
      i += step;
      continue;
    }
    if (c < 32) ctrl = true;
    i++;
  }
  return { closed: false, end: n, ctrl };
}

const isWsCode = (c: number) => c === 32 || c === 10 || c === 13 || c === 9;

/**
 * `repair` as a resumable scan over `raw` from `s.i`. `commit`: stop BEFORE a token that runs to the end of `raw` (an
 * unterminated string, a literal at the end – both can still change), so `s` only holds final tokens; otherwise
 * process to the end exactly like `repair`. 'fail' = repair gives undefined, 'comment' = a `//` or `/*` comment
 * (repair runs on comment-stripped text: those take the full path).
 */
function scanTokens(raw: string, s: Scan, commit: boolean): 'ok' | 'fail' | 'comment' {
  const n = raw.length;
  const { stack, out } = s;
  const top = (): Frame | undefined => stack[stack.length - 1];
  const valueDone = () => {
    const f = top();
    if (f) f.state = 'comma';
    else s.topDone = true;
  };
  const dropTrailingComma = () => {
    if (out[out.length - 1] === ',') out.pop();
  };
  const cutEntry = () => {
    const f = top();
    out.length = f ? f.entryStart : 0;
    if (f) dropTrailingComma();
  };
  const isCommentAt = (k: number) => raw.charCodeAt(k) === 47 && (raw.charCodeAt(k + 1) === 47 || raw.charCodeAt(k + 1) === 42);
  let i = s.i;
  while (i < n) {
    const code = raw.charCodeAt(i);
    if (isWsCode(code)) {
      i++;
      continue;
    }
    // trailing garbage after a complete top-level value: ignored (also by every extension)
    if (s.topDone) break;
    if (isCommentAt(i)) return 'comment';
    const ch = raw[i];
    const f = top();

    if (ch === '"') {
      const { closed, end, ctrl } = scanStringCtrl(raw, i);
      if (!closed && commit) break;
      const isKey = !!f && f.kind === '{' && f.state === 'key';
      if (!f && s.topStarted) return 'fail';
      if (f && !isKey && f.state !== 'value') return 'fail';
      if (f && f.kind === '{' && f.state === 'colon') return 'fail';
      s.topStarted = true;
      const str = raw.slice(i, end);
      if (!closed) {
        if (isKey) cutEntry();
        else {
          out.push((ctrl ? escapeControl(str) : str) + '"');
          valueDone();
        }
        i = n;
        break;
      }
      out.push(ctrl ? escapeControl(str) : str);
      i = end;
      if (isKey) f!.state = 'colon';
      else valueDone();
      continue;
    }

    if (ch === ':') {
      if (!f || f.kind !== '{' || f.state !== 'colon') return 'fail';
      f.state = 'value';
      out.push(ch);
      i++;
      continue;
    }

    if (ch === ',') {
      if (!f || f.state !== 'comma') return 'fail';
      out.push(ch);
      f.state = f.kind === '{' ? 'key' : 'value';
      f.entryStart = out.length;
      i++;
      continue;
    }

    if (ch === '{' || ch === '[') {
      if (f && f.state !== 'value') return 'fail';
      if (!f && s.topStarted) return 'fail';
      if (stack.length >= PARTIAL_MAX_DEPTH) return 'fail';
      s.topStarted = true;
      out.push(ch);
      stack.push({ kind: ch, state: ch === '{' ? 'key' : 'value', entryStart: out.length });
      i++;
      continue;
    }

    if (ch === '}' || ch === ']') {
      if (!f) return 'fail';
      if (f.kind !== (ch === '}' ? '{' : '[')) {
        i++;
        continue;
      }
      if (f.state === 'key' || (f.kind === '[' && f.state === 'value')) dropTrailingComma();
      else if (f.state !== 'comma') return 'fail';
      out.push(ch);
      stack.pop();
      valueDone();
      i++;
      continue;
    }

    // literal token (number / true / false / null)
    let j = i;
    while (j < n) {
      const c = raw[j];
      if (c === ',' || c === '}' || c === ']' || c === ':' || c === '"' || isWs(c)) break;
      if (isCommentAt(j)) return 'comment';
      j++;
    }
    const atEof = j >= n;
    if (atEof && commit) break;
    let tok = raw.slice(i, j);
    if (f && f.state !== 'value') return 'fail';
    if (!f && s.topStarted) return 'fail';
    s.topStarted = true;
    let valid = tok === 'true' || tok === 'false' || tok === 'null' || NUMBER_RE.test(tok);
    if (!valid && atEof) {
      const t2 = tok.replace(/[.eE+-]+$/, '');
      if (t2 && NUMBER_RE.test(t2)) {
        tok = t2;
        valid = true;
      }
    }
    if (!valid) {
      if (atEof) {
        cutEntry();
        i = n;
        break;
      }
      return 'fail';
    }
    out.push(tok);
    i = j;
    valueDone();
  }
  s.i = i;
  return 'ok';
}

/**
 * Streaming variant of `parsePartialJson(raw, opts)` for a text that grows by appending (the open ```hui block of a
 * streaming answer, re-parsed on every update): final tokens are scanned once and kept, each call only scans the
 * new text and repairs the end on a copy – O(new text) interpreted work instead of O(text) per update; joining
 * the tokens and JSON.parse stay native O(text). Same result as `parsePartialJson(raw, opts)` for every call (also
 * for unrelated texts: they restart the scan). Texts that do not start with `{` / `[` (after whitespace), contain a
 * comment or cannot be repaired take the full `parsePartialJson` path.
 */
export function createPartialJsonParser(opts?: PartialJsonOptions): (raw: string) => unknown | undefined {
  const markOpen = !!opts?.markOpen;
  let s: Scan | null = null;
  return (raw) => {
    if (typeof raw !== 'string') return undefined;
    if (!s || raw.length < s.raw.length || !raw.startsWith(s.raw)) {
      // the head must be plain whitespace + `{` / `[`: then comment stripping and skipToJson leave it alone
      const m = /[^ \n\r\t]/.exec(raw);
      s = m && (m[0] === '{' || m[0] === '[') ? { raw: '', i: 0, stack: [], out: [], topDone: false, topStarted: false, full: false } : null;
    }
    if (!s) return parsePartialJson(raw, opts);
    s.raw = raw;
    if (!s.full && scanTokens(raw, s, true) !== 'ok') s.full = true;
    if (s.full) return parsePartialJson(raw, opts);
    // the end: on a copy (the committed state stays resumable)
    const e: Scan = { ...s, stack: s.stack.map((f) => ({ ...f })), out: s.out.slice() };
    if (scanTokens(raw, e, false) !== 'ok') return parsePartialJson(raw, opts);
    // a complete value (no open container): what JSON.parse(raw) would accept – parsePartialJson tries that first
    if (e.topDone && e.stack.length === 0) {
      try {
        return JSON.parse(raw);
      } catch {
        // trailing garbage: repaired below
      }
    }
    const { stack, out } = e;
    const f = stack[stack.length - 1];
    if (f) {
      if (f.kind === '{' && (f.state === 'colon' || f.state === 'value')) {
        out.length = f.entryStart;
        if (out[out.length - 1] === ',') out.pop();
      } else if ((f.state === 'key' || (f.kind === '[' && f.state === 'value')) && out[out.length - 1] === ',') {
        out.pop();
      }
    }
    if (!e.topStarted || !out.length) return undefined;
    let last = out[out.length - 1];
    let suffix = '';
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].kind === '{' && markOpen) suffix += (last === '{' ? '' : ',') + `"${PARTIAL_MARK}":true`;
      last = stack[k].kind === '{' ? '}' : ']';
      suffix += last;
    }
    try {
      return JSON.parse(out.join('') + suffix);
    } catch {
      return undefined;
    }
  };
}

/** Nesting beyond this is never rendered (validator depth caps are far lower). */
export const PRUNE_MAX_DEPTH = 64;
/** Values visited per prune (whole open block); generous vs. every validator cap (charts: 12 × 1 000 points). */
export const PRUNE_MAX_VALUES = 100_000;

/** An array element that is plain data (no node `type`, no `children` / `data` that stream progressively). */
function isLeafItem(o: Record<string, unknown>): boolean {
  return !('type' in o) && !('children' in o) && !('data' in o);
}

/**
 * For streamed (`markOpen`) partial JSON: drop the still-open LAST element of every array when it is
 * a plain data object (checklist item, choice option, quiz question, ingredient, marker, slot, chart
 * point …) – it would otherwise flash with half its fields (e.g. a truncated `category` that moves
 * the row between groups on every token). Open node objects (`type`), tabs/accordion entries
 * (`children`) and chart series (`data`) stay, so their own arrays keep filling in. All marks are
 * removed. Returns a new value; the input is not modified.
 */
export function prunePartialItems(v: unknown): unknown {
  return pruneRec(v, 0, { left: PRUNE_MAX_VALUES });
}

/**
 * Budgeted copy (Astra F16 / GPT #3): depth-capped and at most PRUNE_MAX_VALUES values visited per rebuild,
 * so a huge or deeply nested extraneous field cannot overflow the stack or stall the UI thread before the
 * validator's own caps apply. Past the budget, arrays/objects are cut short (the validator never renders
 * that much anyway).
 */
function pruneRec(v: unknown, depth: number, budget: { left: number }): unknown {
  if (depth > PRUNE_MAX_DEPTH || --budget.left < 0) return null;
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length && budget.left > 0; i++) out.push(pruneRec(v[i], depth + 1, budget));
    const last = v[v.length - 1];
    if (out.length === v.length && last && typeof last === 'object' && !Array.isArray(last) && (last as Record<string, unknown>)[PARTIAL_MARK] === true && isLeafItem(last as Record<string, unknown>)) {
      out.pop();
    }
    return out;
  }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k in v as Record<string, unknown>) {
      if (budget.left <= 0) break;
      if (!Object.prototype.hasOwnProperty.call(v, k) || k === PARTIAL_MARK || k === '__proto__') continue;
      out[k] = pruneRec((v as Record<string, unknown>)[k], depth + 1, budget);
    }
    return out;
  }
  return v;
}

/** True when `v` is an object that was still open at EOF (`parsePartialJson(…, { markOpen: true })`). */
export function isOpenObject(v: unknown): boolean {
  return !!v && typeof v === 'object' && (v as Record<string, unknown>)[PARTIAL_MARK] === true;
}

/**
 * Remove `// line` and `/* block *\/` comments outside of strings (models sometimes annotate JSON).
 * Block comments become one space and line comments keep their newline, so tokens never merge.
 * An unterminated block comment runs to the end. Fast path: no `/` → unchanged.
 */
export function stripJsonComments(raw: string): string {
  if (raw.indexOf('/') === -1) return raw;
  let out = '';
  let i = 0;
  const n = raw.length;
  let last = 0;
  while (i < n) {
    const c = raw.charCodeAt(i);
    if (c === 34 /* " */) {
      i = scanString(raw, i).end;
      continue;
    }
    if (c === 47 /* / */ && i + 1 < n) {
      const d = raw[i + 1];
      if (d === '/' || d === '*') {
        out += raw.slice(last, i);
        if (d === '/') {
          const nl = raw.indexOf('\n', i + 2);
          i = nl === -1 ? n : nl;
        } else {
          const e = raw.indexOf('*/', i + 2);
          i = e === -1 ? n : e + 2;
          // a comment separates tokens: `1/* x */2` must stay two tokens (→ invalid), not become `12`
          out += ' ';
        }
        last = i;
        continue;
      }
    }
    i++;
  }
  return out + raw.slice(last);
}

/** Drop leading non-JSON text (a stray "json" line, a Markdown heading …) before the first `{` / `[`. */
function skipToJson(raw: string): string {
  const m = /[{[]/.exec(raw);
  if (!m) return raw;
  const head = raw.slice(0, m.index);
  return head.trim() === '' ? raw : raw.slice(m.index);
}

/** Re-tries after an unbalanced value per lenient parse (each one rescans the rest). */
const LENIENT_MAX_RETRIES = 16;

/**
 * End index (exclusive) of the balanced `{…}` / `[…]` starting at `start`, or -1 if unbalanced.
 * Closers that do not match the innermost open container are stray (see `repair`) and ignored, so a
 * single wrong `]` neither ends the value early nor hides its real end. `stray`: index of the first such
 * closer (-1: none).
 */
function valueEnd(raw: string, start: number): { end: number; stray: number } {
  const stack: number[] = [];
  let stray = -1;
  let i = start;
  while (i < raw.length) {
    const c = raw.charCodeAt(i);
    if (c === 34 /* " */) {
      const r = scanString(raw, i);
      if (!r.closed) return { end: -1, stray };
      i = r.end;
      continue;
    }
    if (c === 123 /* { */ || c === 91 /* [ */) stack.push(c);
    else if (c === 125 /* } */ || c === 93 /* ] */) {
      if (stack[stack.length - 1] === c - 2) {
        stack.pop();
        if (stack.length === 0) return { end: i + 1, stray };
      } else if (stray === -1) stray = i;
    }
    i++;
  }
  return { end: -1, stray };
}

/**
 * Lenient parse of a COMPLETE block that failed `JSON.parse`: comments removed, leading prose
 * skipped, trailing commas and stray/missing closers tolerated, and several concatenated top-level values (`{…}\n{…}`,
 * `{…},{…}`) returned as an array. Returns undefined when nothing usable is found.
 */
export function parseLenientJson(raw: string): unknown | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = stripJsonComments(raw);
  const values: unknown[] = [];
  let i = 0;
  let retries = 0;
  while (i < s.length) {
    const m = /[{[]/g;
    m.lastIndex = i;
    const hit = m.exec(s);
    if (!hit) break;
    const start = hit.index;
    const { end, stray } = valueEnd(s, start);
    if (end !== -1) {
      const v = parsePartialJson(s.slice(start, end));
      if (v !== undefined) values.push(v);
      i = end;
      continue;
    }
    // unbalanced to the end: a truncated tail is repaired as a whole …
    const tail = parsePartialJson(s.slice(start));
    if (tail !== undefined || stray === -1 || ++retries > LENIENT_MAX_RETRIES) {
      if (tail !== undefined) values.push(tail);
      break;
    }
    // … unless a mismatched closer broke it (`{"a":[1}` + `{"b":2}`): keep what came before that closer and go on
    // after it, so a following well-formed value is not lost (bounded retries: linear on hostile input)
    const head = parsePartialJson(s.slice(start, stray));
    if (head !== undefined) values.push(head);
    i = stray + 1;
  }
  if (!values.length) return undefined;
  return values.length === 1 ? values[0] : values;
}
