/**
 * Approval inbox events (bridge `hui.approval` / `hui.approval_resolved`, docs/SELF-HOSTING.md "Push notifications") and the
 * adapter to the approval cards (owner: approvals workstream, hermes/useHermesChat `openApproval` / `checkApprovals`).
 * Pure, erasable TS (node:test); PushHost wires it to the conversation controller and the banner.
 *
 *   server event "Hermes waits for a decision" → on another chat: banner "Freigabe nötig" + "Öffnen"; on the open
 *   chat: the card is (re)built via openPendingApproval; `approval_resolved` → banner gone, the chat re-checks.
 *   notification tap → PushHost opens the chat → openPendingApproval(conversationId, runId) restores the card.
 */
import type { ConversationMeta } from '../conversations/types.ts';
import { pickConversation, type PushProfile } from './model.ts';

export type ApprovalNotice = {
  /** `a_<requestId>` */
  id: string;
  requestId: string;
  /** completion id of the blocked turn (`POST /v1/runs/{runId}/approval`) */
  runId: string;
  sessionId: string | null;
  /** truncated by the bridge (~200 chars) */
  command: string;
  description?: string;
  risk?: 'high';
  /** epoch ms; an ESTIMATE (Hermes sends no deadline) */
  expiresAt?: number;
  timestamp: number;
};

export type ApprovalResolved = { requestId: string; runId?: string; sessionId?: string | null; reason?: string; choice?: string };

const str = (v: unknown, max = 512) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);

export function parseApprovalNotice(data: string): ApprovalNotice | null {
  try {
    const o = JSON.parse(data) as Record<string, unknown>;
    const requestId = str(o.requestId, 256);
    const runId = str(o.runId, 256) ?? str(o.completionId, 256);
    if (!requestId || !runId) return null;
    return {
      id: str(o.id) ?? `a_${requestId}`,
      requestId,
      runId,
      sessionId: str(o.sessionId, 128) ?? null,
      command: str(o.command, 400) ?? '',
      description: str(o.description, 200),
      ...(o.risk === 'high' ? { risk: 'high' as const } : {}),
      ...(typeof o.expiresAt === 'number' ? { expiresAt: o.expiresAt } : {}),
      timestamp: typeof o.timestamp === 'number' ? o.timestamp : Date.now(),
    };
  } catch {
    return null;
  }
}

export function parseApprovalResolved(data: string): ApprovalResolved | null {
  try {
    const o = JSON.parse(data) as Record<string, unknown>;
    const requestId = str(o.requestId, 256);
    if (!requestId) return null;
    return { requestId, runId: str(o.runId, 256) ?? str(o.completionId, 256), sessionId: str(o.sessionId, 128) ?? null, reason: str(o.reason, 32), choice: str(o.choice, 16) };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ openPendingApproval (adapter to the chat)

export type ApprovalOpener = {
  /** bring the card of `runId` to the front, rebuilding it from GET /v1/runs/{runId} when the stream was lost */
  open(runId?: string): void;
  /** re-check the run now (an approval was answered / expired elsewhere) */
  check?(runId?: string): void | Promise<void>;
};

const openers = new Map<string, ApprovalOpener>();
/** taps that arrived before the chat was mounted (cold start, chat switch): delivered on registration */
const intents = new Map<string, { runId?: string; at: number }>();
export const INTENT_TTL_MS = 60_000;

/** The mounted chat of `conversationId` registers itself (inboxBus.useApprovalOpener). Returns the unregister fn. */
export function registerApprovalOpener(conversationId: string, o: ApprovalOpener, now = Date.now()): () => void {
  openers.set(conversationId, o);
  const pending = intents.get(conversationId);
  intents.delete(conversationId);
  if (pending && now - pending.at < INTENT_TTL_MS) o.open(pending.runId);
  return () => {
    if (openers.get(conversationId) === o) openers.delete(conversationId);
  };
}

/**
 * Notification tap / banner "Öffnen" / approval event on the open chat: show the pending approval of `runId` in
 * `conversationId`. Mounted chat → now; otherwise remembered for 60 s and delivered when the chat mounts.
 */
export function openPendingApproval(conversationId: string, runId?: string, now = Date.now()): void {
  const o = openers.get(conversationId);
  if (o) return o.open(runId);
  intents.set(conversationId, { runId, at: now });
}

/** An approval was resolved elsewhere: the open chat of that conversation re-checks its run. */
export function checkApprovalOf(conversationId: string, runId?: string): void {
  void openers.get(conversationId)?.check?.(runId);
}

// ------------------------------------------------------------------ routing of the inbox events

export type ApprovalRouteDeps = {
  controller: { list(): ConversationMeta[] };
  /** id of the open conversation */
  activeId(): string | undefined;
  /** banner "Freigabe nötig" – `conversationId` is where "Öffnen" goes */
  banner(n: ApprovalNotice, conversationId: string | undefined): void;
  clearBanner(requestId: string): void;
  openPending(conversationId: string, runId?: string): void;
  checkPending(conversationId: string, runId?: string): void;
};

export type ApprovalRoute = 'open-chat' | 'banner' | 'ignored';

/**
 * One `approval` event. The chat that owns the session (pickConversation) is open → no banner, the card is
 * (re)built; any other chat / screen → banner. Expired (estimate) or foreign-profile sessions are ignored.
 */
export function routeApproval(deps: ApprovalRouteDeps, p: Pick<PushProfile, 'id' | 'kind' | 'model'>, n: ApprovalNotice, now = Date.now()): ApprovalRoute {
  if (n.expiresAt && n.expiresAt + 30_000 < now) return 'ignored';
  const conv = n.sessionId ? pickConversation(deps.controller.list(), p, { sessionId: n.sessionId }) : null;
  if (conv && conv.id === deps.activeId()) {
    deps.openPending(conv.id, n.runId);
    return 'open-chat';
  }
  deps.banner(n, conv?.id);
  return 'banner';
}

/** `approval_resolved`: other devices dismiss – banner away, the owning open chat re-checks its card. */
export function routeApprovalResolved(deps: ApprovalRouteDeps, p: Pick<PushProfile, 'id' | 'kind' | 'model'>, r: ApprovalResolved): void {
  deps.clearBanner(r.requestId);
  const conv = r.sessionId ? pickConversation(deps.controller.list(), p, { sessionId: r.sessionId }) : null;
  if (conv) deps.checkPending(conv.id, r.runId);
}
