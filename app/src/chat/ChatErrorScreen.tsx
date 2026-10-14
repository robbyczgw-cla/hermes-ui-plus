import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { useTheme } from '../ui';
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
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.btn,
        primary
          ? { backgroundColor: t.colors.text, borderColor: t.colors.text }
          : { borderColor: t.colors.borderStrong },
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.btnText, { color: primary ? t.colors.bg : t.colors.text }]}>{label}</Text>
    </Pressable>
  );
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
    >
      <View style={[styles.icon, { backgroundColor: t.colors.dangerSoft }]}>
        <Icon name="alert" size={26} color={t.colors.danger} />
      </View>
      <Text style={[styles.title, { color: t.colors.text }]} accessibilityRole="header">
        {tr('chat.errorScreen.title')}
      </Text>
      <Text style={[styles.msg, { color: t.colors.muted }]} numberOfLines={4} selectable>
        {messageOf(error)}
      </Text>
      <View style={styles.col}>
        {onNewChat ? btn(tr('chat.errorScreen.newChat'), onNewChat, true) : null}
        {btn(tr('chat.errorScreen.retry'), onRetry, !onNewChat)}
        {onResetChat ? btn(tr('chat.errorScreen.resetChat'), onResetChat) : null}
        {onSwitchConnection ? btn(tr('chat.errorScreen.switchConnection'), onSwitchConnection) : null}
      </View>
      {onNewChat ? <Text style={[styles.hint, { color: t.colors.muted }]}>{tr('chat.errorScreen.hint')}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
  icon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '600', textAlign: 'center' },
  msg: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  col: { width: '100%', maxWidth: 360, gap: 10, marginTop: 8 },
  btn: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 16, height: 46, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 4 },
});
