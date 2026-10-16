// "Report a problem": shows the exact report (support/report.ts) before anything leaves the device, then opens the
// prefilled GitHub issue in the browser, or copies the text instead. Opened from Settings → About and from the
// failure card. The only extra request is the bridge check against the user's own server (connection type).
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { detectBridge } from '../attachments';
import { BG_SERVICE_ENABLED } from '../background/bgService';
import { brand } from '../brand';
import { Icon } from '../chat/icons';
import { desktopConfig } from '../desktop/bridge';
import { FLAVOR } from '../flavor';
import { useHermesCapabilities } from '../hermes';
import { useT } from '../i18n';
import { useActiveProfile } from '../settings/ConnectionProvider';
import { SheetGrabber, SheetModal, haptic, useTheme } from '../ui';
import { buildReport, issuesNewUrl, lastErrorCode, type ConnectionType } from './report';
import { useUpdateState } from './updateStore';

export const ISSUES_NEW_URL = issuesNewUrl(brand('hermes').repoUrl);

export function ProblemReportSheet({ visible, onClose, onToast }: { visible: boolean; onClose(): void; onToast?(text: string): void }) {
  const tr = useT();
  return (
    <SheetModal visible={visible} onClose={onClose} closeLabel={tr('actions.close')} label={tr('support.report.title')} maxHeight="90%" style={styles.sheet} empty={!visible}>
      {visible ? <ReportBody onClose={onClose} onToast={onToast} /> : null}
    </SheetModal>
  );
}

function useConnectionType(): ConnectionType {
  const p = useActiveProfile();
  const [bridge, setBridge] = useState<boolean | null>(null);
  const hermesUrl = p?.kind === 'hermes' ? p.baseUrl : undefined;
  useEffect(() => {
    if (!hermesUrl) return;
    let live = true;
    detectBridge(hermesUrl)
      .then((b) => live && setBridge(b))
      .catch(() => live && setBridge(null));
    return () => {
      live = false;
    };
  }, [hermesUrl]);
  if (!p) return 'unknown';
  if (p.kind === 'demo') return 'demo';
  if (p.kind !== 'hermes') return 'other';
  return bridge === null ? 'unknown' : bridge ? 'bridge' : 'direct';
}

function ReportBody({ onClose, onToast }: { onClose(): void; onToast?(text: string): void }) {
  const t = useT();
  const th = useTheme();
  const profile = useActiveProfile();
  const conn = profile?.kind === 'hermes' ? { baseUrl: profile.baseUrl, apiKey: profile.apiKey } : undefined;
  const { caps } = useHermesCapabilities(conn);
  const connection = useConnectionType();
  const updates = useUpdateState();

  const report = useMemo(
    () =>
      ISSUES_NEW_URL
        ? buildReport(
            {
              appName: brand().displayName,
              version: Constants.expoConfig?.version,
              extra: Constants.expoConfig?.extra,
              os: Platform.OS,
              osVersion: Platform.Version,
              desktop: desktopConfig()?.platform ?? null,
              flavor: FLAVOR,
              connection,
              hermesVersion: caps?.hermesVersion,
              bridgeVersion: caps?.bridgeVersion,
              serverFlags: caps?.flags,
              appFlags: { bg_service: Platform.OS === 'android' && BG_SERVICE_ENABLED, update_check: updates.enabled },
              lastError: lastErrorCode(),
            },
            ISSUES_NEW_URL,
          )
        : null,
    [caps, connection, updates.enabled],
  );

  const copy = async () => {
    if (!report) return;
    haptic('light');
    await Clipboard.setStringAsync(report.text).catch(() => {});
    onToast?.(t('support.report.copied'));
    onClose();
  };
  const open = () => {
    if (!report) return;
    haptic('light');
    Linking.openURL(report.url)
      .then(onClose)
      .catch(async () => {
        await Clipboard.setStringAsync(report.text).catch(() => {});
        onToast?.(t('support.report.openFailed'));
        onClose();
      });
  };

  return (
    <>
      <SheetGrabber />
      <Text style={[styles.title, { color: th.colors.text }]} accessibilityRole="header">
        {t('support.report.title')}
      </Text>
      <Text style={[styles.lead, { color: th.colors.muted }]}>{t('support.report.intro')}</Text>
      <ScrollView style={[styles.preview, { backgroundColor: th.colors.surfaceAlt, borderColor: th.colors.border }]} contentContainerStyle={styles.previewInner}>
        <Text style={[styles.mono, { color: th.colors.text, fontFamily: th.fonts.mono }]} selectable>
          {report?.text ?? ''}
        </Text>
      </ScrollView>
      <View style={styles.buttons}>
        <Pressable onPress={() => void copy()} accessibilityRole="button" style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? th.colors.surfacePressed : th.colors.surfaceAlt }]}>
          <Icon name="copy" size={16} color={th.colors.text} />
          <Text style={[styles.btnText, { color: th.colors.text }]}>{t('support.report.copy')}</Text>
        </Pressable>
        <Pressable onPress={open} accessibilityRole="button" style={({ pressed }) => [styles.btn, { backgroundColor: th.colors.accent, opacity: pressed ? 0.85 : 1 }]}>
          <Text style={[styles.btnText, { color: th.colors.onAccent }]}>{t('support.report.open')}</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16 },
  title: { fontSize: 17, fontWeight: '600', marginBottom: 4 },
  lead: { fontSize: 14, lineHeight: 19, marginBottom: 12 },
  preview: { flexGrow: 0, maxHeight: 320, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  previewInner: { padding: 12 },
  mono: { fontSize: 12.5, lineHeight: 18 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, flexDirection: 'row', gap: 6, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  btnText: { fontSize: 15, fontWeight: '600' },
});
