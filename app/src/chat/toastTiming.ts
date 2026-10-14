/** Toast visibility (pure, node:test): ~4 s for short notes, longer for long (error) texts, at most 8 s. */
export const TOAST_MIN_MS = 4000;
export const TOAST_MAX_MS = 8000;

export function toastDuration(text: string): number {
  const chars = [...text.trim()].length;
  return Math.min(TOAST_MAX_MS, Math.max(TOAST_MIN_MS, 2500 + chars * 50));
}
