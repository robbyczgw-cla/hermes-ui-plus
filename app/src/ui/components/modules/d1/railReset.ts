/**
 * Carousel start position (pure, tested). While a places/products block streams in, or in the
 * moment it completes, the rail must show its first card; the scroll offset is only left alone
 * once the user scrolled it themselves.
 */
export type RailResetInput = {
  /** the block is still streaming */
  streaming: boolean;
  /** it was streaming one render ago (so `!streaming && prevStreaming` = just completed) */
  prevStreaming: boolean;
  /** the user dragged, wheeled or used the arrows */
  userScrolled: boolean;
  /** current horizontal offset */
  x: number;
};

export function shouldResetRail({ streaming, prevStreaming, userScrolled, x }: RailResetInput): boolean {
  if (userScrolled) return false;
  if (!(x > 0)) return false;
  return streaming || prevStreaming;
}
