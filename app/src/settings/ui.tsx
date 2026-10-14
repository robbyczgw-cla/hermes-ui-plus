// Grouped-list primitives of the settings screens (iOS-settings look, light/dark via theme tokens).
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View, type LayoutChangeEvent, type TextInputProps } from 'react-native';
import { Icon } from '../chat/icons';
import { useTheme } from '../ui';
import { SEGMENT_FONT_SIZE, segmentedFits } from './segmentedLayout';

export function SectionTitle({ children }: { children: string }) {
  const t = useTheme();
  return (
    <Text style={[styles.sectionTitle, { color: t.colors.muted }]} accessibilityRole="header">
      {children.toUpperCase()}
    </Text>
  );
}

export function SubLabel({ children }: { children: string }) {
  const t = useTheme();
  return <Text style={[styles.subLabel, { color: t.colors.muted }]}>{children}</Text>;
}

export function Group({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={[styles.group, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>{children}</View>;
}

export function Footnote({ children, tone }: { children: string; tone?: 'warning' }) {
  const t = useTheme();
  return <Text style={[styles.footnote, { color: tone === 'warning' ? t.colors.warning : t.colors.subtle }]}>{children}</Text>;
}

/** Tappable row with optional leading icon/emoji, subtitle, trailing value and chevron. */
export function NavRow({
  title,
  subtitle,
  value,
  leading,
  onPress,
  last,
  tone,
  chevron = true,
  disabled,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  leading?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  tone?: 'accent' | 'danger';
  chevron?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  const color = tone === 'accent' ? t.colors.accent : tone === 'danger' ? t.colors.danger : t.colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress || disabled}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={disabled ? { disabled: true } : undefined}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border },
        pressed && { backgroundColor: t.colors.surfacePressed },
        disabled && { opacity: 0.5 },
      ]}
    >
      {leading}
      <View style={styles.flex}>
        <Text style={[styles.rowTitle, { color }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.rowSub, { color: t.colors.muted }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.rowValue, { color: t.colors.muted }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {onPress && chevron ? <Icon name="chevronRight" size={18} color={t.colors.subtle} /> : null}
    </Pressable>
  );
}

export function SwitchRow({ title, subtitle, value, onChange, last }: { title: string; subtitle?: string; value: boolean; onChange(v: boolean): void; last?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border }]}>
      <View style={styles.flex}>
        <Text style={[styles.rowTitle, { color: t.colors.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.rowSub, { color: t.colors.muted }]}>{subtitle}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: t.colors.accent, false: t.colors.borderStrong }} accessibilityLabel={title} />
    </View>
  );
}

/**
 * Segmented control; when its labels would be cut (long options, narrow screen, large system text – segmentedLayout.ts)
 * it renders the same choice as a list of radio rows, so every label is readable in full.
 */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void; label?: string }) {
  const t = useTheme();
  const win = useWindowDimensions();
  // until measured: the settings column (max 640, 16 padding each side) on this window
  const [width, setWidth] = useState(() => Math.min(win.width, 640) - 32);
  const fits = segmentedFits(
    options.map((o) => o.label),
    width,
    win.fontScale,
  );
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== width) setWidth(w);
  };
  if (!fits) {
    return (
      <View onLayout={onLayout} style={[styles.group, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o, i) => {
          const sel = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: sel, checked: sel }}
              style={({ pressed }) => [
                styles.choiceRow,
                i < options.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border },
                pressed && { backgroundColor: t.colors.surfacePressed },
              ]}
            >
              <View style={[styles.radio, { borderColor: sel ? t.colors.accent : t.colors.borderStrong }]}>
                {sel ? <View style={[styles.radioDot, { backgroundColor: t.colors.accent }]} /> : null}
              </View>
              <Text style={[styles.choiceLabel, { color: t.colors.text, fontWeight: sel ? '600' : '400' }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View onLayout={onLayout} style={[styles.segmented, { backgroundColor: t.dark ? t.colors.surfaceAlt : t.colors.surfacePressed }]} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: sel }}
            style={[styles.segment, sel && [{ backgroundColor: t.dark ? t.colors.surfacePressed : t.colors.bg }, t.shadows.sm]]}
          >
            <Text style={{ color: sel ? t.colors.text : t.colors.muted, fontSize: SEGMENT_FONT_SIZE, fontWeight: sel ? '600' : '500' }} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ label, trailing, last, hint, ...input }: TextInputProps & { label: string; trailing?: ReactNode; last?: boolean; hint?: string }) {
  const t = useTheme();
  return (
    <View style={[styles.field, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border }]}>
      <Text style={[styles.fieldLabel, { color: t.colors.muted }]}>{label}</Text>
      <View style={styles.fieldRow}>
        <TextInput
          accessibilityLabel={label}
          {...input}
          autoCorrect={false}
          autoCapitalize={input.autoCapitalize ?? 'none'}
          placeholderTextColor={t.colors.subtle}
          style={[
            styles.fieldInput,
            { color: t.colors.text },
            input.multiline && styles.fieldMultiline,
            Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
          ]}
        />
        {trailing}
      </View>
      {hint ? <Text style={[styles.fieldHint, { color: t.colors.subtle }]}>{hint}</Text> : null}
    </View>
  );
}

export function ResultRow({ label, ok, detail, last }: { label: string; ok: boolean; detail: string; last?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border }]}>
      <Icon name={ok ? 'check' : 'alert'} size={18} color={ok ? t.colors.success : t.colors.danger} strokeWidth={2} />
      <Text style={[styles.rowTitle, { color: t.colors.text, flexShrink: 0 }]}>{label}</Text>
      <Text style={[styles.resultDetail, { color: ok ? t.colors.muted : t.colors.danger }]} numberOfLines={3}>
        {detail}
      </Text>
    </View>
  );
}

export function Button({ label, onPress, loading, kind, disabled }: { label: string; onPress(): void; loading?: boolean; kind: 'primary' | 'secondary'; disabled?: boolean }) {
  const t = useTheme();
  const primary = kind === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      accessibilityRole="button"
      accessibilityState={{ busy: !!loading, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: primary ? t.colors.text : t.colors.surface,
          borderColor: primary ? t.colors.text : t.colors.borderStrong,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={primary ? t.colors.bg : t.colors.text} />
      ) : (
        <Text style={{ color: primary ? t.colors.bg : t.colors.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** Wrapping chips (model lists, presets). */
export function Chips({ items, selected, onPick }: { items: { id: string; label: string }[]; selected?: string; onPick(id: string): void }) {
  const t = useTheme();
  return (
    <View style={styles.chips}>
      {items.map((it) => {
        const sel = it.id === selected;
        return (
          <Pressable
            key={it.id}
            onPress={() => onPick(it.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: sel }}
            style={({ pressed }) => [styles.chip, { backgroundColor: sel ? t.colors.accentSoft : t.colors.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={{ color: sel ? t.colors.accent : t.colors.text, fontSize: 13 }} numberOfLines={1}>
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  sectionTitle: { fontSize: 12.5, fontWeight: '500', letterSpacing: 0.4, marginTop: 14, marginLeft: 14 },
  // B8: breathing room under the label — without it the card below clipped the text ("Profile: …")
  subLabel: { fontSize: 13.5, lineHeight: 18, fontWeight: '500', marginTop: 6, marginBottom: 6, marginLeft: 14 },
  group: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 52, paddingVertical: 8 },
  rowTitle: { fontSize: 16 },
  rowSub: { fontSize: 13, marginTop: 2 },
  rowValue: { fontSize: 15, maxWidth: '45%' },
  footnote: { fontSize: 13, lineHeight: 18, marginHorizontal: 14, marginBottom: 2 },
  field: { paddingHorizontal: 14, paddingTop: 9, paddingBottom: 6 },
  fieldLabel: { fontSize: 12.5, fontWeight: '500' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldInput: { flex: 1, minWidth: 0, fontSize: 16, paddingVertical: Platform.OS === 'ios' ? 6 : 4, paddingHorizontal: 0 },
  fieldMultiline: { minHeight: 64, textAlignVertical: 'top' },
  fieldHint: { fontSize: 12, marginBottom: 2 },
  resultDetail: { flex: 1, minWidth: 0, fontSize: 14, textAlign: 'right' },
  btn: { flex: 1, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8 },
  segmented: { flexDirection: 'row', borderRadius: 12, padding: 3, gap: 3 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 36, borderRadius: 9, paddingHorizontal: 4 },
  choiceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 48, paddingVertical: 10 },
  choiceLabel: { flex: 1, fontSize: 16 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 12 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, maxWidth: '100%' },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 14, marginRight: 6 },
  sectionHeaderTitle: { marginTop: 0, flexShrink: 1 },
  resetBtn: { paddingHorizontal: 8, paddingVertical: 2 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 16, paddingVertical: 0 },
});

/** Section title with an optional "Zurücksetzen" action on the right. */
export function SectionHeader({ title, resetLabel, resetA11y, onReset, resetDisabled }: { title: string; resetLabel?: string; resetA11y?: string; onReset?: () => void; resetDisabled?: boolean }) {
  const t = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, styles.sectionHeaderTitle, { color: t.colors.muted }]} accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {onReset && resetLabel ? (
        <Pressable
          onPress={onReset}
          disabled={resetDisabled}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={resetA11y ?? resetLabel}
          accessibilityState={{ disabled: !!resetDisabled }}
          style={({ pressed }) => [styles.resetBtn, { opacity: resetDisabled ? 0.35 : pressed ? 0.6 : 1 }]}
        >
          <Text style={{ color: resetDisabled ? t.colors.subtle : t.colors.accent, fontSize: 13, fontWeight: '500' }}>{resetLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Rounded search input for the top of the settings list. */
export function SearchField({ value, onChange, placeholder, clearLabel }: { value: string; onChange(v: string): void; placeholder: string; clearLabel: string }) {
  const t = useTheme();
  return (
    <View style={[styles.search, { backgroundColor: t.dark ? t.colors.surfaceAlt : t.colors.surface, borderColor: t.colors.border }]}>
      <Icon name="search" size={17} color={t.colors.subtle} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.colors.subtle}
        accessibilityLabel={placeholder}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        style={[styles.searchInput, { color: t.colors.text }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
      />
      {value ? (
        <Pressable onPress={() => onChange('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={clearLabel}>
          <Icon name="close" size={16} color={t.colors.subtle} />
        </Pressable>
      ) : null}
    </View>
  );
}
