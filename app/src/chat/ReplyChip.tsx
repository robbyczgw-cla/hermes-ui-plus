import { StyleSheet, Text, View } from 'react-native';
import { useT } from '../i18n';
import { useTheme } from '../ui';
import { scaledText } from '../settings/preferences';

/**
 * Compact right-aligned "↩ Reisezeit, Klima" chip for a protocol reply in the user's bubble column
 * (P0-1: the stored message keeps the machine tag, the user sees a short localized summary).
 */
export function ReplyChip({ text }: { text: string }) {
  const t = useTheme();
  const tr = useT();
  const size = scaledText(13, 18, t.fontScale);
  return (
    <View
      accessible
      accessibilityLabel={tr('chat.reply.a11y', { text })}
      style={[styles.chip, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.l }]}
    >
      <Text style={[styles.arrow, size, { color: t.colors.subtle }]} aria-hidden>
        ↩
      </Text>
      <Text style={[styles.text, size, { color: t.colors.muted }]} numberOfLines={2}>
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
