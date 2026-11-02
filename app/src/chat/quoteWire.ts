/**
 * Quote / reply ("Antworten"): the user replies to a specific earlier message. Pure, erasable TS (node:test, quote.test.ts). No imports: the storage layer (conversations/messages.ts) uses it.
 *
 * The quoted excerpt travels IN the user message, in front of what the user typed, so Hermes (and every backend that
 * resends the history) reads it as ordinary context and the stored session keeps it for every device:
 *
 *   [hui:quote ref=m-3f9a from=assistant]
 *   > Die Fähre fährt um 9:40 ab Piräus, Ankunft 13:15.
 *   [/hui:quote]
 *
 *   Gibt es eine frühere?
 *
 * A Markdown quote inside a tagged block: a model without the HUI skill still reads "> …" as a quotation, the app cuts
 * the block again for display (the bubble shows a quote box, tap jumps to the cited message). No tool call, no extra
 * message. `ref` is the app's message id; it is a hint only (another device has other ids), the excerpt itself finds the
 * message as well (`resolveQuote`). Several quotes keep their order. Decoding is defensive: the text comes back from the
 * server and may have been written by another app version, an unterminated block stays as typed text.
 */

export type QuoteRole = 'user' | 'assistant';
export type Quote = {
  /** app id of the cited message (hint; may be unknown on another device or after the message was dropped) */
  ref?: string;
  role: QuoteRole;
  /** the excerpt as shown and sent (plain text, ≤ QUOTE_MAX_CHARS) */
  text: string;
};

/** excerpt length (chars); a longer selection is cut at a word boundary with "…" */
export const QUOTE_MAX_CHARS = 280;
/** quotes per message (the composer refuses more) */
export const MAX_QUOTES = 3;

export const QUOTE_OPEN = '[hui:quote';
export const QUOTE_CLOSE = '[/hui:quote]';

/** what a `ref` may look like (app message ids) */
export const REF_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const HEAD_RE = /^\[hui:quote((?:\s+[a-z]+=[^\s\]]*)*)\s*\]$/;

/** one line, collapsed whitespace, cut at a word boundary */
export function clipExcerpt(text: string, max = QUOTE_MAX_CHARS): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

/** add a quote to the composer's list: the same excerpt of the same message only once, at most MAX_QUOTES */
export function addQuote(list: readonly Quote[], q: Quote): Quote[] | null {
  if (list.some((x) => x.text === q.text && x.ref === q.ref)) return list.slice();
  if (list.length >= MAX_QUOTES) return null;
  return [...list, q];
}

function quoteBlock(q: Quote): string {
  const head = `${QUOTE_OPEN}${q.ref && REF_RE.test(q.ref) ? ` ref=${q.ref}` : ''} from=${q.role}]`;
  // the excerpt is one line (clipExcerpt); a "[/hui:quote]" inside it must not end the block early
  const body = clipExcerpt(q.text).replaceAll(QUOTE_CLOSE, '[/hui:quote​]');
  return `${head}\n> ${body}\n${QUOTE_CLOSE}`;
}

/** the message as sent: quote blocks in order, then the typed text */
export function withQuotes(text: string, quotes: readonly Quote[] | undefined): string {
  const qs = (quotes ?? []).filter((q) => q.text.trim()).slice(0, MAX_QUOTES);
  if (!qs.length) return text;
  const blocks = qs.map(quoteBlock).join('\n');
  return text ? `${blocks}\n\n${text}` : blocks;
}

/** Leading quote blocks cut from a (stored or local) user text. Anything malformed stays text. */
export function splitQuotes(text: string): { quotes: Quote[]; text: string } {
  if (!text.startsWith(QUOTE_OPEN)) return { quotes: [], text };
  const quotes: Quote[] = [];
  let rest = text;
  while (rest.startsWith(QUOTE_OPEN) && quotes.length < MAX_QUOTES * 2) {
    const nl = rest.indexOf('\n');
    const end = rest.indexOf(QUOTE_CLOSE);
    if (nl < 0 || end < nl) break;
    const head = HEAD_RE.exec(rest.slice(0, nl).trim());
    if (!head) break;
    const attrs: Record<string, string> = {};
    for (const a of head[1].trim().split(/\s+/).filter(Boolean)) {
      const i = a.indexOf('=');
      attrs[a.slice(0, i)] = a.slice(i + 1);
    }
    const body = rest
      .slice(nl + 1, end)
      .split('\n')
      .map((l) => l.replace(/^>\s?/, ''))
      .join(' ')
      .replaceAll('[/hui:quote​]', QUOTE_CLOSE)
      .trim();
    if (body) {
      const role: QuoteRole = attrs.from === 'user' ? 'user' : 'assistant';
      const ref = attrs.ref && REF_RE.test(attrs.ref) ? attrs.ref : undefined;
      quotes.push({ ...(ref ? { ref } : {}), role, text: body });
    }
    rest = rest.slice(end + QUOTE_CLOSE.length).replace(/^[ \t]*\n?/, '');
  }
  if (!quotes.length) return { quotes: [], text };
  return { quotes, text: rest.replace(/^\s+/, '') };
}

/** the typed text of a user message without its quote blocks */
export function stripQuotes(text: string): string {
  return splitQuotes(text).text;
}

