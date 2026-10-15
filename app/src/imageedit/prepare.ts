/**
 * Native/web I/O for "✨ Bearbeiten": fetch the chat image into a local file, turn it into a prepared
 * Attachment (attachments/store.ts: ≤ 2048 px, JPEG 0.8, persistent copy), on-device quick edits
 * (expo-image-manipulator) and save/share.
 *
 * Auth: chat images are either local files (attachments, generated images), signed adapter URLs
 * (work without headers) or bridge/server URLs that the image views also load without headers, so
 * the download needs no credentials.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';
import { prepareImage } from '../attachments/store';
import type { Attachment } from '../attachments/types';
import { webAttachments } from '../attachments/webStore';
import type { EditSource } from './core';

const IS_WEB = Platform.OS === 'web';

export type WorkImage = { uri: string; width: number; height: number };

function isLocal(uri: string): boolean {
  // hui-att: = a stored web / desktop attachment (attachments/webBlobs.ts): prepareImage reads it itself
  return /^(file|content|blob|ph|assets-library|hui-att):/i.test(uri);
}

function nameFor(src: EditSource): string {
  if (src.name) return src.name;
  const tail = decodeURIComponent((src.uri.split('?')[0] ?? '').split('/').pop() ?? '');
  return /\.(jpe?g|png|webp|gif|heic)$/i.test(tail) ? tail : 'Bild.jpg';
}

/** Remote/data URL → local file (native) or blob URL (web). Returns the uri + a cleanup function (`kept`: the uri the
 * prepared attachment kept – not deleted / revoked then). */
async function fetchLocal(src: EditSource): Promise<{ uri: string; mimeType?: string; size?: number; cleanup(kept?: string): void }> {
  if (isLocal(src.uri)) return { uri: src.uri, mimeType: src.mimeType, size: src.size, cleanup: () => {} };
  if (IS_WEB) {
    const blob = await (await fetch(src.uri)).blob();
    const uri = URL.createObjectURL(blob);
    // revoked once the prepared copy is stored (kept only when it had to keep this URL: no IndexedDB)
    return {
      uri,
      mimeType: blob.type || undefined,
      size: blob.size,
      cleanup: (kept) => {
        if (kept !== uri) URL.revokeObjectURL(uri);
      },
    };
  }
  const dir = new Directory(Paths.cache, 'imageedit');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const m = /^data:([^;,]+)(;base64)?,/i.exec(src.uri);
  let file: File;
  if (m) {
    file = new File(dir, `src-${Date.now()}.${m[1].includes('png') ? 'png' : 'jpg'}`);
    const payload = src.uri.slice(m[0].length);
    file.write(m[2] ? payload : decodeURIComponent(payload), { encoding: m[2] ? 'base64' : 'utf8' });
  } else {
    file = await File.downloadFileAsync(src.uri, new File(dir, `src-${Date.now()}`), { idempotent: true });
  }
  return {
    uri: file.uri,
    cleanup: () => {
      try {
        if (file.exists) file.delete();
      } catch {
        // already gone
      }
    },
  };
}

/**
 * The chat image as a prepared attachment (own persistent copy, also for the user's own
 * attachments: deleting the old message must not break the new one).
 */
export async function prepareEditSource(src: EditSource): Promise<Attachment> {
  const local = await fetchLocal(src);
  let kept: string | undefined;
  try {
    // keep path of prepareImage needs the size + byte count; unknown → it decodes + re-encodes natively
    const att = await prepareImage(
      { uri: local.uri, width: src.width, height: src.height, mimeType: local.mimeType ?? src.mimeType ?? null, name: nameFor(src), size: local.size ?? src.size ?? null },
      nameFor(src),
    );
    // web: the working image needs a session URL of the stored copy (workImageOf)
    if (IS_WEB) await webAttachments().resolve(att.uri);
    kept = att.uri;
    return att;
  } finally {
    local.cleanup(kept);
  }
}

/** the prepared copy as the working image (web: its session URL; prepareEditSource made it) */
export function workImageOf(att: Attachment): WorkImage {
  return { uri: webAttachments().peek(att.uri) ?? att.uri, width: att.width ?? 0, height: att.height ?? 0 };
}

export type QuickOp = { type: 'rotate' } | { type: 'flip' } | { type: 'crop'; rect: { originX: number; originY: number; width: number; height: number } };

/** One quick edit on the working image → a new temporary file (PNG keeps transparency, else JPEG). */
export async function applyQuickOp(img: WorkImage, op: QuickOp, png: boolean): Promise<WorkImage> {
  const ctx = ImageManipulator.manipulate(img.uri);
  if (op.type === 'rotate') ctx.rotate(90);
  else if (op.type === 'flip') ctx.flip('horizontal');
  else ctx.crop(op.rect);
  const ref = await ctx.renderAsync();
  try {
    const out = await ref.saveAsync(png ? { format: SaveFormat.PNG } : { format: SaveFormat.JPEG, compress: 0.92 });
    return { uri: out.uri, width: out.width, height: out.height };
  } finally {
    ref.release();
    ctx.release();
  }
}

/** Working image (after quick edits) → prepared attachment for sending. */
export async function prepareWorkImage(img: WorkImage, name: string, png: boolean): Promise<Attachment> {
  return prepareImage({ uri: img.uri, width: img.width, height: img.height, mimeType: png ? 'image/png' : 'image/jpeg', name }, name);
}

/** System share sheet (Android "Save", iOS "Save Image"); web: download link. Returns false on failure. */
export async function shareImageFile(img: WorkImage, name: string): Promise<boolean> {
  try {
    if (IS_WEB) {
      const doc = (globalThis as { document?: { createElement(tag: string): { href: string; download: string; click(): void } } }).document;
      if (!doc) {
        await Linking.openURL(img.uri);
        return true;
      }
      const a = doc.createElement('a');
      a.href = img.uri;
      a.download = name;
      a.click();
      return true;
    }
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(img.uri, { mimeType: img.uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg', UTI: 'public.image' });
    return true;
  } catch {
    return false;
  }
}
