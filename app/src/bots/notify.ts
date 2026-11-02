/**
 * Notification level per bot and device ("Über <Name>" → Benachrichtigungen, Bots v2 spec 2.5): pure, erasable TS.
 *
 *   all     answers, routine results, reminders and approvals (the default)
 *   needed  only when the bot needs you: approvals (+ the reminder shortly before they expire)
 *   off     nothing for this bot, except the first notice of an approval: an unseen approval just expires to "deny"
 *           (v1 O8), so it still announces itself once; no reminder, no "answer ready", no routine results
 *
 * Stored with the connection's push settings (`bots` map, `all` omitted) and sent to the bridge in the push
 * registration's scope (`quietBots` / `offBots`) so the server skips those pushes too. A bridge without per-bot levels
 * (no `botLevels` in its push config) still pushes everything; the sheet says so.
 */
import { DEFAULT_BOT } from '../hermes/bots.ts';

export type BotNotifyLevel = 'all' | 'needed' | 'off';
export const BOT_NOTIFY_LEVELS: readonly BotNotifyLevel[] = ['all', 'needed', 'off'];

/** botKey (`default` or the profile name) → level; `all` is never stored */
export type BotLevels = Readonly<Record<string, Exclude<BotNotifyLevel, 'all'>>>;

const KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX = 32; // the push scope's list limit

export function sanitizeLevels(v: unknown): BotLevels {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const out: Record<string, 'needed' | 'off'> = {};
  for (const [k, l] of Object.entries(v as Record<string, unknown>)) {
    if (!KEY.test(k) || (l !== 'needed' && l !== 'off')) continue;
    out[k] = l;
    if (Object.keys(out).length >= MAX) break;
  }
  return out;
}

export function levelOf(levels: BotLevels | undefined, bot: string | null | undefined): BotNotifyLevel {
  return levels?.[bot || DEFAULT_BOT] ?? 'all';
}

export function withLevel(levels: BotLevels | undefined, bot: string | null | undefined, level: BotNotifyLevel): BotLevels {
  const key = bot || DEFAULT_BOT;
  const next: Record<string, 'needed' | 'off'> = { ...(levels ?? {}) };
  if (level === 'all') delete next[key];
  else next[key] = level;
  return sanitizeLevels(next);
}

/** The registration scope's lists (only non-empty ones; an older bridge ignores them). */
export function scopeLists(levels: BotLevels | undefined): { quietBots?: string[]; offBots?: string[] } {
  const entries = Object.entries(levels ?? {});
  const quiet = entries.filter(([, l]) => l === 'needed').map(([k]) => k).sort();
  const off = entries.filter(([, l]) => l === 'off').map(([k]) => k).sort();
  return { ...(quiet.length ? { quietBots: quiet } : {}), ...(off.length ? { offBots: off } : {}) };
}

/** Stable key of the levels (re-register the device when it changes). */
export function levelsKey(levels: BotLevels | undefined): string {
  return Object.entries(levels ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, l]) => `${k}=${l}`)
    .join(',');
}

export type NoticeKind = 'answer' | 'routine' | 'reminder' | 'approval' | 'approvalReminder';

/** May the app show this kind of notice (local notification, banner) for that bot? */
export function noticeAllowed(level: BotNotifyLevel, kind: NoticeKind): boolean {
  if (level === 'all') return true;
  if (kind === 'approval') return true; // never silent: it would expire to "deny" unseen
  if (kind === 'approvalReminder') return level === 'needed';
  return false;
}
