// Settings → Verbindungen → "Verbindung prüfen": the onboarding diagnostics for the active profile, any time.
// Fixes that need a different address / key open the profile editor (onEdit).
import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import type { ConnectionProfile } from '../../settings/profiles';
import { HText, useTheme } from '../../ui';
import { Button, Notice, OnbIcon } from '../ui';
import { displayHost, normalizeServerUrl } from '../url';
import { CheckResult, useConnectionCheck, type FixAction } from './Diagnostics';

export function ConnectionCheckPage({ profile, bottomInset, onEdit }: { profile: ConnectionProfile | undefined; bottomInset: number; onEdit: () => void }) {
  const t = useTheme();
  const tr = useT();
  const check = useConnectionCheck();
  const hermes = profile?.kind === 'hermes';
  const url = hermes ? normalizeServerUrl(profile.baseUrl) : null;
  const target = url?.ok ? url : null;
  const key = profile?.apiKey ?? '';

  const run = () => {
    if (target) check.run(target, key);
  };
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rerun when the checked connection changes
  }, [target?.baseUrl, key]);

  const onFix = (a: FixAction) => {
    if (a === 'retry') run();
    else onEdit();
  };

  return (
    <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset + 24 }]} keyboardShouldPersistTaps="handled">
      {!profile || !hermes || !target ? (
        <Notice tone="info" text={tr('onboarding.diag.settings.notHermes', { name: profile?.name ?? '–' })} />
      ) : (
        <>
          <View style={[styles.server, { borderColor: t.colors.border, backgroundColor: t.colors.bg, borderRadius: t.radii.l }]}>
            <View style={[styles.serverIcon, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.m }]}>
              <OnbIcon name="server" size={20} color={t.colors.text} />
            </View>
            <View style={styles.flex1}>
              <HText variant="bodyStrong" numberOfLines={1}>
                {profile.name}
              </HText>
              <HText variant="caption" color="muted" numberOfLines={1}>
                {displayHost(target)}
              </HText>
            </View>
          </View>
          <CheckResult state={check.state} onFix={onFix} />
          <Button variant="secondary" label={tr('onboarding.diag.settings.run')} onPress={run} loading={check.state.phase === 'testing'} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 4, width: '100%', maxWidth: 560, alignSelf: 'center' },
  flex1: { flex: 1 },
  server: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, marginBottom: 14 },
  serverIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
