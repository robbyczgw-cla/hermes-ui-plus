/**
 * Minimal IndexedDB key/value wrapper (web/PWA: transcripts and node state leave the ~5 MB, main-thread
 * localStorage). No dependencies; erasable TS. One database, one object store per namespace.
 */
import type { KeyValueStorage } from './kv.ts';

/** every store the app uses (all are created in the single upgrade step) */
export const IDB_STORES = ['conv', 'nodestate'] as const;
export type IdbStoreName = (typeof IDB_STORES)[number];

const DB_NAME = 'hui-store';
const DB_VERSION = 1;

type IdbFactoryLike = Pick<IDBFactory, 'open'>;

const opened = new Map<string, Promise<IDBDatabase>>();

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

export function openIdb(factory: IdbFactoryLike | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB, name = DB_NAME): Promise<IDBDatabase> {
  const hit = opened.get(name);
  if (hit) return hit;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    if (!factory) {
      reject(new Error('IndexedDB not available'));
      return;
    }
    let r: IDBOpenDBRequest;
    try {
      r = factory.open(name, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of IDB_STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    r.onsuccess = () => {
      const db = r.result;
      // another tab upgraded the schema: close so it can proceed; the next call re-opens
      db.onversionchange = () => {
        db.close();
        opened.delete(name);
      };
      resolve(db);
    };
    r.onerror = () => reject(r.error ?? new Error('IndexedDB open failed'));
    r.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
  opened.set(name, p);
  p.catch(() => opened.delete(name));
  return p;
}

/** Key/value storage on one object store of an opened database. Writes resolve when the transaction commits. */
export function createIdbStorage(db: IDBDatabase, store: IdbStoreName): KeyValueStorage {
  const write = (fn: (s: IDBObjectStore) => void) =>
    new Promise<void>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(store, 'readwrite');
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted')); // QuotaExceededError lands here
      fn(tx.objectStore(store));
    });
  return {
    async getItem(key) {
      const v = await req(db.transaction(store, 'readonly').objectStore(store).get(key));
      return typeof v === 'string' ? v : null;
    },
    setItem: (key, value) => write((s) => void s.put(value, key)),
    removeItem: (key) => write((s) => void s.delete(key)),
    async getAllKeys() {
      const keys = await req(db.transaction(store, 'readonly').objectStore(store).getAllKeys());
      return keys.filter((k): k is string => typeof k === 'string');
    },
  };
}
