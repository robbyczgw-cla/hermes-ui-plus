/**
 * Android recreates the activity on some configuration changes (system font size, display size). The JS runtime
 * survives that, but the router starts again at "/", so an open Settings screen fell back to the chat (E2E round 7).
 * The last route lives in this module (it survives a recreation, not a process restart) and is restored once when the
 * root layout mounts again. Only top-level screens that are safe to reopen are restored. Pure → tested.
 */
export const RESTORABLE_ROUTES: readonly string[] = ['/settings', '/routines', '/gallery'];

let last: string | null = null;

/** the router reported `path` as the current screen */
export function rememberRoute(path: string): void {
  last = path;
}

/** called once per root mount: the route to reopen after a recreation, or null (first start, chat, other screens) */
export function takeRouteToRestore(): string | null {
  const p = last;
  last = null;
  return p && RESTORABLE_ROUTES.includes(p) ? p : null;
}
