/**
 * Routines slice 2: what this device may do with a bot's Routines, and what the bridge offers for it. Pure, erasable TS.
 *
 * Bridge contract (routines slice 2, bridge side):
 *   GET /bridge/routines/capabilities?hermesProfile=<bot> → 200 {version:1, hermesProfile, available, rights, mode,
 *       inbox:{available, durable, retentionDays, maxItems}, push:{available}, features:{…}, reasons:[…]}
 *   job list / get: `hui: {routines: "control"|"read", rights: "manage"|"read"}` (`routines` for slice-1 apps)
 *   errors: 403 `routines_read_only` (mutation without manage), 403 `routines_forbidden` (device right `none`),
 *           404 `routines_off` (bot not enabled / server ceiling off)
 * Direct Hermes connections (no bridge) have no rights model: the key is the owner's, so `manage`.
 */
import { HermesError } from '../hermes/stream.ts';

export type RoutinesRights = 'manage' | 'read' | 'none';

export type RoutinesReason = 'routines_off' | 'bot_not_enabled' | 'read_only_server' | 'read_only_device' | 'device_forbidden' | 'inbox_memory_only';
const REASONS: readonly RoutinesReason[] = ['routines_off', 'bot_not_enabled', 'read_only_server', 'read_only_device', 'device_forbidden', 'inbox_memory_only'];

export type RoutinesCapabilities = {
  version: number;
  hermesProfile: string;
  available: boolean;
  rights: RoutinesRights;
  /** BRIDGE_ROUTINES: control | read | off */
  mode: string;
  inbox: { available: boolean; durable: boolean; retentionDays: number | null; maxItems: number | null };
  push: { available: boolean };
  reasons: RoutinesReason[];
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : null);

export function parseRights(v: unknown): RoutinesRights | undefined {
  return v === 'manage' || v === 'read' || v === 'none' ? v : undefined;
}

/** null: not a capabilities answer (the caller treats it like an older bridge). Unknown reasons are dropped. */
export function parseCapabilities(json: unknown): RoutinesCapabilities | null {
  if (!isObj(json) || typeof json.version !== 'number') return null;
  const rights = parseRights(json.rights) ?? 'none';
  const inbox = isObj(json.inbox) ? json.inbox : {};
  const push = isObj(json.push) ? json.push : {};
  const reasons = Array.isArray(json.reasons) ? json.reasons.filter((r): r is RoutinesReason => REASONS.includes(r as RoutinesReason)) : [];
  return {
    version: json.version,
    hermesProfile: typeof json.hermesProfile === 'string' ? json.hermesProfile : 'default',
    available: json.available === true,
    rights,
    mode: typeof json.mode === 'string' ? json.mode : 'control',
    inbox: { available: inbox.available === true, durable: inbox.durable === true, retentionDays: posInt(inbox.retentionDays), maxItems: posInt(inbox.maxItems) },
    push: { available: push.available === true },
    reasons: [...new Set(reasons)],
  };
}

/** May this device pause / resume / run? Only with `manage`. */
export function canManage(rights: RoutinesRights | undefined): boolean {
  return rights === 'manage';
}

/**
 * Why the list is read-only, for the footnote: the server (BRIDGE_ROUTINES=read) or this device (owner did not grant
 * manage). null = not read-only. Without capabilities (older bridge) a read-only list is the server switch of slice 1.
 */
export function readOnlyReason(rights: RoutinesRights | undefined, caps: Pick<RoutinesCapabilities, 'reasons'> | null | undefined): 'server' | 'device' | null {
  if (rights === 'manage') return null;
  if (caps?.reasons.includes('read_only_server')) return 'server';
  if (caps?.reasons.includes('read_only_device')) return 'device';
  return caps ? 'device' : 'server';
}

export type RoutinesErrorKind = 'readOnly' | 'forbidden' | 'off' | 'unknownBot' | 'notFound' | 'unsupported' | 'other';

/**
 * Bridge error → what the UI says. `unsupported` = no such endpoint (older bridge: plain 404 / 405 / 501, or a
 * non-bridge server); `off` = the owner has not enabled Routines for this bot.
 */
export function routinesErrorKind(e: unknown): RoutinesErrorKind {
  if (!(e instanceof HermesError)) return 'other';
  switch (e.code) {
    case 'routines_read_only':
      return 'readOnly';
    case 'routines_forbidden':
      return 'forbidden';
    case 'routines_off':
      return 'off';
    case 'unknown_profile':
      return 'unknownBot';
    case 'item_not_found':
    case 'job_not_found':
      return 'notFound';
  }
  if (e.status === 404 || e.status === 405 || e.status === 501) return 'unsupported';
  return 'other';
}
