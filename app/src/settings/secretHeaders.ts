/**
 * Custom request headers of a profile (`Authorization`, `CF-Access-Client-Secret`, `X-API-Key`, …)
 * can hold secrets, so they are stored like the API key (SecureStore), not with the profile
 * metadata in AsyncStorage (bugs review 2026-10-11 P3-9). Pure helpers; storage.ts does the I/O.
 */
import type { StoredProfile } from './migrate';

export type Headers = Record<string, string>;

/** secure-store slot id of a profile's headers (separate from the API key slot) */
export const headersSlot = (profileId: string): string => `${profileId}.headers`;

/** Serialized value for the secure store; '' = no headers (slot deleted). */
export function serializeHeaders(h: Headers | undefined): string {
  if (!h) return '';
  const entries = Object.entries(h).filter(([k, v]) => typeof k === 'string' && k.trim() && typeof v === 'string');
  return entries.length ? JSON.stringify(Object.fromEntries(entries)) : '';
}

export function parseHeaders(raw: string | null | undefined): Headers | undefined {
  if (!raw) return undefined;
  try {
    const o = JSON.parse(raw) as unknown;
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return undefined;
    const out: Headers = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

/** Profile metadata for AsyncStorage: everything except the headers. */
export function withoutHeaders<P extends { headers?: Headers }>(p: P): Omit<P, 'headers'> {
  const { headers: _h, ...rest } = p;
  return rest;
}

/** Profiles whose metadata still carries headers (stored by older builds) → move them to the secure store. */
export function legacyHeaders(stored: readonly StoredProfile[]): { id: string; value: string }[] {
  return stored.filter((p) => p.headers && Object.keys(p.headers).length).map((p) => ({ id: p.id, value: serializeHeaders(p.headers) }));
}

/** Headers to restore: the secure-store value wins, legacy metadata headers are the fallback. */
export function restoreHeaders(secret: string, legacy: Headers | undefined): Headers | undefined {
  return parseHeaders(secret) ?? (legacy && Object.keys(legacy).length ? legacy : undefined);
}
