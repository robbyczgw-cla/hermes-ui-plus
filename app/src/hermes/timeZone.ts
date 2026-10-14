/** IANA zone of the device (`Intl`), 'UTC' when the runtime cannot tell. Sent with Hermes turns, stored on messages. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
