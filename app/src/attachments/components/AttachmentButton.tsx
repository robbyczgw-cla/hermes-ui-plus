/**
 * ＋ button left of the composer input. Opens a bottom sheet with Kamera / Fotos / Datei
 * (ChatGPT-style tiles; same look on Android, iOS and web).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useT, type TKey } from '../../i18n';
import { SheetGrabber, SheetModal, useTheme } from '../../ui';
import type { PickSource } from '../pickers';
import { AttIcon } from './icons';
import type { AttachmentIconName } from './icons';

export type AttachmentButtonProps = {
  onSelect(source: PickSource): void;
  disabled?: boolean;
  /** shows a spinner-ish dimmed state while images are being prepared */
  busy?: boolean;
  /** hide individual sources (e.g. camera on web) */
  sources?: PickSource[];
  size?: number;
};

const OPTIONS: { source: PickSource; labelKey: TKey; icon: AttachmentIconName }[] = [
  { source: 'camera', labelKey: 'attachments.source.camera', icon: 'camera' },
  { source: 'library', labelKey: 'attachments.source.library', icon: 'image' },
  { source: 'document', labelKey: 'attachments.source.document', icon: 'file' },
];

export function AttachmentButton({ onSelect, disabled, busy, sources, size = 36 }: AttachmentButtonProps) {
  const t = useTheme();
  const tr = useT();
  const [open, setOpen] = useState(false);
  const opts = OPTIONS.filter((o) => !sources || sources.includes(o.source));
  const inactive = disabled || busy;

  const choose = (s: PickSource) => {
    setOpen(false);
    // let the sheet close before the system picker opens (iOS cannot present two modals at once)
    setTimeout(() => onSelect(s), 250);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={inactive}
        accessibilityRole="button"
        accessibilityLabel={tr('attachments.button.a11y')}
        accessibilityState={{ disabled: !!inactive, busy: !!busy }}
        hitSlop={6}
        style={({ pressed }) => [
          styles.btn,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt, opacity: inactive ? 0.45 : 1 },
        ]}
      >
        <AttIcon name="plus" size={20} color={t.colors.text} strokeWidth={2.2} />
      </Pressable>

      <SheetModal visible={open} onClose={() => setOpen(false)} closeLabel={tr('actions.close')} label={tr('attachments.button.a11y')} style={styles.sheet}>
        <SheetGrabber style={styles.grabber} />
        <View style={styles.row}>
          {opts.map((o) => (
            <Pressable
              key={o.source}
              onPress={() => choose(o.source)}
              accessibilityRole="button"
              accessibilityLabel={tr(o.labelKey)}
              style={({ pressed }) => [styles.tile, { backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt, borderRadius: t.radii.l }]}
            >
              <AttIcon name={o.icon} size={26} color={t.colors.text} />
              <Text style={[styles.tileLabel, { color: t.colors.text }]}>{tr(o.labelKey)}</Text>
            </Pressable>
          ))}
        </View>
      </SheetModal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center' },
  sheet: { paddingHorizontal: 16 },
  grabber: { marginBottom: 14 },
  row: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, height: 84, alignItems: 'center', justifyContent: 'center', gap: 8 },
  tileLabel: { fontSize: 14, fontWeight: '500' },
});
