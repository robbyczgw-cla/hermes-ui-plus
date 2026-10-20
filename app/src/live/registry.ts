import type { AppendResult } from '../actions/lists.ts';

/**
 * The open chat's live cards as a target for `add_to_list` (actions/executor.ts): when the chat has an open live
 * list, the items go onto it as pending edits instead of onto an older plain checklist. Set by LiveProvider.
 */
export type LiveTarget = (items: readonly string[], listTitle?: string) => { cardId: string; title: string; added: string[]; reopened: string[] } | null;

const targets = new Map<string, LiveTarget>();

export function registerLiveTarget(conversationId: string, fn: LiveTarget): () => void {
  targets.set(conversationId, fn);
  return () => {
    if (targets.get(conversationId) === fn) targets.delete(conversationId);
  };
}

export function liveTargetFor(conversationId: string): LiveTarget | undefined {
  return targets.get(conversationId);
}

/** The `add_to_list` result for a live list: a ticked item that was opened again counts as reopened, not added. */
export function liveAppendResult(items: readonly string[], live: { cardId: string; added: string[]; reopened: string[] }): AppendResult {
  const done = new Set([...live.added, ...live.reopened]);
  return { status: 'appended', key: `live:${live.cardId}`, messageId: '', nodeId: live.cardId, added: live.added, reopened: live.reopened, skipped: items.filter((i) => !done.has(i)) };
}
