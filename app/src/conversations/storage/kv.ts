/**
 * Key/value storage primitives for large records (transcripts, node state). Pure, erasable TS (node:test).
 *
 * - `KeyValueStorage`: the AsyncStorage-shaped interface every store here speaks.
 * - `createMigratingStorage(primary, legacy, prefix)`: reads/writes go to `primary` (files / IndexedDB);
 *   keys that still live in the old AsyncStorage (`legacy`) are moved over on first read or by `migrate()`.
 *   Migration is one-time, safe and resumable: a legacy key is removed only AFTER its value reached the
 *   primary store, each key independently, so an interrupted run simply continues on the next start.
 * - `deferredStorage(promise)`: a storage whose backend is chosen asynchronously (IndexedDB may fail to open).
 */

export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys?(): Promise<readonly string[]>;
};

export type MigratingStorage = KeyValueStorage & {
  /** Move every legacy key with the prefix into the primary store. Never throws. */
  migrate(): Promise<{ moved: number; failed: number }>;
};

export function createMigratingStorage(primary: KeyValueStorage, legacy: KeyValueStorage, prefix: string): MigratingStorage {
  /** legacy keys still to move; null = not scanned yet (then every miss checks legacy) */
  let legacyKeys: Set<string> | null = null;
  let migrating: Promise<{ moved: number; failed: number }> | null = null;
  /**
   * Per-key exclusion: migration (bulk and lazy on read), writes and deletions of the same key run one after
   * another, so a migration can never copy an old legacy value over a newer write or recreate a deleted record
   * (and two native writes never share the key's temp file).
   */
  const locks = new Map<string, Promise<unknown>>();
  function withKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    void tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return run;
  }

  const mayHaveLegacy = (key: string) => key.startsWith(prefix) && (legacyKeys === null || legacyKeys.has(key));

  async function dropLegacy(key: string) {
    if (!mayHaveLegacy(key)) return;
    try {
      await legacy.removeItem(key);
      legacyKeys?.delete(key);
    } catch {
      // stays in legacy; primary wins on read, retried by the next migrate()
    }
  }

  /** copy one legacy value into primary (unless primary already has a newer one), then drop it from legacy */
  async function moveOne(key: string): Promise<boolean> {
    // an unreadable primary is NOT "absent" (it may hold a newer value): throw → counted as failed, retried later
    const have = await primary.getItem(key);
    if (have === null) {
      const v = await legacy.getItem(key);
      if (v !== null) await primary.setItem(key, v);
    }
    await legacy.removeItem(key);
    legacyKeys?.delete(key);
    return true;
  }

  async function getLocked(key: string): Promise<string | null> {
    let primaryError: unknown = null;
    try {
      const v = await primary.getItem(key);
      if (v !== null) return v;
    } catch (e) {
      primaryError = e;
    }
    if (!mayHaveLegacy(key)) {
      if (primaryError) throw primaryError;
      return null;
    }
    const old = await legacy.getItem(key);
    if (old === null) {
      legacyKeys?.delete(key);
      if (primaryError) throw primaryError;
      return null;
    }
    if (!primaryError) {
      // lazy migration of this key (best effort: on failure it is read from legacy again next time)
      try {
        await primary.setItem(key, old);
        await dropLegacy(key);
      } catch {
        // keep legacy
      }
    }
    return old;
  }

  return {
    getItem: (key) => withKey(key, () => getLocked(key)),
    setItem: (key, value) =>
      withKey(key, async () => {
        await primary.setItem(key, value);
        // the old copy is stale now – removing it also frees AsyncStorage space (index, prefs live there)
        await dropLegacy(key);
      }),
    removeItem: (key) =>
      withKey(key, async () => {
        let err: unknown = null;
        try {
          await primary.removeItem(key);
        } catch (e) {
          err = e;
        }
        await dropLegacy(key);
        if (err) throw err;
      }),
    async getAllKeys() {
      const out = new Set<string>((await primary.getAllKeys?.()) ?? []);
      if (legacyKeys === null || legacyKeys.size) {
        try {
          for (const k of (await legacy.getAllKeys?.()) ?? []) if (k.startsWith(prefix)) out.add(k);
        } catch {
          // ignore
        }
      }
      return Array.from(out);
    },
    migrate() {
      if (migrating) return migrating;
      migrating = (async () => {
        let moved = 0;
        let failed = 0;
        let keys: string[];
        try {
          if (!legacy.getAllKeys) throw new Error('legacy storage cannot list keys');
          keys = (await legacy.getAllKeys()).filter((k) => k.startsWith(prefix));
        } catch {
          migrating = null; // lazy per-key migration on read still works
          return { moved, failed };
        }
        legacyKeys = new Set(keys);
        for (const k of keys) {
          try {
            await withKey(k, () => moveOne(k));
            moved++;
          } catch {
            failed++; // stays in legacy (still readable), retried on the next start
          }
        }
        if (failed) migrating = null; // allow a retry later in this run
        return { moved, failed };
      })();
      return migrating;
    },
  };
}

/** Storage whose backend is resolved later; every call waits for it. */
export function deferredStorage(backend: Promise<KeyValueStorage>): KeyValueStorage {
  return {
    getItem: async (k) => (await backend).getItem(k),
    setItem: async (k, v) => (await backend).setItem(k, v),
    removeItem: async (k) => (await backend).removeItem(k),
    getAllKeys: async () => ((await backend).getAllKeys ? await (await backend).getAllKeys!() : []),
  };
}

/** In-memory storage (tests, fallback). */
export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
    removeItem: async (k) => {
      data.delete(k);
    },
    getAllKeys: async () => Array.from(data.keys()),
  };
}
