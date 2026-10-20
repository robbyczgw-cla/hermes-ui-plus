/**
 * Skills & memory ("library"): pure parsing, search and grouping. Erasable TS (node:test, library.test.ts).
 *
 * Sources (docs/SKILLS-MEMORY.md):
 *   GET /v1/skills (Hermes API server, `/p/<bot>/v1/skills`)  {object:'list', data:[{name, description, category}]}
 *     Hermes 0.21.5 to 0.22.2 answer 500 "Failed to enumerate skills" (upstream issue #120831, PR #124861 open).
 *   GET /bridge/library/config|skills|skills/content|memory?bot=  projections of the optional hermes-ui-plus plugin
 *     (read-only; enabled state, source, SKILL.md and MEMORY.md / USER.md entries of the plugin's own profile).
 * Nothing here writes to Hermes: changes to memory go through the agent as a normal chat message.
 */
import { HermesError } from '../hermes/stream.ts';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);

export const SKILL_SOURCES = ['bundled', 'hub', 'external', 'local', 'plugin'] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];

export type LibrarySkill = {
  name: string;
  description?: string;
  category?: string;
  /** only from the plugin; undefined = Hermes does not say */
  enabled?: boolean;
  source?: SkillSource;
};

/** `/v1/skills` rows or the bridge projection (same shape plus `enabled` / `source`). Unknown fields are dropped. */
export function parseSkillList(json: unknown): LibrarySkill[] {
  const data = isObj(json) && Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
  const out: LibrarySkill[] = [];
  const seen = new Set<string>();
  for (const raw of data) {
    if (!isObj(raw)) continue;
    const name = str(raw.name, 200);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const s: LibrarySkill = { name };
    const d = str(raw.description, 1000);
    if (d) s.description = d;
    const c = str(raw.category, 100);
    if (c) s.category = c;
    if (typeof raw.enabled === 'boolean') s.enabled = raw.enabled;
    if (typeof raw.source === 'string' && (SKILL_SOURCES as readonly string[]).includes(raw.source)) s.source = raw.source as SkillSource;
    out.push(s);
  }
  return out;
}

export type SkillDoc = {
  name: string;
  /** SKILL.md without its YAML front matter */
  body: string;
  /** simple `key: value` pairs of the front matter (version, author, tags, …); nested YAML is skipped */
  meta: { key: string; value: string }[];
  truncated: boolean;
};

const META_SKIP = new Set(['name', 'description']);

/** Split SKILL.md into front matter (shown as small facts) and the Markdown body. */
export function parseSkillDoc(json: unknown): SkillDoc | null {
  if (!isObj(json) || typeof json.content !== 'string') return null;
  const name = str(json.name, 200) ?? '';
  let text = json.content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const meta: SkillDoc['meta'] = [];
  const fm = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (fm) {
    text = text.slice(fm[0].length);
    for (const line of fm[1].split('\n')) {
      const m = /^([A-Za-z][\w-]{0,40}):[ \t]*(.+)$/.exec(line);
      if (!m || META_SKIP.has(m[1].toLowerCase())) continue;
      const value = m[2].trim().replace(/^\[(.*)\]$/, '$1').replace(/^["'](.*)["']$/, '$1').trim();
      if (value && value !== '|' && value !== '>' && meta.length < 8) meta.push({ key: m[1], value: value.slice(0, 200) });
    }
  }
  return { name, body: text.trim(), meta, truncated: json.truncated === true };
}

export type MemoryTarget = 'memory' | 'user';
export type MemoryStore = {
  target: MemoryTarget;
  /** the gate in config.yaml (memory.memory_enabled / memory.user_profile_enabled) */
  enabled: boolean;
  entries: string[];
  chars: number;
  /** character budget; 0 = unknown */
  limit: number;
  /** epoch ms of the last change, undefined = file missing */
  updatedAt?: number;
};
export type MemorySnapshot = {
  /** an external memory provider (honcho, mem0, …) is active: its contents are not part of this view */
  provider?: string;
  stores: MemoryStore[];
};

export function parseMemory(json: unknown): MemorySnapshot | null {
  if (!isObj(json) || !Array.isArray(json.stores)) return null;
  const stores: MemoryStore[] = [];
  for (const raw of json.stores) {
    if (!isObj(raw) || (raw.target !== 'memory' && raw.target !== 'user')) continue;
    if (stores.some((s) => s.target === raw.target)) continue;
    const entries = Array.isArray(raw.entries) ? raw.entries.flatMap((e) => (typeof e === 'string' && e.trim() ? [e.trim().slice(0, 4000)] : [])).slice(0, 200) : [];
    const at = typeof raw.updated_at === 'string' ? Date.parse(raw.updated_at) : NaN;
    stores.push({
      target: raw.target,
      enabled: raw.enabled !== false,
      entries,
      chars: int(raw.chars) ?? entries.join('\n§\n').length,
      limit: int(raw.limit) ?? 0,
      ...(Number.isFinite(at) ? { updatedAt: at } : {}),
    });
  }
  // fixed order: what Hermes noted for itself, then what it knows about you
  stores.sort((a, b) => (a.target === b.target ? 0 : a.target === 'memory' ? -1 : 1));
  const provider = str(json.provider, 64);
  return { stores, ...(provider ? { provider } : {}) };
}

export type Availability = { available: boolean; reason?: string };
export type LibraryFeatures = { skills: Availability; memory: Availability };

const REASON_RE = /^[a-z][a-z0-9_]{0,63}$/;
function availability(v: unknown): Availability {
  if (!isObj(v)) return { available: false, reason: 'unknown' };
  if (v.available === true) return { available: true };
  return { available: false, reason: typeof v.reason === 'string' && REASON_RE.test(v.reason) ? v.reason : 'unknown' };
}

/** GET /bridge/library/config */
export function parseFeatures(json: unknown): LibraryFeatures {
  return isObj(json) ? { skills: availability(json.skills), memory: availability(json.memory) } : { skills: availability(null), memory: availability(null) };
}

export const NO_FEATURES: LibraryFeatures = Object.freeze({ skills: { available: false, reason: 'no_bridge' }, memory: { available: false, reason: 'no_bridge' } });

/** Why the skill list could not be loaded → which explanation the screen shows. */
export type SkillsFailure = 'hermesBug' | 'unsupported' | 'auth' | 'offline' | 'failed';

const KNOWN_SKILLS_BUG = /failed to enumerate skills|include_editorial/i;

export function skillsFailure(e: unknown): SkillsFailure {
  if (!(e instanceof HermesError)) return 'failed';
  if (e.kind === 'auth') return 'auth';
  if (e.status === 500 && KNOWN_SKILLS_BUG.test(e.message)) return 'hermesBug';
  if (e.status === 404 || e.status === 405 || e.status === 501) return 'unsupported';
  if (e.kind === 'network' || e.kind === 'timeout') return 'offline';
  return 'failed';
}

/** Lower-case, accents folded: "Übersetzen" finds "ubersetzen" and "uebersetzen" alike. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Search: every word of the query must appear in name, category or description (folded). Name hits rank first,
 * then category, then description; the original order (Hermes: category, name) breaks ties.
 */
export function searchSkills(skills: readonly LibrarySkill[], query: string): LibrarySkill[] {
  const words = fold(query).split(/[\s,]+/).filter(Boolean);
  if (!words.length) return skills.slice();
  const scored: { s: LibrarySkill; score: number; i: number }[] = [];
  skills.forEach((s, i) => {
    const name = fold(s.name);
    const cat = fold(s.category ?? '');
    const desc = fold(s.description ?? '');
    let score = 0;
    for (const w of words) {
      if (name.startsWith(w)) score += 4;
      else if (name.includes(w)) score += 3;
      else if (cat.includes(w)) score += 2;
      else if (desc.includes(w)) score += 1;
      else return;
    }
    scored.push({ s, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.s);
}

export type SkillGroup = { category: string | null; skills: LibrarySkill[] };

/** Sections by category (uncategorized last), names sorted inside a section. */
export function groupSkills(skills: readonly LibrarySkill[]): SkillGroup[] {
  const by = new Map<string | null, LibrarySkill[]>();
  for (const s of skills) {
    const k = s.category ?? null;
    const list = by.get(k);
    if (list) list.push(s);
    else by.set(k, [s]);
  }
  const keys = Array.from(by.keys()).sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
  return keys.map((category) => ({ category, skills: (by.get(category) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)) }));
}

export type SkillCounts = { total: number; off: number };
export function countSkills(skills: readonly LibrarySkill[]): SkillCounts {
  return { total: skills.length, off: skills.filter((s) => s.enabled === false).length };
}

/** A memory entry as it goes into a "forget this" message: one line, at most `max` characters. */
export function quoteEntry(entry: string, max = 300): string {
  const one = entry.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** 0..1 fill level of a store (0 when the limit is unknown). */
export function fillLevel(s: Pick<MemoryStore, 'chars' | 'limit'>): number {
  return s.limit > 0 ? Math.min(1, s.chars / s.limit) : 0;
}
