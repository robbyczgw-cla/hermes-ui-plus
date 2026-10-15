/**
 * The web / desktop app's attachment store (webBlobs.ts) on IndexedDB: database `hui-attachments`, object store
 * `files`, values = Blobs keyed `<id>.<ext>`. A database of its own, so the transcript store (`hui-store`,
 * conversations/storage/idbKv.ts) keeps its schema version. Native builds never open it (they keep files in
 * `<documents>/attachments/`, store.ts).
 */
import { Platform } from 'react-native';
import { createWebAttachmentStore, type BlobBackend, type WebAttachmentStore } from './webBlobs';

const DB_NAME = 'hui-attachments';
const STORE = 'files';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!factory) {
      reject(new Error('IndexedDB not available'));
      return;
    }
    let r: IDBOpenDBRequest;
    try {
      r = factory.open(DB_NAME, 1);
    } catch (e) {
      reject(e);
      return;
    }
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB open failed'));
    r.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

function idbBackend(db: IDBDatabase): BlobBackend {
  const write = (fn: (s: IDBObjectStore) => void) =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
      fn(tx.objectStore(STORE));
    });
  return {
    put: (key, blob) => write((s) => void s.put(blob, key)),
    async get(key) {
      const v: unknown = await req(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
      return v instanceof Blob ? v : null;
    },
    delete: (key) => write((s) => void s.delete(key)),
    async keys() {
      const keys = await req(db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys());
      return keys.filter((k): k is string => typeof k === 'string');
    },
  };
}

let store: WebAttachmentStore | null = null;

/** the store (web / desktop app); on native every uri passes through and nothing is stored */
export function webAttachments(): WebAttachmentStore {
  if (!store) {
    const backend = Platform.OS === 'web' ? openDb().then(idbBackend) : Promise.resolve(null);
    store = createWebAttachmentStore({
      backend,
      urls: { create: (b) => URL.createObjectURL(b), revoke: (u) => URL.revokeObjectURL(u) },
      fetchBlob: async (uri) => (await fetch(uri)).blob(),
    });
  }
  return store;
}
