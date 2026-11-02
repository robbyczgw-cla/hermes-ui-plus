/**
 * "Über <Name>", complete (Bots v2 slice 4, bots/BotInfoSheet.tsx): pure, erasable TS (node:test).
 *
 * - "Merkt sich" / "Kann": a short summary of the bot's memory and skills (library/source.ts reads them through the
 *   bridge and the hermes-ui-plus plugin, which reads other profiles from the default profile's process).
 * - "Immer erlaubt": the bot's `command_allowlist` (Hermes stores categories such as "delete in root path", not single
 *   commands), each with "Widerrufen" (bridge `/bridge/bots/<name>/allowlist`, right `bots.manage`).
 * - "Benachrichtigungen": all / needed / off per bot and device (bots/notify.ts).
 * - "Bot archivieren": Hermes' `gateway.parked` through the plugin; the bot leaves the list until restored.
 * Every unknown state has its own reason, so the sheet never shows an empty gap.
 */
import type { LibraryFeatures, LibrarySkill, MemorySnapshot } from '../library/model.ts';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const REASON = /^[a-z][a-z0-9_]{0,63}$/;
const reasonOf = (v: unknown, d = 'unknown') => (typeof v === 'string' && REASON.test(v) ? v : d);
const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

// ------------------------------------------------------------------ "Merkt sich"

export type MemorySummary =
  | { kind: 'ready'; count: number; first: string; provider?: string }
  | { kind: 'empty'; provider?: string }
  /** memory switched off in the bot's config.yaml (both stores) */
  | { kind: 'disabled' }
  /** not readable here: plugin missing, memory not exposed (library.expose_memory), another bot's plugin, … */
  | { kind: 'unavailable'; reason: string }
  | { kind: 'failed' };

/** Count and first line of what the bot remembers: "Über dich" entries first (they are about the user), then its notes. */
export function memorySummary(features: LibraryFeatures | null, snapshot: MemorySnapshot | null | undefined, failed = false): MemorySummary {
  if (failed) return { kind: 'failed' };
  if (!features) return { kind: 'unavailable', reason: 'unknown' };
  if (!features.memory.available) return { kind: 'unavailable', reason: reasonOf(features.memory.reason) };
  if (!snapshot) return { kind: 'unavailable', reason: 'unknown' };
  const provider = snapshot.provider ? { provider: snapshot.provider } : {};
  const on = snapshot.stores.filter((s) => s.enabled);
  if (snapshot.stores.length && !on.length) return { kind: 'disabled' };
  const ordered = [...on.filter((s) => s.target === 'user'), ...on.filter((s) => s.target !== 'user')];
  const entries = ordered.flatMap((s) => s.entries);
  if (!entries.length) return { kind: 'empty', ...provider };
  return { kind: 'ready', count: entries.length, first: oneLine(entries[0], 120), ...provider };
}

// ------------------------------------------------------------------ "Kann"

export type SkillsSummary =
  | { kind: 'ready'; count: number; off: number; names: string[]; full: boolean }
  | { kind: 'empty' }
  | { kind: 'failed'; reason: string };

/** `full`: the list comes from the plugin (enabled state known); else Hermes' plain list of this profile. */
export function skillsSummary(skills: readonly LibrarySkill[] | null, via: 'plugin' | 'api' | 'demo' | null, failure?: string): SkillsSummary {
  if (failure) return { kind: 'failed', reason: failure };
  if (!skills) return { kind: 'failed', reason: 'failed' };
  const on = skills.filter((s) => s.enabled !== false);
  if (!skills.length) return { kind: 'empty' };
  return { kind: 'ready', count: on.length, off: skills.length - on.length, names: on.slice(0, 3).map((s) => s.name), full: via !== 'api' };
}

// ------------------------------------------------------------------ "Immer erlaubt"

export type AllowEntry = { pattern: string; description?: string };
export type ManageRight = { allowed: true } | { allowed: false; reason: string };
/** `omitted`: entries the server left out (too long, control characters, over its cap): said, never silently gone */
export type AllowList = { entries: AllowEntry[]; manage: ManageRight; omitted: number };

export function parseManage(v: unknown): ManageRight {
  if (!isObj(v)) return { allowed: false, reason: 'unknown' };
  return v.allowed === true ? { allowed: true } : { allowed: false, reason: reasonOf(v.reason) };
}

/** `GET /bridge/bots/<name>/allowlist` (also the revoke answer). null = not an allow-list answer. */
export function parseAllowList(json: unknown): AllowList | null {
  if (!isObj(json) || !Array.isArray(json.entries)) return null;
  const seen = new Set<string>();
  const entries: AllowEntry[] = [];
  for (const raw of json.entries) {
    const e = isObj(raw) ? raw : typeof raw === 'string' ? { pattern: raw } : null;
    if (!e || typeof e.pattern !== 'string') continue;
    const pattern = e.pattern.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
    if (!pattern || seen.has(pattern)) continue;
    seen.add(pattern);
    const description = typeof e.description === 'string' && e.description.trim() ? oneLine(e.description, 200) : undefined;
    entries.push({ pattern, ...(description && description !== pattern ? { description } : {}) });
    if (entries.length >= 200) break;
  }
  const omitted = typeof json.omitted === 'number' && Number.isFinite(json.omitted) && json.omitted > 0 ? Math.floor(json.omitted) : 0;
  return { entries, manage: parseManage(json.manage), omitted };
}

/**
 * Plain words for Hermes' approval categories (tools/approval_detection.py DANGEROUS_PATTERNS descriptions, v0.22.2). Unknown ones are
 * shown as Hermes wrote them: they are already short English phrases.
 */
export const ALLOW_LABEL_KEYS: Readonly<Record<string, string>> = {
  'delete in root path': 'rootDelete',
  'recursive delete': 'recursiveDelete',
  'recursive delete (long flag)': 'recursiveDelete',
  'recursive delete (flags after operands)': 'recursiveDelete',
  'world/other-writable permissions': 'worldWritable',
  'recursive chmod': 'recursiveChmod',
  'format filesystem': 'formatFs',
  'disk copy': 'diskCopy',
  'write to block device': 'blockDevice',
  'SQL DROP': 'sqlDrop',
  'SQL DELETE without WHERE': 'sqlDelete',
  'SQL TRUNCATE': 'sqlTruncate',
  'overwrite system config': 'systemConfig',
  'stop/restart system service': 'service',
  'kill all processes': 'killAll',
  'fork bomb': 'forkBomb',
  'pipe remote content to shell': 'pipeShell',
  'git force push (rewrites remote history)': 'gitForcePush',
  'git force push short flag (rewrites remote history)': 'gitForcePush',
  'git reset --hard (destroys uncommitted changes)': 'gitResetHard',
};

/** i18n key suffix (`bots.info.allowed.labels.<key>`) of a category, or null (show the pattern as is). */
export function allowLabelKey(e: AllowEntry): string | null {
  return ALLOW_LABEL_KEYS[e.description ?? e.pattern] ?? ALLOW_LABEL_KEYS[e.pattern] ?? null;
}

// ------------------------------------------------------------------ archive / restore

export type ArchivedBot = { name: string; label?: string; color?: string };

/** `archived` of `GET /bridge/bots` (our own archived bots, restorable). */
export function parseArchived(v: unknown): ArchivedBot[] {
  if (!Array.isArray(v)) return [];
  const out: ArchivedBot[] = [];
  for (const r of v) {
    if (!isObj(r) || typeof r.name !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(r.name) || r.name === 'default') continue;
    if (out.some((x) => x.name === r.name)) continue;
    const label = typeof r.label === 'string' && r.label.trim() ? oneLine(r.label, 40) : undefined;
    const color = typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color.toLowerCase() : undefined;
    out.push({ name: r.name, ...(label ? { label } : {}), ...(color ? { color } : {}) });
  }
  return out;
}

/** Why a write (revoke, archive, restore) is refused: the message key under `bots.info.manage.*`. */
export function manageReasonKey(reason: string): string {
  switch (reason) {
    case 'owner_off':
    case 'bridge_off':
      return 'ownerOff';
    case 'device_forbidden':
      return 'device';
    case 'plugin_not_configured':
    case 'plugin_unreachable':
    case 'plugin_unsupported':
    case 'hermes_unsupported':
    case 'not_root_profile':
    case 'multiplex_off':
    case 'disabled_by_config':
      return 'plugin';
    default:
      return 'other';
  }
}
