/**
 * Horizontal strip above the composer input: image thumbnails + file chips with remove ×,
 * upload progress and error state (tap an errored item to retry).
 */
import { AttachmentImage } from './AttachmentImage';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useT, type TFn } from '../../i18n';
import { useTheme } from '../../ui';
import type { Theme } from '../../ui';
import { formatBytes, typeLabel } from '../mime';
import type { Attachment } from '../types';
import { AttIcon } from './icons';

export type AttachmentTrayProps = {
  attachments: readonly Attachment[];
  onRemove(id: string): void;
  /** tap on an item in error state */
  onRetry?(id: string): void;
  /** shows a placeholder tile while the picker result is being prepared */
  pending?: boolean;
};

const THUMB = 60;

export function AttachmentTray({ attachments, onRemove, onRetry, pending }: AttachmentTrayProps) {
  const t = useTheme();
  const tr = useT();
  if (attachments.length === 0 && !pending) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.row}
      style={styles.scroll}
      accessibilityLabel={tr('attachments.tray.count', { count: attachments.length })}
    >
      {attachments.map((a) =>
        a.kind === 'image' ? (
          <ImageItem key={a.id} att={a} t={t} onRemove={onRemove} onRetry={onRetry} />
        ) : (
          <FileItem key={a.id} att={a} t={t} onRemove={onRemove} onRetry={onRetry} />
        )
      )}
      {pending ? (
        <View style={[styles.thumb, styles.center, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.m }]}>
          <ActivityIndicator color={t.colors.muted} />
        </View>
      ) : null}
    </ScrollView>
  );
}

type ItemProps = { att: Attachment; t: Theme; onRemove(id: string): void; onRetry?(id: string): void };

function RemoveBadge({ att, t, onRemove }: Pick<ItemProps, 'att' | 't' | 'onRemove'>) {
  const tr = useT();
  return (
    <Pressable
      onPress={() => onRemove(att.id)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={tr('attachments.tray.remove', { name: att.name })}
      style={[styles.remove, { backgroundColor: t.colors.text, borderColor: t.dark ? t.colors.surface : t.colors.bg }]}
    >
      <AttIcon name="close" size={12} color={t.colors.bg} strokeWidth={2.6} />
    </Pressable>
  );
}

function progressLabel(a: Attachment, tr: TFn): string {
  return a.progress === undefined || a.progress <= 0
    ? tr('attachments.tray.uploading')
    : tr('attachments.tray.uploadingPct', { percent: Math.round(a.progress * 100) });
}

function errorText(a: Attachment, tr: TFn): string {
  return a.error ? tr(a.error.key, a.error.vars) : tr('attachments.tray.errorGeneric');
}

function ImageItem({ att, t, onRemove, onRetry }: ItemProps) {
  const tr = useT();
  const error = att.status === 'error';
  return (
    <View style={styles.item}>
      <Pressable
        disabled={!error || !onRetry}
        onPress={() => onRetry?.(att.id)}
        accessibilityLabel={error ? tr('attachments.tray.errorRetry', { name: att.name, error: errorText(att, tr) }) : att.name}
        style={[styles.thumb, { borderRadius: t.radii.m, backgroundColor: t.colors.surfaceAlt, borderColor: error ? t.colors.danger : t.colors.border }]}
      >
        <AttachmentImage uri={att.uri} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} recyclingKey={att.id} />
        {att.status === 'uploading' ? (
          <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: 'rgba(0,0,0,0.35)' }]}>
            <ActivityIndicator color="#fff" size="small" />
          </View>
        ) : null}
        {error ? (
          <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
            <AttIcon name="alert" size={22} color="#fff" />
          </View>
        ) : null}
      </Pressable>
      <RemoveBadge att={att} t={t} onRemove={onRemove} />
    </View>
  );
}

function FileItem({ att, t, onRemove, onRetry }: ItemProps) {
  const tr = useT();
  const error = att.status === 'error';
  const uploading = att.status === 'uploading';
  const sub = error
    ? errorText(att, tr)
    : uploading
      ? progressLabel(att, tr)
      : `${typeLabel(att.name, att.mimeType, tr)} · ${formatBytes(att.size)}`;
  return (
    <View style={styles.item}>
      <Pressable
        disabled={!error || !onRetry}
        onPress={() => onRetry?.(att.id)}
        accessibilityLabel={
          error && onRetry ? tr('attachments.tray.fileA11yRetry', { name: att.name, sub }) : tr('attachments.tray.fileA11y', { name: att.name, sub })
        }
        style={[
          styles.chip,
          { borderRadius: t.radii.m, backgroundColor: error ? t.colors.dangerSoft : t.colors.surfaceAlt, borderColor: error ? t.colors.danger : t.colors.border },
        ]}
      >
        <View style={[styles.fileIcon, { backgroundColor: error ? t.colors.danger : t.colors.accent, borderRadius: t.radii.s }]}>
          {uploading ? <ActivityIndicator color={t.colors.onAccent} size="small" /> : <AttIcon name={error ? 'alert' : 'file'} size={18} color={error ? '#fff' : t.colors.onAccent} />}
        </View>
        <View style={styles.chipText}>
          <Text numberOfLines={1} style={[styles.name, { color: t.colors.text }]}>
            {att.name}
          </Text>
          <Text numberOfLines={2} style={[styles.sub, { color: error ? t.colors.danger : t.colors.muted }]}>
            {sub}
          </Text>
        </View>
        {uploading && att.progress !== undefined ? (
          <View style={[styles.bar, { backgroundColor: t.colors.border }]}>
            <View style={[styles.barFill, { width: `${Math.round(att.progress * 100)}%`, backgroundColor: t.colors.accent }]} />
          </View>
        ) : null}
      </Pressable>
      <RemoveBadge att={att} t={t} onRemove={onRemove} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { paddingHorizontal: 4, paddingTop: 8, paddingBottom: 6, gap: 10, alignItems: 'flex-start' },
  item: { position: 'relative', paddingTop: 6, paddingRight: 6 },
  thumb: { width: THUMB, height: THUMB, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  center: { alignItems: 'center', justifyContent: 'center' },
  chip: {
    height: THUMB,
    width: 196,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  fileIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  chipText: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: '600' },
  sub: { fontSize: 12, lineHeight: 15, marginTop: 1 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 },
  barFill: { height: 3 },
  remove: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
