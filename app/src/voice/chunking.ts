/**
 * Sentence splitting + TTS chunking (pure, chunking.test.ts).
 *
 * German-aware: no break after abbreviations ("z. B.", "ca.", "bzw.", "Dr."), initials, ordinals
 * ("am 3. Oktober"), dates ("10.10."), decimals ("3,5" / "3.5"), or before a lowercase word.
 * False negatives only make chunks a bit longer; false positives would cut a sentence in the middle
 * of an audio chunk, so the rules lean conservative.
 */

const ABBREVIATIONS = new Set(
  [
    'ca', 'bzw', 'usw', 'etc', 'dr', 'prof', 'nr', 'str', 'evtl', 'ggf', 'inkl', 'exkl', 'vgl', 'abs', 'mio', 'mrd',
    'jh', 'jhd', 'sog', 'bspw', 'min', 'max', 'st', 'mr', 'mrs', 'ms', 'vs', 'uvm', 'ff', 'bd', 'hrsg', 'tel', 'ggü',
    'allg', 'gem', 'lt', 'zzgl', 'abzgl', 'mind', 'gegr', 'jan', 'feb', 'apr', 'aug', 'sept', 'okt', 'nov', 'dez',
    'eur', 'std', 'sek', 'akt', 'anm', 'bzgl', 'dt', 'engl', 'frz', 'geb', 'gest', 'hl', 'insb', 'kap', 'lfd', 'mtl',
    'jhr', 'orig', 'pkt', 'rd', 'tsd', 'urspr', 'verh', 'zt', 'ziff', 'zit', 'no', 'fig', 'approx', 'e.g', 'i.e',
  ].map((a) => a.toLowerCase())
);

/** closing quotes/brackets, escaped for use inside a RegExp character class */
const CLOSERS = `"'“”‘’»«)\\]}`;

/** True when the punctuation run ending at `end` (exclusive) after `token` ends a sentence. */
function isBoundary(token: string, punct: string, nextChar: string): boolean {
  if (!nextChar) return true;
  if (/[!?]/.test(punct)) return true;
  // "…" / "..." / "." followed by a lowercase word continues the sentence
  if (/\p{Ll}/u.test(nextChar)) return false;
  if (punct !== '.') return true; // ellipsis before uppercase / digit
  const core = token.replace(new RegExp(`^[${CLOSERS}(\\[„]+`), '');
  if (!core) return true;
  const lower = core.toLowerCase();
  if (/^\p{L}$/u.test(core)) return false; // initials, "z. B.", "d. h.", "S. 5"
  if (/^\p{L}{1,3}(\.\p{L}{1,3})+$/u.test(core)) return false; // "z.B", "d.h", "u.a", "i.d.R"
  if (ABBREVIATIONS.has(lower)) return false;
  if (/^\d{1,2}$/.test(core)) return false; // ordinal "3. Oktober", "1. Platz"
  if (/^\d{1,2}\.\d{1,2}$/.test(core)) return false; // date "10.10. 2026"
  return true;
}

/** Split a paragraph (no blank lines) into sentences. */
function splitParagraph(p: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`([.!?…]+)([${CLOSERS}]*)(\\s+)`, 'g');
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p))) {
    const punctStart = m.index;
    const after = m.index + m[0].length;
    const before = p.slice(start, punctStart);
    const token = before.slice(before.search(/\S+$/) >= 0 ? before.search(/\S+$/) : before.length);
    const nextChar = p.slice(after).replace(new RegExp(`^[${CLOSERS}„(\\[]+`), '').charAt(0);
    if (isBoundary(token, m[1].replace(/\.{3,}/, '…'), nextChar)) {
      const sentence = p.slice(start, after).trim();
      if (sentence) out.push(sentence);
      start = after;
    }
  }
  const rest = p.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** closing quotes/brackets after the punctuation and opening ones before the next sentence */
const SKIP_BEFORE_NEXT = new Set(`"'“”‘’»«)]}„([`);

/**
 * Offset right after the last sentence end in `p` that is already followed by the next sentence's first
 * character (so the boundary rules can decide), or 0 when there is none yet. Used while an answer streams.
 */
export function lastSentenceEnd(p: string): number {
  const re = new RegExp(`([.!?…]+)([${CLOSERS}]*)(\\s+)`, 'g');
  let start = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p))) {
    const after = m.index + m[0].length;
    let k = after;
    while (k < p.length && SKIP_BEFORE_NEXT.has(p[k])) k++;
    if (k >= p.length) break; // nothing after the punctuation yet: undecidable
    const before = p.slice(start, m.index);
    const token = before.slice(before.search(/\S+$/) >= 0 ? before.search(/\S+$/) : before.length);
    if (isBoundary(token, m[1].replace(/\.{3,}/, '…'), p[k])) {
      last = after;
      start = after;
    }
  }
  return last;
}

/** Sentences of the whole text; paragraph breaks (blank lines or single newlines) always split. */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .flatMap(splitParagraph);
}

/** Break an overlong sentence at clause marks, then spaces, then hard. Each part ≤ max. */
export function splitLong(sentence: string, max: number): string[] {
  if (sentence.length <= max) return [sentence];
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = -1;
    for (const re of [/[;:]\s/g, /[,–—)]\s/g, /\s/g]) {
      let m: RegExpExecArray | null;
      let last = -1;
      while ((m = re.exec(window))) if (m.index + 1 <= max && m.index > max * 0.3) last = m.index + 1;
      if (last > 0) {
        cut = last;
        break;
      }
    }
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

export type ChunkOptions = {
  /** hard upper bound per chunk (bridge: ≤ 4000, default 3500) */
  maxChars?: number;
  /** soft target for the first chunk so playback starts quickly; the first sentence is never split for it */
  firstMaxChars?: number;
};

/** Pack sentences greedily into chunks ≤ maxChars; paragraph breaks become "\n" inside a chunk. */
export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const max = Math.max(50, opts.maxChars ?? 3500);
  const firstMax = Math.min(max, Math.max(1, opts.firstMaxChars ?? max));
  const units: { text: string; paraStart: boolean }[] = [];
  for (const para of text.split(/\n{2,}/)) {
    let first = true;
    for (const sent of splitSentences(para)) {
      for (const piece of splitLong(sent, max)) {
        units.push({ text: piece, paraStart: first });
        first = false;
      }
    }
  }
  const chunks: string[] = [];
  let cur = '';
  for (const u of units) {
    const limit = chunks.length === 0 ? firstMax : max;
    const sep = cur ? (u.paraStart ? '\n' : ' ') : '';
    if (cur && cur.length + sep.length + u.text.length > limit) {
      chunks.push(cur);
      cur = u.text;
    } else {
      cur += sep + u.text;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Overall progress 0..1 from chunk lengths, current chunk index and the fraction played in it. */
export function overallProgress(lengths: readonly number[], index: number, fraction: number): number {
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= 0 || index < 0) return 0;
  if (index >= lengths.length) return 1;
  let before = 0;
  for (let i = 0; i < index; i++) before += lengths[i];
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return Math.min(1, (before + f * lengths[index]) / total);
}
