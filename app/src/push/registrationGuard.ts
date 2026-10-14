/**
 * Registration vs. disable race (review M8, pure for node:test). Each registration job / disable takes a
 * generation of its profile. A registration that finishes after notifications were switched off (or after a newer
 * job / disable superseded it) must not store its id – and when push is off it is revoked on the server, so no
 * active registration outlives the "off" switch.
 */
const gens = new Map<string, number>();

/** start a registration job or a disable for `profileId`: every older job is superseded */
export function nextRegistrationGen(profileId: string): number {
  const g = (gens.get(profileId) ?? 0) + 1;
  gens.set(profileId, g);
  return g;
}

export function isCurrentRegistrationGen(profileId: string, gen: number): boolean {
  return gens.get(profileId) === gen;
}

export type RegistrationOutcome = 'stored' | 'revoked' | 'superseded';

/** after the server accepted a registration: store it, revoke it (push off meanwhile), or leave it to the newer job */
export async function completeRegistration(o: {
  profileId: string;
  gen: number;
  /** current settings (read now, not at job start) */
  enabled: () => boolean;
  store: () => void;
  /** best effort server unregister of THIS registration */
  revoke: () => Promise<void>;
}): Promise<RegistrationOutcome> {
  if (!o.enabled()) {
    await o.revoke().catch(() => {});
    return 'revoked';
  }
  if (!isCurrentRegistrationGen(o.profileId, o.gen)) return 'superseded';
  o.store();
  return 'stored';
}
