import { useEffect, useRef } from 'react';
import { onPendingApproval, takePendingApproval } from './stackModel';

/**
 * The chat of `conversationId` reacts to `openPendingApproval(conversationId, runId)` (push tap): on mount (cold start /
 * chat opened by the tap) and live while open. `onTarget(runId)` should call `chat.openApproval(runId)`.
 */
export function usePendingApprovalTarget(conversationId: string | undefined, onTarget: ((runId?: string) => void) | undefined): void {
  const cb = useRef(onTarget);
  useEffect(() => {
    cb.current = onTarget;
  }, [onTarget]);
  useEffect(() => {
    if (!conversationId) return;
    const hit = takePendingApproval(conversationId);
    if (hit) cb.current?.(hit.runId);
    return onPendingApproval((t) => {
      if (t.conversationId !== conversationId) return;
      const taken = takePendingApproval(conversationId);
      if (taken) cb.current?.(taken.runId);
    });
  }, [conversationId]);
}
