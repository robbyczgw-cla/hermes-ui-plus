/**
 * expo-calendar adapter (SDK 57 `expo-calendar/legacy` API: createEventAsync & co).
 * Flow: permission → pick a writable calendar → createEventAsync. If that is impossible (permission
 * denied, no writable calendar, error) fall back to the system "new event" UI
 * (createEventInCalendarAsync) where the user saves the event themself.
 */
import { Platform } from 'react-native';
import { calendarEventTimes, pickWritableCalendar } from './calendarModel.ts';
import type { ValidAction } from './types.ts';

export type CalendarOutcome =
  | { ok: true; via: 'direct'; calendarTitle: string }
  /** system UI was shown; `saved` is null when the platform cannot tell (Android) */
  | { ok: true; via: 'ui'; saved: boolean | null }
  | { ok: false; reason: 'unsupported' | 'error' };

type CalendarModule = typeof import('expo-calendar/legacy');

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export async function addCalendarEvent(a: Extract<ValidAction, { type: 'calendar' }>): Promise<CalendarOutcome> {
  if (Platform.OS === 'web') return { ok: false, reason: 'unsupported' };
  let Cal: CalendarModule;
  try {
    Cal = await import('expo-calendar/legacy');
  } catch {
    return { ok: false, reason: 'unsupported' };
  }
  const os = Platform.OS;
  const times = calendarEventTimes(a, os);
  const details = {
    title: a.title,
    startDate: times.startDate,
    endDate: times.endDate,
    allDay: times.allDay,
    timeZone: times.timeZone ?? localTimeZone(),
    ...(a.location ? { location: a.location } : {}),
    ...(a.notes ? { notes: a.notes } : {}),
  };

  try {
    let perm = await Cal.getCalendarPermissionsAsync();
    if (!perm.granted) perm = await Cal.requestCalendarPermissionsAsync();
    if (perm.granted) {
      const calendars = await Cal.getCalendarsAsync(Cal.EntityTypes.EVENT);
      let defaultId: string | null = null;
      if (os === 'ios') {
        try {
          defaultId = (await Cal.getDefaultCalendarAsync()).id;
        } catch {
          defaultId = null;
        }
      }
      const cal = pickWritableCalendar(calendars, os, defaultId);
      if (cal) {
        await Cal.createEventAsync(cal.id, details);
        return { ok: true, via: 'direct', calendarTitle: cal.title };
      }
    }
  } catch {
    /* fall through to the system UI */
  }

  try {
    const res = await Cal.createEventInCalendarAsync(details);
    if (res.action === 'canceled') return { ok: true, via: 'ui', saved: false };
    return { ok: true, via: 'ui', saved: res.action === 'saved' ? true : null };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
