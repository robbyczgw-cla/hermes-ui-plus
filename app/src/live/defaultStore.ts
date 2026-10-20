import AsyncStorage from '@react-native-async-storage/async-storage';
import { storageHealth } from '../conversations/storage/health';
import { LiveLocalStore, type KeyValueStorage } from './localStore.ts';

let instance: LiveLocalStore | null = null;

/**
 * Process-wide store of this device's live-card state (pending edits, last seen versions, unpinned cards). Small
 * records in AsyncStorage, written at once: pending edits are the only copy of what the user did until they are sent.
 */
export function getLiveLocalStore(): LiveLocalStore {
  instance ??= new LiveLocalStore(AsyncStorage as unknown as KeyValueStorage, (e) => storageHealth.reportError(e, 'live'));
  return instance;
}

/** Delete a chat's live-card state (the chat was deleted). */
export function deleteLiveState(conversationId: string): Promise<void> {
  return getLiveLocalStore().deleteConversation(conversationId);
}
