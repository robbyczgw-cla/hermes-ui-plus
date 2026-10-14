// Profile list state machine behind <ConnectionProvider/> (pure: persistence is injected, so it is tested with the
// real storage.ts on in-memory stores, profileStore.test.ts).
//
// Rules (review part 5, finding 1):
// - mutations run one after another (a second save never computes its change from a list the first one has not
//   persisted yet);
// - the published list only changes AFTER the write succeeded; a failed write leaves list AND baseline untouched, so
//   retrying the same save compares against what is really persisted and writes the secrets again;
// - stored profiles of kinds this build hides (flavor.ts) are written back unchanged.
import type { ConnectionProfile } from './profiles.ts';

export type ProfileStoreDeps = {
  /** persisted state: visible (merged with built-ins by the caller) and hidden-by-flavor profiles */
  load(): Promise<{ visible: ConnectionProfile[]; hidden: ConnectionProfile[]; activeId?: string | null }>;
  /** write `next` (visible + hidden) given what was persisted before; must throw when anything failed */
  save(next: ConnectionProfile[], previous: ConnectionProfile[]): Promise<void>;
  /** normalise a profile coming from the editor */
  clean(p: ConnectionProfile): ConnectionProfile;
  builtinIds: ReadonlySet<string>;
  initial: ConnectionProfile[];
};

export type ProfileStore = {
  get(): ConnectionProfile[];
  subscribe(fn: () => void): () => void;
  /** load persisted profiles (first queued task); resolves with the stored active id (null = none; undefined = load failed), never rejects */
  init(): Promise<string | null | undefined>;
  upsert(p: ConnectionProfile): Promise<void>;
  /** resolves with the removed id; built-ins are ignored */
  remove(id: string): Promise<boolean>;
};

export function createProfileStore(deps: ProfileStoreDeps): ProfileStore {
  /** last list known to be persisted = the published list (visible part) */
  let persisted = deps.initial;
  let hidden: ConnectionProfile[] = [];
  const listeners = new Set<() => void>();
  let chain: Promise<unknown> = Promise.resolve();

  const publish = (next: ConnectionProfile[]) => {
    persisted = next;
    for (const l of Array.from(listeners)) l();
  };
  /** queue `fn` after all earlier mutations; a failure does not break the chain */
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };
  /** persist `next`; on success it becomes baseline + published list, on failure nothing changes (error is rethrown) */
  const commit = async (next: ConnectionProfile[]) => {
    await deps.save([...next, ...hidden], [...persisted, ...hidden]);
    publish(next);
  };

  return {
    get: () => persisted,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    init: () =>
      enqueue(async () => {
        try {
          const l = await deps.load();
          hidden = l.hidden;
          publish(l.visible);
          return l.activeId ?? null;
        } catch {
          return undefined; // unreadable storage → keep the built-ins
        }
      }),
    upsert: (p) =>
      enqueue(async () => {
        const clean = deps.clean(p);
        const exists = persisted.some((x) => x.id === clean.id);
        await commit(exists ? persisted.map((x) => (x.id === clean.id ? clean : x)) : [...persisted, clean]);
      }),
    remove: (id) =>
      enqueue(async () => {
        if (deps.builtinIds.has(id)) return false;
        await commit(persisted.filter((x) => x.id !== id));
        return true;
      }),
  };
}
