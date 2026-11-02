/**
 * Attachments inside a sent user message: image thumbnails (tap → fullscreen viewer) and file cards
 * (tap → system share sheet; web / desktop: "Öffnen" / "Sichern" buttons, files/WebFileActions). Render it above the user bubble, right-aligned.
 */
import { AttachmentImage } from './AttachmentImage';
import { memo, useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../ui/primitives/Text';
import { useT } from '../../i18n';
import { useImageEdit } from '../../imageedit/context';
import { useTheme } from '../../ui';
import { formatBytes, typeLabel } from '../mime';
import { shareAttachment } from '../share';
import type { Attachment } from '../types';
import { AttIcon } from './icons';
import { ImageViewer } from './ImageViewer';
import { WebFileActions } from '../../files/WebFileActions';
import { FileFetchError } from '../../files/webFileActions';
import { fetchFileBytes } from '../../files/webFileDom';
import { webAttachments } from '../webStore';

export type MessageAttachmentsProps = {
  attachments: readonly Attachment[] | undefined;
  /** 'end' for user messages (default) */
  align?: 'start' | 'end';
  /** max width of the block, default 280 (fits 360 px screens with bubble margins) */
  maxWidth?: number;
};

const GAP = 6;

export const MessageAttachments = memo(function MessageAttachments({ attachments, align = 'end', maxWidth = 280 }: MessageAttachmentsProps) {
  const t = useTheme();
  const tr = useT();
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const editor = useImageEdit();
  if (!attachments?.length) return null;
  // long-press on an image → "✨ Bearbeiten" (only inside a chat)
  const editProps = (img: Attachment) =>
    editor
      ? {
          onLongPress: () => editor.open(editSourceOf(img)),
          delayLongPress: 380,
          accessibilityHint: tr('imageEdit.longPressHint'),
          accessibilityActions: [{ name: 'activate' }, { name: 'longpress', label: tr('imageEdit.actionA11y') }],
          onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => (e.nativeEvent.actionName === 'longpress' ? editor.open(editSourceOf(img)) : setViewing(img)),
        }
      : {};
  const images = attachments.filter((a) => a.kind === 'image');
  const files = attachments.filter((a) => a.kind !== 'image');
  const alignSelf = align === 'end' ? 'flex-end' : 'flex-start';

  // 1 image: natural aspect (clamped); 2+: square grid, 2 or 3 columns
  const single = images.length === 1 ? images[0] : null;
  const cols = images.length <= 4 ? 2 : 3;
  const tile = Math.floor((maxWidth - GAP * (cols - 1)) / cols);
  const singleW = Math.min(maxWidth, 240);
  const singleAspect = single?.width && single?.height ? Math.min(2, Math.max(0.6, single.width / single.height)) : 1;

  return (
    <View style={[styles.wrap, { alignSelf, alignItems: alignSelf, maxWidth }]}>
      {single ? (
        <Pressable onPress={() => setViewing(single)} {...editProps(single)} accessibilityRole="imagebutton" accessibilityLabel={tr('attachments.message.openImage', { name: single.name })}>
          <AttachmentImage
            uri={single.uri}
            style={{ width: singleW, height: Math.round(singleW / singleAspect), borderRadius: t.radii.card, backgroundColor: t.colors.surfaceAlt }}
            contentFit="cover"
            transition={150}
            recyclingKey={single.id}
          />
        </Pressable>
      ) : images.length > 1 ? (
        <View style={[styles.grid, { width: tile * cols + GAP * (cols - 1), justifyContent: align === 'end' ? 'flex-end' : 'flex-start' }]}>
          {images.map((img) => (
            <Pressable key={img.id} onPress={() => setViewing(img)} {...editProps(img)} accessibilityRole="imagebutton" accessibilityLabel={tr('attachments.message.openImage', { name: img.name })}>
              <AttachmentImage
                uri={img.uri}
                style={{ width: tile, height: tile, borderRadius: t.radii.control, backgroundColor: t.colors.surfaceAlt }}
                contentFit="cover"
                transition={150}
                recyclingKey={img.id}
              />
            </Pressable>
          ))}
        </View>
      ) : null}

      {files.map((f) =>
        Platform.OS === 'web' ? (
          <WebFileCard key={f.id} file={f} maxWidth={maxWidth} />
        ) : (
          <Pressable
            key={f.id}
            onPress={() => void shareAttachment(f, tr)}
            accessibilityRole="button"
            accessibilityLabel={tr('attachments.message.fileA11y', { name: f.name, size: formatBytes(f.size) })}
            style={({ pressed }) => [
              styles.card,
              { maxWidth, borderRadius: t.radii.card, borderColor: t.colors.border, backgroundColor: pressed ? t.colors.surfacePressed : t.dark ? t.colors.surface : t.colors.bg },
            ]}
          >
            <View style={[styles.fileIcon, { backgroundColor: t.colors.accent, borderRadius: t.radii.control }]}>
              <AttIcon name="file" size={20} color={t.colors.onAccent} />
            </View>
            <View style={styles.cardText}>
              <Text numberOfLines={1} style={[t.typography.callout, styles.name, { color: t.colors.text }]}>
                {f.name}
              </Text>
              <Text numberOfLines={1} style={[t.typography.caption, styles.sub, { color: t.colors.muted }]}>
                {typeLabel(f.name, f.mimeType, tr)} · {formatBytes(f.size)}
              </Text>
            </View>
          </Pressable>
        ),
      )}

      <ImageViewer attachment={viewing} onClose={() => setViewing(null)} onEdit={editor ? (a) => editor.open(editSourceOf(a)) : undefined} />
    </View>
  );
});

/** web / desktop: the file card with "Öffnen" / "Sichern" (the bytes come from the app's attachment store) */
function WebFileCard({ file, maxWidth }: { file: Attachment; maxWidth: number }) {
  const t = useTheme();
  const tr = useT();
  const src = useMemo(() => ({ key: `att:${file.id}`, name: file.name, mime: file.mimeType, size: file.size }), [file.id, file.name, file.mimeType, file.size]);
  const fetchBytes = useCallback(async () => {
    const url = await webAttachments().resolve(file.uri);
    if (!url) throw new FileFetchError(404);
    return fetchFileBytes(url);
  }, [file.uri]);
  return (
    <View
      style={[styles.card, styles.webCard, { maxWidth, borderRadius: t.radii.card, borderColor: t.colors.border, backgroundColor: t.dark ? t.colors.surface : t.colors.bg }]}
    >
      <View style={styles.webHead} accessible accessibilityRole="text" accessibilityLabel={tr('attachments.web.fileA11y', { name: file.name, sub: formatBytes(file.size) })}>
        <View style={[styles.fileIcon, { backgroundColor: t.colors.accent, borderRadius: t.radii.control }]}>
          <AttIcon name="file" size={20} color={t.colors.onAccent} />
        </View>
        <View style={styles.cardText}>
          <Text numberOfLines={1} style={[t.typography.callout, styles.name, { color: t.colors.text }]}>
            {file.name}
          </Text>
          <Text numberOfLines={1} style={[t.typography.caption, styles.sub, { color: t.colors.muted }]}>
            {typeLabel(file.name, file.mimeType, tr)} · {formatBytes(file.size)}
          </Text>
        </View>
      </View>
      <WebFileActions src={src} fetchBytes={fetchBytes} />
    </View>
  );
}

/** local attachment → edit source (known size/type: the sheet copies it instead of re-encoding) */
function editSourceOf(a: Attachment) {
  return { uri: a.uri, name: a.name, mimeType: a.mimeType, width: a.width, height: a.height, size: a.size, label: a.name };
}

const styles = StyleSheet.create({
  wrap: { gap: GAP, marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 14,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 180,
  },
  fileIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  cardText: { flexShrink: 1, minWidth: 0 },
  name: { fontWeight: '600' },
  sub: { marginTop: 1 },
  webCard: { flexDirection: 'column', alignItems: 'stretch', gap: 10, paddingRight: 10 },
  webHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
