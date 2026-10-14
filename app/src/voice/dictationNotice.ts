/**
 * Lifetime of the dictation notice above the composer (DictationNotice: "Ohne Mikrofon-Zugriff …", "Zu kurz …").
 * A permission hint must not outlive its cause: it goes when the permission is granted later (checked without a
 * prompt when the app returns to the foreground, e.g. from the system settings) and – like every dictation notice –
 * when the user leaves the chat screen or switches chats. The next start() clears it anyway. Pure (tested in
 * dictationNotice.test.ts).
 */
export type DictationNoticeState = {
  /** the notice shown (null = none) */
  error: string | null;
  /** the text of the last permission failure (null = none) – the notice is a permission hint while both match */
  permissionError: string | null;
  /** a failed transcription kept its recording (retry offered): leaving the chat does not throw that away */
  canRetry?: boolean;
};

export type DictationNoticeEvent =
  | { type: 'appActive'; granted: boolean } // app back in the foreground, permission re-checked (no prompt)
  | { type: 'left' } // chat screen lost focus (Settings, another screen)
  | { type: 'chatChanged' };

/** Is the visible notice a permission hint whose permission is worth re-checking? */
export function needsPermissionRecheck(n: DictationNoticeState): boolean {
  return !!n.error && n.error === n.permissionError;
}

/** Should the notice be dropped after `ev`? */
export function dropDictationNotice(n: DictationNoticeState, ev: DictationNoticeEvent): boolean {
  if (!n.error) return false;
  if (ev.type === 'appActive') return ev.granted && needsPermissionRecheck(n);
  return !n.canRetry;
}
