import { useEffect } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useT } from '../i18n';
import { Icon, SheetGrabber, SheetModal, haptic, useTheme } from '../ui';
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
            <Text style={[styles.title, { color: t.colors.text }]} accessibilityRole="header" numberOfLines={2}>
              {description.title}
            </Text>
          </View>

          <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={styles.rows} accessible accessibilityLabel={description.summary}>
            {description.rows.map((r, i) => (
              <View key={`${r.label}-${i}`} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border }]}>
                <Text style={[styles.rowLabel, { color: t.colors.muted }]}>{r.label}</Text>
                <Text style={[styles.rowValue, { color: t.colors.text }]} selectable>
                  {r.value}
                </Text>
              </View>
            ))}
            {description.hint ? <Text style={[styles.hint, { color: t.colors.muted }]}>{description.hint}</Text> : null}
          </ScrollView>

          <View style={styles.buttons}>
            <Pressable
              onPress={onCancel}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={tr('actionRunner.sheet.cancel')}
              style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt, opacity: busy ? 0.5 : 1 }]}
            >
              <Text style={[styles.btnText, { color: t.colors.text }]}>{tr('actionRunner.sheet.cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                haptic('light');
                onConfirm();
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={tr('actionRunner.sheet.confirmA11y', { label: description.confirmLabel })}
              style={({ pressed }) => [styles.btn, { backgroundColor: t.colors.accent, opacity: busy ? 0.7 : pressed ? 0.85 : 1 }]}
            >
              {busy ? <ActivityIndicator size="small" color={t.colors.onAccent} /> : <Text style={[styles.btnText, { color: t.colors.onAccent }]}>{tr('actionRunner.sheet.confirm')}</Text>}
            </Pressable>
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
  title: { flex: 1, fontSize: 17, fontWeight: '600' },
  rows: { paddingVertical: 4 },
  row: { paddingVertical: 9, gap: 2 },
  rowLabel: { fontSize: 12.5, fontWeight: '500' },
  rowValue: { fontSize: 15.5, lineHeight: 21 },
  hint: { fontSize: 13, lineHeight: 18, marginTop: 8 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  btnText: { fontSize: 15.5, fontWeight: '600' },
});
