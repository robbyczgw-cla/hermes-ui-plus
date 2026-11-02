/**
 * A file the answer links to (fileLinks.ts), web / desktop: a card with the name, type and size and the "Öffnen" /
 * "Sichern" buttons instead of a bare link that opens the file in place.
 */
import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '../chat/icons';
import type { MediaKind } from '../chat/mediaTags';
import { useT } from '../i18n';
import { useTheme } from '../ui';
import { Text } from '../ui/primitives/Text';
import { parseSizeText, type FileLink } from './fileLinks';
import { WebFileActions } from './WebFileActions';
import { fetchFileBytes } from './webFileDom';

const KIND_ICON: Partial<Record<MediaKind, IconName>> = { image: 'image' };

export const FileLinkCard = memo(function FileLinkCard({ link }: { link: FileLink }) {
  const t = useTheme();
  const tr = useT();
  const src = useMemo(
    () => ({ key: link.href, name: link.name, mime: link.mime, url: link.href, downloadUrl: link.downloadUrl, size: parseSizeText(link.sizeText) }),
    [link],
  );
  const fetchBytes = useCallback(() => fetchFileBytes(link.href), [link.href]);
  const kind = tr(`hermesTools.media.kind.${link.kind}`);
  const sub = link.sizeText ? `${kind} · ${link.sizeText}` : kind;
  return (
    <View
      style={[styles.card, { borderColor: t.colors.border, backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.card }]}
      accessible={false}
    >
      <View style={styles.head} accessible accessibilityRole="text" accessibilityLabel={tr('attachments.web.fileA11y', { name: link.name, sub })}>
        <Icon name={KIND_ICON[link.kind] ?? 'file'} size={22} color={t.colors.muted} />
        <View style={styles.text}>
          <Text numberOfLines={2} style={[t.typography.callout, styles.name, { color: t.colors.text }]}>
            {link.name}
          </Text>
          <Text numberOfLines={1} style={[t.typography.caption, { color: t.colors.muted }]}>
            {sub}
          </Text>
        </View>
      </View>
      <WebFileActions src={src} fetchBytes={fetchBytes} />
    </View>
  );
});

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 10, maxWidth: 420, alignSelf: 'flex-start' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flexShrink: 1, minWidth: 0 },
  name: { fontWeight: '600' },
});
