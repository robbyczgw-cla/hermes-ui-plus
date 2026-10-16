import { useEffect } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { useT } from '../i18n';
import { Button, Icon, SheetGrabber, SheetModal, haptic, useTheme } from '../ui';
import type { ActionDescription } from './types.ts';

export type ActionConfirmSheetProps = {
  /** `null` hides the sheet */
  description: ActionDescription | null;
  /** execution in progress: buttons disabled, spinner on "Bestätigen" */
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
};

/**
 * Bottom sheet that tells the user exactly what will happen ("Termin eintragen: Zahnarzt · Di 14. Okt,
 * 10:00–11:00 · Praxis Müller") and asks for "Bestätigen" / "Abbrechen". Mounted by
 * `ActionRunnerProvider`; use it directly only for custom flows.
 */
export function ActionConfirmSheet({ description, busy, onConfirm, onCancel }: ActionConfirmSheetProps) {
  const t = useTheme();
  const tr = useT();
  const open = description !== null;

  useEffect(() => {
    if (!description) return;
    haptic('warning');
    AccessibilityInfo.announceForAccessibility?.(tr('actionRunner.sheet.announce', { summary: description.summary }).slice(0, 200));
  }, [description, tr]);

  return (
    <SheetModal
      visible={open}
      onClose={busy ? undefined : onCancel}
      closeLabel={tr('actionRunner.sheet.cancel')}
      label={description?.title}
      empty={!description}
      style={styles.sheet}
    >
      {description ? (
        <>
          <SheetGrabber style={styles.grabber} />
          <View style={styles.head}>
            <View style={[styles.badge, { backgroundColor: t.colors.accentSoft }]}>
              <Icon name={description.icon} size={18} color={t.colors.accent} />
            </View>
            <Text style={[t.typography.headline, styles.title, { color: t.colors.text }]} accessibilityRole="header" numberOfLines={2}>
              {description.title}
            </Text>
          </View>

          <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={styles.rows} accessible accessibilityLabel={description.summary}>
            {description.rows.map((r, i) => (
              <View key={`${r.label}-${i}`} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border }]}>
                <Text style={[t.typography.caption, styles.rowLabel, { color: t.colors.muted }]}>{r.label}</Text>
                <Text style={[t.typography.body, { color: t.colors.text }]} selectable>
                  {r.value}
                </Text>
              </View>
            ))}
            {description.hint ? <Text style={[t.typography.caption, styles.hint, { color: t.colors.muted }]}>{description.hint}</Text> : null}
          </ScrollView>

          <View style={styles.buttons}>
            <Button label={tr('actionRunner.sheet.cancel')} variant="tertiary" grow disabled={busy} onPress={onCancel} />
            <Button
              label={tr('actionRunner.sheet.confirm')}
              variant="primary"
              grow
              loading={busy}
              accessibilityLabel={tr('actionRunner.sheet.confirmA11y', { label: description.confirmLabel })}
              onPress={onConfirm}
            />
          </View>
        </>
      ) : null}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16 },
  grabber: { marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  badge: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontWeight: '600' },
  rows: { paddingVertical: 4 },
  row: { paddingVertical: 9, gap: 2 },
  rowLabel: { fontWeight: '500' },
  hint: { marginTop: 8 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 14 },
});
