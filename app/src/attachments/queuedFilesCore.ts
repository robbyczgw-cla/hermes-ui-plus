/**
 * Files of a message that was queued while its uploads ran (hermes/pendingSend.ts) must outlive an app restart
 * until the user taps "Erneut senden" or "Verwerfen" (pure, queuedFiles.test.ts; platform wiring: queuedFiles.ts).
 *
 * - native: the local copies already live in `<documents>/attachments` (store.ts) and the stored transcript
 *   references them, so the start-up prune keeps them. Nothing is copied; `restore` only checks they still exist.
 * - web: the composer's `blob:` URLs die with the page. `stash` puts the bytes into IndexedDB (keyed by attachment
 *   id) when the message is queued, `restore` hands out fresh object URLs, `drop` removes them once the message was
 *   sent or discarded. Entries nobody claimed (chat deleted while queued) go after QUEUED_FILE_TTL_MS.
 *
 * An attachment whose bytes are needed (images are sent inline, files not uploaded yet) but gone is returned as a
 * failed chip (`attachments.file.missingAfterRestart`): the bubble offers to remove it, the text is never lost.
 * Erasable TS only.
 */
import type { Attachment } from './types.ts';

export const QUEUED_FILE_TTL_MS = 30 * 24 * 60 * 60_000;

export type QueuedBlobRecord = { blob: Blob; at: number };

export type QueuedBlobStore = {
  get(id: string): Promise<QueuedBlobRecord | undefined>;
  put(id: string, rec: QueuedBlobRecord): Promise<void>;
  delete(id: string): Promise<void>;
  /** every entry: id + time it was stashed */
  list(): Promise<{ id: string; at: number }[]>;
};

export type QueuedFilesDeps = {
  /** web: the blob store (null when IndexedDB cannot be opened); absent on native (files persist already) */
  blobs?: () => Promise<QueuedBlobStore | null>;
  readBlob(uri: string): Promise<Blob>;
  objectUrl(blob: Blob): string;
  /** native: does the local copy still exist */
  exists?(uri: string): boolean;
  now(): number;
  ttlMs?: number;
};

export type QueuedFiles = {
  /** keep the bytes of these attachments across a restart (web; no-op on native) */
  stash(atts: readonly Attachment[]): Promise<void>;
  /** the attachments of a restored queued message, ready to send: fresh uris (web), missing ones as failed chips */
  restore(atts: readonly Attachment[]): Promise<Attachment[]>;
  /** the message was sent or discarded: forget the stashed bytes */
  drop(ids: readonly string[]): Promise<void>;
};

/** a uri that dies with the page (web composer); `data:` carries its bytes, `file:` paths persist */
export function isVolatileUri(uri: string): boolean {
  return uri.startsWith('blob:');
}

/** sending needs the local bytes: images go inline, files that are not on the bridge yet must be uploaded */
export function needsBytes(a: Attachment): boolean {
  return a.kind === 'image' || !a.remoteRef;
}

export function missingAttachment(a: Attachment): Attachment {
  return { ...a, status: 'error', progress: undefined, error: { key: 'attachments.file.missingAfterRestart', vars: { name: a.name } } };
}

export function createQueuedFiles(d: QueuedFilesDeps): QueuedFiles {
  const ttl = d.ttlMs ?? QUEUED_FILE_TTL_MS;
  const open = async () => {
    try {
      return d.blobs ? await d.blobs() : null;
    } catch {
      return null;
    }
  };
  const sweep = async (s: QueuedBlobStore, keep: ReadonlySet<string>) => {
    try {
      const old = (await s.list()).filter((e) => !keep.has(e.id) && e.at < d.now() - ttl);
      for (const e of old) await s.delete(e.id);
    } catch {
      // best effort
    }
  };
  // one at a time: a drop right after a stash (uploads done at once) must not run before its writes
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const r = chain.then(fn, fn);
    chain = r.catch(() => undefined);
    return r;
  };
  const api: QueuedFiles = {
    async stash(atts) {
      const volatile = atts.filter((a) => isVolatileUri(a.uri));
      if (!volatile.length || !d.blobs) return;
      const s = await open();
      if (!s) return;
      for (const a of volatile) {
        try {
          await s.put(a.id, { blob: await d.readBlob(a.uri), at: d.now() });
        } catch {
          // quota / revoked URL: restore reports it as missing, the text survives anyway
        }
      }
      await sweep(s, new Set(volatile.map((a) => a.id)));
    },
    async restore(atts) {
      const s = atts.some((a) => isVolatileUri(a.uri)) ? await open() : null;
      const out: Attachment[] = [];
      for (const a of atts) {
        if (isVolatileUri(a.uri)) {
          let rec: QueuedBlobRecord | undefined;
          try {
            rec = s ? await s.get(a.id) : undefined;
          } catch {
            rec = undefined;
          }
          if (rec) out.push({ ...a, uri: d.objectUrl(rec.blob) });
          else out.push(needsBytes(a) ? missingAttachment(a) : a);
          continue;
        }
        if (d.exists && needsBytes(a) && !d.exists(a.uri)) out.push(missingAttachment(a));
        else out.push(a);
      }
      return out;
    },
    async drop(ids) {
      if (!ids.length || !d.blobs) return;
      const s = await open();
      if (!s) return;
      for (const id of ids) {
        try {
          await s.delete(id);
        } catch {
          // gone already; the TTL sweep catches the rest
        }
      }
    },
  };
  return {
    stash: (atts) => serial(() => api.stash(atts)),
    restore: (atts) => serial(() => api.restore(atts)),
    drop: (ids) => serial(() => api.drop(ids)),
  };
}
