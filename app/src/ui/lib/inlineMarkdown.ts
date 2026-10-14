// Tiny inline-markdown tokenizer: **bold**, __bold__, *italic*, _italic_, `code`,
// ~~strike~~, [label](url), bare https:// links. Tolerates unclosed markers (streaming):
// an unclosed marker is rendered literally except a trailing unclosed `**`/`` ` `` which
// is applied optimistically so text doesn't flicker while streaming.

export type InlineSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  href?: string;
};

type Style = Omit<InlineSpan, 'text'>;

const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/y;

/** first `marker` at index >= from that is not preceded by a backslash, or -1 */
function findClose(src: string, from: number, marker: string): number {
  let i = from;
  while (i < src.length) {
    const j = src.indexOf(marker, i);
    if (j < 0) return -1;
    if (src[j - 1] !== '\\') return j;
    i = j + 1;
  }
  return -1;
}

/**
 * Memoised findClose / indexOf for one parse level. The answer for `from` is the first qualifying index
 * >= from, so a cached hit `at >= from` (or a cached miss from an earlier start) stays valid while the
 * scan moves forward: each marker's string is searched O(1) times per level instead of once per
 * candidate (10 000 unmatched `[` used to cost ~50 M units of suffix search).
 */
class CloseCache {
  private hits = new Map<string, { from: number; at: number }>();
  private readonly src: string;
  constructor(src: string) {
    this.src = src;
  }
  find(from: number, marker: string, raw = false): number {
    const h = this.hits.get(marker);
    if (h && from >= h.from && (h.at < 0 || h.at >= from)) return h.at;
    const at = raw ? this.src.indexOf(marker, from) : findClose(this.src, from, marker);
    this.hits.set(marker, { from, at });
    return at;
  }
}

function parse(src: string, style: Style, out: InlineSpan[]): void {
  let buf = '';
  const flush = () => {
    if (buf) out.push({ ...style, text: buf });
    buf = '';
  };
  const cache = new CloseCache(src);
  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === '\\' && i + 1 < src.length && /[*_`~\[\]\\()]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    if (c === '`') {
      const end = cache.find(i + 1, '`');
      flush();
      if (end < 0) {
        out.push({ ...style, code: true, text: src.slice(i + 1) });
        return;
      }
      out.push({ ...style, code: true, text: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    const dbl = src.startsWith('**', i) ? '**' : src.startsWith('__', i) ? '__' : src.startsWith('~~', i) ? '~~' : null;
    if (dbl) {
      let end = cache.find(i + 2, dbl);
      // `***` closing a nested italic: the bold closer is the LAST two chars of the run
      while (end > 0 && src[end + 2] === dbl[0]) end++;
      const key: keyof Style = dbl === '~~' ? 'strike' : 'bold';
      if (end > i + 2) {
        flush();
        parse(src.slice(i + 2, end), { ...style, [key]: true }, out);
        i = end + 2;
        continue;
      }
      if (end < 0 && dbl === '**' && i + 2 < src.length) {
        // streaming: unclosed bold at the tail – apply optimistically
        flush();
        parse(src.slice(i + 2), { ...style, bold: true }, out);
        return;
      }
    }

    if ((c === '*' || c === '_') && src[i + 1] !== c) {
      const prev = src[i - 1];
      const next = src[i + 1];
      const opens = next !== undefined && next !== ' ' && (c === '*' || !prev || /[\s(\[]/.test(prev));
      if (opens) {
        const end = cache.find(i + 1, c);
        if (end > i + 1 && src[end - 1] !== ' ' && (c === '*' || !src[end + 1] || /[\s.,;:!?)\]]/.test(src[end + 1]))) {
          flush();
          parse(src.slice(i + 1, end), { ...style, italic: true }, out);
          i = end + 1;
          continue;
        }
      }
    }

    if (c === '[') {
      const close = cache.find(i + 1, '](', true);
      if (close > i) {
        const end = cache.find(close + 2, ')', true);
        if (end > close) {
          const href = src.slice(close + 2, end).trim();
          flush();
          parse(src.slice(i + 1, close), { ...style, href: href || undefined }, out);
          i = end + 1;
          continue;
        }
      }
    }

    if (c === 'h' && (i === 0 || /[\s(]/.test(src[i - 1]))) {
      URL_RE.lastIndex = i;
      const m = URL_RE.exec(src);
      if (m) {
        flush();
        out.push({ ...style, href: m[0], text: m[0] });
        i += m[0].length;
        continue;
      }
    }

    buf += c;
    i++;
  }
  flush();
}

export function parseInline(src: string): InlineSpan[] {
  const out: InlineSpan[] = [];
  if (!src) return out;
  parse(src, {}, out);
  // merge adjacent spans with identical style
  const merged: InlineSpan[] = [];
  for (const s of out) {
    const p = merged[merged.length - 1];
    if (p && p.bold === s.bold && p.italic === s.italic && p.code === s.code && p.strike === s.strike && p.href === s.href) {
      p.text += s.text;
    } else merged.push({ ...s });
  }
  return merged;
}
