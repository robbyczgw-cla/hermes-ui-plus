// A pair link reaches the app from several sources at the same moment on a cold start (expo-linking's initial URL,
// +native-intent, the `url` event). Those duplicates must open the flow once – but opening the SAME link again later
// (after dismissing the flow, or after a failed/offline attempt) is a deliberate retry and must work (review part 5,
// finding 12). So a link is only suppressed for a short window after it was delivered. Pure + tested.
// Exception: the process's INITIAL URL (the VIEW intent). After a configuration change (font scale, …) Android recreates
// the activity with the same intent and the router reports it as initial again – that is no new open (E2E round 4, B3:
// the spent link's connection screen reappeared on top of the chat). Initial deliveries are accepted once per process.
// Across processes the persistent "used links" list (storage.ts, keys below) skips links that were saved or redeemed.
export const LINK_DEDUPE_MS = 4000;

export type LinkDeduper = {
  /** true → deliver it; false → duplicate of one delivered within the window (or an initial URL seen before) */
  accept(link: string, opts?: { initial?: boolean }): boolean;
  /** forget the time window (not the initial URLs) */
  clear(): void;
};

export function createLinkDeduper(windowMs = LINK_DEDUPE_MS, now: () => number = Date.now): LinkDeduper {
  const at = new Map<string, number>();
  const initials = new Set<string>();
  return {
    accept(link, opts) {
      if (opts?.initial) {
        if (initials.has(link)) return false;
        initials.add(link);
      }
      const t = now();
      for (const [k, v] of at) if (t - v >= windowMs) at.delete(k);
      if (at.has(link)) return false;
      at.set(link, t);
      return true;
    },
    clear: () => at.clear(),
  };
}

/** storage key of a redeemed one-time code (prefixed: never collides with a link key) */
export const spentCodeKey = (code: string): string => `code:${code}`;

/**
 * Keys under which a pair link counts as used: the link text (saved via that link) and its one-time code (redeemed –
 * any other spelling of a link with the same code is just as spent).
 */
export function usedLinkKeys(link: string, code: string | undefined): string[] {
  return code ? [link, spentCodeKey(code)] : [link];
}
