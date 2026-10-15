/**
 * Durable attachment bytes on the web / in the desktop app (pure, node:test; the IndexedDB backend is webStore.ts).
 *
 * Dropped, pasted and picked files used to keep the `blob:` URL they came with. That URL dies with the page, but it
 * was persisted with the message / draft – after a reload thumbnails, "open" and upload retries failed. Now the
 * bytes go into IndexedDB under `<id>.<ext>` and the attachment's uri is `hui-att:<id>.<ext>` (never a `blob:` URL);
 * an object URL is made from the stored bytes when something needs one (once per session, `resolve` / `peek`) and
 * revoked when the attachment is deleted. The `<id>.<ext>` key keeps `fileBaseName()` (prune.ts) working.
 *
 * Without IndexedDB (some private modes) the source URL is kept as before: it works until the page goes.
 */

export const WEB_ATTACHMENT_SCHEME = 'hui-att:';

/** stored bytes, keyed `<id>.<ext>` */
export type BlobBackend = {
  put(key: string, blob: Blob): Promise<void>;
  get(key: string): Promise<Blob | null>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
};

/** `URL.createObjectURL` / `revokeObjectURL` (tests pass a fake) */
export type UrlRegistry = { create(blob: Blob): string; revoke(url: string): void };

export function isStoredWebUri(uri: string): boolean {
  return typeof uri === 'string' && uri.startsWith(WEB_ATTACHMENT_SCHEME);
}

function keyOf(uri: string): string {
  return uri.slice(WEB_ATTACHMENT_SCHEME.length);
}

export type WebAttachmentStore = {
  /** copy the bytes at `srcUri` (blob:/data:/hui-att:) into the store as `key`; the uri to keep on the attachment */
  save(srcUri: string, key: string): Promise<{ uri: string; size: number }>;
  /** a URL to show / open: object URL for a stored uri (null when its bytes are gone), other uris as they are */
  resolve(uri: string): Promise<string | null>;
  /** `resolve` without waiting: undefined while a stored uri has no object URL in this session yet */
  peek(uri: string): string | undefined;
  /** the bytes (reading, upload) */
  blob(uri: string): Promise<Blob>;
  /** delete stored bytes + revoke this session's URL; a plain `blob:` URL is revoked */
  remove(uri: string): Promise<void>;
  /** every stored uri (start-up prune of orphans) */
  list(): Promise<string[]>;
};

export function createWebAttachmentStore(o: {
  backend: Promise<BlobBackend | null>;
  urls: UrlRegistry;
  /** bytes of a non-stored uri (blob:/data:) */
  fetchBlob(uri: string): Promise<Blob>;
}): WebAttachmentStore {
  const resolved = new Map<string, string>();
  const loading = new Map<string, Promise<string | null>>();
  const backend = o.backend.catch(() => null);

  async function blob(uri: string): Promise<Blob> {
    if (!isStoredWebUri(uri)) return o.fetchBlob(uri);
    const b = await (await backend)?.get(keyOf(uri));
    if (!b) throw new Error('attachment bytes not found');
    return b;
  }

  return {
    async save(srcUri, key) {
      const data = await blob(srcUri);
      const be = await backend;
      if (be) {
        try {
          await be.put(key, data);
          return { uri: WEB_ATTACHMENT_SCHEME + key, size: data.size };
        } catch {
          // quota / private mode: keep the session URL below
        }
      }
      return { uri: srcUri, size: data.size };
    },
    peek(uri) {
      return isStoredWebUri(uri) ? resolved.get(uri) : uri;
    },
    resolve(uri) {
      if (!isStoredWebUri(uri)) return Promise.resolve(uri);
      const hit = resolved.get(uri);
      if (hit) return Promise.resolve(hit);
      let p = loading.get(uri);
      if (!p) {
        p = blob(uri)
          .then((b) => {
            const url = o.urls.create(b);
            resolved.set(uri, url);
            return url;
          })
          .catch(() => null)
          .finally(() => loading.delete(uri));
        loading.set(uri, p);
      }
      return p;
    },
    blob,
    async remove(uri) {
      if (isStoredWebUri(uri)) {
        const url = resolved.get(uri);
        resolved.delete(uri);
        if (url) o.urls.revoke(url);
        await (await backend)?.delete(keyOf(uri));
      } else if (uri.startsWith('blob:')) {
        o.urls.revoke(uri);
      }
    },
    async list() {
      const be = await backend;
      return be ? (await be.keys()).map((k) => WEB_ATTACHMENT_SCHEME + k) : [];
    },
  };
}

/** in-memory backend (tests) */
export function memoryBlobBackend(): BlobBackend & { data: Map<string, Blob> } {
  const data = new Map<string, Blob>();
  return {
    data,
    put: async (k, b) => {
      data.set(k, b);
    },
    get: async (k) => data.get(k) ?? null,
    delete: async (k) => {
      data.delete(k);
    },
    keys: async () => Array.from(data.keys()),
  };
}
