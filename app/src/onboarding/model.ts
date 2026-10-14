// Pure onboarding model: persisted flag format, gate decision, profile creation. Tested in model.test.ts.
import { brand } from '../brand.ts';
import { newProfileId, type ConnectionProfile } from '../settings/profiles.ts';

export type OnboardingPath = 'bridge' | 'direct' | 'demo' | 'other' | 'legacy';

export type OnboardedFlag = { v: 1; at: number; path: OnboardingPath };

export const ONBOARDED_KEY = 'hermes.onboarded.v1';
/** Keys written by settings/storage.ts – if one exists the user set the app up before onboarding existed. */
export const LEGACY_SETUP_KEYS = ['hermes.profiles.v1', 'hermes.activeProfile.v1'] as const;

const PATHS: readonly OnboardingPath[] = ['bridge', 'direct', 'demo', 'other', 'legacy'];

export function serializeOnboardedFlag(path: OnboardingPath, now = Date.now()): string {
  return JSON.stringify({ v: 1, at: now, path } satisfies OnboardedFlag);
}

/** Tolerant parser: anything unexpected → null (= not onboarded). */
export function parseOnboardedFlag(raw: string | null | undefined): OnboardedFlag | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (o.v !== 1 || typeof o.at !== 'number' || !PATHS.includes(o.path as OnboardingPath)) return null;
    return { v: 1, at: o.at, path: o.path as OnboardingPath };
  } catch {
    return null;
  }
}

/**
 * Show onboarding unless it was completed, the user already had a setup (upgrade from a version without
 * onboarding), or a personal dev build ships keys via EXPO_PUBLIC_* (maintainer convenience).
 */
export function shouldShowOnboarding(s: { flag: OnboardedFlag | null; hasLegacySetup: boolean; hasDevKeys?: boolean }): boolean {
  if (s.flag) return false;
  if (s.hasLegacySetup) return false;
  if (s.hasDevKeys) return false;
  return true;
}

/**
 * Hermes profile from onboarding input. Re-uses an existing Hermes profile with the same base URL
 * (re-pairing updates the token instead of piling up duplicates).
 */
export function buildHermesProfile(
  input: { baseUrl: string; apiKey: string; name: string; bridge: boolean },
  existing: readonly ConnectionProfile[] = [],
  makeId: () => string = newProfileId,
): ConnectionProfile {
  const same = existing.find((p) => p.kind === 'hermes' && p.baseUrl.replace(/\/+$/, '').toLowerCase() === input.baseUrl.toLowerCase());
  const base: ConnectionProfile = same ?? { id: makeId(), kind: 'hermes', name: '', baseUrl: '', apiKey: '', sessionKey: 'hermes-ui' };
  return {
    ...base,
    kind: 'hermes',
    name: input.name.trim() || base.name || input.baseUrl,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey.trim(),
    sessionKey: base.sessionKey ?? 'hermes-ui',
    bridge: input.bridge || undefined,
  };
}

// ── Skill install hint (generic: no maintainer hosts) ────────────────────────────────────────────
/** Public source repository (brand identity `repoUrl`, app/brand/identity.json); null until published. */
export const PROJECT_REPO_URL: string | null = brand().repoUrl;
/** Docs page for the skill install (opened by the "Anleitung" button). null → button hidden. */
export const SKILL_DOCS_URL: string | null = null;

/**
 * Shell commands for the Hermes host. Copies only the skill folder; Hermes picks it up without restart.
 * Without a published repo URL: just the copy step from a checkout of the source (never a placeholder URL).
 */
export function skillInstallCommand(repoUrl: string | null = PROJECT_REPO_URL): string {
  if (!repoUrl) return ['mkdir -p ~/.hermes/skills', 'cp -r hermes-skill/hermes-ui ~/.hermes/skills/'].join('\n');
  return [
    `git clone --depth 1 ${repoUrl} hermes-ui-src`,
    'mkdir -p ~/.hermes/skills',
    'cp -r hermes-ui-src/hermes-skill/hermes-ui ~/.hermes/skills/',
  ].join('\n');
}

/** Lines of a code box (onboarding CodeBox): one wrapping text each, trailing blank lines dropped. */
export function codeBoxLines(code: string): string[] {
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}

