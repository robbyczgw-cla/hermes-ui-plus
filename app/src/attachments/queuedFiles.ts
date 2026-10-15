/**
 * Platform wiring of queuedFilesCore.ts: web keeps the bytes of a queued message's attachments in IndexedDB
 * (`hui-queued-files` / `files`, Blob values), native only checks that the local copies still exist.
 */
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { createQueuedFiles, type QueuedBlobRecord, type QueuedBlobStore } from './queuedFilesCore';

const DB_NAME = 'hui-queued-files';
const STORE = 'files';

let opened: Promise<QueuedBlobStore | null> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function openBlobStore(): Promise<QueuedBlobStore | null> {
  if (opened) return opened;
  opened = new Promise<QueuedBlobStore | null>((resolve) => {
    const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!factory) return resolve(null);
    let r: IDBOpenDBRequest;
    try {
      r = factory.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
    };
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => {
        db.close();
        opened = null;
      };
      const write = (fn: (s: IDBObjectStore) => void) =>
        new Promise<void>((res, rej) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error ?? new Error('IndexedDB write failed'));
          tx.onabort = () => rej(tx.error ?? new Error('IndexedDB write aborted'));
          fn(tx.objectStore(STORE));
        });
      const read = () => db.transaction(STORE, 'readonly').objectStore(STORE);
      resolve({
        async get(id) {
          const v = (await req(read().get(id))) as QueuedBlobRecord | undefined;
          return v && typeof v === 'object' && v.blob ? v : undefined;
        },
        put: (id, rec) => write((s) => void s.put(rec, id)),
        delete: (id) => write((s) => void s.delete(id)),
        async list() {
          const s = read(); // one transaction: keys and values in the same (key) order
          const [keys, vals] = await Promise.all([req(s.getAllKeys()), req(s.getAll()) as Promise<(QueuedBlobRecord | undefined)[]>]);
          return keys.map((k, i) => ({ id: String(k), at: vals[i]?.at ?? 0 }));
        },
      });
    };
  });
  return opened;
}

const IS_WEB = Platform.OS === 'web';

export const queuedFiles = createQueuedFiles({
  blobs: IS_WEB ? openBlobStore : undefined,
  readBlob: async (uri) => (await fetch(uri)).blob(),
  objectUrl: (blob) => URL.createObjectURL(blob),
  exists: IS_WEB
    ? undefined
    : (uri) => {
        try {
          return new File(uri).exists;
        } catch {
          return false;
        }
      },
  now: () => Date.now(),
});
