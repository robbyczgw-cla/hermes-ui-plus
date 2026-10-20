import { getNodeStateStore } from '../nodestate/defaultStore';
import { appendToLatestChecklistWith, type AppendResult } from './lists.ts';
import { liveAppendResult, liveTargetFor } from '../live/registry.ts';

/**
 * Append items to the latest checklist of a conversation (via nodestate) and publish `listBus`
 * `items_added`. If the conversation has no checklist the result is `{status:'no_checklist', …}`
 * and the UI must create a local "Einkaufsliste" (see INTEGRATION.md / `listBus` `create_list`).
 */
export function appendToLatestChecklist(conversationId: string, items: readonly string[], listTitle?: string): Promise<AppendResult> {
  // a chat with an open live list (live/LiveProvider): the items become pending edits of that card
  const live = liveTargetFor(conversationId)?.(items, listTitle);
  if (live) return Promise.resolve(liveAppendResult(items, live));
  return appendToLatestChecklistWith({ store: getNodeStateStore() }, conversationId, items, listTitle);
}
