/**
 * Settings → "Benachrichtigungen" for the active profile: on/off, preview (auto/on/off), quiet hours, test.
 * The switch tap is the user gesture that web/iOS PWAs need for the permission prompt.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '../i18n';
import type { TKey } from '../i18n/core';
import type { ConnectionProfile } from '../settings/profiles';
import { Button, Field, Footnote, Group, Segmented, SubLabel, SwitchRow } from '../settings/ui';
import { pushUnsupportedKey } from '../settings/flavorTexts';
import { sendTestPush } from './api';
import { pushFetch } from './device';
import { DEFAULT_QUIET, normalizeTime, pushServerKind, type PreviewMode, type PushPlatform } from './model';
import { disablePush, serverConfig, syncRegistration, type PushStatus } from './registration';
import { getPushSettings, setPushSettings, usePushSettingsState } from './settingsStore';

export function PushSettingsSection({ profile }: { profile: ConnectionProfile | undefined }) {
  const { t, lang } = useI18n();
  usePushSettingsState(); // re-render on changes
  const supported = !!profile && !!pushServerKind(profile);
  const s = profile ? getPushSettings(profile.id) : null;
  // last result for a profile/server key; a different key means "checking" (derived, no setState in the effect)
  const probeKey = profile ? `${profile.id}|${profile.baseUrl}|${profile.apiKey.slice(-6)}` : '';
  const [probe, setProbe] = useState<{ key: string; status: PushStatus } | null>(null);
  const status: PushStatus | 'checking' | null = !supported ? { kind: 'unsupported' } : probe?.key === probeKey ? probe.status : 'checking';
  const setStatus = (st: PushStatus) => setProbe({ key: probeKey, status: st });
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [from, setFrom] = useState(s?.quiet?.from ?? DEFAULT_QUIET.from);
  const [to, setTo] = useState(s?.quiet?.to ?? DEFAULT_QUIET.to);
  const [timeError, setTimeError] = useState(false);

  // probe the server once per profile (unsupported servers answer 404)
  useEffect(() => {
    if (!profile || !supported) return;
    let cancelled = false;
    const key = probeKey;
    const done = (st: PushStatus) => !cancelled && setProbe({ key, status: st });
    serverConfig(profile)
      .then((cfg) => {
        const cur = getPushSettings(profile.id);
        done(!cfg ? { kind: 'unsupported' } : cur.enabled && cur.platform ? { kind: 'registered', platform: cur.platform } : cur.enabled ? { kind: 'liveOnly', platform: null } : { kind: 'off' });
      })
      .catch((e) => done({ kind: 'error', error: String((e as Error)?.message ?? e) }));
    return () => {
      cancelled = true;
    };
  }, [probeKey, supported]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!profile || !s) return null;
  const platformLabel = (p: PushPlatform | null | undefined) => (p ? t(`push.platform.${p}` as TKey) : '');
  const statusText = (() => {
    if (status === 'checking') return t('push.status.checking');
    if (!status) return '';
    switch (status.kind) {
      case 'unsupported':
        return t(pushUnsupportedKey());
      case 'liveOnly':
        return t('push.status.notConfigured', { platform: platformLabel(status.platform) });
      case 'denied':
        return t('push.status.denied');
      case 'webUnsupported':
        return t('push.status.webUnsupported');
      case 'registered':
        return t('push.status.registered', { platform: platformLabel(status.platform) });
      case 'error':
        return t('push.status.error', { error: status.error });
      default:
        return t('push.status.live');
    }
  })();
  const unsupported = status !== 'checking' && status?.kind === 'unsupported';

  const apply = async () => {
    setBusy(true);
    try {
      setStatus(await syncRegistration(profile, t, lang));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (on: boolean) => {
    if (on) {
      setPushSettings(profile.id, { enabled: true });
      await apply();
    } else {
      setBusy(true);
      await disablePush(profile);
      setBusy(false);
      setStatus({ kind: 'off' });
    }
  };

  const setPreview = (preview: PreviewMode) => {
    setPushSettings(profile.id, { preview });
    if (s.enabled) void apply();
  };

  const setQuietOn = (on: boolean) => {
    setPushSettings(profile.id, { quiet: on ? { from: normalizeTime(from) ?? DEFAULT_QUIET.from, to: normalizeTime(to) ?? DEFAULT_QUIET.to } : null });
    if (s.enabled) void apply();
  };

  const commitTimes = () => {
    const f = normalizeTime(from);
    const tt = normalizeTime(to);
    if (!f || !tt || f === tt) return setTimeError(true);
    setTimeError(false);
    setFrom(f);
    setTo(tt);
    if (s.quiet?.from === f && s.quiet?.to === tt) return;
    setPushSettings(profile.id, { quiet: { from: f, to: tt } });
    if (s.enabled) void apply();
  };

  const test = async () => {
    setTestMsg(null);
    try {
      const results = await sendTestPush(pushFetch, profile, s.registrationId);
      const failed = results.find((r) => !r.ok);
      setTestMsg(results.length && !failed ? t('push.testOk') : t('push.testFailed', { error: failed?.error ?? '–' }));
    } catch (e) {
      setTestMsg(t('push.testFailed', { error: String((e as Error)?.message ?? e) }));
    }
  };

  return (
    <View>
      <SubLabel>{t('push.profile', { name: profile.name })}</SubLabel>
      <Group>
        <SwitchRow title={t('push.enable')} subtitle={t('push.enableSub', { name: profile.name })} value={s.enabled && !unsupported} onChange={(v) => void toggle(v)} last={!s.enabled || unsupported} />
        {s.enabled && !unsupported ? <SwitchRow title={t('push.quiet')} subtitle={t('push.quietSub')} value={!!s.quiet} onChange={setQuietOn} last={!s.quiet} /> : null}
        {s.enabled && !unsupported && s.quiet ? (
          <>
            <Field label={t('push.quietFrom')} value={from} onChangeText={setFrom} onBlur={commitTimes} onSubmitEditing={commitTimes} keyboardType="numbers-and-punctuation" placeholder="22:00" />
            <Field label={t('push.quietTo')} value={to} onChangeText={setTo} onBlur={commitTimes} onSubmitEditing={commitTimes} keyboardType="numbers-and-punctuation" placeholder="07:00" last hint={timeError ? t('push.quietInvalid') : undefined} />
          </>
        ) : null}
      </Group>
      {s.enabled && !unsupported ? (
        <>
          <SubLabel>{t('push.preview')}</SubLabel>
          <Segmented<PreviewMode>
            label={t('push.preview')}
            value={s.preview}
            onChange={setPreview}
            options={[
              { value: 'auto', label: t('push.previewAuto') },
              { value: 'on', label: t('push.previewOn') },
              { value: 'off', label: t('push.previewOff') },
            ]}
          />
          <Footnote>{t('push.previewHint')}</Footnote>
          {status !== 'checking' && status?.kind === 'registered' ? <Button kind="secondary" label={t('push.test')} onPress={() => void test()} loading={busy} /> : null}
          {testMsg ? <Footnote>{testMsg}</Footnote> : null}
        </>
      ) : null}
      {statusText ? <Footnote tone={status !== 'checking' && (status?.kind === 'error' || status?.kind === 'denied') ? 'warning' : undefined}>{statusText}</Footnote> : null}
      {/* the live hint once: not again when it already is the status line */}
      {supported && !unsupported && statusText !== t('push.status.live') ? <Footnote>{t('push.status.live')}</Footnote> : null}
    </View>
  );
}

/** search texts for the settings filter */
export function pushSearchTexts(t: (k: TKey) => string): string[] {
  return [t('push.title' as TKey), t('push.enable' as TKey), t('push.preview' as TKey), t('push.quiet' as TKey), t('push.test' as TKey)];
}
