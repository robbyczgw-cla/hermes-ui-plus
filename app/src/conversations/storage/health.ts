/**
 * Storage health: write failures of transcripts / node state are reported here; the UI shows a one-time,
 * non-blocking "storage full" notice while the device (or the browser origin) is out of space.
 * Pure, erasable TS (node:test).
 */

export type StorageIssue = { kind: 'full'; what: string; at: number };

/** Quota / disk-full errors of AsyncStorage (SQLITE_FULL), localStorage/IndexedDB (QuotaExceededError) and files (ENOSPC). */
export function isQuotaError(e: unknown): boolean {
  if (!e) return false;
  const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name?: unknown }).name) : '';
  if (/quota/i.test(name)) return true;
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : String((e as { message?: unknown }).message ?? '');
  return /quota|SQLITE_FULL|database or disk is full|disk full|ENOSPC|no space left|not enough space|storage (is )?full/i.test(msg);
}

export function createStorageHealth(now: () => number = Date.now) {
  let issue: StorageIssue | null = null;
  const subs = new Set<() => void>();
  const emit = () => {
    for (const f of Array.from(subs)) f();
  };
  return {
    get: () => issue,
    /** a write failed; only quota errors raise the notice (others are retried silently) */
    reportError(e: unknown, what: string) {
      if (!isQuotaError(e) || issue) return;
      issue = { kind: 'full', what, at: now() };
      emit();
    },
    /** a write succeeded again: clear the notice so a later shortage is reported once more */
    reportOk() {
      if (!issue) return;
      issue = null;
      emit();
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}

export type StorageHealth = ReturnType<typeof createStorageHealth>;

/** Process-wide instance (transcripts + node state report here). */
export const storageHealth: StorageHealth = createStorageHealth();
