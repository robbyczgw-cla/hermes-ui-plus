/**
 * Older Hermes sessions – pure paging logic (no React; node:test). React side: hermesSync.ts `useHermesSessionSync`
 * (`older`), UI: the drawer's "Ältere Chats laden" row / the end of the list.
 *
 * Every list sync (start, foreground, drawer) fetches the newest SESSION_PAGE sessions per source – cheap, and enough
 * to keep the drawer current. Older ones are only fetched on demand: on a new device the newest page of `api_server`
 * can be mostly other API clients, so the app's older chats would be unreachable without it.
 *
 * - one cursor per source (Hermes orders by last activity; `offset` = rows already seen). The list sync keeps a cursor
 *   that is already further back. Offsets drift a little when sessions get new activity meanwhile: a row may come twice
 *   (merged by session id, harmless) and a session moved up is in the first page anyway
 * - a "load older" step pages on until a chat the drawer will SHOW was added (profile filter + chat scope) or
 *   OLDER_MAX_PAGES pages were read – a page of other clients' sessions alone never ends a tap without a result
 */
import type { RemoteSession } from '../hermes/sessions.ts';
import type { ChatScope } from './chatScope.ts';
import { syncSources, type SyncFilter } from './remoteSync.ts';

/** sessions per source on every list sync (GET /api/sessions?limit=50, Hermes' default) */
export const SESSION_PAGE = 50;
/** sessions per "load older" request (Hermes caps `limit` at 200) */
export const OLDER_PAGE = 100;
/** "load older": at most this many requests per step when the pages add nothing the drawer shows */
export const OLDER_MAX_PAGES = 4;

export type SourceCursor = { offset: number; hasMore: boolean };
export type Cursors = Readonly<Record<string, SourceCursor>>;

/** Cursor after the first page of a list sync: one already further back is kept; a complete first page ends paging. */
export function afterFirstPage(prev: SourceCursor | undefined, count: number, hasMore: boolean): SourceCursor {
  if (!hasMore) return { offset: count, hasMore: false };
  if (prev && prev.hasMore && prev.offset > count) return prev;
  return { offset: count, hasMore: true };
}

/**
 * Sources worth paging for the profile filter and the device's chat scope: with "only this device" the app's sessions
 * from the list are never shown, so `api_server` is only paged when other API clients are shown.
 */
export function pagedSources(filter: SyncFilter, scope: ChatScope): string[] {
  const all = syncSources(filter);
  return scope === 'device' && !filter.foreign ? all.filter((s) => s !== 'api_server') : all;
}

/** Are there older sessions on any of these sources? (false before the first sync: nothing known yet) */
export function hasOlder(cursors: Cursors, sources: readonly string[]): boolean {
  return sources.some((s) => cursors[s]?.hasMore === true);
}

export type OlderStep = {
  cursors: Cursors;
  sources: readonly string[];
  /** GET /api/sessions?source&offset&limit (throws like the sessions client) */
  fetch(source: string, offset: number, limit: number): Promise<{ sessions: RemoteSession[]; hasMore: boolean }>;
  /** merge into the index; returns the entries the drawer SHOWS that were added */
  merge(sessions: RemoteSession[]): readonly unknown[];
  maxPages?: number;
  pageSize?: number;
  cancelled?: () => boolean;
};

/**
 * One "load older" step: pages through the sources (in order) until a shown chat was added, nothing older is left or
 * `maxPages` requests were made. Returns the new cursors (the input is not mutated). A failing request throws; the
 * cursors of pages read before it are lost with it, so the next step re-reads them (merging is idempotent).
 */
export async function loadOlderSessions(o: OlderStep): Promise<{ cursors: Cursors; added: number; pages: number }> {
  const cursors: Record<string, SourceCursor> = { ...o.cursors };
  const maxPages = o.maxPages ?? OLDER_MAX_PAGES;
  const limit = o.pageSize ?? OLDER_PAGE;
  let added = 0;
  let pages = 0;
  while (pages < maxPages && added === 0 && !o.cancelled?.()) {
    const source = o.sources.find((s) => cursors[s]?.hasMore === true);
    if (!source) break;
    const at = cursors[source];
    const page = await o.fetch(source, at.offset, limit);
    pages++;
    cursors[source] = { offset: at.offset + page.sessions.length, hasMore: page.hasMore && page.sessions.length > 0 };
    added += o.merge(page.sessions).length;
  }
  return { cursors, added, pages };
}
