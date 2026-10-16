/**
 * Share-as-image, Android / iOS: the frame → a PNG in the app's cache (react-native-view-shot), handed to the system
 * share sheet (expo-sharing). The file stays on the device until the user picks a target in that sheet. A preview
 * that was not shared is deleted when the sheet closes; a shared one stays for KEEP_SHARED_MS – the share sheet hands
 * the receiving app a content URI of this very file and returns as soon as a target is picked, while a mail draft or
 * a messenger may read it only later – and is deleted at a later capture (the OS may clear the cache before).
 * Web / desktop app: shareExport.ts.
 */
import * as Sharing from 'expo-sharing';
import { Platform, type View } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';
import { expiredShares, type ShareActionKind, type ShareEnv } from './shareModel';

/** uri → time it was handed to the share sheet */
const shared = new Map<string, number>();

export type CapturedImage = { uri: string; release(): void };
export type ShareOutcome = 'shared' | 'cancelled' | 'downloaded' | 'saved' | 'copied' | 'failed' | 'unavailable';

export function shareEnvironment(): ShareEnv {
  return { platform: Platform.OS === 'ios' ? 'ios' : 'android', desktop: false, canShareFiles: false, canCopyImage: false };
}

/** native captures at the device pixel ratio (no resampling); `size` / `background` are for the web capture */
export async function captureFrame(view: View, _size: { width: number; height: number }, _background: string, fileName: string): Promise<CapturedImage> {
  for (const old of expiredShares(shared, Date.now())) {
    shared.delete(old);
    releaseCapture(old);
  }
  const uri = await captureRef(view, {
    format: 'png',
    quality: 1,
    result: 'tmpfile',
    fileName: fileName.replace(/\.png$/i, ''),
    // iOS: render the layer tree (drawViewHierarchy skips parts outside the visible window)
    ...(Platform.OS === 'ios' ? { useRenderInContext: true } : {}),
  });
  return { uri, release: () => (shared.has(uri) ? undefined : releaseCapture(uri)) };
}

export async function runShareAction(kind: ShareActionKind, img: CapturedImage, opts: { fileName: string; title: string }): Promise<ShareOutcome> {
  if (kind !== 'share') return 'unavailable';
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  shared.set(img.uri, Date.now());
  await Sharing.shareAsync(img.uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: opts.title });
  return 'shared';
}
