/** Pure helpers for creating calendar events (calendar choice, platform date conventions). */
import { startOfDay } from './dates.ts';
import type { Os } from './urls.ts';
import type { ValidAction } from './types.ts';

/** Structural subset of expo-calendar's `Calendar`. */
export type CalendarInfo = {
  id: string;
  title: string;
  allowsModifications: boolean;
  isPrimary?: boolean;
  isVisible?: boolean;
  accessLevel?: string;
  ownerAccount?: string;
  source?: { name?: string; isLocalAccount?: boolean; type?: string };
};

/**
 * Choose where to write the event.
 *  - only calendars that allow modifications (and are not hidden) qualify
 *  - iOS: the system default calendar (`defaultId`) if writable
 *  - Android: there is no default → primary calendar of an account (isPrimary), then a calendar owned
 *    by its own account (Google: ownerAccount === source.name), then owner access level, then any.
 */
export function pickWritableCalendar<C extends CalendarInfo>(calendars: readonly C[], os: Os, defaultId?: string | null): C | null {
  const writable = calendars.filter((c) => c.allowsModifications && c.isVisible !== false);
  if (!writable.length) return null;
  if (os === 'ios' && defaultId) {
    const d = writable.find((c) => c.id === defaultId);
    if (d) return d;
  }
  const score = (c: C): number => {
    let s = 0;
    if (c.isPrimary) s += 8;
    if (c.ownerAccount && c.source?.name && c.ownerAccount === c.source.name) s += 4;
    if (c.accessLevel === 'owner') s += 2;
    if (c.source?.isLocalAccount === false) s += 1;
    return s;
  };
  return [...writable].sort((a, b) => score(b) - score(a))[0];
}

export type CalendarEventTimes = { startDate: Date; endDate: Date; allDay: boolean; /** only set for Android all-day events */ timeZone?: string };

/**
 * Convert the validated action (all-day `end` = inclusive last day) to platform conventions:
 *  - Android's calendar provider stores all-day events as UTC midnight .. following UTC midnight
 *    (exclusive end) with EVENT_TIMEZONE "UTC".
 *  - iOS (EventKit) takes local dates; the end is the last day itself.
 */
export function calendarEventTimes(a: Extract<ValidAction, { type: 'calendar' }>, os: Os): CalendarEventTimes {
  if (!a.allDay) return { startDate: a.start, endDate: a.end, allDay: false };
  const first = startOfDay(a.start);
  const last = startOfDay(a.end);
  if (os === 'ios') return { startDate: first, endDate: new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59), allDay: true };
  return {
    startDate: new Date(Date.UTC(first.getFullYear(), first.getMonth(), first.getDate())),
    endDate: new Date(Date.UTC(last.getFullYear(), last.getMonth(), last.getDate() + 1)),
    allDay: true,
    timeZone: 'UTC',
  };
}
