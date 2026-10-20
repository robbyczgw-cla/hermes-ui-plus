import { createHash } from 'node:crypto';
import { splitLiveTrailer } from './live.mjs';

/** @typedef {{role: 'user'|'assistant', content: string, liveFocus?: string}} Turn */

export const MAX_TURNS = 4;
export const DEFAULT_MAX_CHARS = 2000;

/** Flatten OpenAI message content (string or parts array) to plain text; images become a marker. */
export function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object') {
          if (typeof p.text === 'string') return p.text;
          if (p.type === 'image_url' || p.type === 'input_image' || p.type === 'image') return '[image]';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Truncate long text keeping head and tail (the request is usually at the start, follow-up
 * instructions at the end of a long paste).
 */
export function truncate(text, max = DEFAULT_MAX_CHARS) {
  if (text.length <= max) return text;
  const head = Math.ceil(max * 0.7);
  const tail = max - head;
  return `${text.slice(0, head)}\n[…${text.length - max} chars omitted…]\n${text.slice(text.length - tail)}`;
}

/**
 * Last ≤4 user/assistant turns from an OpenAI messages array (system/tool messages dropped).
 * `prior` (bridge session memory) is prepended when the client sent only the new message.
 * @param {any[]} messages @param {{prior?: Turn[], maxTurns?: number, maxChars?: number}} [opts]
 * @returns {Turn[]}
 */
export function routingContext(messages, opts = {}) {
  const maxTurns = opts.maxTurns ?? MAX_TURNS;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  /** @type {Turn[]} */
  const turns = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    // live-card edits (router/live.mjs): not routed on; a focused card is kept for the deterministic `card=` hint
    const live = m.role === 'user' ? splitLiveTrailer(contentText(m.content)) : { text: contentText(m.content) };
    const text = live.text.trim();
    if (text || live.focus) turns.push({ role: m.role, content: text, ...(live.focus ? { liveFocus: live.focus } : {}) });
  }
  let all = turns;
  // Session-continuation clients (X-Hermes-Session-Id) send only the new user message.
  if (opts.prior?.length && turns.filter((t) => t.role === 'user').length <= 1 && !turns.some((t) => t.role === 'assistant')) {
    all = [...opts.prior, ...turns];
  }
  // Drop trailing assistant turns: we route the latest *user* request.
  while (all.length && all[all.length - 1].role !== 'user') all = all.slice(0, -1);
  // only the latest user turn may carry a focused card (the prior turns come from the bridge's memory)
  return all.slice(-maxTurns).map((t, i, a) => ({ role: t.role, content: truncate(t.content, maxChars), ...(t.liveFocus && i === a.length - 1 ? { liveFocus: t.liveFocus } : {}) }));
}

/** Stable cache key for a routing input. */
export function contextHash(turns, salt = '') {
  return createHash('sha256').update(salt).update('\0').update(JSON.stringify(turns)).digest('hex');
}

/** Render turns for an LLM user message. Content is quoted as data, not instructions. */
export function renderTurns(turns) {
  const lines = ['<conversation>'];
  turns.forEach((t, i) => {
    const latest = i === turns.length - 1;
    lines.push(`<${t.role}${latest ? ' latest="true"' : ''}>`);
    lines.push(t.content.replace(/<\/?(user|assistant|conversation)[^>]*>/gi, ''));
    lines.push(`</${t.role}>`);
  });
  lines.push('</conversation>');
  lines.push('Classify the presentation for the latest user message. Reply with the JSON object only.');
  return lines.join('\n');
}
