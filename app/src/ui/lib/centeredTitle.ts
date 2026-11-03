/**
 * A centered display title (Gloock, `hero` / `heroCompact`) takes the full width of its parent instead of its measured
 * width. In a parent with `alignItems: 'center'` Android sized the text to a width measured too narrow for Gloock with
 * negative letter spacing: the last word wrapped onto a line the measured height left out, and "Alles bereit" showed as
 * "Alles" (deep test 0.3.0). Full width + `textAlign: 'center'` looks the same and leaves Android nothing to measure.
 */
export function centeredTitleBox(variant: string, align: string | undefined): { alignSelf: 'stretch' } | null {
  return align === 'center' && (variant === 'hero' || variant === 'heroCompact') ? { alignSelf: 'stretch' } : null;
}
