/**
 * What the message area of an open chat shows, and how much of a long transcript the first frame renders – pure
 * (node:test). The header and the composer are always there; only this area waits for a chat's history.
 */

/** `list`: the messages; `placeholder`: calm bubble skeleton while the history loads; `empty`: the starter surface */
export type MessageArea = 'list' | 'placeholder' | 'empty';

/** after this long the placeholder also says what it waits for ("Loading the chat from Hermes…") */
export const HISTORY_HINT_MS = 250;

/**
 * Messages win (also a turn sent while the history still loads); with none, a pending history shows the placeholder
 * – never the empty-chat surface for a chat that has a history on its way.
 */
export function messageAreaFor(count: number, historyPending: boolean): MessageArea {
  if (count > 0) return 'list';
  return historyPending ? 'placeholder' : 'empty';
}

/**
 * Is the history of a synced chat still on its way? Not `settled` yet (a never-loaded Hermes chat waits for its
 * transcript, ≤ 8 s) or fetched but not merged into the chat yet (the frame between fetch and merge).
 */
export function historyPendingFor(o: { settled: boolean; applyPending: boolean }): boolean {
  return !o.settled || o.applyPending;
}

export type InitialRenderOptions = {
  /** rough text budget of the first frame (characters, newest first) – a phone screen shows ~1.5 K */
  budget?: number;
  /** cost of a message beyond its text (bubble, header line, tool chips) */
  perMessage?: number;
  min?: number;
  max?: number;
};

export const INITIAL_RENDER = { budget: 4000, perMessage: 300, min: 2, max: 12 } as const;

/**
 * How many of the newest messages the (inverted) list renders on its first frame: newest first until the text budget
 * is used, at least `min` (the last question + answer), at most `max` (the list's old fixed value). The older ones
 * follow in the list's own batches after the first paint – above the visible area of an inverted list, so nothing on
 * screen moves.
 */
export function initialRenderCount(messages: readonly { text: string }[], o: InitialRenderOptions = {}): number {
  const budget = o.budget ?? INITIAL_RENDER.budget;
  const per = o.perMessage ?? INITIAL_RENDER.perMessage;
  const min = o.min ?? INITIAL_RENDER.min;
  const max = o.max ?? INITIAL_RENDER.max;
  const n = messages.length;
  let used = 0;
  let count = 0;
  for (let i = n - 1; i >= 0 && count < max; i--) {
    if (count >= min && used >= budget) break;
    used += (messages[i].text?.length ?? 0) + per;
    count++;
  }
  return Math.max(1, count); // FlatList wants ≥ 1
}
