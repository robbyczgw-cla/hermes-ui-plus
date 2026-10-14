/**
 * Orphaned attachment files (pure, node:test). Starts from the files that exist (usually none or a few) and
 * scans stored conversations only until every one of them is accounted for: no cache fill, no JSON.parse
 * (repo.attachmentUrisOf), a yield between conversations so the JS thread stays responsive. Only files that
 * existed when the scan started can be returned, so attachments added meanwhile are never touched.
 */

/** file name of a uri (`file:///…/attachments/<id>.<ext>` and `file:/…` spellings compare equal) */
export function fileBaseName(uri: string): string {
  const last = uri.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export type OrphanScan = {
  /** uris of the files in the attachments directory (listed before the scan) */
  files: string[];
  conversationIds: string[];
  /** attachment uris referenced by one stored conversation; throws when unreadable */
  urisOf: (id: string) => Promise<string[]>;
  /** uris that must survive anyway (live drafts, files sent during the scan); read at the end */
  keep: () => Iterable<string>;
  /** let the UI breathe between conversations */
  yieldFn?: () => Promise<void>;
  /** stop early (unmounted) */
  cancelled?: () => boolean;
};

/** Uris of files no conversation references. Returns [] when any conversation could not be read (be safe). */
export async function findOrphanFiles(o: OrphanScan): Promise<string[]> {
  const left = new Map<string, string>(); // base name -> uri
  for (const f of o.files) left.set(fileBaseName(f), f);
  for (const id of o.conversationIds) {
    if (!left.size || o.cancelled?.()) break;
    let uris: string[];
    try {
      uris = await o.urisOf(id);
    } catch {
      return []; // an unreadable chat may reference any file
    }
    for (const u of uris) left.delete(fileBaseName(u));
    if (o.yieldFn) await o.yieldFn();
  }
  if (o.cancelled?.()) return [];
  for (const u of o.keep()) left.delete(fileBaseName(u));
  return Array.from(left.values());
}

export type SharedFileCheck = {
  /** attachment uris of the deleted conversation(s) */
  uris: string[];
  /** conversations that stay (a branch shares its parent's attachment files) */
  survivorIds: string[];
  /** attachment uris referenced by one stored conversation; throws when unreadable */
  urisOf: (id: string) => Promise<string[]>;
  /** uris that must survive anyway (live drafts) */
  keep?: () => Iterable<string>;
};

/**
 * Of the attachment files of deleted chats, those no surviving chat (or live draft) still references – the
 * only ones that may be deleted (review H7: a branch copies the messages, not the files). Returns [] when a
 * surviving chat cannot be read (be safe: the startup orphan prune catches real orphans later).
 */
export async function unreferencedFiles(o: SharedFileCheck): Promise<string[]> {
  const left = new Map<string, string>();
  for (const u of o.uris) left.set(fileBaseName(u), u);
  for (const id of o.survivorIds) {
    if (!left.size) break;
    let uris: string[];
    try {
      uris = await o.urisOf(id);
    } catch {
      return [];
    }
    for (const u of uris) left.delete(fileBaseName(u));
  }
  for (const u of o.keep?.() ?? []) left.delete(fileBaseName(u));
  return Array.from(left.values());
}
