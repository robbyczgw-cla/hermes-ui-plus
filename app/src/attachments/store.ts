/**
 * Native file handling: image preparation (downscale + JPEG), persistent copies in
 * `<documents>/attachments/` (needed for thumbnails and for Claude history replay after restarts),
 * the AttachmentReader used by the encoders, and cleanup.
 *
 * Memory: the original image is never loaded into JS (no picker base64). It is decoded natively by
 * expo-image-manipulator, written to disk, and the native ImageRefs are released immediately.
 * Base64 is produced only when a message is encoded (reader), one file at a time.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImageRef } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { newAttachmentId } from './draft';
import { extOf, MIME, normalizeMime, withExt } from './mime';
import { AttachmentError, LIMITS } from './types';
import type { Attachment, AttachmentReader } from './types';

const IS_WEB = Platform.OS === 'web';
const DIR_NAME = 'attachments';

function attachmentsDir(): Directory {
  const d = new Directory(Paths.document, DIR_NAME);
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

/** Move/copy a local file into the attachments dir as `<id>.<ext>`; returns the new uri + size. */
async function persist(srcUri: string, id: string, ext: string, move: boolean): Promise<{ uri: string; size: number }> {
  if (IS_WEB) {
    // web preview: no document dir; keep the blob:/data: URL (lives as long as the tab)
    const blob = await (await fetch(srcUri)).blob();
    return { uri: srcUri, size: blob.size };
  }
  const src = new File(srcUri);
  const dest = new File(attachmentsDir(), `${id}.${ext || 'bin'}`);
  if (move) await src.move(dest);
  else await src.copy(dest);
  return { uri: dest.uri, size: dest.size };
}

export type ImageSource = {
  uri: string;
  width?: number;
  height?: number;
  mimeType?: string | null;
  name?: string | null;
  size?: number | null;
};

async function renderJpeg(source: string | ImageRef, w: number, h: number, quality: number) {
  const ctx = ImageManipulator.manipulate(source);
  const long = Math.max(w, h);
  if (long > LIMITS.imageMaxEdge) {
    if (w >= h) ctx.resize({ width: LIMITS.imageMaxEdge, height: null });
    else ctx.resize({ width: null, height: LIMITS.imageMaxEdge });
  }
  const ref = await ctx.renderAsync();
  try {
    return await ref.saveAsync({ format: SaveFormat.JPEG, compress: quality });
  } finally {
    ref.release();
    ctx.release();
  }
}

/**
 * Downscale to ≤ 2048 px long edge + JPEG 0.8 (0.6 if still > maxImageBytes). Small JPEG/PNG
 * originals within the limits are kept byte-identical (no re-compression, PNG transparency kept).
 */
export async function prepareImage(src: ImageSource, fallbackName: string): Promise<Attachment> {
  const id = newAttachmentId();
  const rawName = src.name || fallbackName;
  const mime = normalizeMime(src.mimeType, rawName);
  let w = src.width ?? 0;
  let h = src.height ?? 0;

  const keep =
    (mime === MIME.jpeg || mime === MIME.png) &&
    w > 0 &&
    h > 0 &&
    Math.max(w, h) <= LIMITS.imageMaxEdge &&
    typeof src.size === 'number' &&
    src.size > 0 &&
    src.size <= LIMITS.keepOriginalImageBytes;
  if (keep) {
    const p = await persist(src.uri, id, mime === MIME.png ? 'png' : 'jpg', false);
    return { id, kind: 'image', name: rawName, mimeType: mime, size: p.size, uri: p.uri, width: w, height: h, status: 'ready' };
  }

  try {
    let probe: ImageRef | null = null;
    if (!(w > 0 && h > 0)) {
      // dimensions unknown (document picker): decode once natively to read them
      const ctx = ImageManipulator.manipulate(src.uri);
      probe = await ctx.renderAsync();
      ctx.release();
      w = probe.width;
      h = probe.height;
    }
    let out = await renderJpeg(probe ?? src.uri, w, h, LIMITS.jpegQuality);
    let p = await persist(out.uri, id, 'jpg', true);
    if (p.size > LIMITS.maxImageBytes) {
      out = await renderJpeg(probe ?? src.uri, w, h, LIMITS.jpegQualityRetry);
      await deleteUri(p.uri);
      p = await persist(out.uri, id, 'jpg', true);
    }
    probe?.release();
    return {
      id,
      kind: 'image',
      name: withExt(rawName, 'jpg'),
      mimeType: MIME.jpeg,
      size: p.size,
      uri: p.uri,
      width: out.width,
      height: out.height,
      status: 'ready',
    };
  } catch (e) {
    if (e instanceof AttachmentError) throw e;
    throw new AttachmentError('prepare_failed', { key: 'attachments.file.prepareFailed', vars: { name: rawName } });
  }
}

export type FileSource = { uri: string; name: string; mimeType?: string | null; size?: number | null };

/** Copy a picked document into the attachments dir (picker copies live in the purgeable cache). */
export async function importFile(src: FileSource): Promise<Attachment> {
  const id = newAttachmentId();
  const mime = normalizeMime(src.mimeType, src.name);
  try {
    const p = await persist(src.uri, id, extOf(src.name), false);
    return { id, kind: 'file', name: src.name, mimeType: mime, size: p.size || src.size || 0, uri: p.uri, status: 'ready' };
  } catch {
    throw new AttachmentError('import_failed', { key: 'attachments.file.openFailed', vars: { name: src.name } });
  }
}

async function webBlob(uri: string): Promise<Blob> {
  return (await fetch(uri)).blob();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

/** Reads attachment files on demand (native: expo-file-system File; web: fetch the blob URL). */
export const fileReader: AttachmentReader = {
  async base64(att) {
    if (IS_WEB) return blobToBase64(await webBlob(att.uri));
    return new File(att.uri).base64();
  },
  async text(att) {
    if (IS_WEB) return (await webBlob(att.uri)).text();
    return new File(att.uri).text();
  },
};

export async function deleteUri(uri: string): Promise<void> {
  if (IS_WEB) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}

/** Delete the local copies (draft discarded, chat deleted). */
export async function deleteAttachmentFiles(atts: readonly Pick<Attachment, 'uri'>[]): Promise<void> {
  for (const a of atts) await deleteUri(a.uri);
}

/**
 * Remove files in the attachments dir that no stored chat references any more
 * (call occasionally, e.g. on app start, with all uris from persisted conversations).
 */
export function pruneAttachmentFiles(keepUris: Iterable<string>): number {
  if (IS_WEB) return 0;
  // compare by file name (`<id>.<ext>`): uri spellings (file:/// vs file:/) may differ
  const base = (u: string) => decodeURIComponent(u.split('/').pop() ?? '');
  const keep = new Set([...keepUris].map(base));
  const d = new Directory(Paths.document, DIR_NAME);
  if (!d.exists) return 0;
  let n = 0;
  for (const entry of d.list()) {
    if (entry instanceof File && !keep.has(base(entry.uri))) {
      try {
        entry.delete();
        n++;
      } catch {
        // ignore
      }
    }
  }
  return n;
}
