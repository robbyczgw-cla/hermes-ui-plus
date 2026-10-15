/** Open/share a sent attachment with the system share sheet (expo-sharing). */
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert, Linking, Platform } from 'react-native';
import type { TFn } from '../i18n/core.ts';
import type { Attachment } from './types';
import { webAttachments } from './webStore';

const UTI: Record<string, string> = {
  'application/pdf': 'com.adobe.pdf',
  'image/jpeg': 'public.jpeg',
  'image/png': 'public.png',
  'text/plain': 'public.plain-text',
  'text/csv': 'public.comma-separated-values-text',
  'application/json': 'public.json',
};

export function attachmentFileExists(att: Pick<Attachment, 'uri'>): boolean {
  if (Platform.OS === 'web') return true;
  try {
    return new File(att.uri).exists;
  } catch {
    return false;
  }
}

/** Share/open a file; `t` translates the alert texts. */
export async function shareAttachment(att: Attachment, t: TFn): Promise<void> {
  if (Platform.OS === 'web') {
    const url = await webAttachments().resolve(att.uri);
    if (!url) {
      Alert.alert(t('attachments.share.unavailableTitle'), t('attachments.share.gone', { name: att.name }));
      return;
    }
    await Linking.openURL(url).catch(() => undefined);
    return;
  }
  if (!attachmentFileExists(att)) {
    Alert.alert(t('attachments.share.unavailableTitle'), t('attachments.share.gone', { name: att.name }));
    return;
  }
  if (!(await Sharing.isAvailableAsync())) {
    Alert.alert(t('attachments.share.impossibleTitle'), t('attachments.share.noDialog'));
    return;
  }
  try {
    await Sharing.shareAsync(att.uri, { mimeType: att.mimeType, dialogTitle: att.name, UTI: UTI[att.mimeType] });
  } catch {
    // user dismissed / no target app
  }
}
