import type { ProfileKind } from './types.ts';

function randomHex(bytes: number): string {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  let out = '';
  if (c && typeof c.getRandomValues === 'function') {
    for (const b of c.getRandomValues(new Uint8Array(bytes))) out += b.toString(16).padStart(2, '0');
    return out;
  }
  for (let i = 0; i < bytes; i++) out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  return out;
}

export function newConversationId(now: number = Date.now()): string {
  return `c-${now.toString(36)}-${randomHex(4)}`;
}

/** Session id prefix per backend (`hui` = Hermes; the others are local ids only). */
export const SESSION_PREFIX: Record<ProfileKind, string> = { hermes: 'hui', demo: 'demo' };

/**
 * Session id for a new conversation. Hermes: client-generated id sent as `X-Hermes-Session-Id` on every
 * request (same shape as hermes/newSessionId: `hui-<hex>`). Other backends: local id only.
 */
export function newSessionIdFor(kind: ProfileKind): string {
  return `${SESSION_PREFIX[kind] ?? 'hui'}-${randomHex(8)}`;
}
