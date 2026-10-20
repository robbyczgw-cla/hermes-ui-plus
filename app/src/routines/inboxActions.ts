/**
 * Actions inside a Routine result (cards rendered in the inbox). Rendering a result is never permission to act on it:
 * there is no chat here, so anything that would send a message (chip, button, form, `ask`, "Choose this") is not
 * executed; the result view points to "Continue in chat" instead. Device actions go through the app's action runner
 * like in a chat (validated, confirmation sheet; http(s) links open the way chat links do). Pure, erasable TS.
 */
import type { HuiAction } from '../protocol/types.ts';

export type InboxActionDecision = { kind: 'run'; action: HuiAction } | { kind: 'needsChat' } | { kind: 'ignore' };

/** sends a message or writes into a chat's lists: needs a conversation */
const CHAT_ONLY: ReadonlySet<string> = new Set(['send', 'submit', 'ask', 'add_to_list']);

export function inboxActionDecision(action: HuiAction | null | undefined): InboxActionDecision {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return { kind: 'ignore' };
  if (CHAT_ONLY.has(action.type)) return { kind: 'needsChat' };
  if (action.type === 'open_url') {
    // bare "www.…" links from the model → https, like the chat (the runner itself only accepts http/https)
    const url = typeof action.url === 'string' && /^www\./i.test(action.url.trim()) ? `https://${action.url.trim()}` : action.url;
    return { kind: 'run', action: { ...action, url } };
  }
  return { kind: 'run', action };
}
