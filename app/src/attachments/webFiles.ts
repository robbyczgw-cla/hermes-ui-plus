/**
 * Dropped / pasted files on the web and in the desktop app → attachments (pure, node:test; pickers.ts wires it).
 *
 * Object URLs: a file gets one only once it is accepted (within the free slots, type and size allowed), only while it
 * is prepared (one at a time), and it is revoked as soon as the prepared attachment no longer needs it – its bytes are
 * stored (webBlobs.ts) or preparing failed. Only without IndexedDB does the attachment keep the URL; deleting the
 * attachment revokes it then (store.ts `deleteUri`).
 *
 * `stillWanted` (desktop app lock, desktop/files.ts): once false, the file being prepared is discarded and the rest
 * is not read at all.
 */
import { isAttachmentError } from './types.ts';
import type { Attachment, AttachmentMsg } from './types.ts';
import type { UrlRegistry } from './webBlobs.ts';

export type WebPicked = { uri: string; name: string; mimeType: string | null; size: number };

export type WebFileImport<F extends Blob> = {
  /** free slots in the draft */
  remaining: number;
  urls: UrlRegistry;
  /** display name of the i-th file (pasted screenshots come as "image.png") */
  nameOf(f: F, i: number): string;
  /** reason to refuse a file before reading it (type, size), or null */
  check(p: Omit<WebPicked, 'uri'>): AttachmentMsg | null;
  /** read + store one file (store.ts prepareImage / importFile) */
  prepare(p: WebPicked): Promise<Attachment>;
  /** delete a prepared attachment that is not wanted any more */
  discard(att: Attachment): Promise<void>;
  stillWanted(): boolean;
  onPrepared?(att: Attachment): void;
};

export async function importWebFileList<F extends Blob>(files: readonly F[], o: WebFileImport<F>): Promise<{ attachments: Attachment[]; errors: AttachmentMsg[] }> {
  const out: { attachments: Attachment[]; errors: AttachmentMsg[] } = { attachments: [], errors: [] };
  const remaining = Math.max(0, o.remaining);
  if (files.length > remaining) out.errors.push({ key: 'attachments.picker.onlyRemaining', vars: { remaining } });
  const take = files.slice(0, remaining);
  for (let i = 0; i < take.length; i++) {
    if (!o.stillWanted()) break;
    const f = take[i];
    const meta = { name: o.nameOf(f, i), mimeType: f.type || null, size: f.size };
    const refused = o.check(meta);
    if (refused) {
      out.errors.push(refused);
      continue;
    }
    const uri = o.urls.create(f);
    let att: Attachment | null = null;
    try {
      att = await o.prepare({ ...meta, uri });
    } catch (e) {
      out.errors.push(isAttachmentError(e) ? e.msg : { key: 'attachments.file.openFailed', vars: { name: meta.name } });
    } finally {
      if (att?.uri !== uri) o.urls.revoke(uri);
    }
    if (!att) continue;
    if (!o.stillWanted()) {
      await o.discard(att);
      break;
    }
    out.attachments.push(att);
    o.onPrepared?.(att);
  }
  return out;
}
