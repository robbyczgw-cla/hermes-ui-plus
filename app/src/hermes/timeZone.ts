/** IANA zone of the device (`Intl`), 'UTC' when the runtime cannot tell. Sent with Hermes turns, stored on messages. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** UTC offset of `zone` at `at` in minutes (east positive), or null when the runtime cannot tell. */
export function zoneOffsetMinutes(zone: string, at: number): number | null {
  try {
    // `format` + a fixed en-US pattern ("10/20/2026, 09:00"): formatToParts is platform-dependent in Hermes
    const text = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(at);
    const m = /(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})/.exec(text);
    if (!m) return null;
    const wall = Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), Number(m[4]) % 24, Number(m[5]));
    const off = Math.round((wall - Math.floor(at / 60_000) * 60_000) / 60_000);
    return Number.isFinite(off) ? off : null;
  } catch {
    return null;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The user's time zone for Hermes (an ephemeral system message on every Hermes turn, bridge and direct alike): "9 Uhr"
 * means the phone's 9:00, and Hermes only knows its own zone (its prompt carries date + server zone, no clock time;
 * cron jobs have no zone of their own). The skill turns it into an ISO time with this offset for one-shot reminders.
 * Only zone, offset and date: the text changes once a day (and at a DST switch), so the prompt cache stays valid.
 * Example: `[hermes-ui-app] User time zone: Europe/Vienna (UTC+02:00), date there 2026-10-20 (Tue).` (the weekday too:
 * models get "tomorrow" wrong without it)
 */
export function userTimeZoneMessage(at: number = Date.now(), zone: string = deviceTimeZone()): string {
  const off = zoneOffsetMinutes(zone, at);
  if (off === null) return `[hermes-ui-app] User time zone: ${zone}.`;
  const sign = off < 0 ? '-' : '+';
  const local = new Date(at + off * 60_000);
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} (${WEEKDAYS[local.getUTCDay()]})`;
  return `[hermes-ui-app] User time zone: ${zone} (UTC${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}), date there ${date}.`;
}
