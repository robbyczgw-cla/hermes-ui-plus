/**
 * React side of the share inbox (inbox.ts): the share waiting for the sheet, and the composer's hand-off hook.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { consumeShareDeliveries, currentShare, subscribeShare, type OfferedShare, type ShareDelivery } from './inbox';

export function useOfferedShare(): OfferedShare | null {
  return useSyncExternalStore(subscribeShare, currentShare, currentShare);
}

/**
 * Composer: receive a confirmed share for its chat (on mount, or when it arrives later). `conversationId` undefined =
 * this composer takes no shares (quick thread).
 */
export function useShareDelivery(conversationId: string | undefined, onShare: (d: ShareDelivery) => void | Promise<void>): void {
  const cb = useRef(onShare);
  useEffect(() => {
    cb.current = onShare;
  });
  useEffect(() => {
    if (!conversationId) return;
    return consumeShareDeliveries(conversationId, (d) => cb.current(d));
  }, [conversationId]);
}
