// AI data-sharing consent UI (consent.ts): the text block, a sheet for existing installs / first send, and the
// onboarding step.
import { memo } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { brand } from '../brand';
import { consentAudience, consentBodyKey, consentProviderName } from './consent';
import { Icon } from '../chat/icons';
import { useT } from '../i18n';
import { Button, OnbScreen, Title } from '../onboarding/ui';
import { Button as UiButton, SheetGrabber, SheetModal, textStyle, useTheme } from '../ui';

function openPrivacy() {
  const url = brand().privacyUrl;
  if (url) void WebBrowser.openBrowserAsync(url).catch(() => {});
}

/** the parts of a connection profile the wording depends on */
type ConsentProfile = { kind: string; baseUrl?: string; provider?: string };

/** Body + provider line + privacy link (shared by sheet and onboarding step), for the connection that sends. */
export function ConsentText({ profile }: { profile?: ConsentProfile | null }) {
  const t = useTheme();
  const tr = useT();
  const privacy = brand().privacyUrl;
  const body = tr(consentBodyKey(consentAudience(profile)));
  return (
    <View style={styles.text}>
      <Text style={[textStyle(t, 'body'), { color: t.colors.text }]}>{body}</Text>
      <Text style={[textStyle(t, 'callout'), { color: t.colors.muted }]}>{tr('compliance.consent.providers')}</Text>
      {privacy ? (
        <Pressable onPress={openPrivacy} accessibilityRole="link" hitSlop={8} style={styles.link}>
          <Text style={[textStyle(t, 'callout'), { color: t.colors.accentText, fontWeight: '600' }]}>{tr('compliance.consent.privacy')}</Text>
          <Icon name="external" size={14} color={t.colors.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Sheet shown before the first message of a non-demo chat (also after a text version bump), for `profile`. */
export const ConsentSheet = memo(function ConsentSheet({ visible, profile, onAccept, onLater }: { visible: boolean; profile?: ConsentProfile | null; onAccept: () => void; onLater: () => void }) {
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
        <Text style={[styles.title, textStyle(t, 'headline'), { color: t.colors.text }]} accessibilityRole="header">
          {title}
        </Text>
      </View>
      <ScrollView style={styles.scroll}>
        <ConsentText profile={profile} />
      </ScrollView>
      <View style={styles.buttons}>
        <UiButton label={tr('compliance.consent.later')} variant="tertiary" onPress={onLater} grow />
        <UiButton label={tr('compliance.consent.accept')} variant="primary" onPress={onAccept} grow style={styles.btnWide} />
      </View>
    </SheetModal>
  );
});

/** Onboarding step (after the connection `profile` is saved, before the first message can go out). */
export function ConsentStep({ profile, onAccept, onBack, step, total }: { profile?: ConsentProfile | null; onAccept: () => void; onBack?: () => void; step?: number; total?: number }) {
  const tr = useT();
  return (
    <OnbScreen onBack={onBack} step={step} total={total} footer={<Button label={tr('compliance.consent.accept')} onPress={onAccept} />}>
      <Title>{tr('compliance.consent.title')}</Title>
      <ConsentText profile={profile} />
    </OnbScreen>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  badge: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1 },
  scroll: { flexGrow: 0 },
  text: { gap: 12 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btnWide: { flexGrow: 2 },
});
