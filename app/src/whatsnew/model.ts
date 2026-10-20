/**
 * "What's new" after an update: one short sheet per release that brings user-visible features, shown once per app
 * version, never on a fresh install. Pure (node-tested); storage in storage.ts, the sheet in WhatsNewSheet.tsx.
 *
 * WHATS_NEW is the one list to edit: add a release with its item ids, or drop an id to take a line out. Each id needs
 * its texts (i18n `whatsNew.items.<id>`) and what it opens (ITEMS in WhatsNewSheet.tsx).
 */

export type WhatsNewItemId = 'liveCards' | 'skills' | 'memory';
export type WhatsNewRelease = { version: string; items: readonly WhatsNewItemId[] };

/** newest first is not required; `pickRelease` takes the newest that applies */
export const WHATS_NEW: readonly WhatsNewRelease[] = [{ version: '0.2.0', items: ['liveCards', 'skills', 'memory'] }];

/** `1.2.3` (also `1.2`, `v1.2.3-beta.1`, build suffixes) → [1, 2, 3]; null when it is no version */
export function parseVersion(v: string | null | undefined): [number, number, number] | null {
  const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v ?? '');
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a) ?? [0, 0, 0];
  const y = parseVersion(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export type WhatsNewInput = {
  /** this build's version (app.json) */
  current: string | null | undefined;
  /** the version the user last saw this hint for (or that was installed when it was first checked); null = never */
  seen: string | null;
  /** this device was set up before (onboarding done or an older setup): null `seen` then means an update from a version without the hint */
  existingUser: boolean;
};

export type WhatsNewDecision = {
  /** the release to show now, or null */
  show: WhatsNewRelease | null;
  /** store `current` as seen now (silently, without showing anything) */
  record: boolean;
};

/**
 * - fresh install (nothing seen, never set up): nothing, remember this version
 * - update (seen older than current, or never seen on a set-up device): the newest release after `seen` up to
 *   `current`, if there is one; else just remember the version
 * - same version (or a downgrade): nothing
 */
export function decideWhatsNew(input: WhatsNewInput, releases: readonly WhatsNewRelease[] = WHATS_NEW): WhatsNewDecision {
  const current = input.current;
  if (!current || !parseVersion(current)) return { show: null, record: false };
  if (input.seen === null && !input.existingUser) return { show: null, record: true };
  const seen = input.seen !== null && parseVersion(input.seen) ? input.seen : '0.0.0';
  // same version, or a downgrade: keep the higher one, so its notes never come back
  if (compareVersions(seen, current) >= 0) return { show: null, record: false };
  const show = pickRelease(releases, seen, current);
  return { show, record: !show };
}

/** the newest release with seen < version <= current */
export function pickRelease(releases: readonly WhatsNewRelease[], seen: string, current: string): WhatsNewRelease | null {
  let best: WhatsNewRelease | null = null;
  for (const r of releases) {
    if (!r.items.length || compareVersions(r.version, seen) <= 0 || compareVersions(r.version, current) > 0) continue;
    if (!best || compareVersions(r.version, best.version) > 0) best = r;
  }
  return best;
}

/** the release's items that apply to the open connection, in list order (none apply: the sheet waits) */
export function applicableItems(release: WhatsNewRelease, applies: (id: WhatsNewItemId) => boolean): WhatsNewItemId[] {
  return release.items.filter(applies);
}

/** "0.2.0" → "0.2" for the sheet's caption (patch releases share the minor's notes) */
export function shortVersion(v: string): string {
  const p = parseVersion(v);
  return p ? (p[2] ? `${p[0]}.${p[1]}.${p[2]}` : `${p[0]}.${p[1]}`) : v;
}
