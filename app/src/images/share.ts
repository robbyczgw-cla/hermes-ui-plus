/** Share / save a remote image: download to the cache, then the system share sheet (Android "Save", iOS "Save Image"). */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert, Platform } from 'react-native';
import { mimeFromName } from '../attachments/mime';
import { saveWebFile } from '../files/webFileActions';
import { browserFileDeps, fetchFileBytes } from '../files/webFileDom';
import type { TFn } from '../i18n/core.ts';

/** file name of an image URL (last path segment), "image.jpg" when it has none with an extension */
function imageName(url: string): string {
  try {
    const seg = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    return /\.(jpe?g|png|gif|webp|heic)$/i.test(seg) ? seg : 'image.jpg';
  } catch {
    return 'image.jpg';
  }
}

export async function shareImageUrl(url: string, t: TFn): Promise<void> {
  if (Platform.OS === 'web') {
    // web / desktop: "Sichern" (share sheet on phones, download elsewhere); an image the app may not fetch
    // (another origin without CORS) opens in a new tab instead (files/webFileActions.ts)
    const name = imageName(url);
    const src = { key: url, name, mime: mimeFromName(name) ?? 'image/jpeg', url };
    await saveWebFile(src, browserFileDeps(src, () => fetchFileBytes(url))).catch(() => undefined);
    return;
  }
  try {
    const file = await File.downloadFileAsync(url, new Directory(Paths.cache), { idempotent: true });
    if (!(await Sharing.isAvailableAsync())) return Alert.alert(t('ui.image.shareFailed'));
    await Sharing.shareAsync(file.uri, { mimeType: 'image/*', UTI: 'public.image' });
  } catch {
    Alert.alert(t('ui.image.shareFailed'));
  }
}
