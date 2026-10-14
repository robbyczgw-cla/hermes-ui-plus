// Versioned migration of the stored profile list (AsyncStorage `hermes.profiles.v1`). Pure + tested.
//
// Formats
// - v1 (no envelope): `StoredProfile[]` – kinds 'hermes' | 'claude' (or no kind = hermes), and copies of
//   the old built-in presets (`preset-bridge`, `preset-hermes-host`, `preset-mock`, `preset-claude`).
// - v2: `{ v: 2, profiles: StoredProfile[] }` – all kinds of ProfileKind.
//
// v1 → v2: the old presets are no longer shipped. A stored copy becomes a normal (deletable) profile
// under the SAME id, so its secure-store key and the conversations bound to it keep working. A copy
// without a usable URL (never saved with real values) is dropped. Unknown kinds are dropped, fields
// with wrong types are removed, never thrown.
import {
  PRESET_DEMO_ID,
  PROFILE_KINDS,
  type ConnectionProfile,
  type ProfileKind,
} from './profiles.ts';

export const PROFILES_SCHEMA_VERSION = 2;

export type StoredProfile = Omit<ConnectionProfile, 'apiKey'>;

/** Ids of the presets shipped before v2. */
export const LEGACY_PRESET_IDS = ['preset-bridge', 'preset-hermes-host', 'preset-mock', 'preset-claude'] as const;

const LEGACY_NAMES: Record<string, string> = {
  'preset-bridge': 'Hermes (Bridge)',
  'preset-hermes-host': 'Hermes',
  'preset-mock': 'Mock-Server',
  'preset-claude': 'Claude',
};

export type MigrationResult = {
  profiles: StoredProfile[];
  /** the input was not in the current format (caller should write the result back) */
  changed: boolean;
  /** version found in storage (0 = nothing / unreadable) */
  from: number;
  /** something was stored but it is not JSON / not a profile list: the caller quarantines the raw value */
  corrupt?: boolean;
  /** written by a newer app version (`from` > PROFILES_SCHEMA_VERSION): read what we understand, never write back */
  newer?: boolean;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | undefined =>
  typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : undefined;


/** Type-check one stored profile; null = unusable. `legacy` = coming from v1. */
export function sanitizeStoredProfile(raw: unknown, legacy = false): StoredProfile | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id)?.trim();
  if (!id || id === PRESET_DEMO_ID) return null; // the demo profile is built in, never stored as user data
  let kind: ProfileKind | undefined;
  if (legacy) kind = raw.kind === 'claude' || id === 'preset-claude' ? undefined : 'hermes'; // Claude profiles are not part of this build
  else kind = oneOf(raw.kind, PROFILE_KINDS);
  if (!kind || kind === 'demo') return null;

  const baseUrl = (str(raw.baseUrl) ?? '').trim();
  if (kind === 'hermes' && !/^https?:\/\/[^\s/<>]+/i.test(baseUrl)) {
    // only an old preset copy may silently disappear; a user profile with a broken URL stays editable
    if (legacy && (LEGACY_PRESET_IDS as readonly string[]).includes(id)) return null;
  }

  const p: StoredProfile = {
    id,
    kind,
    name: (str(raw.name) ?? '').trim() || LEGACY_NAMES[id] || defaultName(kind),
    baseUrl: kind === 'hermes' ? baseUrl : '',
  };
  const model = str(raw.model)?.trim();
  if (model) p.model = model;
  switch (kind) {
    case 'hermes': {
      const sk = str(raw.sessionKey)?.trim();
      if (sk) p.sessionKey = sk;
      if (raw.bridge === true) p.bridge = true;
      if (raw.syncSessions === false) p.syncSessions = false;
      if (raw.showForeignChats === true) p.showForeignChats = true;
      if (raw.showCronReports === true) p.showCronReports = true;
      break;
    }
  }
  return p;
}

function defaultName(kind: ProfileKind): string {
  return { hermes: 'Hermes', demo: 'Demo' }[kind];
}

/** Parse + migrate whatever is stored under the profiles key. Never throws. */
export function migrateStoredProfiles(raw: string | null | undefined): MigrationResult {
  if (raw == null || raw === '') return { profiles: [], changed: false, from: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { profiles: [], changed: false, from: 0, corrupt: true };
  }
  let list: unknown[];
  let from: number;
  if (Array.isArray(parsed)) {
    list = parsed;
    from = 1;
  } else if (isObj(parsed) && typeof parsed.v === 'number' && Array.isArray(parsed.profiles)) {
    if (parsed.v > PROFILES_SCHEMA_VERSION) {
      // written by a newer app version: read what we understand, do not write back (no data loss on downgrade)
      return { profiles: dedupe(parsed.profiles.map((p) => sanitizeStoredProfile(p))), changed: false, from: parsed.v, newer: true };
    }
    list = parsed.profiles;
    from = parsed.v;
  } else {
    // valid JSON, but no profile list (`{}`, `null`, a string …)
    return { profiles: [], changed: false, from: 0, corrupt: true };
  }
  const legacy = from < 2;
  const profiles = dedupe(list.map((p) => sanitizeStoredProfile(p, legacy)));
  const changed = legacy || stable(profiles) !== stable(list);
  return { profiles, changed, from };
}

/** JSON with sorted object keys (key order must not count as a change). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

function dedupe(list: (StoredProfile | null)[]): StoredProfile[] {
  const seen = new Set<string>();
  const out: StoredProfile[] = [];
  for (const p of list) {
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

export function serializeStoredProfiles(profiles: StoredProfile[]): string {
  return JSON.stringify({ v: PROFILES_SCHEMA_VERSION, profiles });
}
