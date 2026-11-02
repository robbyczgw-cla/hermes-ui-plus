/**
 * Bots A+: what a tap on a control inside a Bot Chat row does (bots/timeline.ts). The Bot Chat takes no turns from the
 * app, so choices, checklists, forms and reformat chips go into the talk. A bare `[choice:…]` means nothing there, so the
 * row they came from rides along as a quote: stored in the session, seen by every device. Pure (node:test).
 */
import type { ChatActionDeps } from '../chat/actionHandler.ts';
import { quoteOf } from '../chat/quote.ts';
import { withQuotes, type Quote } from '../chat/quoteWire.ts';
import type { ChatMessage } from '../hermes/types.ts';
import { cronDelivery } from './core.ts';

/** The row's words; a comment with nothing to quote (only a picture) quotes the delivery it belongs to. */
function originQuote(messages: readonly ChatMessage[], i: number): Quote | null {
  const own = quoteOf(messages[i]);
  if (own) return own;
  for (let k = i - 1; k >= 0 && messages[k].feed; k--) {
    if (messages[k].role !== 'user') continue;
    return cronDelivery(messages[k].text) ? quoteOf(messages[k]) : null;
  }
  return null;
}

/** The text to send for a control of message `id`: quoted when that row is a Bot Chat row, else unchanged. */
export function feedActionText(messages: readonly ChatMessage[], id: string | undefined, text: string): string {
  const i = id ? messages.findIndex((m) => m.id === id) : -1;
  if (i < 0 || !messages[i].feed) return text;
  const q = originQuote(messages, i);
  return q ? withQuotes(text, [q]) : text;
}

/** `deps` for a control inside message `id`: every way a tap can send (directly, or after the confirm sheet). */
export function feedActionDeps(deps: ChatActionDeps, messages: () => readonly ChatMessage[], id: string | undefined): ChatActionDeps {
  if (!id || !messages().find((m) => m.id === id)?.feed) return deps;
  return {
    ...deps,
    send: (text) => deps.send(feedActionText(messages(), id, text)),
    run: (action, options) => deps.run(action.type === 'send' && typeof action.text === 'string' ? { ...action, text: feedActionText(messages(), id, action.text) } : action, options),
  };
}
