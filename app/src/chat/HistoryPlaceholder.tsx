import { StyleSheet, View } from 'react-native';
import { useT } from '../i18n';
import { usePreferences } from '../settings/PreferencesProvider';
import { chatMaxWidth } from '../settings/preferences';
import { HText, useTheme } from '../ui';
import { useSettledAfter } from '../ui/lib/useSettledAfter';
import { HISTORY_HINT_MS } from './messageArea';

/**
 * Message area of a chat whose history is still on its way (a Hermes chat opened here for the first time): three
 * quiet bubble shapes where the newest messages will appear (bottom-anchored like the inverted list, same column
 * width and paddings), no animation, no spinner. A slow Hermes load adds one line after HISTORY_HINT_MS. Also the message
 * area of every other chat while its stored transcript is read (ChatViewPending / SessionPending, without the line).
 */
export function HistoryPlaceholder({ hint: withHint = true }: { hint?: boolean } = {}) {
  const t = useTheme();
  const tr = useT();
  const { prefs } = usePreferences();
  // "Loading the chat from Hermes…" – not for other backends (their history is a local read)
  const hint = useSettledAfter(HISTORY_HINT_MS) && withHint;
  const block = { backgroundColor: t.colors.skeleton };
  const line = [styles.line, block, { borderRadius: t.radii.inline }];
  const bubble = [styles.bubble, block, { borderRadius: t.radii.card }];
  return (
    <View style={styles.flex} accessibilityLiveRegion="polite">
      <View style={[styles.column, { maxWidth: chatMaxWidth(prefs) }]}>
        <View style={styles.hint}>
          {hint ? (
            <HText variant="callout" color="muted" align="center" numberOfLines={2}>
              {tr('conversations.sync.loading')}
            </HText>
          ) : null}
        </View>
        <View style={styles.answer}>
          <View style={[line, { width: '92%' }]} />
          <View style={[line, { width: '84%' }]} />
          <View style={[line, { width: '48%' }]} />
        </View>
        <View style={styles.userRow}>
          <View style={[bubble, { width: '58%' }]} />
        </View>
        <View style={styles.answer}>
          <View style={[line, { width: '96%' }]} />
          <View style={[line, { width: '100%' }]} />
          <View style={[line, { width: '88%' }]} />
          <View style={[line, { width: '62%' }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end', overflow: 'hidden' },
  // MessageList: content paddingHorizontal 16, paddingTop (visual bottom) 10; rows centred at the chat width
  column: { width: '100%', alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 10 },
  // the line's room is kept before it shows: nothing moves when it appears
  hint: { minHeight: 40, justifyContent: 'flex-end', paddingBottom: 16 },
  answer: { gap: 10, paddingTop: 16, paddingBottom: 6 },
  line: { height: 12 },
  userRow: { alignItems: 'flex-end', paddingLeft: 56, paddingTop: 20, paddingBottom: 4 },
  bubble: { height: 40 },
});
