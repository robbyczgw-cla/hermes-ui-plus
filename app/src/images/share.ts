/** Share / save a remote image: download to the cache, then the system share sheet (Android "Save", iOS "Save Image"). */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert, Linking, Platform } from 'react-native';
import type { TFn } from '../i18n/core.ts';

export async function shareImageUrl(url: string, t: TFn): Promise<void> {
  if (Platform.OS === 'web') {
    await Linking.openURL(url).catch(() => undefined);
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
