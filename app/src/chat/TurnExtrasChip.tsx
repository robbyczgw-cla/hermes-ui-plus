import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { useT } from '../i18n';
import { useTheme } from '../ui';
import type { TurnExtras } from '../hermes/turnOverride';

/**
 * Right-aligned chips under a user bubble for hidden app text the stored message carried (`[hui:note]` retry note,
 * `[hui:context]` branch context). The text itself is never shown (hermes/sessionMapping.splitStoredExtras).
 */
export function TurnExtrasChips({ extras }: { extras: TurnExtras }) {
  const t = useTheme();
  const tr = useT();
  const labels = [extras.context ? tr('chat.message.extraContext') : '', extras.note ? tr('chat.message.extraNote') : ''].filter(Boolean);
  return (
    <>
      {labels.map((label) => (
        <View key={label} accessible accessibilityLabel={label} style={[styles.chip, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.card }]}>
          <Text style={[t.typography.caption, styles.text, { color: t.colors.muted }]} numberOfLines={2}>
            {label}
          </Text>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 12, paddingVertical: 6, maxWidth: '100%', alignSelf: 'flex-end' },
  text: { flexShrink: 1, fontWeight: '500' },
});
