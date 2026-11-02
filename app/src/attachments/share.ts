/** Open/share a sent attachment with the system share sheet (expo-sharing). */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert, Platform } from 'react-native';
import { FileFetchError, saveWebFile, type FileOutcome } from '../files/webFileActions';
import { browserFileDeps, fetchFileBytes } from '../files/webFileDom';
import type { TFn } from '../i18n/core.ts';
import type { Attachment } from './types';
import { shareFileName } from './uploadCore.ts';
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

/**
 * The app keeps a file as `<id>.<ext>`, and the share sheet (and "Save to Files") names it after the path: share a copy
 * under the file's own name. It stays until the next share, a receiving app may still read it after the sheet closed.
 * A failed copy shares the original rather than nothing.
 */
function namedCopy(att: Attachment): string {
  try {
    const dir = new Directory(Paths.cache, 'hui-share');
    if (dir.exists) dir.delete();
    dir.create({ intermediates: true });
    const copy = new File(dir, shareFileName(att.name, att.id));
    new File(att.uri).copy(copy);
    return copy.uri;
  } catch {
    return att.uri;
  }
}

/**
 * Share/open a file; `t` translates the alert texts. Web / desktop: "Sichern" (files/webFileActions.ts: share sheet on
 * phones, download in browsers, Downloads folder in the desktop app); the outcome is for the caller's toast.
 */
export async function shareAttachment(att: Attachment, t: TFn): Promise<FileOutcome | void> {
  if (Platform.OS === 'web') {
    const src = { key: `att:${att.id}`, name: att.name, mime: att.mimeType, size: att.size };
    return saveWebFile(
      src,
      browserFileDeps(src, async () => {
        const url = await webAttachments().resolve(att.uri);
        if (!url) throw new FileFetchError(404);
        return fetchFileBytes(url);
      }),
    );
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
    await Sharing.shareAsync(namedCopy(att), { mimeType: att.mimeType, dialogTitle: att.name, UTI: UTI[att.mimeType] });
  } catch {
    // user dismissed / no target app
  }
}
