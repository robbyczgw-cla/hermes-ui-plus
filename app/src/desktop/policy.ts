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

/** the shell's app lock state (`desktop_lock_state`); null = could not be read */
export type NativeLockState = { enabled: boolean; locked: boolean } | null;

/**
 * Does a page that just loaded stay behind the lock cover? The init script's prefs are those of the window's
 * creation (a reload after switching the lock on would miss it), so the shell's state decides – and when it cannot be
 * read, the cover stays (fail closed).
 */
export function staysLocked(native: NativeLockState): boolean {
  if (!native || typeof native !== 'object') return true;
  return native.locked !== false;
}

/**
 * May files that arrived at lock epoch `since` still become attachments? Not while locked, and not when the lock
 * engaged in between (dropped while unlocked, locked before they were read / prepared: discarded, never uploaded).
 */
export function ingestAllowed(since: number, now: { locked: boolean; epoch: number }): boolean {
  return !now.locked && now.epoch === since;
}
