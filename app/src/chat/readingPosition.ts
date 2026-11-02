/**
 * Where a chat opens again (pure, node:test readingPosition.test.ts): the stored reading position (readingState.ts
 * `anchor`) as an index of the inverted list (0 = newest message), or null = open at the newest message.
 * 'wait' = the anchor is not in the list (yet): a chat whose history is still arriving.
 */
export type RestoreAt = { index: number; /** exact offset (px from the bottom): the chat did not change since */ offset?: number };

export function restoreTarget(
  newestFirst: readonly { id: string }[],
  saved: { anchor?: string; offset?: number; count?: number } | undefined,
): RestoreAt | null | 'wait' {
  const anchor = saved?.anchor;
  if (!anchor || !newestFirst.length) return anchor && !newestFirst.length ? 'wait' : null;
  const i = newestFirst.findIndex((m) => m.id === anchor);
  if (i < 0) return 'wait';
  // same messages as when the user left: the exact offset (a tall answer stays where it was read, not centred)
  if (saved.offset !== undefined && saved.count === newestFirst.length) return saved.offset > 0 ? { index: i, offset: saved.offset } : null;
  // the newest message (or the one right above it) is the bottom anyway
  return i <= 1 ? null : { index: i };
}
