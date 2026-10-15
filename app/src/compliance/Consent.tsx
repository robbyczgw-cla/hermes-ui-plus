// AI data-sharing consent UI (consent.ts): the text block, a sheet for existing installs / first send, and the
// onboarding step.
import { memo } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { brand } from '../brand';
import { Icon } from '../chat/icons';
import { useT } from '../i18n';
import { Button, OnbScreen, Title } from '../onboarding/ui';
import { SheetGrabber, SheetModal, haptic, useTheme } from '../ui';

function openPrivacy() {
  const url = brand().privacyUrl;
  if (url) void WebBrowser.openBrowserAsync(url).catch(() => {});
}

/** Body + provider line + privacy link (shared by sheet and onboarding step). */
export function ConsentText() {
  const t = useTheme();
  const tr = useT();
  const privacy = brand().privacyUrl;
  return (
    <View style={styles.text}>
      <Text style={[styles.body, { color: t.colors.text }]}>{tr('compliance.consent.body')}</Text>
      <Text style={[styles.providers, { color: t.colors.muted }]}>{tr('compliance.consent.providers')}</Text>
      {privacy ? (
        <Pressable onPress={openPrivacy} accessibilityRole="link" hitSlop={8} style={styles.link}>
          <Text style={[styles.linkText, { color: t.colors.accent }]}>{tr('compliance.consent.privacy')}</Text>
          <Icon name="external" size={14} color={t.colors.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Sheet shown before the first message of a non-demo chat (also after a text version bump). */
export const ConsentSheet = memo(function ConsentSheet({ visible, onAccept, onLater }: { visible: boolean; onAccept: () => void; onLater: () => void }) {
  const t = useTheme();
  const tr = useT();
  const title = tr('compliance.consent.title');
  return (
    <SheetModal visible={visible} onClose={onLater} closeLabel={tr('compliance.consent.later')} label={title} style={styles.sheet} maxHeight="88%">
      <SheetGrabber />
      <View style={styles.head}>
        <View style={[styles.badge, { backgroundColor: t.colors.accentSoft }]}>
          <Icon name="shield" size={18} color={t.colors.accent} />
        </View>
        <Text style={[styles.title, { color: t.colors.text }]} accessibilityRole="header">
          {title}
        </Text>
      </View>
      <ScrollView style={styles.scroll}>
        <ConsentText />
      </ScrollView>
      <View style={styles.buttons}>
        <Pressable
          onPress={onLater}
          accessibilityRole="button"
          style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt }]}
        >
          <Text style={[styles.btnText, { color: t.colors.text }]}>{tr('compliance.consent.later')}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            haptic('light');
            onAccept();
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.btn, styles.btnWide, { backgroundColor: t.colors.accent, opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={[styles.btnText, { color: t.colors.onAccent }]}>{tr('compliance.consent.accept')}</Text>
        </Pressable>
      </View>
    </SheetModal>
  );
});

/** Onboarding step (after the connection is saved, before the first message can go out). */
export function ConsentStep({ onAccept, onBack, step, total }: { onAccept: () => void; onBack?: () => void; step?: number; total?: number }) {
  const tr = useT();
  return (
    <OnbScreen onBack={onBack} step={step} total={total} footer={<Button label={tr('compliance.consent.accept')} onPress={onAccept} />}>
      <Title>{tr('compliance.consent.title')}</Title>
      <ConsentText />
    </OnbScreen>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  badge: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 17, fontWeight: '600' },
  scroll: { flexGrow: 0 },
  text: { gap: 12 },
  body: { fontSize: 15.5, lineHeight: 22 },
  providers: { fontSize: 13.5, lineHeight: 19 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2 },
  linkText: { fontSize: 14, fontWeight: '600' },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  btnWide: { flex: 2 },
  btnText: { fontSize: 15.5, fontWeight: '600' },
});
