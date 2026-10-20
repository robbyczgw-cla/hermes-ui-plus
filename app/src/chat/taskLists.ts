/**
 * GFM task lists in a plain Markdown answer (`- [ ] Penne, 500 g` / `- [x] Milch`) become the app's interactive
 * `checklist` (tick, "An Hermes senden", "Als Live-Karte weiterführen"), so a normal model that answers "Einkaufsliste
 * zum Abhaken" in Markdown still gets a list the user can tick (real-user round 2: Haiku wrote a Markdown task list and
 * then told the user the boxes may not be tappable "in your app"). Only finished answers; code fences are left alone.
 * Pure (node:test).
 */
import { normalizeNode } from '../protocol/validate.ts';
import type { HuiNode } from '../protocol/types.ts';

export type TaskPart = { kind: 'md'; text: string } | { kind: 'tasks'; key: string; node: HuiNode };

const TASK_RE = /^ {0,3}[-*+] +\[( |x|X)\] +(\S.*)$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
/** a list is a task list from this many items on (one box alone is usually prose) */
export const MIN_TASK_ITEMS = 2;

/** stable short hash (FNV-1a) of the list's texts: the checklist id, so its ticks persist across renders */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Markdown with its task lists split out as checklist nodes, in order; a text without one: a single `md` part. */
export function splitTaskLists(text: string): TaskPart[] {
  const lines = text.split('\n');
  const out: TaskPart[] = [];
  let md: string[] = [];
  let fence: string | null = null;
  let n = 0;
  const flushMd = () => {
    const t = md.join('\n');
    if (t.trim()) out.push({ kind: 'md', text: t.replace(/^\n+|\n+$/g, '') });
    md = [];
  };
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    const f = FENCE_RE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      md.push(line);
      i++;
      continue;
    }
    if (f) {
      fence = f[1];
      md.push(line);
      i++;
      continue;
    }
    const items: { text: string; checked: boolean }[] = [];
    let j = i;
    for (; j < lines.length; j++) {
      const m = TASK_RE.exec(lines[j]);
      if (!m) break;
      items.push({ text: m[2].trim(), checked: m[1] !== ' ' });
    }
    if (items.length >= MIN_TASK_ITEMS) {
      flushMd();
      const id = `md-tasks-${n++}-${hash(items.map((x) => x.text).join('\n'))}`;
      const node = normalizeNode({ type: 'checklist', id, items: items.map((x) => ({ text: x.text, ...(x.checked ? { checked: true } : {}) })) });
      if (node) out.push({ kind: 'tasks', key: id, node });
      else md.push(...lines.slice(i, j));
      i = j;
      continue;
    }
    md.push(line);
    i++;
  }
  flushMd();
  return out.length ? out : [{ kind: 'md', text }];
}

const cache = new Map<string, TaskPart[]>();
/** splitTaskLists with a small cache (finished answers re-render with the same text) */
export function splitTaskListsCached(text: string): TaskPart[] {
  const hit = cache.get(text);
  if (hit) return hit;
  const parts = splitTaskLists(text);
  if (cache.size > 100) cache.delete(cache.keys().next().value as string);
  cache.set(text, parts);
  return parts;
}

/** Cheap pre-check: the text may hold a task list. */
export function mayHaveTaskList(text: string): boolean {
  return text.includes('[ ]') || text.includes('[x]') || text.includes('[X]');
}
