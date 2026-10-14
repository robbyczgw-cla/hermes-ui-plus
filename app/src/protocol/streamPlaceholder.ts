/**
 * What a ```hui segment should show at every streaming stage (pure, UI-free, tested):
 *
 * - "```hui\n" only, `{`, `{"type":"` …     → skeleton (shape from the router hint, else generic)
 * - `{"type":"chec` (partial type string)    → skeleton shaped like the unique known type with
 *                                              that prefix ("checklist"), else the router hint
 * - known type, partial fields               → the node (components render their own skeletons /
 *                                              progressive fill-in while `streaming`)
 * - complete but unusable                    → error
 *
 * A started block therefore never renders as nothing.
 */
import { HUI_NODE_TYPES, type HuiNode, type Segment } from './types.ts';

/** A node type (`checklist`, `table` …), a router-only format (`diagram`, `calculator` …) or `generic`. */
export type SkeletonShape = string;

export type HuiStreamView =
  | { kind: 'node'; node: HuiNode }
  | { kind: 'skeleton'; shape: SkeletonShape }
  | { kind: 'error'; error?: string };

/**
 * Router decision → skeleton shape. A `component` that names a node type wins over the coarse
 * `format` (`format=choice component=slots` → slots, `format=quiz component=flashcards` →
 * flashcards). `text` (no component expected) → undefined; a started block then shows a generic
 * skeleton.
 */
export function skeletonShapeForRoute(format: string | null | undefined, component?: string | null): SkeletonShape | undefined {
  if (component && (HUI_NODE_TYPES as readonly string[]).includes(component)) return component;
  if (!format || format === 'text') return undefined;
  return format;
}

/**
 * Complete type → itself. A partial type string ("chec", "time") → the single known type it is a
 * prefix of, or undefined when ambiguous/unknown ("t" → text/table/timeline/… → undefined).
 * No known type is a strict prefix of another, so an exact match is final.
 */
export function guessNodeType(partial: unknown, extraTypes: readonly string[] = []): string | undefined {
  if (typeof partial !== 'string' || partial === '') return undefined;
  const all = extraTypes.length ? [...HUI_NODE_TYPES, ...extraTypes] : (HUI_NODE_TYPES as readonly string[]);
  if (all.includes(partial)) return partial;
  let hit: string | undefined;
  for (const t of all) {
    if (t.startsWith(partial)) {
      if (hit !== undefined && hit !== t) return undefined;
      hit = t;
    }
  }
  return hit;
}

/** Display decision for one hui segment (see file comment). `routeFormat` = `message.route?.format`. */
export function huiStreamView(seg: Extract<Segment, { kind: 'hui' }>, routeFormat?: string | null): HuiStreamView {
  const route = skeletonShapeForRoute(routeFormat);
  const node = seg.node;
  if (node) {
    const type = (node as { type?: unknown }).type;
    if (seg.complete) return { kind: 'node', node };
    if (typeof type === 'string' && (HUI_NODE_TYPES as readonly string[]).includes(type)) return { kind: 'node', node };
    return { kind: 'skeleton', shape: guessNodeType(type) ?? route ?? 'generic' };
  }
  if (!seg.complete) return { kind: 'skeleton', shape: route ?? 'generic' };
  return { kind: 'error', error: seg.error };
}
