/**
 * `changes` – pure model (node:test): files touched by an agent turn. Counts come from the node, else from the file's
 * diff (own `patch` / `hunks`, or its section of the node's combined `patch`, matched by path). A file with a diff
 * opens it on tap.
 */
import type { HuiChangedFile, HuiChanges, HuiFileStatus } from '../../../types';
import { fileFromJson, parseUnifiedDiff, type DiffFileModel } from './diffModel.ts';

export type ChangeRow = {
  key: string;
  path: string;
  oldPath?: string;
  status: HuiFileStatus;
  additions?: number;
  deletions?: number;
  binary: boolean;
  /** touched by the agent (the "<agent> only" filter) */
  byAgent?: boolean;
  /** the file's diff (null = none, the row is not tappable) */
  diff: DiffFileModel | null;
};
export type ChangesModel = {
  title?: string;
  summary?: string;
  rows: ChangeRow[];
  additions: number;
  deletions: number;
  /** files per status */
  counts: Record<HuiFileStatus, number>;
};

const combinedCache = new Map<string, DiffFileModel[]>();

/** the combined patch parsed once per text (a small LRU: the same answer mounts several times) */
function combined(patch: string | undefined): DiffFileModel[] {
  if (!patch) return [];
  const hit = combinedCache.get(patch);
  if (hit) return hit;
  const files = parseUnifiedDiff(patch);
  combinedCache.set(patch, files);
  if (combinedCache.size > 8) combinedCache.delete(combinedCache.keys().next().value as string);
  return files;
}

/** per file object of the node (the stream parser keeps unchanged files' identity): its diff is built once */
const ownCache = new WeakMap<HuiChangedFile, DiffFileModel>();

function ownDiff(f: HuiChangedFile, i: number): DiffFileModel | null {
  if (!f.hunks?.length && typeof f.patch !== 'string') return null;
  const hit = ownCache.get(f);
  if (hit && hit.key === `j${i}`) return hit;
  const d = fileFromJson({ path: f.path, oldPath: f.oldPath, status: f.status, hunks: f.hunks, patch: f.patch, binary: f.binary }, i);
  ownCache.set(f, d);
  return d;
}

/**
 * Model of a (normalized, possibly partial) changes node. `patchFiles` = the node's combined `patch` already parsed
 * (the view parses a streaming patch incrementally); left out, it is parsed here (cached per text).
 */
export function readChanges(node: Partial<HuiChanges>, patchFiles?: readonly DiffFileModel[]): ChangesModel {
  const files = Array.isArray(node.files) ? node.files : [];
  const fromPatch = patchFiles ?? combined(typeof node.patch === 'string' ? node.patch : undefined);
  const byPath = new Map<string, DiffFileModel>();
  for (const d of fromPatch) {
    byPath.set(d.path, d);
    if (d.oldPath && !byPath.has(d.oldPath)) byPath.set(d.oldPath, d);
  }
  const counts: Record<HuiFileStatus, number> = { added: 0, modified: 0, deleted: 0, renamed: 0 };
  let additions = 0;
  let deletions = 0;
  const rows: ChangeRow[] = [];
  const listed = new Set<string>();
  files.forEach((f, i) => {
    if (!f || typeof f.path !== 'string') return;
    const diff = ownDiff(f, i) ?? byPath.get(f.path) ?? null;
    const status = f.status ?? diff?.status ?? 'modified';
    const a = f.additions ?? diff?.additions;
    const d = f.deletions ?? diff?.deletions;
    counts[status]++;
    additions += a ?? 0;
    deletions += d ?? 0;
    listed.add(f.path);
    rows.push({ key: `c${i}`, path: f.path, oldPath: f.oldPath ?? diff?.oldPath, status, additions: a, deletions: d, binary: f.binary === true || diff?.binary === true, byAgent: f.byAgent, diff });
  });
  // no file list: the combined patch alone lists the files
  if (!files.length) {
    fromPatch.forEach((d, i) => {
      if (!d.path || listed.has(d.path)) return;
      counts[d.status]++;
      additions += d.additions;
      deletions += d.deletions;
      rows.push({ key: `p${i}`, path: d.path, oldPath: d.oldPath, status: d.status, additions: d.additions, deletions: d.deletions, binary: d.binary, diff: d });
    });
  }
  return { title: node.title, summary: node.summary, rows, additions, deletions, counts };
}

/** collapsed list: this many rows, then "show all" */
export const CHANGES_PREVIEW = 12;
