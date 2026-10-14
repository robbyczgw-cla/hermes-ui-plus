/**
 * `paths` – 2–6 ways / variants / architectures, each a row with a verdict badge, a short chain
 * "A → B → C" and one note line. Pure model (node:test): reads a raw or normalized node through the
 * protocol validator (one source of truth for aliases, caps and tones), builds the chain units and the
 * accessibility label, maps badge tones to theme color keys and composes the select reply.
 */
import { normalizeNode } from '../../../../protocol/validate.ts';
import type { HuiBasis, HuiPathIcon, HuiPathTone } from '../../../types';
import { pathsReply } from '../a/replies.ts';

export type PathStepModel = { label: string; icon?: HuiPathIcon; detail?: string };
export type PathRowModel = { key: string; title: string; badge?: { text: string; tone: HuiPathTone }; path: PathStepModel[]; note?: string };
export type PathsModel = { title?: string; items: PathRowModel[]; select: boolean; basis?: HuiBasis; source?: string };

type Rec = Record<string, unknown>;

/** Model of a (possibly partial / un-normalized) paths node. Never throws; garbage → no rows. */
export function readPaths(node: unknown): PathsModel {
  const raw = node && typeof node === 'object' && !Array.isArray(node) ? (node as Rec) : {};
  const n = normalizeNode({ ...raw, type: 'paths' }) as Rec | null;
  const items = Array.isArray(n?.items) ? (n!.items as Rec[]) : [];
  return {
    title: typeof n?.title === 'string' ? n.title : undefined,
    items: items.map((it) => ({
      key: String(it.id),
      title: String(it.title),
      badge: it.badge as PathRowModel['badge'],
      path: (it.path as PathStepModel[]) ?? [],
      note: typeof it.note === 'string' ? it.note : undefined,
    })),
    select: n?.select === true,
    basis: n?.basis as HuiBasis | undefined,
    source: typeof n?.source === 'string' ? n.source : undefined,
  };
}

/**
 * Chain layout units: every node after the first carries the arrow in FRONT of it, so a wrapping
 * chain never leaves an arrow dangling at a line end – a new line starts with "→ Node".
 */
export type ChainUnit = { step: PathStepModel; arrow: boolean; index: number };
export function chainUnits(path: readonly PathStepModel[]): ChainUnit[] {
  return path.map((step, index) => ({ step, arrow: index > 0, index }));
}

/** "macOS → APFS → SSD" (labels only; what the screen reader reads for the chain) */
export function chainText(path: readonly PathStepModel[]): string {
  return path.map((s) => s.label).join(' → ');
}

/** One label for the whole row: "Native macOS, Ausgangsbasis: macOS → APFS → SSD. Schnell und sicher." */
export function rowA11yLabel(row: PathRowModel): string {
  const head = row.badge ? `${row.title}, ${row.badge.text}` : row.title;
  const chain = chainText(row.path);
  const parts = [chain ? `${head}: ${chain}` : head];
  if (row.note) parts.push(row.note);
  return parts.map((p) => p.trim().replace(/[.:;,]+$/, '')).join('. ') + '.';
}

/** Theme color keys of a badge tone (neutral grey, green good, orange warn, red bad). */
export function badgeColorKeys(tone: HuiPathTone | undefined): { bg: 'surfacePressed' | 'successSoft' | 'warningSoft' | 'dangerSoft'; fg: 'text' | 'success' | 'warning' | 'danger' } {
  switch (tone) {
    case 'good':
      return { bg: 'successSoft', fg: 'success' };
    case 'warn':
      return { bg: 'warningSoft', fg: 'warning' };
    case 'bad':
      return { bg: 'dangerSoft', fg: 'danger' };
    default:
      // stronger than surfaceAlt/muted: in dark themes those were barely lighter than the card (device check)
      return { bg: 'surfacePressed', fg: 'text' };
  }
}

/** Persisted select state: `picked` = row key that was sent (null = open). */
export type PathsState = { picked: string | null; title?: string };
export const INITIAL_PATHS_STATE: PathsState = { picked: null };

/** Reply for the picked row (`[paths:<id>] <title>`), null for an unknown key. */
export function pathsSelectReply(id: string, model: PathsModel, key: string): string | null {
  const row = model.items.find((r) => r.key === key);
  return row ? pathsReply(id, row.title) : null;
}
