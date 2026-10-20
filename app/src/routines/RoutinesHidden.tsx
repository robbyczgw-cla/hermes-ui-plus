// The /routines route while Settings → Chat → "Routinen" is off on this device (routines/enabled.ts): a deep link, a
// restored route or an older Routine notification lands here instead of on the Routines screen. A short explanation
// and "Turn on Routines"; turning it on swaps in the real screen (app/routines.tsx).
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../ui/primitives/Text';
import { Button, textStyle, useTheme } from '../ui';
import { useEscapeToClose } from '../ui/lib/useEscapeToClose';
import { useTitlebarInset } from '../desktop/chrome';
import { useT } from '../i18n';
import { usePreferences } from '../settings/PreferencesProvider';

export function RoutinesHidden() {
  const th = useTheme();
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const titlebarInset = useTitlebarInset();
  const { set } = usePreferences();
  const close = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/')), [router]);
  useEscapeToClose(true, close);

  return (
    <View style={[styles.flex, { backgroundColor: th.colors.bg }]}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8, borderBottomColor: th.colors.border }, titlebarInset > 0 && { paddingLeft: titlebarInset }]}>
        <View style={styles.headerSide} />
        <Text style={[styles.headerTitle, textStyle(th, 'headline'), { color: th.colors.text }]} numberOfLines={1} accessibilityRole="header">
          {t('routines.title')}
        </Text>
        <Pressable onPress={close} hitSlop={10} accessibilityRole="button" style={[styles.headerSide, { alignItems: 'flex-end' }]} testID="routines-done">
          <Text style={[textStyle(th, 'headline'), { color: th.colors.accentText }]} numberOfLines={1}>
            {t('settings.screen.done')}
          </Text>
        </Pressable>
      </View>
      <View style={styles.content}>
        <View style={[styles.card, { backgroundColor: th.colors.surface, borderColor: th.colors.border, borderRadius: th.radii.card }]} testID="routines-hidden">
          <Text style={[textStyle(th, 'headline'), { color: th.colors.text }]} accessibilityRole="header">
            {t('routines.disabled.title')}
          </Text>
          <Text style={[styles.body, textStyle(th, 'body'), { color: th.colors.muted }]}>{t('routines.disabled.body')}</Text>
          <View style={styles.actions}>
            <Button label={t('routines.disabled.enable')} onPress={() => set('routines', true)} variant="secondary" size="small" testID="routines-enable" />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerSide: { minWidth: 76 },
  headerTitle: { flex: 1, textAlign: 'center' },
  content: { paddingHorizontal: 16, paddingTop: 8, width: '100%', maxWidth: 720, alignSelf: 'center' },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 16, marginTop: 8 },
  body: { marginTop: 6 },
  actions: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
