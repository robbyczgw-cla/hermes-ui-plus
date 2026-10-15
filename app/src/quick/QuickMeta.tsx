/**
 * Under a quick answer: the meta line "⚡ model · 1,6 s" (in place of the turn footer; time to first token) and the
 * "Mit Hermes weitermachen" pill (last answer of the quick thread only; every answer has it in the ⋯ menu).
 */
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../chat/icons';
import type { QuickStamp } from '../hermes/types';
import { useLocale, useT } from '../i18n';
import { scaledText } from '../settings/preferences';
import { useTheme } from '../ui';
import { shortModel } from './core';

export const QuickMetaLine = memo(function QuickMetaLine({ stamp }: { stamp: QuickStamp }) {
  const t = useTheme();
  const tr = useT();
  const { formatNumber } = useLocale();
  const model = shortModel(stamp.model);
  const time = stamp.ms !== undefined ? tr('quick.meta.seconds', { value: formatNumber(Math.max(stamp.ms, 100) / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : undefined;
  const line = [model, time].filter(Boolean).join(' · ');
  const a11y = model ? (time ? tr('quick.meta.a11y', { model, time }) : tr('quick.meta.a11yNoTime', { model })) : tr('quick.meta.a11yPlain');
  return (
    <View style={styles.row} accessible accessibilityLabel={a11y}>
      <Icon name="boltFilled" size={11} color={t.colors.accent} strokeWidth={1.4} />
      {line ? (
        <Text style={[styles.text, scaledText(12, 16, t.fontScale), { color: t.colors.subtle }]} numberOfLines={1}>
          {line}
        </Text>
      ) : null}
    </View>
  );
});

export function HandOffButton({ onPress }: { onPress(): void }) {
  const t = useTheme();
  const tr = useT();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={tr('quick.handOff.action')}
      accessibilityHint={tr('quick.handOff.a11y')}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.pill,
        { borderColor: t.colors.borderStrong },
        (pressed || hovered) && { backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt },
      ]}
    >
      <Text style={[styles.pillText, scaledText(13, 17, t.fontScale), { color: t.colors.text }]} numberOfLines={1}>
        {tr('quick.handOff.action')}
      </Text>
      <Icon name="chevronRight" size={14} color={t.colors.muted} strokeWidth={2.2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 8, paddingVertical: 2 },
  text: { fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'], flexShrink: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto', minHeight: 32, paddingLeft: 12, paddingRight: 8, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  pillText: { fontSize: 13, fontWeight: '600' },
});
