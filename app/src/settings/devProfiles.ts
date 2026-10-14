// Dev-only built-in profiles from EXPO_PUBLIC_DEV_PROFILES (JSON). Pure parser + tested.
// The variable is inlined into the JS bundle by Expo at build time, so it must only be set for
// personal development builds (docs/BUILD.md "Dev profiles"); release builds ship without it.
//
// Format: a JSON array (or a single object) of partial profiles:
//   [{"id":"dev-home","kind":"hermes","name":"Hermes zu Hause","baseUrl":"http://192.0.2.10:8642/v1",
//     "apiKey":"…","bridge":false,"active":true}]
// `id` defaults to `dev-<n>`; `active: true` makes it the default active profile on first start.
import { sanitizeStoredProfile } from './migrate.ts';
import type { ConnectionProfile } from './profiles.ts';

export type DevProfiles = { profiles: ConnectionProfile[]; activeId?: string; error?: string };

export function parseDevProfiles(raw: string | undefined | null): DevProfiles {
  if (!raw || !raw.trim()) return { profiles: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { profiles: [], error: 'EXPO_PUBLIC_DEV_PROFILES is not valid JSON' };
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const profiles: ConnectionProfile[] = [];
  let activeId: string | undefined;
  list.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const o = item as Record<string, unknown>;
    const withId = { ...o, id: typeof o.id === 'string' && o.id.trim() ? o.id : `dev-${i + 1}`, kind: o.kind ?? 'hermes' };
    const p = sanitizeStoredProfile(withId);
    if (!p || profiles.some((x) => x.id === p.id)) return;
    profiles.push({ ...p, apiKey: typeof o.apiKey === 'string' ? o.apiKey.trim() : '' });
    if (o.active === true && !activeId) activeId = p.id;
  });
  return { profiles, activeId };
}
