/** expo-image for an attachment's `uri`: web / desktop app attachments (`hui-att:`) show from their session URL. */
import { Image, type ImageProps } from 'expo-image';
import { useAttachmentUri } from '../useAttachmentUri';

export function AttachmentImage({ uri, ...rest }: Omit<ImageProps, 'source'> & { uri: string }) {
  const shown = useAttachmentUri(uri);
  return <Image {...rest} source={shown ? { uri: shown } : null} />;
}
