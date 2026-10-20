/**
 * Raw tool-call markup in an answer: a model that has no tools here (direct backends) or whose call the server did not
 * run wrote the call as text, e.g. `<tool_call>{"name":"cronjob_manage",…}</tool_call>` after "I'm setting up the
 * reminder now" (real-user PC-02). Nothing ran, so the answer never shows it as if it were content: the block is
 * replaced by one quiet line (`notice`). Pure (node:test).
 *
 * - Only at the start of a line outside fenced code: a model explaining the format in a code block, or prose that
 *   mentions `<tool_call>` inline, stays as written.
 * - Streaming: an opened block is hidden up to its end (it may still close), and a last line that may become an
 *   opener (`<tool_c`) is held back. The shown text therefore only ever grows (append-only for the parsers).
 * - Finished answer: an unclosed block is hidden to the end, with the notice.
 *
 * Every other output of a finished answer (copy / share, read-aloud and auto-read, the screen-reader announcement, the
 * "answer is ready" notification, the chat list preview and search text, /export) goes through `answerOutputText`, so
 * it says what the answer shows (PC-07: the announcement read the raw call's JSON).
 */

const NAMES = ['tool_call', 'tool_calls', 'function_call', 'function_calls', 'tool_use'];
const OPEN_RE = /^[ \t]*<(tool_calls?|function_calls?|tool_use)(?:[ \t][^>\n]*)?>|^[ \t]*<(invoke)[ \t]+name=[^>\n]*>/;
const ANY_OPENER_RE = /(?:^|\n)[ \t]*<(?:tool_calls?|function_calls?|tool_use|invoke[ \t])/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** a last line that may still become an opener while streaming */
function mayBecomeOpener(line: string): boolean {
  const t = line.trimStart();
  if (!t.startsWith('<') || t.includes('>')) return false;
  return NAMES.some((n) => `<${n}`.startsWith(t) || t.startsWith(`<${n}`)) || '<invoke name='.startsWith(t) || t.startsWith('<invoke ');
}

/** i18n key of the notice line (chat namespace) */
export const TOOL_MARKUP_NOTICE_KEY = 'chat.message.toolMarkupHidden';

/** A finished answer's text as every output path gets it: the same text the answer shows (`notice` '' drops blocks). */
export function answerOutputText(text: string, notice: string): string {
  return hideToolMarkup(text, { streaming: false, notice });
}

export function hideToolMarkup(text: string, opts: { streaming: boolean; notice: string }): string {
  if (!text.includes('<')) return text;
  // fast path (runs per streaming tick): no line starts like an opener, and the last line cannot become one
  if (!ANY_OPENER_RE.test(text) && !(opts.streaming && mayBecomeOpener(text.slice(text.lastIndexOf('\n') + 1)))) return text;
  const lines = text.split('\n');
  const out: string[] = [];
  let fence: { ch: string; len: number } | null = null;
  let changed = false;
  let held = false; // streaming: the text from a line on is held back (that line's newline before it stays)
  const addNotice = () => {
    changed = true;
    if (!opts.notice) return;
    // one line per run of hidden blocks, as its own paragraph
    let last = out.length - 1;
    while (last >= 0 && out[last].trim() === '') last--;
    if (last >= 0 && out[last] === `_${opts.notice}_`) return;
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push(`_${opts.notice}_`, '');
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE_RE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence.ch && f[1].length >= fence.len && line.trim() === f[1]) fence = null;
      out.push(line);
      continue;
    }
    if (f) {
      fence = { ch: f[1][0], len: f[1].length };
      out.push(line);
      continue;
    }
    const m = OPEN_RE.exec(line);
    if (!m) {
      if (opts.streaming && i === lines.length - 1 && mayBecomeOpener(line)) {
        changed = true;
        held = true;
        break;
      }
      out.push(line);
      continue;
    }
    const name = m[1] ?? m[2];
    const close = `</${name}>`;
    // the closing tag: on this line after the opener, or on a later line
    let endLine = -1;
    let endCol = -1;
    for (let j = i; j < lines.length; j++) {
      const from = j === i ? m[0].length : 0;
      const k = lines[j].indexOf(close, from);
      if (k >= 0) {
        endLine = j;
        endCol = k + close.length;
        break;
      }
    }
    if (endLine < 0) {
      // still open: streaming waits for the rest (nothing of it shows), a finished answer drops it
      if (opts.streaming) {
        changed = true;
        held = true;
      } else addNotice();
      break;
    }
    addNotice();
    const rest = lines[endLine].slice(endCol);
    i = endLine;
    if (rest.trim()) {
      lines[endLine] = rest.trimStart();
      i = endLine - 1; // scan the rest of that line as a line of its own
    }
  }
  if (!changed) return text;
  // trailing blank lines are kept: the shown text of a streaming answer only grows
  return out.join('\n') + (held && out.length ? '\n' : '');
}
