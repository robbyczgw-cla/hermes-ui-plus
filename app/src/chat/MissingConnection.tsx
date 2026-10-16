import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT, type TKey } from '../i18n';
import type { ConnectionProfile, ProfileKind } from '../settings/profiles';
import { Button, useTheme } from '../ui';
import { Icon } from './icons';

type Props = {
  kind: ProfileKind;
  /** other profiles of the chat's kind (the chat may continue there, explicitly) */
  candidates: ConnectionProfile[];
  onPick(profileId: string): void;
  onNewChat(): void;
  onOpenSettings(): void;
  onOpenDrawer(): void;
};

/**
 * "Verbindung fehlt": the chat's profile was deleted. Nothing is sent anywhere until the user picks
 * another profile of the same kind or starts a new chat.
 */
export function MissingConnection({ kind, candidates, onPick, onNewChat, onOpenSettings, onOpenDrawer }: Props) {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const kindName = tr(`settings.kinds.${kind}.title` as TKey);
  const btn = (key: string, label: string, onPress: () => void, primary = false) => (
    <Button key={key} label={label} variant={primary ? 'primary' : 'secondary'} numberOfLines={2} onPress={onPress} />
  );
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
    >
      <View style={[styles.icon, { backgroundColor: t.colors.warningSoft }]}>
        <Icon name="alert" size={26} color={t.colors.warning} />
      </View>
      <Text style={[t.typography.title, styles.title, { color: t.colors.text }]} accessibilityRole="header">
        {tr('chat.missingConnection.title')}
      </Text>
      <Text style={[t.typography.callout, styles.msg, { color: t.colors.muted }]}>{tr('chat.missingConnection.text', { kind: kindName })}</Text>
      <View style={styles.col}>
        {candidates.length ? (
          <>
            <Text style={[t.typography.caption, styles.hint, { color: t.colors.muted }]}>{tr('chat.missingConnection.pickHint', { kind: kindName })}</Text>
            {candidates.map((p) => btn(p.id, tr('chat.missingConnection.pick', { name: p.name }), () => onPick(p.id)))}
          </>
        ) : (
          <Text style={[t.typography.caption, styles.hint, { color: t.colors.muted }]}>{tr('chat.missingConnection.none', { kind: kindName })}</Text>
        )}
        {btn('new', tr('chat.missingConnection.newChat'), onNewChat, true)}
        {btn('settings', tr('chat.missingConnection.settings'), onOpenSettings)}
        {btn('chats', tr('chat.missingConnection.chats'), onOpenDrawer)}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
  icon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  title: { textAlign: 'center' },
  msg: { textAlign: 'center' },
  col: { width: '100%', maxWidth: 360, gap: 10, marginTop: 8 },
  hint: { textAlign: 'center' },
});
