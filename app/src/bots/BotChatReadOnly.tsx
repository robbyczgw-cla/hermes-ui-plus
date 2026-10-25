/**
 * In place of the composer in a bot's Bot Chat the app cannot write into (Hermes v0.22.3+, bots/core.ts
 * botChatReadOnly): says why in plain words and offers a new ordinary chat with the same bot. The thread itself stays
 * readable (reminders, routine results); nothing disappears silently.
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '../i18n';
import { Button, HText, Icon, useTheme } from '../ui';

type Props = {
  name: string;
  bottomInset: number;
  onNewChat(): void;
};

export const BotChatReadOnly = memo(function BotChatReadOnly({ name, bottomInset, onNewChat }: Props) {
  const t = useTheme();
  const tr = useT();
  return (
    <View
      testID="bot-chat-read-only"
      style={[styles.bar, { borderTopColor: t.colors.border, backgroundColor: t.colors.surfaceAlt, paddingBottom: 12 + bottomInset }]}
    >
      <View style={styles.row} accessible accessibilityRole="text">
        <Icon name="info" size={16} color={t.colors.muted} />
        <HText variant="caption" color="muted" style={styles.flex}>
          {tr('bots.chat.readOnly', { name })}
        </HText>
      </View>
      <Button label={tr('bots.chat.readOnlyNewChat', { name })} onPress={onNewChat} icon="plus" variant="primary" testID="bot-chat-new-chat" />
    </View>
  );
});

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  flex: { flex: 1 },
});
