/**
 * Camera / photo library / document picker → prepared Attachments (messages as keys, see AttachmentMsg).
 *
 * Permissions (SDK 57):
 * - camera: always needs CAMERA permission (requested here)
 * - photo library: the system picker needs no permission for images (Android + iOS 14+)
 * - documents: no permission
 * Requires the `expo-image-picker` config plugin in app.json (see INTEGRATION.md).
 */
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Linking, Platform } from 'react-native';
import { classifyFile, DOCUMENT_PICKER_TYPES, formatSizeOverLimit, normalizeMime } from './mime';
import { deleteAttachmentFiles, importFile, prepareImage } from './store';
import { prepareEach } from './prepareEach';
import { importWebFileList } from './webFiles';
import { LIMITS } from './types';
import type { Attachment, AttachmentMsg } from './types';

export type PickSource = 'camera' | 'library' | 'document';

export type PickResult = {
  attachments: Attachment[];
  /** messages (translate with `t(m.key, m.vars)`) for files that were skipped */
  errors: AttachmentMsg[];
  canceled: boolean;
  /** permission permanently denied → offer `openAppSettings()` */
  permissionDenied?: boolean;
};

const EMPTY: PickResult = { attachments: [], errors: [], canceled: true };

export function openAppSettings(): void {
  void Linking.openSettings().catch(() => undefined);
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

async function ensureCameraPermission(): Promise<{ ok: boolean; message?: AttachmentMsg; denied?: boolean }> {
  if (Platform.OS === 'web') return { ok: true };
  let perm = await ImagePicker.getCameraPermissionsAsync();
  if (perm.granted) return { ok: true };
  if (perm.canAskAgain) perm = await ImagePicker.requestCameraPermissionsAsync();
  if (perm.granted) return { ok: true };
  return {
    ok: false,
    denied: !perm.canAskAgain,
    message: perm.canAskAgain ? { key: 'attachments.picker.cameraNoAccess' } : { key: 'attachments.picker.cameraDenied' },
  };
}

async function prepareAssets(assets: ImagePicker.ImagePickerAsset[], prefix: string, onPrepared?: (att: Attachment) => void): Promise<PickResult> {
  const r = await prepareEach(
    assets,
    async (a, i): Promise<Attachment | { skip: AttachmentMsg }> => {
      if (a.type && a.type !== 'image' && a.type !== 'livePhoto') return { skip: { key: 'attachments.picker.videoUnsupported' } };
      return prepareImage(
        { uri: a.uri, width: a.width, height: a.height, mimeType: a.mimeType, name: a.fileName, size: a.fileSize },
        `${prefix} ${stamp()}${assets.length > 1 ? `-${i + 1}` : ''}.jpg`
      );
    },
    { onPrepared, fallbackError: () => ({ key: 'attachments.picker.imageFailed' }) }
  );
  return { ...r, canceled: false };
}

/** Android can kill the activity while the camera is open; call once on mount to recover the photo. */
export async function recoverPendingPick(): Promise<PickResult | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const r = await ImagePicker.getPendingResultAsync();
    if (!r || !('assets' in r) || r.canceled || !r.assets?.length) return null;
    return prepareAssets(r.assets, 'Foto');
  } catch {
    return null;
  }
}

type PickedFile = { uri: string; name: string; mimeType?: string | null; size?: number | null };

/** why a picked / dropped file is not taken (type, size), or null */
function refusal(name: string, mime: string, bytes: number | null | undefined): AttachmentMsg | null {
  if (!classifyFile(mime)) return { key: 'attachments.picker.unsupportedType', vars: { name } };
  if (typeof bytes === 'number' && bytes > LIMITS.maxUploadBytes) {
    return { key: 'attachments.validate.tooLarge', vars: { name, ...formatSizeOverLimit(bytes, LIMITS.maxUploadBytes) } };
  }
  return null;
}

/** one accepted file (normalized mime) → attachment: images prepared like photos, other files copied */
function prepareOne(a: PickedFile & { mimeType: string }): Promise<Attachment> {
  return classifyFile(a.mimeType) === 'image'
    ? prepareImage({ uri: a.uri, mimeType: a.mimeType, name: a.name, size: a.size }, a.name)
    : importFile({ uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size ?? undefined });
}

/** picked / dropped files → attachments (images prepared like photos), at most `remaining`, each reported when ready */
async function importPickedFiles(files: readonly PickedFile[], remaining: number, onPrepared?: (att: Attachment) => void): Promise<PickResult> {
  const errors: AttachmentMsg[] = [];
  const assets = files.slice(0, Math.max(0, remaining));
  if (files.length > remaining) errors.push({ key: 'attachments.picker.onlyRemaining', vars: { remaining } });
  const prepared = await prepareEach(
    assets,
    async (a): Promise<Attachment | { skip: AttachmentMsg }> => {
      const mime = normalizeMime(a.mimeType, a.name);
      const refused = refusal(a.name, mime, a.size);
      return refused ? { skip: refused } : prepareOne({ ...a, mimeType: mime });
    },
    { onPrepared, fallbackError: (a) => ({ key: 'attachments.file.openFailed', vars: { name: a.name } }) }
  );
  return { attachments: prepared.attachments, errors: [...errors, ...prepared.errors], canceled: false };
}

/**
 * "Share to HUI+" (share/): files another app shared (native file:// copies or content:// uris), prepared like picked
 * documents (images like photos), at most `remaining`. Never throws.
 */
export async function importSharedFiles(files: readonly PickedFile[], remaining: number, onPrepared?: (att: Attachment) => void): Promise<PickResult> {
  if (remaining <= 0) {
    return { ...EMPTY, canceled: false, errors: [{ key: 'attachments.validate.tooMany', vars: { max: LIMITS.maxAttachments } }] };
  }
  try {
    return await importPickedFiles(files, remaining, onPrepared);
  } catch {
    return { ...EMPTY, canceled: false, errors: [{ key: 'attachments.picker.failedDocument' }] };
  }
}

/**
 * Web / desktop app: files from drag & drop or the clipboard. Object URLs only for accepted files and only while each
 * is prepared (webFiles.ts); the bytes end up in IndexedDB (webBlobs.ts).
 * `stillWanted` false (the desktop app lock engaged meanwhile) → the prepared file is deleted, the rest not read.
 */
export async function importWebFiles(
  files: readonly File[],
  remaining: number,
  onPrepared?: (att: Attachment) => void,
  stillWanted: () => boolean = () => true
): Promise<PickResult> {
  if (remaining <= 0) {
    return { ...EMPTY, canceled: false, errors: [{ key: 'attachments.validate.tooMany', vars: { max: LIMITS.maxAttachments } }] };
  }
  const at = stamp();
  try {
    const r = await importWebFileList(files, {
      remaining,
      urls: { create: (b) => URL.createObjectURL(b), revoke: (u) => URL.revokeObjectURL(u) },
      // pasted screenshots come as "image.png"
      nameOf: (f, i) =>
        f.name && f.name !== 'image.png' ? f.name : `Bild ${at}${files.length > 1 ? `-${i + 1}` : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`,
      check: (p) => refusal(p.name, normalizeMime(p.mimeType, p.name), p.size),
      prepare: (p) => prepareOne({ ...p, mimeType: normalizeMime(p.mimeType, p.name) }),
      discard: (att) => deleteAttachmentFiles([att]),
      stillWanted,
      onPrepared,
    });
    return { ...r, canceled: false };
  } catch {
    return { ...EMPTY, canceled: false, errors: [{ key: 'attachments.picker.failedDocument' }] };
  }
}

/**
 * Open a picker and prepare the result. `remaining` = free slots in the draft.
 * Never throws; problems are reported in `errors` (German).
 */
export async function pickAttachments(source: PickSource, remaining: number, onPrepared?: (att: Attachment) => void): Promise<PickResult> {
  if (remaining <= 0) {
    return { ...EMPTY, canceled: false, errors: [{ key: 'attachments.validate.tooMany', vars: { max: LIMITS.maxAttachments } }] };
  }
  try {
    if (source === 'camera') {
      const perm = await ensureCameraPermission();
      if (!perm.ok) {
        return { ...EMPTY, canceled: false, errors: [perm.message ?? { key: 'attachments.picker.cameraUnavailable' }], permissionDenied: perm.denied };
      }
      const r = await ImagePicker.launchCameraAsync({
        mediaTypes: 'images',
        quality: 1,
        exif: false,
        // web: standard `capture="environment"` (iOS Safari opens the camera directly)
        ...(Platform.OS === 'web' ? { cameraType: ImagePicker.CameraType.back } : {}),
      });
      if (r.canceled || !r.assets?.length) return EMPTY;
      return prepareAssets(r.assets.slice(0, 1), 'Foto', onPrepared);
    }

    if (source === 'library') {
      const limit = Math.min(LIMITS.maxGalleryPick, remaining);
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsMultipleSelection: limit > 1,
        selectionLimit: limit,
        orderedSelection: true,
        quality: 1,
        exif: false,
        // iOS: hand out JPEG instead of HEIC where possible
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (r.canceled || !r.assets?.length) return EMPTY;
      const res = await prepareAssets(r.assets.slice(0, limit), 'Bild', onPrepared);
      if (r.assets.length > limit) res.errors.push({ key: 'attachments.picker.limitedPick', vars: { limit } });
      return res;
    }

    // documents
    const r = await DocumentPicker.getDocumentAsync({ type: DOCUMENT_PICKER_TYPES, multiple: true, copyToCacheDirectory: true, base64: false });
    if (r.canceled || !r.assets?.length) return EMPTY;
    return await importPickedFiles(r.assets, remaining, onPrepared);
  } catch {
    const key =
      source === 'camera' ? 'attachments.picker.failedCamera' : source === 'library' ? 'attachments.picker.failedLibrary' : 'attachments.picker.failedDocument';
    return { ...EMPTY, canceled: false, errors: [{ key }] };
  }
}
