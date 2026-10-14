import type { TKey } from '../i18n/core.ts';
import type { ConversationMeta } from './types.ts';

export type GroupKey = 'pinned' | 'today' | 'yesterday' | 'week' | 'older';

/** Section header per group; the UI translates it (`t(GROUP_KEYS[key])`). */
export const GROUP_KEYS: Record<GroupKey, TKey> = {
  pinned: 'conversations.group.pinned',
  today: 'conversations.group.today',
  yesterday: 'conversations.group.yesterday',
  week: 'conversations.group.week',
  older: 'conversations.group.older',
};

export type ConversationGroup = { key: GroupKey; items: ConversationMeta[] };

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Which bucket (local time) an `updatedAt` falls in. "Letzte 7 Tage" = the 7 calendar days before yesterday's end, i.e. 2..7 days back. */
export function bucketOf(updatedAt: number, now: number): Exclude<GroupKey, 'pinned'> {
  const today = startOfDay(now);
  const d = new Date(today);
  d.setDate(d.getDate() - 1);
  const yesterday = d.getTime();
  d.setDate(d.getDate() - 6);
  const weekStart = d.getTime();
  if (updatedAt >= today) return 'today';
  if (updatedAt >= yesterday) return 'yesterday';
  if (updatedAt >= weekStart) return 'week';
  return 'older';
}

/** Most recent first. */
export function sortByRecency(items: ConversationMeta[]): ConversationMeta[] {
  return items.slice().sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

/** Pinned section first, then today / yesterday / last 7 days / older; empty groups omitted. */
export function groupConversations(items: ConversationMeta[], now: number): ConversationGroup[] {
  const sorted = sortByRecency(items);
  const buckets: Record<GroupKey, ConversationMeta[]> = { pinned: [], today: [], yesterday: [], week: [], older: [] };
  for (const c of sorted) {
    if (c.pinned) buckets.pinned.push(c);
    else buckets[bucketOf(c.updatedAt, now)].push(c);
  }
  const order: GroupKey[] = ['pinned', 'today', 'yesterday', 'week', 'older'];
  return order.filter((k) => buckets[k].length > 0).map((k) => ({ key: k, items: buckets[k] }));
}
