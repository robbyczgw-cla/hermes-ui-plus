/**
 * `mindmap` logic (docs/SPEC-modules-v4.md): defensive reader (same id/limit scheme as
 * normalizeNode), default collapse, label wrapping, a pure two-sided ("balanced") or one-sided
 * left-to-right tree layout with bezier edges, best-layout choice for a viewport, fit-to-screen and
 * zoom math, and the outline (screen reader) rows. Pure (node:test).
 */
import { oneLine } from '../a/replies.ts';

type Rec = Record<string, unknown>;

export const MAX_DEPTH = 4;
export const MAX_NODES = 60;

export type MindNode = { id: string; label: string; note?: string; depth: number; branch: number; children: MindNode[] };

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** Tree from a (raw or normalized) node; null when not even the root label is there yet. */
export function readMindmap(node: Rec | null | undefined): { title?: string; root: MindNode | null; count: number } {
  const n = node ?? {};
  const used = new Set<string>();
  let budget = MAX_NODES;
  const walk = (r: unknown, depth: number, path: string, branch: number): MindNode | null => {
    if (!isRec(r) || budget <= 0) return null;
    const label = str(r.label);
    if (!label) return null;
    budget--;
    let id = str(r.id) || path;
    while (used.has(id)) id = `${id}~`;
    used.add(id);
    const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim() : undefined;
    const out: MindNode = { id, label, ...(note ? { note } : {}), depth, branch, children: [] };
    if (Array.isArray(r.children) && depth < MAX_DEPTH) {
      r.children.forEach((c, i) => {
        const k = walk(c, depth + 1, `${path}-${i}`, depth === 0 ? out.children.length : branch);
        if (k) out.children.push(k);
      });
    }
    return out;
  };
  const root = walk(n.root, 0, 'm', -1);
  const title = str(n.title);
  return { ...(title ? { title } : {}), root, count: MAX_NODES - budget };
}

export function walkTree(root: MindNode, fn: (n: MindNode, parent: MindNode | null) => void): void {
  const go = (n: MindNode, p: MindNode | null) => {
    fn(n, p);
    n.children.forEach((c) => go(c, n));
  };
  go(root, null);
}

export function countNodes(root: MindNode | null): number {
  let c = 0;
  if (root) walkTree(root, () => c++);
  return c;
}

/** Collapse overrides (persisted): id → true = collapsed, false = expanded. */
export type Collapse = Record<string, boolean>;

/** Large maps start with level-2 nodes folded (root + 2 levels visible); small ones fully open. */
export function isCollapsed(n: MindNode, overrides: Readonly<Collapse>, total: number): boolean {
  if (!n.children.length) return false;
  const o = overrides[n.id];
  if (o !== undefined) return o;
  return total > 24 && n.depth >= 2;
}

export function hiddenCount(n: MindNode): number {
  return countNodes(n) - 1;
}

/* ───────────── label boxes ───────────── */

/** Greedy word wrap to ≤ `maxLines` lines of ≈ `maxChars`; overflow ends with "…". Long words are cut. */
export function wrapLabel(label: string, maxChars: number, maxLines: number): string[] {
  const words = oneLine(label).split(' ').filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  let i = 0;
  for (; i < words.length; i++) {
    let w = words[i];
    if (w.length > maxChars) w = `${w.slice(0, Math.max(1, maxChars - 1))}…`;
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && cur) {
    lines.push(cur);
    cur = '';
    i++;
  }
  if (i < words.length || cur) {
    const last = lines[lines.length - 1] ?? '';
    lines[lines.length - 1] = `${last.length >= maxChars ? last.slice(0, maxChars - 1) : last}…`;
  }
  return lines;
}

export type BoxMetrics = { fontSize: number; lineHeight: number; maxChars: number; maxLines: number; padX: number; padY: number; minW: number; /** average glyph width in em (default 0.62; bold ≈ 0.66) */ charW?: number };

/** Approximate box for a label (average glyph width ≈ 0.62 em for the system sans fonts, a bit generous). */
export function measureLabel(label: string, m: BoxMetrics): { lines: string[]; w: number; h: number } {
  const lines = wrapLabel(label, m.maxChars, m.maxLines);
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const w = Math.max(m.minW, Math.ceil(longest * m.fontSize * (m.charW ?? 0.68) + m.padX * 2));
  const h = Math.ceil(lines.length * m.lineHeight + m.padY * 2);
  return { lines, w, h };
}

/* ───────────── layout ───────────── */

export type LayoutMode = 'balanced' | 'right';

export type LaidNode = {
  id: string;
  label: string;
  lines: string[];
  note?: string;
  depth: number;
  branch: number;
  /** +1 right of the root, -1 left (root: +1) */
  side: 1 | -1;
  /** box top-left + size, in content coordinates (0,0 = bounds origin) */
  x: number;
  y: number;
  w: number;
  h: number;
  hasChildren: boolean;
  collapsed: boolean;
  hidden: number;
  parent: string | null;
};
export type LaidEdge = { from: string; to: string; branch: number; depth: number; d: string };
export type Layout = { nodes: LaidNode[]; edges: LaidEdge[]; width: number; height: number; mode: LayoutMode };

export type LayoutOptions = {
  mode: LayoutMode;
  metrics: (depth: number) => BoxMetrics;
  /** horizontal gap parent → child */
  hGap: number;
  /** vertical gap between sibling subtrees */
  vGap: number;
  /** outer margin */
  margin: number;
  collapsed: (n: MindNode) => boolean;
};

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Tidy tree: each visible subtree gets the height of max(own box, stacked children); children are
 * centred on their parent. `balanced` splits the root's children into a right and a left column
 * group with similar total height (order kept: first ones right, clockwise like a classic mind map).
 */
export function layoutMindmap(root: MindNode, o: LayoutOptions): Layout {
  type Tmp = { n: MindNode; w: number; h: number; lines: string[]; kids: Tmp[]; sub: number; collapsed: boolean };
  const build = (n: MindNode): Tmp => {
    const box = measureLabel(n.label, o.metrics(n.depth));
    const collapsed = o.collapsed(n);
    const kids = collapsed ? [] : n.children.map(build);
    const stacked = kids.reduce((s, k) => s + k.sub, 0) + Math.max(0, kids.length - 1) * o.vGap;
    return { n, w: box.w, h: box.h, lines: box.lines, kids, sub: Math.max(box.h, stacked), collapsed };
  };
  const tr = build(root);

  // split root children
  let right = tr.kids;
  let left: Tmp[] = [];
  if (o.mode === 'balanced' && tr.kids.length > 1) {
    const total = tr.kids.reduce((s, k) => s + k.sub, 0);
    let acc = 0;
    let cut = tr.kids.length;
    for (let i = 0; i < tr.kids.length; i++) {
      // keep at least one on each side; cut where the right group reaches about half the height
      if (i > 0 && acc + tr.kids[i].sub / 2 > total / 2) {
        cut = i;
        break;
      }
      acc += tr.kids[i].sub;
    }
    if (cut >= tr.kids.length) cut = tr.kids.length - 1;
    right = tr.kids.slice(0, cut);
    // left side reads top→bottom too, but continuing clockwise means reversed order
    left = tr.kids.slice(cut).reverse();
  }

  const nodes: LaidNode[] = [];
  const edges: LaidEdge[] = [];
  const centre = new Map<string, { cx: number; cy: number; w: number; side: 1 | -1 }>();

  const place = (t: Tmp, cx: number, cy: number, side: 1 | -1, parent: string | null) => {
    nodes.push({
      id: t.n.id,
      label: t.n.label,
      lines: t.lines,
      ...(t.n.note ? { note: t.n.note } : {}),
      depth: t.n.depth,
      branch: t.n.branch,
      side,
      x: cx - t.w / 2,
      y: cy - t.h / 2,
      w: t.w,
      h: t.h,
      hasChildren: t.n.children.length > 0,
      collapsed: t.collapsed,
      hidden: t.collapsed ? hiddenCount(t.n) : 0,
      parent,
    });
    centre.set(t.n.id, { cx, cy, w: t.w, side });
  };

  const stack = (kids: Tmp[], parentCx: number, parentW: number, cy: number, side: 1 | -1, parentId: string) => {
    const total = kids.reduce((s, k) => s + k.sub, 0) + Math.max(0, kids.length - 1) * o.vGap;
    let top = cy - total / 2;
    for (const k of kids) {
      const kcy = top + k.sub / 2;
      const kcx = parentCx + side * (parentW / 2 + o.hGap + k.w / 2);
      place(k, kcx, kcy, side, parentId);
      stack(k.kids, kcx, k.w, kcy, side, k.n.id);
      top += k.sub + o.vGap;
    }
  };

  place(tr, 0, 0, 1, null);
  stack(right, 0, tr.w, 0, 1, tr.n.id);
  stack(left, 0, tr.w, 0, -1, tr.n.id);

  // bounds → shift to positive coordinates
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  const dx = o.margin - minX;
  const dy = o.margin - minY;
  for (const n of nodes) {
    n.x = r1(n.x + dx);
    n.y = r1(n.y + dy);
  }
  for (const n of nodes) {
    if (!n.parent) continue;
    const p = centre.get(n.parent)!;
    const c = centre.get(n.id)!;
    // parent's outer edge (root: its side edge) → child's inner edge, horizontal tangents
    const x1 = p.cx + c.side * (p.w / 2) + dx;
    const y1 = p.cy + dy;
    const x2 = c.cx - c.side * (c.w / 2) + dx;
    const y2 = c.cy + dy;
    const mx = (x1 + x2) / 2;
    edges.push({ from: n.parent, to: n.id, branch: n.branch, depth: n.depth, d: `M${r1(x1)} ${r1(y1)} C${r1(mx)} ${r1(y1)} ${r1(mx)} ${r1(y2)} ${r1(x2)} ${r1(y2)}` });
  }
  return { nodes, edges, width: r1(maxX - minX + o.margin * 2), height: r1(maxY - minY + o.margin * 2), mode: o.mode };
}

/* ───────────── viewport math ───────────── */

export type View = { s: number; tx: number; ty: number };

export const MIN_SCALE = 0.3;
export const MAX_SCALE = 2.5;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Scale (≤ 1, never upscaling) + offset that centre the whole content in the viewport. */
export function fitView(cw: number, ch: number, vw: number, vh: number, pad = 8, maxScale = 1): View {
  if (cw <= 0 || ch <= 0 || vw <= 0 || vh <= 0) return { s: 1, tx: 0, ty: 0 };
  const s = clamp(Math.min((vw - pad * 2) / cw, (vh - pad * 2) / ch, maxScale), MIN_SCALE, MAX_SCALE);
  return { s, tx: (vw - cw * s) / 2, ty: (vh - ch * s) / 2 };
}

/** Zoom by `factor` keeping the viewport point (fx, fy) fixed. */
export function zoomAt(v: View, factor: number, fx: number, fy: number): View {
  const s = clamp(v.s * factor, MIN_SCALE, MAX_SCALE);
  const k = s / v.s;
  return { s, tx: fx - (fx - v.tx) * k, ty: fy - (fy - v.ty) * k };
}

/** Scale the content gets when fitted to the viewport width (used for choosing the layout + height). */
export function widthScale(l: Layout, vw: number): number {
  return Math.min(1, vw / Math.max(1, l.width));
}

/**
 * Viewport height for a layout at viewport width `vw`: content height at the width-fit scale,
 * clamped to [minH, maxH].
 */
export function viewportHeight(l: Layout, vw: number, minH: number, maxH: number): number {
  return Math.round(clamp(l.height * widthScale(l, vw) + 16, minH, maxH));
}

/** Pick the layout that is readable at the largest scale inside a viewport of (vw, maxH). */
export function pickLayout(candidates: readonly Layout[], vw: number, maxH: number): Layout {
  let best = candidates[0];
  let bestS = -1;
  for (const l of candidates) {
    const s = Math.min(vw / Math.max(1, l.width), maxH / Math.max(1, l.height), 1);
    if (s > bestS + 0.02) {
      best = l;
      bestS = s;
    }
  }
  return best;
}

/* ───────────── outline ───────────── */

export type OutlineRow = { id: string; label: string; note?: string; depth: number; branch: number; hasChildren: boolean; collapsed: boolean; path: string };

/** Visible rows in pre-order (children of collapsed nodes skipped); `path` = "1.2.3" numbering. */
export function outlineRows(root: MindNode, collapsed: (n: MindNode) => boolean): OutlineRow[] {
  const out: OutlineRow[] = [];
  const go = (n: MindNode, path: string) => {
    const c = collapsed(n);
    out.push({ id: n.id, label: n.label, ...(n.note ? { note: n.note } : {}), depth: n.depth, branch: n.branch, hasChildren: n.children.length > 0, collapsed: c, path });
    if (!c) n.children.forEach((k, i) => go(k, path ? `${path}.${i + 1}` : `${i + 1}`));
  };
  go(root, '');
  return out;
}

/** `[mindmap] Erkläre „<label>“ genauer` (no id needed). */
export function deepenReply(label: string): string {
  return `[mindmap] Erkläre „${oneLine(label)}“ genauer`;
}

export function findNode(root: MindNode | null, id: string): MindNode | null {
  let hit: MindNode | null = null;
  if (root) walkTree(root, (n) => {
    if (!hit && n.id === id) hit = n;
  });
  return hit;
}
