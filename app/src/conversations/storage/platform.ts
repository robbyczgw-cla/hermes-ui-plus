/**
 * Where large records live, per platform:
 *   native  one JSON file per key in `<documents>/hui-store/<ns>/` (expo-file-system, atomic temp + move)
 *   web     IndexedDB `hui-store` / object store `<ns>`; falls back to localStorage (AsyncStorage) when
 *           IndexedDB cannot be opened (very old browsers, some private modes)
 * Values written before this existed (AsyncStorage keys with the same names) are migrated on first read
 * and by `migrateLegacyStorage()` (deferred after start).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createFileStorage } from './fileKv.ts';
import { expoDirFs } from './fileKvExpo.ts';
import { createIdbStorage, openIdb, type IdbStoreName } from './idbKv.ts';
import { createMigratingStorage, deferredStorage, type KeyValueStorage, type MigratingStorage } from './kv.ts';

const legacy = AsyncStorage as unknown as KeyValueStorage;
const instances = new Map<IdbStoreName, { storage: KeyValueStorage; ready: Promise<MigratingStorage | null> }>();

function build(ns: IdbStoreName, prefix: string) {
  if (Platform.OS === 'web') {
    const ready: Promise<MigratingStorage | null> = openIdb()
      .then((db) => createMigratingStorage(createIdbStorage(db, ns), legacy, prefix))
      .catch(() => null);
    return { storage: deferredStorage(ready.then((s) => s ?? legacy)), ready };
  }
  const s = createMigratingStorage(createFileStorage(expoDirFs('hui-store', ns)), legacy, prefix);
  return { storage: s as KeyValueStorage, ready: Promise.resolve(s) };
}

/** Storage for big records of one namespace (`conv` transcripts, `nodestate`), keys start with `prefix`. */
export function largeRecordStorage(ns: IdbStoreName, prefix: string): KeyValueStorage {
  let i = instances.get(ns);
  if (!i) instances.set(ns, (i = build(ns, prefix)));
  return i.storage;
}

/** Move all remaining legacy AsyncStorage records (call once, deferred after the first render). */
export async function migrateLegacyStorage(): Promise<void> {
  for (const i of Array.from(instances.values())) {
    const s = await i.ready;
    if (s) await s.migrate();
  }
}
