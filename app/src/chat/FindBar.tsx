/**
 * "Im Chat suchen": inline find bar under the chat header (chat menu, ⌘/Ctrl+F). Match count, previous / next
 * (Enter / ⇧Enter on a keyboard), Esc or ✕ closes. Matching + highlighting: findInChat.ts / findContext.tsx.
 */
import { memo, useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type NativeSyntheticEvent, type TextInputKeyPressEventData } from 'react-native';
import { useT } from '../i18n';
import { useTheme } from '../ui';
import { useEscapeToClose } from '../ui/lib/useEscapeToClose';
import { Icon, type IconName } from './icons';

type Props = {
  query: string;
  onChange(q: string): void;
  /** number of matches (0 = none) */
  total: number;
  /** 0-based index of the current match (-1 = none) */
  current: number;
  /** the query is long enough to search */
  active: boolean;
  onPrev(): void;
  onNext(): void;
  onClose(): void;
  /** bump to focus the field again (⌘/Ctrl+F while open) */
  focusKey: number;
};

export const FindBar = memo(function FindBar({ query, onChange, total, current, active, onPrev, onNext, onClose, focusKey }: Props) {
  const t = useTheme();
  const tr = useT();
  const input = useRef<TextInput>(null);
  useEscapeToClose(true, onClose);
  useEffect(() => {
    // after the bar's first layout (a focus during the mount frame is dropped on web)
    const id = setTimeout(() => input.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [focusKey]);
  const status = !active ? '' : total ? tr('menus.find.count', { current: current + 1, total }) : tr('menus.find.none');
  const statusA11y = !active ? '' : total ? tr('menus.find.countA11y', { current: current + 1, total }) : tr('menus.find.none');
  const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData & { shiftKey?: boolean }>) => {
    if (Platform.OS !== 'web' || e.nativeEvent.key !== 'Enter') return;
    e.preventDefault();
    if (e.nativeEvent.shiftKey) onPrev();
    else onNext();
  };
  return (
    <View style={[styles.wrap, { borderBottomColor: t.colors.border, backgroundColor: t.colors.bg }]}>
      <View style={[styles.field, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.pill }]}>
        <View style={styles.icon}>
          <Icon name="search" size={16} color={t.colors.subtle} />
        </View>
        <TextInput
          ref={input}
          value={query}
          onChangeText={onChange}
          placeholder={tr('menus.find.placeholder')}
          placeholderTextColor={t.colors.subtle}
          style={[styles.input, { color: t.colors.text, fontFamily: t.fonts.sans }]}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          onSubmitEditing={Platform.OS === 'web' ? undefined : onNext}
          blurOnSubmit={false}
          onKeyPress={onKeyPress}
          accessibilityLabel={tr('menus.find.field')}
        />
        {status ? (
          <Text style={[styles.count, { color: total ? t.colors.muted : t.colors.danger }]} accessibilityLabel={statusA11y} accessibilityLiveRegion="polite" numberOfLines={1}>
            {status}
          </Text>
        ) : null}
      </View>
      <BarButton icon="chevronDown" flip label={tr('menus.find.prev')} onPress={onPrev} disabled={!total} />
      <BarButton icon="chevronDown" label={tr('menus.find.next')} onPress={onNext} disabled={!total} />
      <BarButton icon="close" label={tr('menus.find.close')} onPress={onClose} />
    </View>
  );
});

function BarButton({ icon, label, onPress, disabled, flip }: { icon: IconName; label: string; onPress(): void; disabled?: boolean; flip?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.btn, pressed && { backgroundColor: t.colors.surfacePressed }, disabled && { opacity: 0.35 }]}
    >
      <View style={flip ? styles.flip : undefined}>
        <Icon name={icon} size={18} color={t.colors.text} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 40, marginRight: 4 },
  input: { flex: 1, minWidth: 0, width: '100%', fontSize: 15, paddingVertical: 0, height: 40, outlineStyle: 'none' as never },
  count: { fontSize: 12.5, fontVariant: ['tabular-nums'], flexShrink: 0 },
  icon: { flexShrink: 0 },
  btn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  flip: { transform: [{ rotate: '180deg' }] },
});
