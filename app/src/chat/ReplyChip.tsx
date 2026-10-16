import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { useT } from '../i18n';
import { useTheme } from '../ui';

/**
 * Compact right-aligned "↩ Reisezeit, Klima" chip for a protocol reply in the user's bubble column
 * (P0-1: the stored message keeps the machine tag, the user sees a short localized summary).
 */
export function ReplyChip({ text }: { text: string }) {
  const t = useTheme();
  const tr = useT();
  return (
    <View
      accessible
      accessibilityLabel={tr('chat.reply.a11y', { text })}
      style={[styles.chip, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.card }]}
    >
      <Text style={[t.typography.caption, styles.arrow, { color: t.colors.subtle }]} aria-hidden>
        ↩
      </Text>
      <Text style={[t.typography.caption, styles.text, { color: t.colors.muted }]} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 12, paddingVertical: 6, maxWidth: '100%', alignSelf: 'flex-end' },
  arrow: { fontWeight: '600' },
  text: { flexShrink: 1, fontWeight: '500' },
});
