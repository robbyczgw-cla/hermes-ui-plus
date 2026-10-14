/**
 * A direct-backend turn (a backend without a server-side run, e.g. the offline demo) whose stream died while the app was in
 * the background (pure, node:test). These backends have no server-side continuation (unlike Hermes via the UI
 * bridge, hermes/recovery.ts), so the app:
 *
 *   streaming ──connection error, app was in the background during the turn──▶ error + `cutInBackground`
 *     (partial text, tools and search results kept; calm notice instead of a red error)
 *   cut ──"Fortsetzen"──▶ streaming again on the SAME message: history + the partial answer + a hidden
 *     continue instruction are re-sent, the continuation is appended (`planContinue`)
 *   cut ──"Neu starten"──▶ the normal retry (answer dropped, user message re-sent)
 *
 * The continuation always re-sends history + partial.
 */
import type { ChatMessage, ToolEvent } from '../hermes/types.ts';

export type CutPlatform = 'android' | 'ios' | 'web' | 'other';

/** i18n keys of the calm notice (chat namespace) */
export const CUT_KEYS = {
  android: 'chat.backgroundCut.android',
  other: 'chat.backgroundCut.other',
} as const;

/** stored German text (older builds / logs), like every other message error */
const CUT_TEXT_DE = {
  android: 'Die App war im Hintergrund – Android hat die Verbindung getrennt.',
  other: 'Die App war im Hintergrund – das System hat die Verbindung getrennt.',
};

// network / timeout / "stream ended unexpectedly" keys of all direct backends (i18n/ns/backends.*)
const CONNECTION_KEY_RE = /\.(network\w*|timeout\w*|connectionLost|streamUnexpected|streamAborted|interruptedLost)$/;
// un-keyed reducer texts ("Die Verbindung wurde unerwartet beendet.", native "Software caused connection abort")
const CONNECTION_TEXT_RE = /verbindung|connection|network|netzwerk|socket|abort|timed? ?out|zeitüberschreitung|unterbrochen|unerwartet|unexpected/i;

/** the error is a lost connection (not an HTTP / auth / rate-limit / content error) */
export function isConnectionLoss(m: Pick<ChatMessage, 'error' | 'errorText'>): boolean {
  const key = m.errorText?.key;
  if (key) return CONNECTION_KEY_RE.test(key);
  return CONNECTION_TEXT_RE.test(m.error ?? '');
}

/** running tools of a turn that ended by connection loss / stop: neutral "abgebrochen", not a red failure */
export function cancelRunningTools(tools: ToolEvent[], now: number): ToolEvent[] {
  if (!tools.some((t) => t.status === 'running')) return tools;
  return tools.map((t) => (t.status === 'running' ? { ...t, status: 'done', endedAt: now, detail: { ...t.detail, cancelled: true } } : t));
}

/**
 * Turn finished: when it failed with a lost connection and the app was in the background at some point during
 * the turn, mark the last message as cut (keeps text/tools). Returns `list` unchanged otherwise.
 */
export function applyBackgroundCut(list: ChatMessage[], o: { backgrounded: boolean; now: number; platform: CutPlatform }): ChatMessage[] {
  const last = list[list.length - 1];
  if (!o.backgrounded || !last || last.role !== 'assistant' || last.status !== 'error' || !isConnectionLoss(last)) return list;
  const which = o.platform === 'android' ? 'android' : 'other';
  const next = list.slice();
  next[next.length - 1] = {
    ...last,
    cutInBackground: o.now,
    error: CUT_TEXT_DE[which],
    errorText: { key: CUT_KEYS[which] },
    tools: cancelRunningTools(last.tools, o.now),
  };
  return next;
}

export function isCut(m: ChatMessage | undefined): boolean {
  return !!m && m.role === 'assistant' && m.status === 'error' && typeof m.cutInBackground === 'number';
}

/** hidden instruction appended for "Fortsetzen" (never shown, never stored) */
export const CONTINUE_PROMPT =
  '[The connection dropped while you were answering. Your answer so far is the previous assistant message. Continue it exactly where it stops – do not repeat, summarize or restart it and do not mention the interruption. If it ends mid-sentence or mid-block, continue that sentence or block.]';
export const CONTINUE_PROMPT_EMPTY = '[The connection dropped before your answer arrived. Please answer my previous message now.]';

export type ContinuePlan = {
  /** new transcript: the cut message turned back into a streaming message (same id) */
  messages: ChatMessage[];
  /** what the backend gets as history (partial answer + hidden continue instruction at the end) */
  history: ChatMessage[];
  initial: ChatMessage;
};

/**
 * "Fortsetzen" for the last assistant message (cut, failed or stopped with partial content). null when there is
 * nothing to continue (no assistant message at the end, or no user message before it).
 */
export function planContinue(list: readonly ChatMessage[], now: number): ContinuePlan | null {
  const last = list[list.length - 1];
  if (!last || last.role !== 'assistant' || (last.status !== 'error' && last.status !== 'stopped')) return null;
  const before = list.slice(0, -1);
  if (!before.some((m) => m.role === 'user')) return null;
  const hasText = !!last.text.trim();
  const prompt: ChatMessage = { id: `continue-${now}`, role: 'user', text: hasText ? CONTINUE_PROMPT : CONTINUE_PROMPT_EMPTY, tools: [], status: 'done', createdAt: now };
  const partial: ChatMessage = { ...last, status: 'done', error: undefined, errorText: undefined };
  const history = hasText ? [...before, partial, prompt] : [...before, prompt];
  const metrics = last.metrics ? { ...last.metrics } : undefined;
  if (metrics) delete metrics.endedAt;
  const initial: ChatMessage = {
    ...last,
    status: 'streaming',
    error: undefined,
    errorText: undefined,
    cutInBackground: undefined,
    finishReason: undefined,
    truncated: undefined,
    statusNote: undefined,
    continuedAt: now,
    ...(metrics ? { metrics } : {}),
  };
  return { messages: [...before, initial], history, initial };
}
