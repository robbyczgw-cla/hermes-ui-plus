/**
 * Settings → Chat → "Routinen" (this device, default on): off hides every Routines surface of the app (the Routines
 * screen, the routines part of "Über <Name>", the result inbox, Routine pushes, the demo routines). Reminders from the
 * chat are no Routines feature and stay. The React side reads `usePreference('routines')`; this module-level copy is
 * for non-React callers (push registration, the notification handler, the offline demo). PreferencesProvider keeps it
 * in sync. Pure, erasable TS.
 */
let enabled = true;

export function routinesEnabled(): boolean {
  return enabled;
}

export function setRoutinesEnabled(on: boolean): void {
  enabled = on;
}
