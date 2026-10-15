/**
 * Natural aspect ratios of images already shown, by URL (bounded LRU, module level). An image box without a known
 * size starts at 4:3 and jumps to the real ratio once the image decoded – every time a chat is reopened or an answer
 * scrolls back into view. With the ratio remembered the box has its final size on the first frame. Pure (node:test).
 */

/** entries kept (a number each; the URL is the bulk of an entry) */
export const ASPECT_CACHE_MAX = 400;
/** longer keys (data: URLs) are not kept: memory for a rare reflow */
export const ASPECT_KEY_MAX = 2048;

const aspects = new Map<string, number>();

/** The remembered width / height of `url`, if it was shown before (marks it recently used). */
export function knownAspect(url: string | null | undefined): number | undefined {
  if (!url) return undefined;
  const a = aspects.get(url);
  if (a === undefined) return undefined;
  aspects.delete(url);
  aspects.set(url, a);
  return a;
}

/** Remember the decoded size of `url`; returns its aspect (width / height), or undefined for an unusable size. */
export function rememberAspect(url: string | null | undefined, width: number, height: number): number | undefined {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return undefined;
  const a = width / height;
  if (!url || url.length > ASPECT_KEY_MAX) return a;
  aspects.delete(url);
  aspects.set(url, a);
  while (aspects.size > ASPECT_CACHE_MAX) {
    const oldest = aspects.keys().next();
    if (oldest.done) break;
    aspects.delete(oldest.value);
  }
  return a;
}

/** test hook */
export function clearAspects(): void {
  aspects.clear();
}
