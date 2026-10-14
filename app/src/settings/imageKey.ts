// Saving the own image-search key (pure, injectable I/O → imageKey.test.ts). The secure-store write comes first; the
// active resolver and the "saved" state change only after it succeeded, and only if the provider the key belongs to
// is still the selected one when the write finishes (review part 5, finding 13).
export type ImageKeyDeps<P extends string> = {
  save(provider: P, value: string): Promise<void>;
  /** publish the key to the running image resolver (null = none) */
  setConfig(cfg: { provider: P; key: string } | null): void;
};

export type ImageKeyOutcome = 'saved' | 'cleared' | 'failed' | 'stale';

export async function persistImageKey<P extends string>(deps: ImageKeyDeps<P>, provider: P, value: string, current: () => boolean = () => true): Promise<ImageKeyOutcome> {
  const key = value.trim();
  try {
    await deps.save(provider, key);
  } catch {
    return 'failed'; // not stored → the resolver keeps its previous (persisted) configuration
  }
  if (!current()) return 'stale'; // the provider changed during the write: do not touch the global resolver
  deps.setConfig(key ? { provider, key } : null);
  return key ? 'saved' : 'cleared';
}
