/**
 * Header of the quick thread: back to the chat (left), "⚡ Schnellfragen" with the one honest line under it
 * (no memory, no tools, no live data – said once here, never on every answer), and a menu (right).
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionMenu, type MenuItem } from '../chat/ActionMenu';
import { Icon } from '../chat/icons';
import { useT } from '../i18n';
import { scaledText } from '../settings/preferences';
import { useTheme } from '../ui';

type Props = {
  topInset: number;
  canClear: boolean;
  onBack(): void;
  onClear(): void;
};

export function QuickHeader({ topInset, canClear, onBack, onClear }: Props) {
  const t = useTheme();
  const tr = useT();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const items: MenuItem[] = [
    { key: 'settings', icon: 'settings', label: tr('quick.thread.settings'), onPress: () => router.push('/settings') },
    { key: 'clear', icon: 'trash', label: tr('quick.thread.clear'), onPress: onClear, danger: true, disabled: !canClear },
  ];
  return (
    <View style={[styles.bar, { paddingTop: topInset, backgroundColor: t.colors.bg }]}>
      <View style={styles.row}>
        <Pressable
          onPress={onBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={tr('quick.thread.back')}
          style={({ pressed }) => [styles.btn, pressed && { backgroundColor: t.colors.surfacePressed }]}
        >
          <Icon name="chevronLeft" size={22} color={t.colors.text} />
        </Pressable>
        <View style={styles.center} accessible accessibilityRole="header" accessibilityLabel={`${tr('quick.thread.title')}. ${tr('quick.thread.hint')}`}>
          <View style={styles.titleRow}>
            <Icon name="boltFilled" size={15} color={t.colors.accent} strokeWidth={1.6} />
            <Text style={[styles.title, { color: t.colors.text }, scaledText(17, 22, t.fontScale)]} numberOfLines={1} maxFontSizeMultiplier={1.6}>
              {tr('quick.thread.title')}
            </Text>
          </View>
          <Text style={[styles.subtitle, { color: t.colors.subtle }, scaledText(12, 16, t.fontScale)]} numberOfLines={1} maxFontSizeMultiplier={1.6}>
            {tr('quick.thread.hint')}
          </Text>
        </View>
        <Pressable
          onPress={() => setMenu(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={tr('quick.thread.menu')}
          style={({ pressed }) => [styles.btn, pressed && { backgroundColor: t.colors.surfacePressed }]}
        >
          <Icon name="more" size={22} color={t.colors.text} />
        </Pressable>
      </View>
      {menu ? <ActionMenu visible onClose={() => setMenu(false)} label={tr('quick.thread.menu')} items={items} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { zIndex: 2 },
  row: { minHeight: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  btn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', minWidth: 0, paddingHorizontal: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  title: { fontSize: 17, fontWeight: '600', letterSpacing: -0.2, flexShrink: 1 },
  subtitle: { fontSize: 12, marginTop: 1, flexShrink: 1 },
});
