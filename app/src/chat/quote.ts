/**
 * Quote / reply: excerpt of a message, finding the cited message again (wire form and parsing: quoteWire.ts). Pure (node:test,
 * quote.test.ts).
 */
import { cronDelivery, cronPlainText } from '../bots/core.ts';
import type { ChatMessage } from '../hermes/types.ts';
import { searchableText, foldText } from './findInChat.ts';
import { plainCopyText } from './format.ts';
import { clipExcerpt, REF_RE, splitQuotes, type Quote } from './quoteWire.ts';

export * from './quoteWire.ts';

/** visible text of a message without markup (Markdown syntax, hui JSON, app markers) */
export function messagePlainText(m: Pick<ChatMessage, 'role' | 'text'>): string {
  if (m.role === 'user') {
    // a job's delivery on a bot's timeline: the job and its output, not the header Hermes injected
    const cron = cronDelivery(m.text);
    if (cron) return `${cron.name}: ${cronPlainText(cron.output)}`;
    return splitQuotes(searchableText(m)).text;
  }
  return plainCopyText(searchableText(m))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[.,;:!?])/g, '$1$2')
    .split('\n')
    // Markdown tables: the separator row goes, cells read "A · B"
    .filter((l) => !/^\s*\|?[\s:|-]*-[\s:|-]*\|[\s:|-]*$/.test(l))
    .map((l) => (/^\s*\|.*\|\s*$/.test(l) ? l.trim().slice(1, -1).split('|').map((c) => c.trim()).join(' · ') : l))
    .join('\n')
    .trim();
}

/**
 * Quote of a message: the selected part when the user selected text inside it (web), else the start of its visible
 * text. null when there is nothing to quote (an answer made only of a picture / an empty message).
 */
export function quoteOf(m: Pick<ChatMessage, 'id' | 'role' | 'text'>, selection?: string): Quote | null {
  const sel = selection?.trim();
  const text = clipExcerpt(sel || messagePlainText(m));
  if (!text) return null;
  return { ref: REF_RE.test(m.id) ? m.id : undefined, role: m.role, text };
}

/**
 * The message a quote cites: its `ref` when that message is (still) in the chat, else the newest earlier message of
 * the same role whose visible text contains the excerpt (a chat loaded on another device has other ids). `before`:
 * the quoting message's id (the cited one is older). null = not in the loaded chat (deleted / older than the stored
 * history): the quote stays visible, the jump says why it cannot go there.
 */
export function resolveQuote(
  messages: readonly Pick<ChatMessage, 'id' | 'role' | 'text'>[],
  q: Quote,
  before?: string,
  plainOf: (m: Pick<ChatMessage, 'id' | 'role' | 'text'>) => string = (m) => foldText(messagePlainText(m)),
): string | null {
  let end = messages.length;
  if (before) {
    const i = messages.findIndex((m) => m.id === before);
    if (i >= 0) end = i;
  }
  if (q.ref) for (let i = 0; i < end; i++) if (messages[i].id === q.ref) return q.ref;
  // the excerpt without the "…" of a cut: its first 120 characters are enough to find the message again
  const needle = foldText(q.text.replace(/…$/, '').replace(/\s+/g, ' ').trim()).slice(0, 120);
  if (needle.length < 2) return null;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = end - 1; i >= 0; i--) {
      const m = messages[i];
      if (pass === 0 && m.role !== q.role) continue;
      if (plainOf(m).replace(/\s+/g, ' ').includes(needle)) return m.id;
    }
  }
  return null;
}
