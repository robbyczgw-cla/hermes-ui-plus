import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { Button, useTheme } from '../ui';
import { Icon } from './icons';

export type ChatErrorScreenProps = {
  error: unknown;
  /** remount the chat (same conversation) */
  onRetry(): void;
  /** create a fresh conversation and switch to it */
  onNewChat?(): void;
  /** clear the persisted node state of this conversation, then remount */
  onResetChat?(): void;
  /** open settings; returning with another profile starts a new chat there (no error loop) */
  onSwitchConnection?(): void;
};

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  return '';
}

/**
 * Error screen of the chat boundaries (ChatBoundary + route ErrorBoundary): never a blank screen and
 * never a dead end – a fresh chat always works, even when the crash comes from persisted data.
 */
export function ChatErrorScreen({ error, onRetry, onNewChat, onResetChat, onSwitchConnection }: ChatErrorScreenProps) {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const btn = (label: string, onPress: () => void, primary = false) => (
    <Button key={label} label={label} variant={primary ? 'primary' : 'secondary'} onPress={onPress} />
  );
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
    >
      <View style={[styles.icon, { backgroundColor: t.colors.dangerSoft }]}>
        <Icon name="alert" size={26} color={t.colors.danger} />
      </View>
      <Text style={[t.typography.title, styles.title, { color: t.colors.text }]} accessibilityRole="header">
        {tr('chat.errorScreen.title')}
      </Text>
      <Text style={[t.typography.callout, styles.msg, { color: t.colors.muted }]} numberOfLines={4} selectable>
        {messageOf(error)}
      </Text>
      <View style={styles.col}>
        {onNewChat ? btn(tr('chat.errorScreen.newChat'), onNewChat, true) : null}
        {btn(tr('chat.errorScreen.retry'), onRetry, !onNewChat)}
        {onResetChat ? btn(tr('chat.errorScreen.resetChat'), onResetChat) : null}
        {onSwitchConnection ? btn(tr('chat.errorScreen.switchConnection'), onSwitchConnection) : null}
      </View>
      {onNewChat ? <Text style={[t.typography.caption, styles.hint, { color: t.colors.muted }]}>{tr('chat.errorScreen.hint')}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
  icon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  title: { textAlign: 'center' },
  msg: { textAlign: 'center' },
  col: { width: '100%', maxWidth: 360, gap: 10, marginTop: 8 },
  hint: { textAlign: 'center', marginTop: 4 },
});
