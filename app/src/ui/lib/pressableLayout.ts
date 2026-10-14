/**
 * Pure layout split for PressableScale: layout props go on the outer Pressable, visuals on the
 * animated inner view. The inner view must only fill the outer one when the outer view has a size
 * that is decided by its parent (flex / stretch). An unconditional `flexGrow: 1` on the inner view
 * made content-sized pressables (alignSelf flex-start buttons, e.g. the recipe step timer) grow
 * without bound on Android when Yoga re-measured them with an unbounded main size.
 */
export const OUTER_KEYS = new Set([
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'width', 'minWidth', 'maxWidth',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical',
  'position', 'left', 'right', 'top', 'bottom', 'zIndex',
]);

export function innerShouldFill(flat: Record<string, unknown>): boolean {
  const num = (v: unknown) => typeof v === 'number' && v > 0;
  if (num(flat.flex) || num(flat.flexGrow)) return true;
  if (flat.flexBasis !== undefined && flat.flexBasis !== 'auto') return true;
  if (flat.alignSelf === 'stretch') return true;
  // absolutely positioned with both edges set => size is decided by the offsets
  if (flat.position === 'absolute') return true;
  return false;
}

export function splitPressableStyle(flat: Record<string, unknown>): [Record<string, unknown>, Record<string, unknown>] {
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = innerShouldFill(flat) ? { flexGrow: 1 } : {};
  for (const k of Object.keys(flat)) (OUTER_KEYS.has(k) ? outer : inner)[k] = flat[k];
  return [outer, inner];
}
