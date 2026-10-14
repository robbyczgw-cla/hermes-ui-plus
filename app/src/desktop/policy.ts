/**
 * Paste and app-lock policy of the desktop app (pure, node:test).
 *
 * A paste with files becomes attachments of the open chat (screenshots, "Copy Image", files copied in Finder) –
 * unless it is rich text from a document app: Word / Pages / Mail put a picture of the selection next to the HTML,
 * and the user wants the text then. Rule: files win, except when HTML comes with real text (more than a URL or
 * file names).
 */
export function shouldAttachPaste(o: { fileCount: number; types: readonly string[]; text: string }): boolean {
  if (o.fileCount <= 0) return false;
  if (!o.types.includes('text/html')) return true;
  const t = o.text.trim();
  if (!t) return true;
  // a single URL / file name (browser "Copy Image", Finder) is not text the user meant to paste
  return /^\S+$/.test(t) && t.length < 2048;
}

/** the app lock after time in the background: lock when the window comes back after `minutes` (0 = launch only) */
export function lockDue(blurredAt: number | null, now: number, minutes: number): boolean {
  if (blurredAt === null || minutes <= 0) return false;
  return now - blurredAt >= minutes * 60_000;
}
