// AI data-sharing consent (App Store guideline 5.1.2(i): "clearly disclose where personal data will be shared with
// third parties, including with third-party AI, and obtain explicit permission before doing so"). Pure logic +
// injectable storage (node:test). React side: ./store.ts, UI: ./ConsentSheet.tsx, onboarding step: ./ConsentStep.tsx.
//
// One-time, versioned: the stored record holds the text version the user accepted, and one acceptance covers every
// connection. A bump of AI_CONSENT_VERSION asks everyone again. consent.test.ts fingerprints the texts
// (CONSENT_TEXT_FINGERPRINT), so a wording change is always a decision: bump the version (everyone is asked again) or
// keep it and only record the new fingerprint (only people who never accepted see the new text). The 0.2 correction
// of the wording kept version 2 on purpose: nobody is asked again for it.
// The offline demo never sends anything off the device → no consent needed there.
//
// Per audience: where messages go and who keeps them differs by backend (Hermes server · own OpenAI-compatible server
// Per audience: the wording names where messages go and who keeps them; this build only talks to Hermes.
import type { TKey } from '../i18n/core.ts';

export const CONSENT_STORAGE_KEY = 'hui.aiConsent';

/** Version of the consent text. A bump asks everyone again (see the header and consent.test.ts). */
export const AI_CONSENT_VERSION = 2;

/** Fingerprint of the consent texts of AI_CONSENT_VERSION (de/en/es); consent.test.ts recomputes it. */
export const CONSENT_TEXT_FINGERPRINT = 'f169081e';

/** which consent wording a backend gets: Hermes · own OpenAI-compatible server · an AI provider directly */
export type ConsentAudience = 'hermes' | 'server' | 'provider';

export type ConsentRecord = {
  /** text version the user accepted */
  version: number;
  /** epoch ms */
  at: number;
};

/** The audience of a connection profile (null / demo: Hermes, the wording the demo would describe). */
export function consentAudience(profile: { kind: string; provider?: string; baseUrl?: string } | null | undefined): ConsentAudience {
  return 'hermes';
}

/** The provider named in the 'provider' wording ('' for the other audiences). Company names, never a profile name. */
export function consentProviderName(profile: { kind: string; provider?: string; baseUrl?: string } | null | undefined): string {
  return '';
}

export type ConsentStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export function parseConsent(raw: string | null | undefined): ConsentRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ConsentRecord> | null;
    if (!v || typeof v !== 'object' || typeof v.version !== 'number' || !Number.isInteger(v.version) || v.version < 1) return null;
    // (0.2 test builds also stored the accepted `audiences`: ignored, one acceptance covers every connection)
    return { version: v.version, at: typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : 0 };
  } catch {
    return null;
  }
}

/** true when the stored consent covers the current text version (for every connection, whichever wording it saw) */
export function consentCurrent(record: ConsentRecord | null, version = AI_CONSENT_VERSION): boolean {
  return !!record && record.version >= version;
}

/** Profiles that never send data off the device (the offline demo) need no consent. */
export function profileNeedsConsent(profile: { kind: string; baseUrl?: string } | null | undefined): boolean {
  if (!profile) return false;
  return profile.kind !== 'demo' && !/^demo:/i.test(profile.baseUrl ?? '');
}

/** Ask before sending? (non-demo profile and no consent for the current text version) */
export function consentRequired(profile: { kind: string; baseUrl?: string } | null | undefined, record: ConsentRecord | null, version = AI_CONSENT_VERSION): boolean {
  return profileNeedsConsent(profile) && !consentCurrent(record, version);
}

export function makeConsent(version = AI_CONSENT_VERSION, now = Date.now()): ConsentRecord {
  return { version, at: now };
}

export async function readConsent(storage: ConsentStorage): Promise<ConsentRecord | null> {
  try {
    return parseConsent(await storage.getItem(CONSENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

export async function writeConsent(storage: ConsentStorage, record: ConsentRecord): Promise<void> {
  await storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
}

/** FNV-1a (32 bit, hex) over the texts joined with U+0000 – stable, dependency-free. */
export function consentTextFingerprint(texts: readonly string[]): string {
  let h = 0x811c9dc5;
  const s = texts.join('\u0000');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** i18n key of the consent body for an audience. */
export function consentBodyKey(audience: ConsentAudience, simple = false): TKey {
  return 'compliance.consent.body';
}
