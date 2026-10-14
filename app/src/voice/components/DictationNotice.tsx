/**
 * Inline message under the composer for dictation problems (permission, too short, network, no bridge).
 * Tap the text to dismiss; shows "Einstellungen öffnen" when the mic permission is blocked and
 * "Erneut senden" when a failed transcription can be retried.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useT } from '../../i18n';
import { useTheme } from '../../ui';
import type { Dictation } from '../useDictation';

export function DictationNotice({ dictation }: { dictation: Dictation }) {
  const theme = useTheme();
  const t = useT();
  if (!dictation.error) return null;
  return (
    <View style={styles.row} accessibilityRole="alert">
      <Text onPress={dictation.clearError} style={[styles.text, { color: dictation.available ? theme.colors.danger : theme.colors.muted }]} accessibilityHint={t('voice.dictation.dismiss')}>
        {dictation.error}
      </Text>
      {dictation.permissionBlocked ? <Action label={t('voice.dictation.openSettings')} onPress={dictation.openSettings} /> : null}
      {dictation.canRetry ? <Action label={t('voice.dictation.retry')} onPress={() => void dictation.retry()} /> : null}
    </View>
  );
}

function Action({ label, onPress }: { label: string; onPress(): void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}>
      <Text style={[styles.action, { color: theme.colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 10, rowGap: 2, paddingHorizontal: 18, paddingTop: 4 },
  text: { fontSize: 13, lineHeight: 18, flexShrink: 1 },
  action: { fontSize: 13, fontWeight: '600' },
});
