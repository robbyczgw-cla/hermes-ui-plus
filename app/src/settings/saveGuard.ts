// "Speichern" after a failed connection test (pure; tested in saveGuard.test.ts). A profile whose last test was
// rejected for its credentials (401/403, invalid key/token) is only saved after an explicit
// "Trotzdem speichern" – a silently saved bad key ends in a chat that only shows errors.
import { isAuthFailure } from '../hermes/authError.ts';

export type GuardRow = { ok: boolean; /** this check failed because the key / token was rejected */ auth?: boolean };
export type GuardView = { rows: GuardRow[] } | null;

/** did the last test reject the credentials? */
export function testAuthFailed(view: GuardView): boolean {
  return !!view && view.rows.some((r) => !r.ok && !!r.auth);
}

/** status / error of a failed check → `auth` flag of its row */
export function authFlag(status: number | undefined, error?: unknown): boolean {
  const e = error as { status?: unknown; kind?: unknown; message?: unknown } | null | undefined;
  const st = typeof status === 'number' ? status : typeof e?.status === 'number' ? e.status : undefined;
  if (e && (e.kind === 'auth' || e.kind === 'forbidden')) return true;
  return isAuthFailure(st, typeof e?.message === 'string' ? e.message : typeof error === 'string' ? error : undefined);
}

export type SaveDecision = 'save' | 'confirm';

/** "Speichern": save right away, or first ask "Trotzdem speichern?" (`confirmed` = the user already agreed) */
export function saveDecision(view: GuardView, confirmed: boolean): SaveDecision {
  return testAuthFailed(view) && !confirmed ? 'confirm' : 'save';
}
