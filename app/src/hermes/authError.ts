// Rejected credentials in a chat (pure; tested in authError.test.ts). A 401/403 or a server text like
// "Invalid bridge token" is shown as a human message ("Zugang abgelehnt – Schlüssel prüfen") with a
// "Verbindung bearbeiten" action that opens the profile editor (MessageItem).
import type { TKey } from '../i18n/core.ts';
import type { ChatMessage } from './types';

export const AUTH_DENIED_KEY: TKey = 'backends.hermes.errors.authDenied';

/** keyed errors of all backends that mean "the stored key / login is not accepted" */
const AUTH_KEYS: ReadonlySet<string> = new Set<string>([
  AUTH_DENIED_KEY,
  'backends.hermes.errors.apiKeyInvalid',
]);

const AUTH_TEXT_RE =
  /\b(?:invalid|bad|missing|wrong|expired|revoked)\b[\w\s()-]{0,30}?\b(?:token|api[ _-]?key|key|credentials?|password)\b|\bunauthori[sz]ed\b|\bauthentication (?:failed|required)\b|(?:\b|_)auth(?:entication)?[_ ]?(?:error|failed)\b/i;

/** HTTP status and/or server message of a failed request → is it a credentials problem? */
export function isAuthFailure(status: number | undefined, message?: string | null): boolean {
  if (status === 401 || status === 403) return true;
  return typeof message === 'string' && AUTH_TEXT_RE.test(message);
}

/** `errorText` for a credentials failure (else undefined: keep the server text) */
export function authErrorText(status: number | undefined, message?: string | null): { key: TKey } | undefined {
  return isAuthFailure(status, message) ? { key: AUTH_DENIED_KEY } : undefined;
}

/** an error bubble that should offer "Verbindung bearbeiten" */
export function isAuthErrorMessage(m: Pick<ChatMessage, 'status' | 'error' | 'errorText'>): boolean {
  if (m.status !== 'error') return false;
  if (m.errorText) return AUTH_KEYS.has(m.errorText.key);
  return isAuthFailure(undefined, m.error);
}
