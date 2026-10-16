// Settings → About: the update notice row (only when a newer release exists), "Check for updates" and
// "Report a problem". The rows go inside the About group of SettingsScreen.
import { useState } from 'react';
import { Linking } from 'react-native';
import { useToast } from '../chat/Toast';
import { useT, type TKey } from '../i18n';
import { NavRow, SwitchRow } from '../settings/ui';
import { ProblemReportSheet } from './ProblemReportSheet';
import { currentUpdateTarget, setUpdateChecks, usePendingUpdate, useUpdateState } from './updateStore';
import type { UpdateTarget } from './update';

const HINT: Record<Exclude<UpdateTarget, 'none'>, TKey> = { apk: 'support.update.apk', release: 'support.update.release', web: 'support.update.web' };

/** search texts of the rows (settings search) */
export function supportSearchTexts(t: (k: TKey) => string): string[] {
  return [t('support.report.row'), t('support.update.setting'), 'GitHub', 'Issue', 'Bug', 'Update'];
}

export function SupportRows() {
  const t = useT();
  const toast = useToast();
  const [reporting, setReporting] = useState(false);
  const pending = usePendingUpdate();
  const updates = useUpdateState();
  const target = currentUpdateTarget();

  const openUpdate = () => {
    if (!pending || pending.target === 'web') return;
    void Linking.openURL(pending.target === 'apk' && pending.release.apkUrl ? pending.release.apkUrl : pending.release.pageUrl).catch(() => {});
  };

  return (
    <>
      {pending && pending.target !== 'none' ? (
        <NavRow
          title={t('support.update.available', { version: pending.release.version })}
          subtitle={t(HINT[pending.target])}
          tone="accent"
          onPress={pending.target === 'web' ? undefined : openUpdate}
        />
      ) : null}
      {/* iOS and store installs update through their store: no switch, no request */}
      {target !== 'none' ? <SwitchRow title={t('support.update.setting')} subtitle={t('support.update.settingSub')} value={updates.enabled} onChange={setUpdateChecks} /> : null}
      <NavRow title={t('support.report.row')} subtitle={t('support.report.rowSub')} onPress={() => setReporting(true)} />
      <ProblemReportSheet visible={reporting} onClose={() => setReporting(false)} onToast={toast} />
    </>
  );
}
