/**
 * Why an `image` / `gallery` item shows no photo. A query-only item that cannot be resolved must never leave an
 * empty gap: the block shows a calm placeholder tile per item plus ONE quiet line naming the reason (and, where the
 * user can change it, a link to the setting). Pure: no RN imports (tested in miss.test.ts).
 *
 *   off        Settings → Medien → Bilder laden is "Nie" (or "Nur WLAN" on a metered connection)
 *   noSearch   the item needs a web image search (`source:"web"`, or Wikipedia found nothing) and none is available:
 *              the bridge reports no provider and there is no own key
 *   wikiOnly   same, but the user chose Bildersuche → "Nur Wikipedia"
 *   error      the lookup failed or timed out, or the photo itself did not load
 *   notFound   searched, nothing suitable
 */
import type { ImageSearchMode } from './mode.ts';

/**
 * A lookup still running after this long shows its placeholder ('error'); a late photo still replaces it. Longer than
 * the card slot cap (slot.ts): the resolver and web search time out after 4-6 s each, and a block that turns into
 * placeholders and back into photos jumps.
 */
export const IMAGE_LOOKUP_CAP_MS = 8000;

export type ImageMissReason = 'off' | 'noSearch' | 'wikiOnly' | 'error' | 'notFound';

/** Which setting the note links to (null = nothing the user can change). */
export type ImageMissSetting = 'loading' | 'search' | null;

export function imageMissReason(s: {
  /** Settings → Bilder laden allows query photos right now */
  allowed: boolean;
  /** the item is web-only (`source:"web"`): Wikimedia is never asked */
  webOnly: boolean;
  /** some web image search (bridge provider or own key) is usable */
  webEnabled: boolean;
  mode: ImageSearchMode;
  /** 'none' = searched without a hit · 'error' = lookup failed · 'expired' = still resolving past the cap · 'broken' = photo did not load */
  status: 'none' | 'error' | 'expired' | 'broken';
  /** the item only had a direct URL (no query): searches never ran */
  urlOnly?: boolean;
}): ImageMissReason {
  if (s.status === 'broken' || s.urlOnly) return 'error';
  if (!s.allowed) return 'off';
  if (s.status === 'error' || s.status === 'expired') return 'error';
  // nothing found and no web search to ask (web-only items never had a source at all)
  if (!s.webEnabled) return s.mode === 'wikipedia' ? 'wikiOnly' : 'noSearch';
  return 'notFound';
}

const PRIORITY: readonly ImageMissReason[] = ['off', 'noSearch', 'wikiOnly', 'error', 'notFound'];

/** One line for a block with several missing items: the reason the user can act on wins. null = nothing missing. */
export function blockMissReason(reasons: readonly (ImageMissReason | null | undefined)[]): ImageMissReason | null {
  let best: ImageMissReason | null = null;
  for (const r of reasons) if (r && (best === null || PRIORITY.indexOf(r) < PRIORITY.indexOf(best))) best = r;
  return best;
}

export function missSetting(r: ImageMissReason): ImageMissSetting {
  if (r === 'off') return 'loading';
  if (r === 'noSearch' || r === 'wikiOnly') return 'search';
  return null;
}

/** What the note offers after the reason: the settings link, a sentence instead, or nothing. */
export type MissNoteAction = { kind: 'link'; target: Exclude<ImageMissSetting, null> } | { kind: 'hint' } | null;

/**
 * `shell`: 'settings' = the app can open the matching settings row · 'none' = it has no such row (the reduced settings
 * of a locked-down shell): one sentence about what still helps (the tiles open a web search), never a link to a screen
 * without the control (real-user PC-05) · null = no shell (component gallery, share-as-image): nothing.
 */
export function missNoteAction(reason: ImageMissReason, shell: 'settings' | 'none' | null): MissNoteAction {
  const target = missSetting(reason);
  if (!target || !shell) return null;
  return shell === 'settings' ? { kind: 'link', target } : { kind: 'hint' };
}

/**
 * Browser image search for a placeholder tile (the user taps it on purpose; nothing is fetched by the app).
 * DuckDuckGo: no account, no tracking parameters. undefined for an empty query.
 */
export function browserImageSearchUrl(query: string | undefined): string | undefined {
  const q = query?.replace(/\s+/g, ' ').trim();
  if (!q) return undefined;
  return `https://duckduckgo.com/?q=${encodeURIComponent(q.slice(0, 200))}&ia=images&iax=images`;
}
