/**
 * Approval reminder (Bots v2 spec 2.4 "Warten statt Countdown"): Hermes denies an unanswered approval by itself when
 * its timeout runs out (default 300 s). Besides the first notice, the app schedules ONE local notification two minutes
 * before that deadline, so a request is not lost while the phone is in the pocket. Pure planner (node:test); the
 * notifier is injected (actions/notifications.ts on devices).
 *
 * Honest limits: the deadline is an estimate (Hermes sends none; the bridge and the chat add the configured timeout to
 * the request time). Without a deadline, or when it is less than REMINDER_MIN_LEAD_MS away, there is no reminder.
 */
import { DEFAULT_BOT } from '../hermes/bots.ts';
import type { AttentionItem } from './core.ts';
import { noticeAllowed, type BotNotifyLevel } from './notify.ts';

export const REMINDER_BEFORE_MS = 120_000;
/** a reminder closer than this to "now" would land right after the first notice: skip it */
export const REMINDER_MIN_LEAD_MS = 20_000;
/** `data` tag of a scheduled reminder: the approval's request id */
export const REMINDER_TAG = 'huiApprovalReminder';

export type PlannedReminder = { requestId: string; at: number; item: AttentionItem };

/** The reminders that should exist now: one per pending approval with a deadline far enough ahead. */
export function plannedReminders(items: readonly AttentionItem[], now: number, level: (profileId: string, bot: string) => BotNotifyLevel): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  for (const item of items) {
    if (!item.expiresAt) continue;
    const at = item.expiresAt - REMINDER_BEFORE_MS;
    if (at - now < REMINDER_MIN_LEAD_MS) continue;
    if (!noticeAllowed(level(item.profileId, item.bot ?? DEFAULT_BOT), 'approvalReminder')) continue;
    if (out.some((r) => r.requestId === item.requestId)) continue;
    out.push({ requestId: item.requestId, at, item });
  }
  return out;
}

export type ScheduledReminder = { id: string; requestId: string; at: number };

/**
 * What to cancel and what to schedule. A reminder of a request this app run never saw stays (after a cold start the
 * attention list is empty until the chats and the inbox report again: the reminder must survive that), unless its time
 * has passed. Answered / resolved ones (seen, now gone), second copies and moved deadlines are cancelled.
 */
export function reminderDiff(
  planned: readonly PlannedReminder[],
  scheduled: readonly ScheduledReminder[],
  o: { known: ReadonlySet<string>; now: number },
): { cancel: string[]; add: PlannedReminder[] } {
  const want = new Map(planned.map((p) => [p.requestId, p]));
  const cancel: string[] = [];
  const kept = new Set<string>();
  for (const s of scheduled) {
    const p = want.get(s.requestId);
    if (p && !kept.has(s.requestId) && Math.abs(p.at - s.at) < 5_000) kept.add(s.requestId);
    else if (p || o.known.has(s.requestId) || s.at < o.now) cancel.push(s.id);
    else kept.add(s.requestId); // not known in this run yet: leave it alone
  }
  return { cancel, add: planned.filter((p) => !kept.has(p.requestId)) };
}

/** Scheduled reminders of this app among all pending local notifications. */
export function scheduledReminders(list: readonly { id: string; data: Record<string, unknown> }[]): ScheduledReminder[] {
  return list.flatMap((n) => {
    const requestId = n.data[REMINDER_TAG];
    const at = Number(n.data.huiApprovalAt);
    return typeof requestId === 'string' && requestId ? [{ id: n.id, requestId, at: Number.isFinite(at) ? at : 0 }] : [];
  });
}
