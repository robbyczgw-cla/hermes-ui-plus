/**
 * Settings → "Mac-App" (macOS desktop app only): open at login (login item, ServiceManagement), menu bar only
 * (no dock icon), Touch ID / password lock with its delay, and the keyboard shortcuts as a footnote.
 */
import { useState } from 'react';
import { useT } from '../i18n';
import type { SettingsSection } from '../settings/sections';
import { Footnote, Group, NavRow, Segmented, SubLabel, SwitchRow } from '../settings/ui';
import { DEFAULT_DESKTOP_PREFS, invokeDesktop, invokeDesktopStrict, type DesktopPrefs } from './bridge';
import { refreshDesktopInfo, setDesktopChrome, useDesktopChrome } from './chrome';

const LOCK_MINUTES = ['0', '1', '5', '15', '60'] as const;
type LockMinutes = (typeof LOCK_MINUTES)[number];

/** the section, or null outside the macOS app */
export function useDesktopSettingsSection(): SettingsSection | null {
  const t = useT();
  const chrome = useDesktopChrome();
  if (!chrome.mac) return null;
  return {
    id: 'desktop',
    title: t('desktop.settings.title'),
    rows: [
      {
        key: 'desktop',
        texts: [
          t('desktop.settings.title'),
          t('desktop.settings.launchAtLogin'),
          t('desktop.settings.menuBarOnly'),
          t('desktop.settings.lock'),
          t('desktop.settings.lockAfter'),
          'Touch ID',
          'Dock',
          t('desktop.settings.shortcuts'),
        ],
        render: () => <DesktopSettings />,
      },
    ],
  };
}

function DesktopSettings() {
  const t = useT();
  const chrome = useDesktopChrome();
  const prefs = chrome.prefs ?? DEFAULT_DESKTOP_PREFS;
  const [error, setError] = useState<string | null>(null);
  const [lockBusy, setLockBusy] = useState(false);

  const savePrefs = async (patch: Partial<DesktopPrefs>) => {
    setError(null);
    try {
      const saved = await invokeDesktopStrict<DesktopPrefs>('desktop_set_prefs', { prefs: { ...prefs, ...patch } });
      setDesktopChrome({ prefs: saved });
    } catch (e) {
      setError(t('desktop.settings.loginItemFailed', { error: String((e as Error)?.message ?? e) }));
    }
  };

  const setLogin = async (on: boolean) => {
    setError(null);
    try {
      const status = await invokeDesktopStrict<string>('desktop_set_login_item', { enabled: on });
      setDesktopChrome({ loginItem: status === 'enabled' || status === 'requiresApproval' ? status : 'disabled' });
    } catch (e) {
      setError(t('desktop.settings.loginItemFailed', { error: String((e as Error)?.message ?? e) }));
      void refreshDesktopInfo();
    }
  };

  // switching the lock on or off needs the same proof as unlocking
  const setLock = async (on: boolean) => {
    if (lockBusy) return;
    setLockBusy(true);
    const ok = await invokeDesktop<boolean>('desktop_unlock', { reason: t('desktop.settings.lockConfirm') });
    setLockBusy(false);
    if (ok === true) await savePrefs({ lockEnabled: on });
  };

  const login = chrome.loginItem;
  const minutes = (LOCK_MINUTES as readonly string[]).includes(String(prefs.lockMinutes)) ? (String(prefs.lockMinutes) as LockMinutes) : '5';
  const minuteLabel = (m: LockMinutes) =>
    m === '0' ? t('desktop.settings.lockLaunchOnly') : m === '60' ? t('desktop.settings.lockHour') : t('desktop.settings.lockMinutes', { count: Number(m) });

  return (
    <>
      <Group>
        <SwitchRow
          title={t('desktop.settings.launchAtLogin')}
          subtitle={login === 'requiresApproval' ? t('desktop.settings.requiresApproval') : t('desktop.settings.launchAtLoginSub')}
          value={login === 'enabled' || login === 'requiresApproval'}
          onChange={(v) => void setLogin(v)}
        />
        {login === 'requiresApproval' ? (
          <NavRow title={t('desktop.settings.openLoginItems')} tone="accent" chevron={false} onPress={() => void invokeDesktop('desktop_open_login_items')} />
        ) : null}
        <SwitchRow title={t('desktop.settings.menuBarOnly')} subtitle={t('desktop.settings.menuBarOnlySub')} value={prefs.menuBarOnly} onChange={(v) => void savePrefs({ menuBarOnly: v })} />
        {chrome.authAvailable || prefs.lockEnabled ? (
          <SwitchRow title={t('desktop.settings.lock')} subtitle={t('desktop.settings.lockSub')} value={prefs.lockEnabled} onChange={(v) => void setLock(v)} last />
        ) : (
          <NavRow title={t('desktop.settings.lock')} subtitle={t('desktop.settings.lockUnavailable')} chevron={false} disabled last />
        )}
      </Group>
      {prefs.lockEnabled ? (
        <>
          <SubLabel>{t('desktop.settings.lockAfter')}</SubLabel>
          <Segmented<LockMinutes>
            label={t('desktop.settings.lockAfter')}
            value={minutes}
            options={LOCK_MINUTES.map((m) => ({ value: m, label: minuteLabel(m) }))}
            onChange={(m) => void savePrefs({ lockMinutes: Number(m) })}
          />
        </>
      ) : null}
      {error ? <Footnote tone="warning">{error}</Footnote> : null}
      <Footnote>{t('desktop.settings.shortcuts')}</Footnote>
    </>
  );
}
