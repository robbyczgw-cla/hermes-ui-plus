/**
 * Action menu sheet (bottom sheet on phones, centred dialog on wide windows – SheetModal): the answer "⋯" /
 * long-press menu and the chat menu (header ⋯, desktop title menu). Optional small header (timestamp + model),
 * one level of submenus ("Erneut versuchen ▸" swaps the page, a back row returns), quiet items at the very bottom
 * ("Melden"). Rows are ≥ 48 px high; an item runs after the sheet closed.
 */
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useT } from '../i18n';
import { scaledText } from '../settings/preferences';
import { SheetGrabber, SheetModal, haptic, useTheme } from '../ui';
import { Icon, type IconName } from './icons';

export type MenuItem = {
  key: string;
  icon: IconName;
  label: string;
  /** runs after the sheet closed */
  onPress?: () => void;
  /** opens a second page with these items instead */
  submenu?: readonly MenuItem[];
  danger?: boolean;
  /** small muted row below a divider (e.g. "Melden") */
  quiet?: boolean;
  disabled?: boolean;
  /** secondary line (e.g. why it is disabled) */
  hint?: string;
};

export function ActionMenu({
  visible,
  onClose,
  label,
  header,
  items,
}: {
  visible: boolean;
  onClose: () => void;
  /** a11y label of the sheet */
  label: string;
  /** small text block above the items (timestamp, model) */
  header?: ReactNode;
  items: readonly MenuItem[];
}) {
  const tr = useT();
  const [page, setPage] = useState<MenuItem | null>(null);
  const close = () => {
    setPage(null);
    onClose();
  };
  const shown = page?.submenu ?? items;
  const main = shown.filter((i) => !i.quiet);
  const quiet = shown.filter((i) => i.quiet);
  return (
    <SheetModal visible={visible} onClose={close} closeLabel={tr('actions.close')} label={page ? page.label : label} maxWidth={420} maxHeight="88%" style={styles.sheet}>
      <SheetGrabber />
      <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
        {page ? <BackRow label={page.label} onPress={() => setPage(null)} /> : header ? <View style={styles.header}>{header}</View> : null}
        {main.map((it, i) => (
          <Row
            key={it.key}
            item={it}
            first={i === 0 && !page && !header}
            onPress={() => {
              if (it.submenu) {
                haptic('selection');
                setPage(it);
                return;
              }
              close();
              it.onPress?.();
            }}
          />
        ))}
        {quiet.length ? <Divider /> : null}
        {quiet.map((it) => (
          <Row
            key={it.key}
            item={it}
            first
            onPress={() => {
              close();
              it.onPress?.();
            }}
          />
        ))}
      </ScrollView>
    </SheetModal>
  );
}

/** small header text styles for menus (timestamp line + model line) */
export function MenuHeader({ lines }: { lines: string[] }) {
  const t = useTheme();
  const shown = lines.filter(Boolean);
  if (!shown.length) return null;
  return (
    <View accessible accessibilityLabel={shown.join(', ')}>
      {shown.map((l, i) => (
        <Text key={i} style={[i === 0 ? styles.headTitle : styles.headLine, scaledText(i === 0 ? 13 : 12.5, i === 0 ? 18 : 17, t.fontScale), { color: i === 0 ? t.colors.muted : t.colors.subtle }]} numberOfLines={2}>
          {l}
        </Text>
      ))}
    </View>
  );
}

function Row({ item, first, onPress }: { item: MenuItem; first: boolean; onPress: () => void }) {
  const t = useTheme();
  const tr = useT();
  const color = item.danger ? t.colors.danger : item.quiet ? t.colors.muted : t.colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={item.disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!item.disabled }}
      accessibilityLabel={item.hint ? `${item.label}, ${item.hint}` : item.label}
      accessibilityHint={item.submenu ? tr('menus.submenuHint') : undefined}
      style={({ pressed }) => [
        styles.row,
        item.quiet && styles.rowQuiet,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border },
        pressed && { backgroundColor: t.colors.surfacePressed },
        item.disabled && { opacity: 0.45 },
      ]}
    >
      <Icon name={item.icon} size={item.quiet ? 16 : 19} color={color} />
      <View style={styles.rowText}>
        <Text style={[item.quiet ? styles.quietText : styles.text, scaledText(item.quiet ? 13.5 : 15.5, item.quiet ? 18 : 21, t.fontScale), { color }]} numberOfLines={2}>
          {item.label}
        </Text>
        {item.hint ? (
          <Text style={[styles.hint, { color: t.colors.subtle }]} numberOfLines={2}>
            {item.hint}
          </Text>
        ) : null}
      </View>
      {item.submenu ? <Icon name="chevronRight" size={16} color={t.colors.muted} /> : null}
    </Pressable>
  );
}

function BackRow({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  const tr = useT();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tr('menus.back', { label })}
      style={({ pressed }) => [styles.row, styles.back, pressed && { backgroundColor: t.colors.surfacePressed }]}
    >
      <Icon name="chevronLeft" size={18} color={t.colors.muted} />
      <Text style={[styles.backText, { color: t.colors.text }]} numberOfLines={1} accessibilityRole="header">
        {label}
      </Text>
    </Pressable>
  );
}

function Divider() {
  const t = useTheme();
  return <View style={[styles.divider, { backgroundColor: t.colors.border }]} />;
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 0 },
  header: { paddingHorizontal: 20, paddingTop: 2, paddingBottom: 10 },
  headTitle: { fontSize: 13, fontWeight: '600' },
  headLine: { fontSize: 12.5, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 50, paddingHorizontal: 20, paddingVertical: 8 },
  rowQuiet: { minHeight: 44 },
  rowText: { flex: 1, minWidth: 0 },
  text: { fontSize: 15.5 },
  quietText: { fontSize: 13.5 },
  hint: { fontSize: 12, marginTop: 1 },
  back: { minHeight: 48, gap: 8 },
  backText: { fontSize: 15, fontWeight: '600', flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 6, marginBottom: 2 },
});
