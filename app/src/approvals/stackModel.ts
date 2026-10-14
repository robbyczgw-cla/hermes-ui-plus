/**
 * Pure helpers for the approval card stack and the notification entry point (node:test, no RN imports).
 */
import { approvalKey } from '../hermes/approvals.ts';
import type { ApprovalRequest } from '../hermes/types.ts';

/** stable key of a card in the stack */
export function stackKey(a: ApprovalRequest): string {
  return approvalKey(a);
}

// ------------------------------------------------------------------ openPendingApproval (push tap)

export type PendingApprovalTarget = { conversationId: string; runId?: string; at: number };

let target: PendingApprovalTarget | null = null;
const listeners = new Set<(t: PendingApprovalTarget) => void>();

/**
 * Entry point for a notification tap / deep link ("Hermes braucht eine Freigabe"). The caller opens the chat
 * (as PushHost does for `turn` targets: `controller.setActive(conversationId); router.navigate('/')`); this records
 * the target so the chat – mounted now or on its next mount – checks `GET /v1/runs/{runId}` immediately and shows
 * that run's card. Targets older than `maxAgeMs` (default 10 min) are ignored.
 */
export function openPendingApproval(conversationId: string, runId?: string, now = Date.now()): void {
  target = { conversationId, runId, at: now };
  for (const fn of listeners) fn(target);
}

/** The chat of `conversationId` takes its pending target (once). */
export function takePendingApproval(conversationId: string, now = Date.now(), maxAgeMs = 10 * 60_000): PendingApprovalTarget | null {
  if (!target || target.conversationId !== conversationId) return null;
  const t = target;
  target = null;
  return now - t.at <= maxAgeMs ? t : null;
}

/** subscribe to new targets (the open chat reacts without remounting) */
export function onPendingApproval(fn: (t: PendingApprovalTarget) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
