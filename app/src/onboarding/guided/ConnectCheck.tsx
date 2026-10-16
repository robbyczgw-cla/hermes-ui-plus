// Guided onboarding, step 2b: verify + save a connection.
//   mode 'pair'   – from a QR code / link / deep link: tests automatically, shows the server, fields hidden behind
//                   "Adresse oder Schlüssel ändern" (links are untrusted → saving still needs a tap on "Verbinden").
//                   A one-time code (`c=`) is redeemed only on that tap (pairConnect.ts): until then the screen shows
//                   the target and sends nothing; after it the connection is saved with the device token – as one run
//                   that survives Back / unmount (connectPairCode); Back is swallowed until it finished.
//   mode 'manual' – "Ohne Bridge verbinden": what's missing without the bridge, URL + key fields, test on demand
// The result area is the shared diagnostics (Diagnostics.tsx): fixes like "Mit http:// versuchen" edit the form here.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, View, type TextInput } from 'react-native';
import { useT, type TKey } from '../../i18n';
import { maskKey, type ConnectionProfile } from '../../settings/profiles';
import { HText, Icon, useTheme } from '../../ui';
import type { ConnectedInput } from '../ConnectionForm';
import { isHeaderSafeToken, type PairData } from '../pairLink';
import { pairConnectLock } from '../connectLock';
import { connectPairCode, pairPending, resumeSpentPair } from '../pairConnect';
import { keepPairRecovery, loadPairRecovery, markPairCodeSpent, wasPairCodeSpent } from '../storage';
import { useSwallowBack } from '../useConnectLock';
import { Button, Field, Notice, OnbIcon, OnbScreen, Title } from '../ui';
import { displayHost, normalizeServerUrl } from '../url';
import { CheckResult, useConnectionCheck, type FixAction } from './Diagnostics';
import { isProfilesReadOnlyError } from '../../settings/storage';
import { a11yState } from '../../ui/lib/a11yState';

export function ConnectCheck({
  mode,
  pair,
  onBack,
  onNewLink,
  onConnected,
  savedProfiles,
  step,
  total,
}: {
  mode: 'pair' | 'manual';
  pair?: PairData | null;
  onBack?: () => void;
  /** the link is used up (expired / already used): to the scanner (default: onBack) */
  onNewLink?: () => void;
  onConnected: (c: ConnectedInput) => Promise<void> | void;
  /** saved connections: a code this device already redeemed for one of them continues with it (no "expired" error) */
  savedProfiles?: readonly ConnectionProfile[];
  step?: number;
  total?: number;
}) {
  const t = useTheme();
  const tr = useT();
  const [urlText, setUrlText] = useState(pair?.baseUrl ?? '');
  const [key, setKey] = useState(pair?.token ?? '');
  const [name, setName] = useState(pair?.nameFromLink ? pair.name : '');
  const [showKey, setShowKey] = useState(false);
  const [details, setDetails] = useState(mode === 'manual');
  const [urlTouched, setUrlTouched] = useState(!!pair);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const check = useConnectionCheck();
  // the pair as it is now: a one-time code is swapped for the device token on "Verbinden"
  const [livePair, setLivePair] = useState<PairData | null>(pair ?? null);
  const pending = mode === 'pair' && pairPending(livePair);
  /** the tap on "Verbinden" runs: redeem → save (Back is swallowed; stays busy until the flow moved on) */
  const [connecting, setConnecting] = useState(false);
  /** the code was redeemed but the save failed: "Verbinden" retries the save with the device token */
  const [redeemed, setRedeemed] = useState(false);
  const [redeemError, setRedeemError] = useState<{ key: TKey; final: boolean } | null>(null);
  useSwallowBack(connecting);
  const pairStage = mode === 'pair' && (pending || redeemed);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const urlRef = useRef<TextInput>(null);
  const keyRef = useRef<TextInput>(null);

  const url = useMemo(() => normalizeServerUrl(urlText), [urlText]);
  const keyTrim = key.trim();
  const keyError = keyTrim && !isHeaderSafeToken(keyTrim) ? tr('onboarding.form.keyInvalid') : null;
  const sig = url.ok ? `${url.baseUrl}\n${keyTrim}` : '';
  const st = check.state;
  // a result only counts for exactly what is in the form now
  const current = st.phase === 'done' && st.sig === sig ? st : null;
  const testing = st.phase === 'testing';

  const runTest = (overrideUrl?: string) => {
    const u = overrideUrl !== undefined ? normalizeServerUrl(overrideUrl) : url;
    if (!u.ok || keyError) {
      setUrlTouched(true);
      setDetails(true);
      return;
    }
    setSaveError(null);
    check.run(u, keyTrim);
  };

  // pair links: test right away (not with an unredeemed one-time code: nothing is sent before "Verbinden")
  useEffect(() => {
    if (mode === 'pair' && pair && !pairPending(pair) && (!pair.token || isHeaderSafeToken(pair.token))) check.run(pair.url, pair.token);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount (the flow remounts per link)
  }, []);

  const onFix = (a: FixAction) => {
    if (a === 'retry') return runTest();
    if (a === 'editKey' || a === 'editUrl') {
      setDetails(true);
      setTimeout(() => (a === 'editKey' ? keyRef : urlRef).current?.focus(), 80);
      return;
    }
    if (url.ok) {
      const next = a === 'useHttp' ? url.baseUrl.replace(/^https:/, 'http:') : url.baseUrl.replace(/^http:/, 'https:');
      setUrlText(next);
      runTest(next);
    }
  };

  /**
   * tap on "Verbinden" with a one-time code: redeem it (once) and save with the device token. The run does not depend
   * on this screen: once the code is spent the token is saved even if the screen went away (E2E round 4, B1/B2).
   */
  const connectPair = async () => {
    if (!livePair || !pairStage || connecting || !url.ok) return;
    setConnecting(true);
    setRedeemError(null);
    setSaveError(null);
    const target = url;
    const chosenName = name.trim();
    const out = await connectPairCode(livePair, {
      hold: pairConnectLock.hold,
      // redeemed here before and saved (Back to this screen, a re-delivered link): continue with it (E2E round 5, N1)
      resume: (p) =>
        resumeSpentPair(p, { spent: wasPairCodeSpent, profiles: savedProfiles ?? [], pending: () => loadPairRecovery().then((r) => r?.pair ?? null) }),
      // the device token is kept durably before the code counts as used: a failed save + Back can not lose it
      keep: keepPairRecovery,
      spent: markPairCodeSpent, // the link is used up from now on: never offered again (B3)
      redeemed: (p) => {
        if (!mounted.current) return;
        setLivePair(p);
        setKey(p.token);
        setRedeemed(true);
      },
      save: (p) => onConnected({ url: target, apiKey: p.token, name: chosenName || p.name || displayHost(target), probe: null }),
    });
    if (!mounted.current || out.phase === 'saved') return; // saved: the flow moves on – never back to an idle button
    setConnecting(false);
    if (out.phase === 'redeem-failed') setRedeemError({ key: out.messageKey, final: out.final });
    else {
      const e = out.error;
      setSaveError(isProfilesReadOnlyError(e) ? tr('settings.storage.readOnlySave') : e instanceof Error ? e.message : String(e));
    }
  };

  const save = async () => {
    if (!url.ok || keyError) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onConnected({ url, apiKey: keyTrim, name: name.trim() || (livePair?.name ?? displayHost(url)), probe: current?.probe ?? null });
    } catch (e) {
      setSaveError(isProfilesReadOnlyError(e) ? tr('settings.storage.readOnlySave') : e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const urlError = urlTouched && !url.ok ? tr(`onboarding.urlErrors.${url.error}`) : null;
  const urlHelp = url.ok && (url.addedScheme || url.addedV1 || url.baseUrl !== urlText.trim()) ? tr('onboarding.form.urlPreview', { url: url.baseUrl }) : undefined;
  const ok = !!current?.probe.ok;
  const failed = !!current && !current.probe.ok;

  const result = <CheckResult state={current ?? (testing ? st : { phase: 'idle' })} onFix={onFix} />;

  const newLink = onNewLink ?? onBack;
  const footer = pairStage ? (
    redeemError?.final ? (
      newLink ? <Button label={tr('onboarding.redeem.newLink')} onPress={newLink} /> : null
    ) : (
      <Button label={connecting ? tr('onboarding.redeem.busy') : tr('onboarding.guided.check.connect')} onPress={() => void connectPair()} loading={connecting} disabled={!url.ok} />
    )
  ) : ok ? (
    <Button label={tr('onboarding.guided.check.connect')} onPress={() => void save()} loading={saving} />
  ) : (
    <>
      <Button
        label={testing ? tr('onboarding.form.testing') : failed ? tr('onboarding.guided.check.retry') : tr('onboarding.guided.check.test')}
        onPress={() => runTest()}
        loading={testing}
        disabled={!!keyError || !urlText.trim()}
      />
      {failed && url.ok && !keyError ? <Button variant="tertiary" label={tr('onboarding.guided.check.saveAnyway')} onPress={() => void save()} disabled={saving} /> : null}
    </>
  );

  return (
    <OnbScreen onBack={connecting ? undefined : onBack} step={step} total={total} footer={footer}>
      <Title lead={mode === 'pair' ? tr('onboarding.guided.check.leadPair') : tr('onboarding.guided.manual.lead')}>
        {mode === 'pair' ? tr('onboarding.guided.check.titlePair') : tr('onboarding.guided.check.titleManual')}
      </Title>

      {/* what's missing without the bridge – until a test result takes this place */}
      {mode === 'manual' && st.phase === 'idle' ? (
        <View style={{ gap: 6, marginTop: -t.spacing.m, marginBottom: t.spacing.xl }}>
          {(Platform.OS === 'web' ? (['missing1', 'missing2', 'missing3', 'missing4'] as const) : (['missing1', 'missing2', 'missing3'] as const)).map((k) => (
            <View key={k} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <View style={{ paddingTop: 2 }}>
                <Icon name="minus" size={16} color={t.colors.subtle} />
              </View>
              <HText variant="callout" color="muted" style={{ flex: 1 }}>
                {tr(`onboarding.guided.manual.${k}`)}
              </HText>
            </View>
          ))}
          <HText variant="caption" color="subtle" style={{ marginTop: 4 }}>
            {tr('onboarding.guided.manual.later')}
          </HText>
        </View>
      ) : null}

      {mode === 'pair' && livePair ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: t.radii.l, borderWidth: 1, borderColor: t.colors.border, marginBottom: t.spacing.l }}>
          <View style={{ width: 40, height: 40, borderRadius: t.radii.m, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
            <OnbIcon name="server" size={20} color={t.colors.text} />
          </View>
          <View style={{ flex: 1 }}>
            <HText variant="bodyStrong" numberOfLines={1}>
              {livePair.name}
            </HText>
            <HText variant="caption" color="muted" numberOfLines={1}>
              {`${url.ok ? displayHost(url) : displayHost(livePair.url)}${livePair.token ? ` · ${maskKey(livePair.token)}` : ''}`}
            </HText>
          </View>
        </View>
      ) : null}

      {pairStage ? (redeemError ? <Notice tone="danger" text={tr(redeemError.key)} /> : pending ? <Notice tone="info" text={tr('onboarding.redeem.pending')} /> : null) : null}

      {result}

      {mode === 'pair' && !pairStage ? (
        <Pressable
          onPress={() => setDetails((v) => !v)}
          accessibilityRole="button"
          {...a11yState({ expanded: details })}
          hitSlop={6}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6, marginBottom: t.spacing.m }}
        >
          <HText variant="caption" color="accent" weight="600">
            {details ? tr('onboarding.guided.check.hideDetails') : tr('onboarding.guided.check.editDetails')}
          </HText>
          <Icon name={details ? 'chevronDown' : 'chevronRight'} size={14} color={t.colors.accent} />
        </Pressable>
      ) : null}

      {details && !pairStage ? (
        <View>
          <Field
            ref={urlRef}
            label={tr('onboarding.form.urlLabel')}
            value={urlText}
            onChangeText={setUrlText}
            onBlur={() => setUrlTouched(true)}
            placeholder={tr('onboarding.form.urlPlaceholder')}
            keyboardType={Platform.OS === 'web' ? 'default' : 'url'}
            textContentType="URL"
            autoComplete="url"
            returnKeyType="next"
            onSubmitEditing={() => keyRef.current?.focus()}
            error={urlError}
            help={urlHelp}
          />
          {url.ok && url.cleartext === 'public' ? <Notice tone="warning" text={tr('onboarding.form.cleartextPublic')} /> : null}
          <Field
            ref={keyRef}
            label={tr('onboarding.form.keyLabel')}
            value={key}
            onChangeText={setKey}
            placeholder={tr('onboarding.form.keyPlaceholder')}
            secureTextEntry={!showKey}
            textContentType="password"
            autoComplete="off"
            returnKeyType="go"
            onSubmitEditing={() => (ok ? void save() : runTest())}
            error={keyError}
            help={livePair?.token && key === livePair.token ? tr('onboarding.form.keyFromPair', { masked: maskKey(livePair.token) }) : tr('onboarding.form.keyHelp')}
            trailing={
              key ? (
                <Pressable
                  onPress={() => setShowKey((v) => !v)}
                  hitSlop={8}
                  accessibilityRole="button"
                  // "Show" alone does not say what is shown when a screen reader lists the controls
                  accessibilityLabel={`${showKey ? tr('onboarding.form.hide') : tr('onboarding.form.show')}: ${tr('onboarding.form.keyLabel')}`}
                  style={{ paddingHorizontal: 10, paddingVertical: 8 }}
                >
                  <HText variant="caption" color="accent" weight="600">
                    {showKey ? tr('onboarding.form.hide') : tr('onboarding.form.show')}
                  </HText>
                </Pressable>
              ) : null
            }
          />
          {mode === 'manual' ? (
            <Field
              label={tr('onboarding.form.nameLabel')}
              value={name}
              onChangeText={setName}
              placeholder={url.ok ? displayHost(url) : tr('onboarding.form.namePlaceholder')}
              autoCapitalize="sentences"
              maxLength={48}
              returnKeyType="done"
            />
          ) : null}
        </View>
      ) : null}

      {saveError ? <Notice tone="danger" text={saveError} /> : null}
    </OnbScreen>
  );
}
