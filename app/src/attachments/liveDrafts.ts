/**
 * Files of unsent composer drafts. `pruneAttachmentFiles` on app start must not delete them
 * (e.g. an Android camera photo recovered right after launch, before the prune ran).
 */
const owners = new Map<string, readonly string[]>();

export function setDraftUris(owner: string, uris: readonly string[]): void {
  if (uris.length) owners.set(owner, uris);
  else owners.delete(owner);
}

export function liveDraftUris(): string[] {
  const out: string[] = [];
  for (const list of owners.values()) out.push(...list);
  return out;
}
