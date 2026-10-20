/**
 * Routines availability as the drawer and the screen see it (pure, no React): what a failed job-list probe means, and
 * when the drawer shows the Routines row.
 */
import { isRoutinesUnsupported } from './jobs.ts';
import { routinesErrorKind } from './rights.ts';

/**
 * What the server says about Routines for this bot: `available` (the job list loaded), `off` (a UI bridge that knows
 * Routines, but the owner has not enabled them for this bot: 404 `routines_off`), `forbidden` (this device has no access:
 * 403 `routines_forbidden`), `unsupported` (no job API at all: older Hermes or bridge, 404/405/501 without our code).
 */
export type RoutinesState = 'available' | 'off' | 'forbidden' | 'unsupported';

/** A failed job-list probe as a lasting state; null = transient (network, auth, 5xx): ask again, keep the old answer. */
export function routinesProbeState(e: unknown): Exclude<RoutinesState, 'available'> | null {
  const kind = routinesErrorKind(e);
  if (kind === 'off') return 'off';
  if (kind === 'forbidden') return 'forbidden';
  return isRoutinesUnsupported(e) ? 'unsupported' : null;
}

/**
 * Drawer row for a state: shown whenever the server knows Routines, with a note when they cannot be used here, so a
 * user of the default bridge (no bot enabled) finds the explanation where Routines live instead of nothing. A server
 * without the job API keeps no row (nothing to explain beyond "this server has none"; the Routines screen still says
 * so when opened another way).
 */
export function routinesEntry(state: RoutinesState | undefined): { show: boolean; note: 'off' | 'forbidden' | null } {
  if (state === 'available') return { show: true, note: null };
  if (state === 'off' || state === 'forbidden') return { show: true, note: state };
  return { show: false, note: null };
}
