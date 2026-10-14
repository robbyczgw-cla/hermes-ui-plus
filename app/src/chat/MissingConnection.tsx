import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT, type TKey } from '../i18n';
import type { ConnectionProfile, ProfileKind } from '../settings/profiles';
import { useTheme } from '../ui';
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
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.btn,
        primary ? { backgroundColor: t.colors.text, borderColor: t.colors.text } : { borderColor: t.colors.borderStrong },
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.btnText, { color: primary ? t.colors.bg : t.colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
    >
      <View style={[styles.icon, { backgroundColor: t.colors.warningSoft }]}>
        <Icon name="alert" size={26} color={t.colors.warning} />
      </View>
      <Text style={[styles.title, { color: t.colors.text }]} accessibilityRole="header">
        {tr('chat.missingConnection.title')}
      </Text>
      <Text style={[styles.msg, { color: t.colors.muted }]}>{tr('chat.missingConnection.text', { kind: kindName })}</Text>
      <View style={styles.col}>
        {candidates.length ? (
          <>
            <Text style={[styles.hint, { color: t.colors.muted }]}>{tr('chat.missingConnection.pickHint', { kind: kindName })}</Text>
            {candidates.map((p) => btn(p.id, tr('chat.missingConnection.pick', { name: p.name }), () => onPick(p.id)))}
          </>
        ) : (
          <Text style={[styles.hint, { color: t.colors.muted }]}>{tr('chat.missingConnection.none', { kind: kindName })}</Text>
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
  title: { fontSize: 19, fontWeight: '600', textAlign: 'center' },
  msg: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  col: { width: '100%', maxWidth: 360, gap: 10, marginTop: 8 },
  btn: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 16, height: 46, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 13, textAlign: 'center' },
});
