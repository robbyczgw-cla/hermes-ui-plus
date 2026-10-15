/**
 * One-turn overrides of a retry ("Erneut versuchen ▸ Mit anderem Modell…", "Ohne Websuche erneut versuchen") and
 * the context seed of a branched Hermes chat ("In neuem Chat fortsetzen" from an earlier answer). Pure, erasable
 * TS (node:test, turnOverride.test.ts).
 *
 * Hidden texts the model gets but the transcript does not show:
 * - a NOTE appended to the re-sent user message: `…\n\n[hui:note] Beantworte ohne Websuche/Web-Tools.`
 * - a CONTEXT block in front of the first message of a branched Hermes chat: Hermes keeps the history per
 *   session server-side and ignores earlier `messages` of a request that carries `X-Hermes-Session-Id`
 *   (docs/HERMES-API.md), so a branch from the middle of a chat starts a fresh session whose first user message
 *   carries the prior turns as quoted context.
 * Both markers are stripped again where stored Hermes transcripts are matched to the local one
 * (sessionMapping.userTextCore), so the synced turn still lines up with the local message.
 */
import type { ChatMessage } from './types.ts';

export type TurnOverride = {
  /** model for this one turn (picked in "Mit anderem Modell…"); the chat's own model stays */
  model?: string;
  /** hidden instruction appended to the re-sent user message (this turn only) */
  note?: string;
  /** false: the provider's web search tool is off for this turn (backends with a web search switch) */
  webSearch?: false;
};

export const NOTE_TAG = '[hui:note]';
export const CONTEXT_OPEN = '[hui:context]';
export const CONTEXT_CLOSE = '[/hui:context]';

/** user text + hidden one-turn note */
export function withTurnNote(text: string, note: string | undefined): string {
  const n = note?.trim();
  if (!n) return text;
  return text ? `${text}\n\n${NOTE_TAG} ${n}` : `${NOTE_TAG} ${n}`;
}

/** context block (branched Hermes chat) in front of the first user message */
export function withContextSeed(seed: string | undefined, text: string): string {
  const s = seed?.trim();
  if (!s) return text;
  return `${CONTEXT_OPEN}\n${s}\n${CONTEXT_CLOSE}\n\n${text}`;
}

const NOTE_RE = /\n*\[hui:note\][^\n]*\s*$/;

/** the typed user text without a leading context block / trailing note (transcript matching) */
export function stripTurnExtras(text: string): string {
  let s = text;
  if (s.startsWith(CONTEXT_OPEN)) {
    const end = s.indexOf(CONTEXT_CLOSE);
    if (end >= 0) s = s.slice(end + CONTEXT_CLOSE.length).replace(/^\s+/, '');
  }
  return s.replace(NOTE_RE, '');
}

/**
 * Connection of one turn: `model` replaced, the web search tool switched off. Works for every backend conn
 * shape (`webSearch` boolean / provider string of other backends → removed).
 */
export function overrideConn<C extends object>(conn: C, o: TurnOverride | undefined): C {
  if (!o || (!o.model && o.webSearch !== false)) return conn;
  const out: Record<string, unknown> = { ...(conn as Record<string, unknown>) };
  if (o.model) out.model = o.model;
  if (o.webSearch === false) {
    if (typeof out.webSearch === 'string') delete out.webSearch;
    else out.webSearch = false;
    if ('xSearch' in out) out.xSearch = false;
  }
  return out as C;
}

/**
 * History of a retried turn for backends that resend the whole history: the note goes onto the LAST user message
 * of the copy (the stored transcript keeps the typed text).
 */
export function overrideHistory(history: ChatMessage[], o: TurnOverride | undefined): ChatMessage[] {
  if (!o?.note) return history;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'user') continue;
    const next = history.slice();
    next[i] = { ...history[i], text: withTurnNote(history[i].text, o.note) };
    return next;
  }
  return history;
}

/** max characters of the context block (Hermes caps a text part at 64 KB; leave room for the prompt) */
export const SEED_MAX_CHARS = 24_000;

export type SeedLabels = {
  intro: string;
  user: string;
  assistant: string;
  attachment: string;
  /** intro when the copied turns are quick answers ("Mit Hermes weitermachen", app/src/quick) */
  quickIntro?: string;
  /** label of a quick answer; `{model}` is replaced (or the parentheses dropped when unknown) */
  quick?: string;
};

const DEFAULT_SEED_LABELS: SeedLabels = {
  intro: 'This chat continues an earlier conversation. Its turns so far (for context only, do not repeat them):',
  user: 'User',
  assistant: 'Assistant',
  attachment: 'attachment',
  quickIntro:
    'This chat continues a quick answer from a small fast model that had no tools, no memory and no live data. ' +
    'Context only, do not repeat it; check it before you build on it:',
  quick: 'Quick answer ({model})',
};

function quickLabel(labels: SeedLabels, model: string | undefined): string {
  const l = labels.quick ?? DEFAULT_SEED_LABELS.quick!;
  return model ? l.replace('{model}', model) : l.replace(/\s*\(\{model\}\)/, '').replace('{model}', '');
}

/**
 * Prior turns as plain text for the context block. Newest turns win when the transcript is too long (older ones are
 * dropped with a "…" line); interim tool notes and hui JSON stay as they were stored (the model wrote them).
 */
export function branchSeedText(
  messages: readonly Pick<ChatMessage, 'role' | 'text' | 'attachments' | 'status' | 'quick'>[],
  labels: SeedLabels = DEFAULT_SEED_LABELS,
  maxChars: number = SEED_MAX_CHARS,
): string {
  const turns: string[] = [];
  let quick = false;
  for (const m of messages) {
    const text = (m.role === 'user' ? stripTurnExtras(m.text) : m.text).trim();
    const files = m.role === 'user' ? (m.attachments ?? []).map((a) => `[${labels.attachment}: ${a.name}]`) : [];
    if (!text && !files.length) continue;
    // a handed-over quick answer is labelled as such, so Hermes does not mistake it for its own earlier turn
    const label = m.role === 'user' ? labels.user : m.quick ? quickLabel(labels, m.quick.model) : labels.assistant;
    if (m.role === 'assistant' && m.quick) quick = true;
    turns.push(`${label}: ${[text, ...files].filter(Boolean).join('\n')}`);
  }
  if (!turns.length) return '';
  const intro = quick ? (labels.quickIntro ?? DEFAULT_SEED_LABELS.quickIntro!) : labels.intro;
  const kept: string[] = [];
  let size = intro.length;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (size + t.length + 2 > maxChars) {
      if (!kept.length) kept.unshift(`…${t.slice(t.length - (maxChars - size - 3))}`);
      kept.unshift('…');
      break;
    }
    kept.unshift(t);
    size += t.length + 2;
  }
  return `${intro}\n\n${kept.join('\n\n')}`;
}
