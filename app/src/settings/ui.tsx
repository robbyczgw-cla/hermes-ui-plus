// Grouped-list primitives of the settings screens (iOS-settings look, light/dark via theme tokens).
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent, type TextInputProps } from 'react-native';
import { Text, TextInput } from '../ui/primitives/Text';
import { Icon } from '../chat/icons';
import { Button as UiButton, Toggle, textStyle, useTheme, type ButtonProps } from '../ui';
import { SEGMENT_FONT_SIZE, segmentedFits } from './segmentedLayout';
import { scaledLineLimit } from '../ui/lib/fontScaleLayout';
import { a11yState } from '../ui/lib/a11yState';

export function SectionTitle({ children }: { children: string }) {
  const t = useTheme();
  return (
    <Text style={[styles.sectionTitle, textStyle(t, 'caption'), { color: t.colors.muted, fontWeight: '600' }]} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function SubLabel({ children }: { children: string }) {
  const t = useTheme();
  return <Text style={[styles.subLabel, textStyle(t, 'caption'), { color: t.colors.muted }]}>{children}</Text>;
}

export function Group({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={[styles.group, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radii.card }]}>{children}</View>;
}

export function Footnote({ children, tone }: { children: string; tone?: 'warning' }) {
  const t = useTheme();
  return <Text style={[styles.footnote, textStyle(t, 'caption'), { color: tone === 'warning' ? t.colors.warning : t.colors.subtle }]}>{children}</Text>;
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
  const color = tone === 'accent' ? t.colors.accentText : tone === 'danger' ? t.colors.danger : t.colors.text;
  // 2 lines at text scale 1; at large system text the same description needs more lines
  const subLines = scaledLineLimit(2, useWindowDimensions().fontScale || 1);
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
        <Text style={[styles.rowTitle, textStyle(t, 'body'), { color }]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.rowSub, textStyle(t, 'caption'), { color: t.colors.muted }]} numberOfLines={subLines}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.rowValue, textStyle(t, 'body'), { color: t.colors.muted }]} numberOfLines={1}>
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
        <Text style={[styles.rowTitle, textStyle(t, 'body'), { color: t.colors.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.rowSub, textStyle(t, 'caption'), { color: t.colors.muted }]}>{subtitle}</Text> : null}
      </View>
      <Toggle value={value} onValueChange={onChange} accessibilityLabel={title} />
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
      <View onLayout={onLayout} style={[styles.group, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radii.card }]} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o, i) => {
          const sel = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              {...a11yState({ selected: sel, checked: sel })}
              style={({ pressed }) => [
                styles.choiceRow,
                i < options.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border },
                pressed && { backgroundColor: t.colors.surfacePressed },
              ]}
            >
              <View style={[styles.radio, { borderColor: sel ? t.colors.accent : t.colors.borderStrong }]}>
                {sel ? <View style={[styles.radioDot, { backgroundColor: t.colors.accent }]} /> : null}
              </View>
              <Text style={[styles.choiceLabel, textStyle(t, 'body'), { color: t.colors.text, fontWeight: sel ? '600' : '400' }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View onLayout={onLayout} style={[styles.segmented, { backgroundColor: t.dark ? t.colors.surfaceAlt : t.colors.surfacePressed, borderRadius: t.radii.pill }]} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            {...a11yState({ selected: sel })}
            style={[styles.segment, { borderRadius: t.radii.pill }, sel && [{ backgroundColor: t.dark ? t.colors.surfacePressed : t.colors.bg }, t.shadows.sm]]}
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
      <Text style={[styles.fieldLabel, textStyle(t, 'caption'), { color: t.colors.muted, fontWeight: '500' }]}>{label}</Text>
      <View style={styles.fieldRow}>
        <TextInput
          accessibilityLabel={label}
          {...input}
          autoCorrect={false}
          autoCapitalize={input.autoCapitalize ?? 'none'}
          placeholderTextColor={t.colors.subtle}
          style={[
            styles.fieldInput,
            { color: t.colors.text, fontSize: t.typography.reading.fontSize },
            input.multiline && styles.fieldMultiline,
            Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
          ]}
        />
        {trailing}
      </View>
      {hint ? <Text style={[styles.fieldHint, textStyle(t, 'caption'), { color: t.colors.subtle }]}>{hint}</Text> : null}
    </View>
  );
}

export function ResultRow({ label, ok, detail, last }: { label: string; ok: boolean; detail: string; last?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border }]}>
      <Icon name={ok ? 'check' : 'alert'} size={18} color={ok ? t.colors.success : t.colors.danger} strokeWidth={2} />
      <Text style={[styles.rowTitle, textStyle(t, 'body'), { color: t.colors.text, flexShrink: 0 }]}>{label}</Text>
      <Text style={[styles.resultDetail, textStyle(t, 'callout'), { color: ok ? t.colors.muted : t.colors.danger }]} numberOfLines={3}>
        {detail}
      </Text>
    </View>
  );
}

/**
 * Settings button on top of the app's one `Button`: primary = ink (the one main action of a group), secondary = outline,
 * tertiary = text. Inside a row pass `grow` so the buttons share the width.
 */
export function Button({ label, onPress, loading, kind, disabled, grow, tone, icon, style, testID }: { label: string; onPress(): void; loading?: boolean; kind: ButtonProps['variant']; disabled?: boolean; grow?: boolean; tone?: ButtonProps['tone']; icon?: ButtonProps['icon']; style?: ButtonProps['style']; testID?: string }) {
  return <UiButton label={label} onPress={onPress} variant={kind} tone={tone} icon={icon} loading={loading} disabled={disabled} grow={grow} style={style} testID={testID} />;
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
            {...a11yState({ selected: sel }, 'button')}
            style={({ pressed }) => [styles.chip, { backgroundColor: sel ? t.colors.accentSoft : t.colors.surfaceAlt, borderRadius: t.radii.inline, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[textStyle(t, 'caption'), { color: sel ? t.colors.accentText : t.colors.text }]} numberOfLines={1}>
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
  sectionTitle: { marginTop: 14, marginLeft: 14 },
  // B8: breathing room under the label — without it the card below clipped the text ("Profile: …")
  subLabel: { marginTop: 6, marginBottom: 6, marginLeft: 14 },
  group: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 52, paddingVertical: 8 },
  rowTitle: {},
  rowSub: { marginTop: 2 },
  rowValue: { maxWidth: '45%' },
  footnote: { marginHorizontal: 14, marginBottom: 2 },
  field: { paddingHorizontal: 14, paddingTop: 9, paddingBottom: 6 },
  fieldLabel: {},
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldInput: { flex: 1, minWidth: 0, paddingVertical: Platform.OS === 'ios' ? 6 : 4, paddingHorizontal: 0 },
  fieldMultiline: { minHeight: 64, textAlignVertical: 'top' },
  fieldHint: { marginBottom: 2 },
  resultDetail: { flex: 1, minWidth: 0, textAlign: 'right' },
  segmented: { flexDirection: 'row', padding: 3, gap: 3 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 36, paddingHorizontal: 4 },
  choiceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 48, paddingVertical: 10 },
  choiceLabel: { flex: 1 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 12 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, maxWidth: '100%' },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 14, marginRight: 6 },
  sectionHeaderTitle: { marginTop: 0, flexShrink: 1 },
  resetBtn: { paddingHorizontal: 8, paddingVertical: 2 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 0 },
});

/** Section title with an optional "Zurücksetzen" action on the right. */
export function SectionHeader({ title, resetLabel, resetA11y, onReset, resetDisabled }: { title: string; resetLabel?: string; resetA11y?: string; onReset?: () => void; resetDisabled?: boolean }) {
  const t = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, styles.sectionHeaderTitle, textStyle(t, 'caption'), { color: t.colors.muted, fontWeight: '600' }]} accessibilityRole="header">
        {title}
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
          <Text style={[textStyle(t, 'caption'), { color: resetDisabled ? t.colors.subtle : t.colors.accentText, fontWeight: '500' }]}>{resetLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Rounded search input for the top of the settings list. */
export function SearchField({ value, onChange, placeholder, clearLabel }: { value: string; onChange(v: string): void; placeholder: string; clearLabel: string }) {
  const t = useTheme();
  return (
    <View style={[styles.search, { backgroundColor: t.dark ? t.colors.surfaceAlt : t.colors.surface, borderColor: t.colors.borderControl, borderRadius: t.radii.control }]}>
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
        style={[styles.searchInput, { color: t.colors.text, fontSize: t.typography.reading.fontSize }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
      />
      {value ? (
        <Pressable onPress={() => onChange('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={clearLabel}>
          <Icon name="close" size={16} color={t.colors.subtle} />
        </Pressable>
      ) : null}
    </View>
  );
}
