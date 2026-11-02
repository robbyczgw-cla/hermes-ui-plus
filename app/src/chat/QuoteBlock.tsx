import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { useT } from '../i18n';
import { useTheme } from '../ui';
import { Icon } from './icons';
import type { Quote } from './quoteWire';

type Props = {
  quote: Quote;
  /** sent bubble: tap jumps to the cited message */
  onPress?: () => void;
  /** composer: × removes the quote from the draft */
  onRemove?: () => void;
  /** 1-based position when there are several (screen readers hear "Zitat 2 von 2") */
  pos?: { n: number; of: number };
  testID?: string;
};

/**
 * One quoted excerpt: an accent bar, who said it, two lines of the excerpt. In the composer with ×, in a sent
 * message as a button that jumps to the original. A quote whose original is gone still shows its text (the jump says why).
 */
export function QuoteBlock({ quote, onPress, onRemove, pos, testID }: Props) {
  const t = useTheme();
  const tr = useT();
  const who = quote.role === 'user' ? tr('chat.quote.fromUser') : tr('chat.quote.fromAnswer');
  const a11y = tr(pos && pos.of > 1 ? 'chat.quote.a11yN' : 'chat.quote.a11y', { who, text: quote.text, n: pos?.n ?? 1, of: pos?.of ?? 1 });
  const body = (
    <>
      <View style={[styles.bar, { backgroundColor: t.colors.accent }]} />
      <View style={styles.texts}>
        <Text style={[t.typography.caption, styles.who, { color: t.colors.accentText }]} numberOfLines={1}>
          {who}
        </Text>
        <Text style={[t.typography.caption, { color: t.colors.muted }]} numberOfLines={2}>
          {quote.text}
        </Text>
      </View>
    </>
  );
  if (onRemove) {
    return (
      <View style={[styles.box, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.inline }]}>
        {/* the id on the accessible part: UI tests find it there (a plain container is not in the tree) */}
        <View style={styles.row} accessible accessibilityLabel={a11y} testID={testID}>
          {body}
        </View>
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={tr('chat.quote.remove', { text: quote.text })}
          testID={testID ? `${testID}-remove` : undefined}
          style={({ pressed }) => [styles.remove, pressed && { opacity: 0.6 }]}
        >
          <Icon name="close" size={16} color={t.colors.muted} strokeWidth={2} />
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={a11y}
      accessibilityHint={onPress ? tr('chat.quote.jumpHint') : undefined}
      testID={testID}
      style={({ pressed }) => [styles.box, styles.inner, { backgroundColor: t.dark ? t.colors.surface : t.colors.bg, borderRadius: t.radii.inline }, pressed && { opacity: 0.7 }]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', overflow: 'hidden', alignSelf: 'stretch' },
  // composer: the excerpt next to × (grows sideways); bubble: the whole box (no flex: in a column it would collapse)
  row: { flexDirection: 'row', flex: 1, alignItems: 'stretch', paddingVertical: 6, paddingRight: 10, gap: 8 },
  inner: { alignItems: 'stretch', paddingVertical: 6, paddingRight: 10, gap: 8 },
  bar: { width: 3, borderRadius: 2, marginLeft: 6 },
  texts: { flex: 1, minWidth: 0 },
  who: { fontWeight: '600' },
  remove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
