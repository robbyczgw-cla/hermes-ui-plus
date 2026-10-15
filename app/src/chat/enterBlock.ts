/**
 * A5 block entrance of streamed Markdown (chat/Markdown.tsx `EnterBlock`): which prop changes re-render a block's
 * fade-in wrapper. Every streaming tick re-renders `<Markdown>`; without this only the tail block may change, but an
 * unmemoized wrapper re-rendered every block of a long answer per tick (its animated style hooks included).
 * Pure TS (erasable syntax only) so `node --test` can run it (enterBlock.test.ts).
 */

/** stagger between blocks that appear in the same update */
export const ENTER_STAGGER_MS = 40;
export const ENTER_STAGGER_MAX_MS = 200;

/** Entrance delay of block `index` when the previous commit rendered `prevRendered` blocks. */
export function enterDelay(index: number, prevRendered: number): number {
  return Math.min(ENTER_STAGGER_MAX_MS, Math.max(0, index - prevRendered) * ENTER_STAGGER_MS);
}

export type EnterBlockCompare = { block: { src: string }; s: unknown; first: boolean; live: boolean; enter: boolean; delay: number };

/**
 * memo() comparator: same source, styles, position and live state → no re-render. `delay` is ignored on purpose:
 * it is read on mount only (a later tick recomputes it as 0 for an already rendered block, which used to restart
 * the running fade without its stagger).
 */
export function enterBlockPropsEqual(a: EnterBlockCompare, b: EnterBlockCompare): boolean {
  return a.block.src === b.block.src && a.live === b.live && a.s === b.s && a.first === b.first && a.enter === b.enter;
}
