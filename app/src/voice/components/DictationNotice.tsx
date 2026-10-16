/**
 * Inline message under the composer for dictation problems (permission, too short, network, no bridge).
 * Tap the text to dismiss; shows "Einstellungen öffnen" when the mic permission is blocked and
 * "Erneut senden" when a failed transcription can be retried.
 */
import { StyleSheet, View } from 'react-native';
import { Text } from '../../ui/primitives/Text';
import { useT } from '../../i18n';
import { Button, useTheme } from '../../ui';
import type { Dictation } from '../useDictation';

export function DictationNotice({ dictation }: { dictation: Dictation }) {
  const theme = useTheme();
  const t = useT();
  if (!dictation.error) return null;
  return (
    <View style={styles.row} accessibilityRole="alert">
      <Text onPress={dictation.clearError} style={[theme.typography.caption, styles.text, { color: dictation.available ? theme.colors.danger : theme.colors.muted }]} accessibilityHint={t('voice.dictation.dismiss')}>
        {dictation.error}
      </Text>
      {dictation.permissionBlocked ? <Action label={t('voice.dictation.openSettings')} onPress={dictation.openSettings} /> : null}
      {dictation.canRetry ? <Action label={t('voice.dictation.retry')} onPress={() => void dictation.retry()} /> : null}
    </View>
  );
}

function Action({ label, onPress }: { label: string; onPress(): void }) {
  return <Button label={label} variant="tertiary" size="small" onPress={onPress} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 2, paddingHorizontal: 18, paddingTop: 4 },
  text: { flexShrink: 1 },
});
