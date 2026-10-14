/**
 * A2 "Weiterlesen": after a `summary` node, long markdown sections collapse to their first ~12 lines
 * (`collapsePlan`); long researched answers with a closing sources list collapse after their first
 * section (`sectionPlan`, B3).
 *
 * Line counting is an estimate (no layout pass): each source line counts as ceil(chars / charsPerLine)
 * rendered lines, headings/blank gaps count one extra, code/table rows count one each. A section only
 * collapses when the hidden rest is worth it (> `minHidden` lines) – "Weiterlesen" for two more lines
 * would be silly.
 *
 * Pure TS (erasable syntax only) so `node --test` can run it.
 */
import type { Segment } from '../../protocol/types';
import type { MdBlock } from '../markdown.ts';

export const COLLAPSE_LINES = 12;
/** ~ characters per rendered line of body text on a 360–390 pt phone */
export const CHARS_PER_LINE = 42;

export type CollapsePlan = { visible: number; hiddenLines: number } | null;

function textLines(s: string, cpl: number): number {
  let n = 0;
  for (const l of s.split('\n')) n += Math.max(1, Math.ceil(l.trim().length / cpl));
  return n;
}

/** Estimated rendered lines of one markdown block. */
export function blockLines(b: MdBlock, cpl = CHARS_PER_LINE): number {
  switch (b.type) {
    case 'heading':
      return textLines(b.text, Math.round(cpl * 0.8)) + 1;
    case 'paragraph':
      return textLines(b.text, cpl);
    case 'code':
      return b.code.split('\n').length + 2;
    case 'table':
      return b.rows.length + 1;
    case 'images':
      return 8;
    case 'hr':
      return 1;
    case 'quote':
      return b.blocks.reduce((a, x) => a + blockLines(x, cpl - 4), 0);
    case 'list':
      return b.items.reduce((a, it) => a + textLines(it.text, cpl - 3) + it.children.reduce((c, x) => c + blockLines(x, cpl - 3), 0), 0);
  }
}

const lineCache = new WeakMap<MdBlock, number>();

/**
 * `blockLines` memoized per block object: the incremental parser reuses the stable prefix blocks, so while
 * streaming only the tail block is measured again (no O(text) work per update).
 */
export function blockLinesCached(b: MdBlock): number {
  let n = lineCache.get(b);
  if (n === undefined) lineCache.set(b, (n = blockLines(b)));
  return n;
}

/**
 * How many leading blocks to show collapsed. null = show everything (short enough).
 * At least one block is always visible, even when it alone is longer than the limit.
 */
export function collapsePlan(
  blocks: readonly MdBlock[],
  maxLines = COLLAPSE_LINES,
  minHidden = 4,
  cpl = CHARS_PER_LINE,
  linesOf: (b: MdBlock) => number = (b) => blockLines(b, cpl),
): CollapsePlan {
  if (blocks.length < 2) return null;
  const lines = blocks.map(linesOf);
  const total = lines.reduce((a, b) => a + b, 0);
  if (total <= maxLines + minHidden) return null;
  let used = 0;
  let visible = 0;
  while (visible < blocks.length && (visible === 0 || used + lines[visible] <= maxLines)) {
    used += lines[visible];
    visible++;
  }
  // a heading must not be the last visible block (it would announce hidden content)
  while (visible > 1 && blocks[visible - 1].type === 'heading') {
    visible--;
    used -= lines[visible];
  }
  const hiddenLines = total - used;
  if (visible >= blocks.length || hiddenLines < minHidden) return null;
  return { visible, hiddenLines };
}

/**
 * Long researched answers (answers/citations.ts, no `summary` node): show the first section – everything
 * before the first heading that follows some content – then "Weiterlesen". Without such a heading, or when
 * that section alone is very long, the line-based `collapsePlan` decides.
 */
export function sectionPlan(
  blocks: readonly MdBlock[],
  maxLines = COLLAPSE_LINES,
  minHidden = 4,
  linesOf: (b: MdBlock) => number = (b) => blockLines(b),
): CollapsePlan {
  if (blocks.length < 2) return null;
  let h = -1;
  let content = false;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type === 'heading') {
      if (content) {
        h = i;
        break;
      }
    } else content = true;
  }
  if (h > 0) {
    let used = 0;
    for (let i = 0; i < h; i++) used += linesOf(blocks[i]);
    let hidden = 0;
    for (let i = h; i < blocks.length; i++) hidden += linesOf(blocks[i]);
    if (used <= maxLines * 2 && hidden >= minHidden) return { visible: h, hiddenLines: hidden };
  }
  return collapsePlan(blocks, maxLines, minHidden, CHARS_PER_LINE, linesOf);
}

/** Is there a `summary` node among the answer's segments before segment `index`? */
export function summaryBefore(segments: readonly Segment[], index: number): boolean {
  for (let i = 0; i < index && i < segments.length; i++) {
    const s = segments[i];
    if (s.kind === 'hui' && s.node && (s.node as { type?: unknown }).type === 'summary') return true;
  }
  return false;
}
