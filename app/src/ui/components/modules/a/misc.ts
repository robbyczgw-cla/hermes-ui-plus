/**
 * Small pure helpers for modules-a: node ids, choice selection rules, provenance labels,
 * source URLs, timer speech. No React / RN imports (node:test).
 */
import { S_DE, type ModuleStrings } from './text.ts';

type Rec = Record<string, unknown>;

/** Deterministic short hash (djb2, base36). */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function stableJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
}

/**
 * Stable node id: the explicit `id` (normalizeNode guarantees one for interactive nodes), otherwise a
 * content hash so a node without id still persists consistently across renders/reloads.
 */
export function moduleNodeId(type: string, node: Rec | null | undefined): string {
  const id = node && typeof node.id === 'string' ? node.id.trim() : '';
  if (id) return id;
  return `${type}-${hashString(stableJson(node ?? {}))}`;
}

/* ───────────── choice ───────────── */

export type ChoiceLayout = 'list' | 'grid' | 'chips';

export type ChoiceOptionLite = { key: string; label: string; description?: string; icon?: string; imageQuery?: string };

/** Option key: explicit id or protocol fallback `o<index>`. */
export function optionKey(o: Rec, i: number): string {
  const id = typeof o.id === 'string' ? o.id.trim() : typeof o.id === 'number' ? String(o.id) : '';
  return id || `o${i}`;
}

export function readOptions(raw: unknown): ChoiceOptionLite[] {
  if (!Array.isArray(raw)) return [];
  const out: ChoiceOptionLite[] = [];
  const seen = new Set<string>();
  raw.forEach((x, i) => {
    let o: Rec | null = null;
    if (typeof x === 'string') o = { label: x };
    else if (x && typeof x === 'object' && !Array.isArray(x)) o = x as Rec;
    if (!o) return;
    const label = typeof o.label === 'string' ? o.label : typeof o.label === 'number' ? String(o.label) : '';
    if (!label.trim()) return;
    let key = optionKey(o, i);
    while (seen.has(key)) key = `${key}_`;
    seen.add(key);
    out.push({
      key,
      label,
      description: typeof o.description === 'string' && o.description ? o.description : undefined,
      icon: typeof o.icon === 'string' && o.icon ? o.icon : undefined,
      imageQuery: typeof o.imageQuery === 'string' && o.imageQuery ? o.imageQuery : undefined,
    });
  });
  return out;
}

/** Explicit layout wins; images → grid; short plain labels → chips; else list. */
export function pickChoiceLayout(explicit: unknown, options: readonly ChoiceOptionLite[]): ChoiceLayout {
  if (explicit === 'list' || explicit === 'grid' || explicit === 'chips') return explicit;
  if (options.some((o) => o.imageQuery)) return 'grid';
  if (options.length <= 8 && options.every((o) => !o.description && !o.imageQuery && o.label.length <= 22)) return 'chips';
  return 'list';
}

export type SelectionRules = { multiple: boolean; min: number; max: number };

/** Normalise min/max: single → 1/1; multi → min ≥ 1 (≤ max), max ≤ available. */
export function selectionRules(multiple: unknown, min: unknown, max: unknown, available: number): SelectionRules {
  if (multiple !== true) return { multiple: false, min: 1, max: 1 };
  const avail = Math.max(1, available);
  const mx = typeof max === 'number' && Number.isFinite(max) && max >= 1 ? Math.min(Math.floor(max), avail) : avail;
  const mn = typeof min === 'number' && Number.isFinite(min) && min >= 1 ? Math.min(Math.floor(min), mx) : 1;
  return { multiple: true, min: mn, max: mx };
}

/** Toggle `key` in a multi selection, respecting `max`. Returns null if the max is reached. */
export function toggleSelection(selected: readonly string[], key: string, rules: SelectionRules): string[] | null {
  if (selected.includes(key)) return selected.filter((k) => k !== key);
  if (selected.length >= rules.max) return null;
  return [...selected, key];
}

export function canSubmitSelection(count: number, rules: SelectionRules): boolean {
  return count >= rules.min && count <= rules.max;
}

/* ───────────── provenance ───────────── */

export type Basis = 'user' | 'sourced' | 'calculated' | 'estimate' | 'illustrative';
const BASES: readonly Basis[] = ['user', 'sourced', 'calculated', 'estimate', 'illustrative'];

export type ProvenanceInfo = {
  basis?: Basis;
  /** chip text, e.g. "Schätzung · Quelle: destatis.de" */
  label: string;
  /** 'caution' for estimates / illustrative values */
  tone: 'neutral' | 'caution' | 'info';
  /** tappable http(s) URL if `source` is one */
  url?: string;
};

/** Chip content for `{basis?, source?}`; null when the node carries no provenance. */
export function provenanceInfo(basis: unknown, source: unknown, S: ModuleStrings = S_DE): ProvenanceInfo | null {
  const b = BASES.includes(basis as Basis) ? (basis as Basis) : undefined;
  const src = typeof source === 'string' ? source.trim() : '';
  if (!b && !src) return null;
  const url = src && isHttpUrl(src) ? src : undefined;
  // B7: in free-text sources a full URL shows as its domain (complete, never ellipsised mid-host);
  // the long title/path part is what gets dropped, not the domain
  const srcText = url ? domainOf(url) : src.replace(/https?:\/\/[^\s,;)\]]+/gi, (m) => domainOf(m) || m);
  const parts: string[] = [];
  if (b && !(b === 'sourced' && srcText)) parts.push(S.provenance[b]);
  if (srcText) parts.push(S.provenance.source(srcText));
  const tone = b === 'estimate' || b === 'illustrative' ? 'caution' : b === 'calculated' || b === 'user' ? 'info' : 'neutral';
  return { basis: b, label: parts.join(' · '), tone, url };
}

/* ───────────── sources ───────────── */

export function isHttpUrl(s: string): boolean {
  return /^https?:\/\/[^\s/?#@]+\.[^\s/?#@]+([/?#][^\s]*)?$/i.test(s.trim());
}

/** "https://www.spiegel.de/a/b" → "spiegel.de"; invalid → ''. */
export function domainOf(url: string): string {
  const m = /^https?:\/\/([^/?#\s]+)/i.exec(url.trim());
  if (!m) return '';
  const host = m[1].replace(/:\d+$/, '').toLowerCase();
  if (host.includes('@')) return '';
  return host.replace(/^www\d?\./, '');
}

/** The site's own favicon (no third-party favicon service). */
export function faviconUrl(url: string): string | undefined {
  const m = /^(https?):\/\/([^/?#\s@]+)/i.exec(url.trim());
  return m ? `${m[1].toLowerCase()}://${m[2]}/favicon.ico` : undefined;
}

/* ───────────── timer ───────────── */

export function spokenDuration(totalSeconds: number, S: ModuleStrings = S_DE): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return S.timer.spoken(Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60);
}
