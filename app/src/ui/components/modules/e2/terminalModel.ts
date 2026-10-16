/**
 * `terminal` – pure model (node:test). An INCREMENTAL terminal-output interpreter: a growing output only feeds its new
 * chars, finished lines are immutable objects (memo'd chunks skip them), only the current line is rebuilt.
 *
 * Supported: SGR colours / styles (16 colours, 256-colour and truecolor, bold, dim, italic, underline, inverse),
 * carriage return (progress bars overwrite their line), backspace, tab stops, erase-in-line (`ESC[K`), cursor column
 * moves; other CSI / OSC sequences are dropped. Escape sequences split across updates are held back.
 */

import { extendsText } from './appendCheck.ts';

export type TermStyle = {
  /** 0-255 palette index or '#rrggbb' */
  fg?: number | string;
  bg?: number | string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
};
/** a run of text in one style; `s` = index into the parser's style table (0 = plain) */
export type TermSpan = { text: string; s: number };
export type TermLine = { key: number; spans: TermSpan[]; text: string };
export type TermSnapshot = {
  /** finished lines (identity stable) */
  lines: TermLine[];
  /** the current, unterminated line (null when empty) */
  tail: TermLine | null;
  /** style table (index 0 = plain) */
  styles: readonly TermStyle[];
};

export type TermParser = {
  /**
   * Snapshot after `output`. `start` = absolute offset of `output[0]` when it is a retained tail window (the host drops
   * chars from the front): a window that moved forward and still overlaps the previous one only feeds the new tail.
   */
  update(output: string, start?: number): TermSnapshot;
};

/** tab stops every 8 columns */
const TAB = 8;
/** more finished lines than this drop from the head (the output is capped by the protocol anyway) */
export const MAX_TERM_LINES = 50_000;
/** Bound interpreted output too: cursor motion can generate spaces absent from the raw text. */
export const MAX_TERM_CHARS = 200_000;
const MAX_CURSOR_COLUMN = 4096;

export function createTermParser(): TermParser {
  let src = '';
  let srcStart = 0;
  let stylesSnap: TermStyle[] = [{}];
  let esc = ''; // an escape sequence still incomplete at the end of the fed text
  let lines: TermLine[] = [];
  let dropped = 0;
  let finishedChars = 0;
  let chars: string[] = [];
  let cstyles: number[] = [];
  let col = 0;
  let style = 0;
  let cur: TermStyle = {};
  let styles: TermStyle[] = [{}];
  let styleIds = new Map<string, number>([['', 0]]);
  let lastSnap: TermSnapshot | null = null;
  let tailCache: TermLine | null = null;
  let linesDirty = true;

  function reset() {
    src = '';
    esc = '';
    lines = [];
    dropped = 0;
    finishedChars = 0;
    chars = [];
    cstyles = [];
    col = 0;
    style = 0;
    cur = {};
    styles = [{}];
    stylesSnap = [{}];
    styleIds = new Map([['', 0]]);
    lastSnap = null;
    tailCache = null;
    linesDirty = true;
  }

  function styleId(s: TermStyle): number {
    const k = `${s.fg ?? ''}|${s.bg ?? ''}|${s.bold ? 1 : 0}${s.dim ? 1 : 0}${s.italic ? 1 : 0}${s.underline ? 1 : 0}${s.inverse ? 1 : 0}`;
    const key = k === '||00000' ? '' : k;
    let id = styleIds.get(key);
    if (id === undefined) {
      id = styles.length;
      styles.push({ ...s });
      styleIds.set(key, id);
    }
    return id;
  }

  function spansOf(cs: readonly string[], ss: readonly number[]): TermSpan[] {
    const spans: TermSpan[] = [];
    let i = 0;
    while (i < cs.length) {
      const s = ss[i];
      let j = i + 1;
      while (j < cs.length && ss[j] === s) j++;
      spans.push({ text: cs.slice(i, j).join(''), s });
      i = j;
    }
    return spans;
  }

  function endLine() {
    const spans = spansOf(chars, cstyles);
    lines.push({ key: dropped + lines.length, spans, text: chars.join('') });
    finishedChars += chars.length;
    let n = 0;
    while (n < lines.length && (lines.length - n > MAX_TERM_LINES || finishedChars > MAX_TERM_CHARS)) {
      finishedChars -= lines[n++].text.length;
    }
    if (n) {
      lines = lines.slice(n);
      dropped += n;
    }
    chars = [];
    cstyles = [];
    col = 0;
    linesDirty = true;
    tailCache = null;
  }

  function put(ch: string) {
    if (col >= MAX_TERM_CHARS) {
      const drop = col - MAX_TERM_CHARS + 1;
      chars = chars.slice(drop);
      cstyles = cstyles.slice(drop);
      col = chars.length;
    }
    while (chars.length < col) {
      chars.push(' ');
      cstyles.push(0);
    }
    if (col < chars.length) {
      chars[col] = ch;
      cstyles[col] = style;
    } else {
      chars.push(ch);
      cstyles.push(style);
    }
    col++;
  }

  function sgr(params: string) {
    const ps = params === '' ? [0] : params.split(/[;:]/).map((p) => (p === '' ? 0 : Number(p)));
    if (!ps.every(p => Number.isInteger(p) && p >= 0)) return;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p === 0) cur = {};
      else if (p === 1) cur.bold = true;
      else if (p === 2) cur.dim = true;
      else if (p === 3) cur.italic = true;
      else if (p === 4) cur.underline = true;
      else if (p === 7) cur.inverse = true;
      else if (p === 22) cur.bold = cur.dim = false;
      else if (p === 23) cur.italic = false;
      else if (p === 24) cur.underline = false;
      else if (p === 27) cur.inverse = false;
      else if (p >= 30 && p <= 37) cur.fg = p - 30;
      else if (p >= 90 && p <= 97) cur.fg = p - 90 + 8;
      else if (p === 39) cur.fg = undefined;
      else if (p >= 40 && p <= 47) cur.bg = p - 40;
      else if (p >= 100 && p <= 107) cur.bg = p - 100 + 8;
      else if (p === 49) cur.bg = undefined;
      else if (p === 38 || p === 48) {
        let c: number | string | undefined;
        if (ps[i + 1] === 5 && ps[i + 2] !== undefined) {
          c = Math.max(0, Math.min(255, ps[i + 2]));
          i += 2;
        } else if (ps[i + 1] === 2 && ps[i + 4] !== undefined) {
          c = '#' + [ps[i + 2], ps[i + 3], ps[i + 4]].map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
          i += 4;
        } else break;
        if (p === 38) cur.fg = c;
        else cur.bg = c;
      }
    }
    style = styleId(cur);
  }

  function csi(params: string, final: string) {
    const raw = Number(params.split(';')[0]);
    const n = Number.isFinite(raw) && Number.isInteger(raw) && raw >= 0 ? raw : 0;
    switch (final) {
      case 'm':
        sgr(params);
        break;
      case 'K':
        if (n === 0) {
          chars.length = Math.min(chars.length, col);
          cstyles.length = chars.length;
        } else if (n === 1) {
          for (let i = 0; i < Math.min(col + 1, chars.length); i++) {
            chars[i] = ' ';
            cstyles[i] = 0;
          }
        } else {
          chars = [];
          cstyles = [];
        }
        break;
      case 'G':
        col = Math.min(MAX_CURSOR_COLUMN, Math.max(0, (n || 1) - 1));
        break;
      case 'C':
        col = Math.min(MAX_CURSOR_COLUMN, col + (n || 1));
        break;
      case 'D':
        col = Math.max(0, col - (n || 1));
        break;
      default:
        // cursor up / screen clears / modes: no screen model, dropped
        break;
    }
  }

  /** an escape sequence at `s[i]` (ESC); returns the index after it, or -1 when incomplete */
  function escape(s: string, i: number): number {
    if (i + 1 >= s.length) return -1;
    const c = s[i + 1];
    if (c === '[') {
      let j = i + 2;
      while (j < s.length) {
        const code = s.charCodeAt(j);
        if (code >= 0x40 && code <= 0x7e) {
          csi(s.slice(i + 2, j).replace(/^[?>=]/, ''), s[j]);
          return j + 1;
        }
        // garbage inside a CSI: give up on it
        if (code < 0x20 || j - i > 64) return j;
        j++;
      }
      return -1;
    }
    if (c === ']') {
      // OSC … BEL or ESC \ (titles, hyperlinks): dropped
      for (let j = i + 2; j < s.length; j++) {
        if (s.charCodeAt(j) === 7) return j + 1;
        if (s.charCodeAt(j) === 27 && s[j + 1] === '\\') return j + 2;
        if (s.charCodeAt(j) === 27 && j + 1 >= s.length) return -1;
      }
      return -1;
    }
    // charset selection ESC ( B and other two-/three-char sequences
    if (c === '(' || c === ')' || c === '#') return i + 2 < s.length ? i + 3 : -1;
    return i + 2;
  }

  function feed(text: string) {
    const s = esc ? esc + text : text;
    esc = '';
    let i = 0;
    while (i < s.length) {
      const code = s.charCodeAt(i);
      if (code >= 0x20 && code !== 0x7f) {
        // printable run
        let j = i + 1;
        while (j < s.length) {
          const c = s.charCodeAt(j);
          if (c < 0x20 || c === 0x7f) break;
          j++;
        }
        if (col === chars.length) {
          const drop = Math.max(0, chars.length + j - i - MAX_TERM_CHARS);
          if (drop) {
            chars = chars.slice(drop);
            cstyles = cstyles.slice(drop);
          }
          for (let k = Math.max(i, j - MAX_TERM_CHARS); k < j; k++) {
            chars.push(s[k]);
            cstyles.push(style);
          }
          col = chars.length;
        } else for (let k = i; k < j; k++) put(s[k]);
        i = j;
        continue;
      }
      if (code === 10) endLine();
      else if (code === 13) {
        if (s.charCodeAt(i + 1) !== 10) col = 0;
      } else if (code === 8) col = Math.max(0, col - 1);
      else if (code === 9) {
        const to = Math.min(MAX_TERM_CHARS, (Math.floor(col / TAB) + 1) * TAB);
        while (col < to) put(' ');
      } else if (code === 27) {
        const e = escape(s, i);
        if (e < 0) {
          esc = s.slice(i);
          break;
        }
        i = e;
        continue;
      }
      i++;
    }
    tailCache = null;
  }

  function tail(): TermLine | null {
    if (!chars.length) return null;
    if (!tailCache) tailCache = { key: dropped + lines.length, spans: spansOf(chars, cstyles), text: chars.join('') };
    return tailCache;
  }

  return {
    update(output: string, start = 0): TermSnapshot {
      if (output === src && start === srcStart && lastSnap) return lastSnap;
      const drop = start - srcStart;
      if (drop === 0 && extendsText(output, src)) feed(output.slice(src.length));
      else if (drop > 0 && drop <= src.length && extendsText(output, src, drop)) feed(output.slice(src.length - drop));
      else {
        reset();
        feed(output);
      }
      src = output;
      srcStart = start;
      const t = tail();
      if (stylesSnap.length !== styles.length) stylesSnap = styles.slice();
      if (lastSnap && !linesDirty && lastSnap.tail === t && lastSnap.styles === stylesSnap) return lastSnap;
      lastSnap = { lines: linesDirty || !lastSnap ? lines.slice() : lastSnap.lines, tail: t, styles: stylesSnap };
      linesDirty = false;
      return lastSnap;
    },
  };
}

/** All lines (finished + tail) as plain text: copy output. */
export function plainText(snap: TermSnapshot): string {
  const out = snap.lines.map((l) => l.text);
  if (snap.tail) out.push(snap.tail.text);
  return out.join('\n');
}

/** Visible line count (finished + tail). */
export function lineCount(snap: TermSnapshot): number {
  return snap.lines.length + (snap.tail ? 1 : 0);
}

// ───────────────────────── colours ─────────────────────────

/** xterm-like 16-colour palettes tuned for the code background of dark / light themes */
const PALETTE_DARK = ['#3B4252', '#F07A80', '#7DBE8E', '#E5C07B', '#6CA7E8', '#C792EA', '#56C2C9', '#D8DEE9', '#7A8394', '#FF9AA0', '#9AD8A8', '#F2D58F', '#8CBDF5', '#DDB0F5', '#7FDBE2', '#FFFFFF'];
const PALETTE_LIGHT = ['#1F2328', '#B42F3A', '#2F7A3E', '#8A6100', '#1F5FB4', '#8E3FA8', '#127A84', '#6E7781', '#57606A', '#D1242F', '#1A7F37', '#9A6700', '#0969DA', '#8250DF', '#1B7C83', '#8C959F'];

/** a 0-255 palette index → '#rrggbb' (16 theme colours, 6×6×6 cube, 24 greys) */
export function ansiColor(c: number | string, dark: boolean): string {
  if (typeof c === 'string') return c;
  if (!Number.isInteger(c) || c < 0 || c > 255) return (dark ? PALETTE_DARK : PALETTE_LIGHT)[7];
  if (c < 16) return (dark ? PALETTE_DARK : PALETTE_LIGHT)[c];
  if (c >= 232) {
    const v = 8 + (c - 232) * 10;
    return '#' + v.toString(16).padStart(2, '0').repeat(3);
  }
  const i = c - 16;
  const steps = [0, 95, 135, 175, 215, 255];
  return '#' + [Math.floor(i / 36), Math.floor(i / 6) % 6, i % 6].map((k) => steps[k].toString(16).padStart(2, '0')).join('');
}

/** Duration badge text parts: 350 ms · 1.2 s · 2 min 5 s · 1 h 3 min */
export function formatDuration(ms: number): { n: string; unit: 'ms' | 's' | 'min' | 'h' } | { m: number; s: number } | { h: number; m: number } {
  if (ms < 1000) return { n: String(Math.round(ms)), unit: 'ms' };
  if (ms < 60_000) {
    const s = ms / 1000;
    return { n: s < 10 ? s.toFixed(1) : String(Math.round(s)), unit: 's' };
  }
  if (ms < 3_600_000) {
    const total = Math.round(ms / 1000);
    return { m: Math.floor(total / 60), s: total % 60 };
  }
  const total = Math.round(ms / 60_000);
  return { h: Math.floor(total / 60), m: total % 60 };
}

export type TerminalState = 'running' | 'ok' | 'failed' | 'unknown';

/** badge state: explicit status, else from the exit code, else running while the answer streams */
export function terminalState(n: { status?: string; exitCode?: number }, streaming: boolean): TerminalState {
  if (n.status === 'running') return streaming || n.exitCode === undefined ? 'running' : n.exitCode === 0 ? 'ok' : 'failed';
  if (n.status === 'error') return 'failed';
  if (n.status === 'done') return n.exitCode !== undefined && n.exitCode !== 0 ? 'failed' : 'ok';
  if (n.exitCode !== undefined) return n.exitCode === 0 ? 'ok' : 'failed';
  return streaming ? 'running' : 'unknown';
}

/** collapsed view: lines shown (the tail – results and errors are at the end) */
export const TERM_PREVIEW_LINES = 40;
/** outputs up to this many lines show completely, no "show all" */
export const TERM_SHOW_ALL_MIN = 52;

/** which lines the view renders: everything, or the last TERM_PREVIEW_LINES with a count of the hidden ones */
export function visibleLines(snap: TermSnapshot, expanded: boolean): { lines: TermLine[]; hidden: number } {
  const all = lineCount(snap);
  if (expanded || all <= TERM_SHOW_ALL_MIN) return { lines: snap.tail ? [...snap.lines, snap.tail] : snap.lines, hidden: 0 };
  // collapsed: only the last lines are copied (a long live output updates many times)
  const from = all - TERM_PREVIEW_LINES;
  const lines = snap.lines.slice(from);
  if (snap.tail) lines.push(snap.tail);
  return { lines, hidden: from };
}
