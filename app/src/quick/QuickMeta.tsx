/**
 * Under a quick answer: the meta line "⚡ model · 1,6 s" (in place of the turn footer; time to first token) and the
 * "Mit Hermes weitermachen" pill (last answer of the quick thread only; every answer has it in the ⋯ menu).
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { Icon } from '../chat/icons';
import type { QuickStamp } from '../hermes/types';
import { useLocale, useT } from '../i18n';
import { Button, useTheme } from '../ui';
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
        <Text style={[t.typography.caption, styles.text, { color: t.colors.subtle }]} numberOfLines={1}>
          {line}
        </Text>
      ) : null}
    </View>
  );
});

export function HandOffButton({ onPress }: { onPress(): void }) {
  const tr = useT();
  return (
    <Button
      label={tr('quick.handOff.action')}
      size="small"
      onPress={onPress}
      accessibilityHint={tr('quick.handOff.a11y')}
      style={styles.pill}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 8, paddingVertical: 2 },
  text: { fontVariant: ['tabular-nums'], flexShrink: 1 },
  pill: { marginLeft: 'auto' },
});
