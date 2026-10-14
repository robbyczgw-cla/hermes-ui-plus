import { storageHealth } from '../conversations/storage/health';
import { largeRecordStorage } from '../conversations/storage/platform';
import { STORAGE_PREFIX } from './model.ts';
import { NodeStateStore } from './store.ts';

let instance: NodeStateStore | null = null;

/**
 * Process-wide store (also used by non-React code such as the list bus). Records (≤ 512 KB per chat) live in
 * files (native) / IndexedDB (web) like the transcripts, not in the size-capped AsyncStorage; existing
 * AsyncStorage records are migrated on first read (conversations/storage/platform.ts).
 */
export function getNodeStateStore(): NodeStateStore {
  if (!instance) {
    instance = new NodeStateStore({
      storage: largeRecordStorage('nodestate', STORAGE_PREFIX),
      onWriteError: (e) => storageHealth.reportError(e, 'nodestate'),
    });
  }
  return instance;
}

/** Delete a conversation's node state – call when the conversation is deleted. */
export function deleteConversationState(conversationId: string): Promise<void> {
  return getNodeStateStore().deleteConversation(conversationId);
}

/** Delete the node state of one message (regenerate / edit / delete message). */
export function deleteMessageState(conversationId: string, messageId: string): void {
  getNodeStateStore().removeMessage(conversationId, messageId);
}

/** Export the persisted node state of one conversation (e.g. for chat export / backup). */
export function exportNodeState(conversationId: string) {
  return getNodeStateStore().exportConversation(conversationId);
}

/** Export every conversation's node state. */
export function exportAllNodeState() {
  return getNodeStateStore().exportAll();
}
