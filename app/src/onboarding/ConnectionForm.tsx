// Step 3b (and verification after pairing): server URL + API key, live URL normalization preview,
// connection test with German error explanations, cleartext warnings. A pair link with a one-time code shows only
// the target (host + bridge name) until the user taps "Verbinden": then the code is redeemed (pairConnect.ts), the
// connection saved with the new device token – as one run that survives Back / unmount (connectPairCode); hardware Back
// and the header back are swallowed until it finished.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useT, type TKey } from '../i18n';
import { maskKey, type ConnectionProfile } from '../settings/profiles';
import { HText, useTheme } from '../ui';
import { describeConnError } from './errors';
import { isHeaderSafeToken, type PairData } from './pairLink';
import { pairConnectLock } from './connectLock';
import { connectPairCode, pairPending, resumeSpentPair } from './pairConnect';
import { probeConnection, type ProbeResult } from './probe';
import { Button, Field, Notice, OnbScreen, Title } from './ui';
import { displayHost, normalizeServerUrl, type NormalizedUrl } from './url';
import { isProfilesReadOnlyError } from '../settings/storage';
import { keepPairRecovery, loadPairRecovery, markPairCodeSpent, wasPairCodeSpent } from './storage';
import { useSwallowBack } from './useConnectLock';

export type ConnectedInput = { url: NormalizedUrl; apiKey: string; name: string; probe: ProbeResult | null };

const pageProtocol = (): string | undefined =>
  Platform.OS === 'web' && typeof window !== 'undefined' ? window.location?.protocol : undefined;

function initialAutoTest(mode: 'direct' | 'pair', pair?: PairData | null) {
  // an unredeemed one-time code: nothing is sent before the tap on "Verbinden"
  if (mode !== 'pair' || !pair || pairPending(pair) || (pair.token && !isHeaderSafeToken(pair.token))) return null;
  return { url: pair.url, key: pair.token, sig: `${pair.url.baseUrl}\n${pair.token}` };
}

export function ConnectionForm({
  mode,
  pair,
  initialUrl,
  onBack,
  onNewLink,
  onConnected,
  savedProfiles,
  step,
  total,
}: {
  mode: 'direct' | 'pair';
  pair?: PairData | null;
  /** direct mode: pre-filled server address (web: page origin) */
  initialUrl?: string;
  onBack: () => void;
  /** the link is used up (expired / already used): to the scanner (default: onBack) */
  onNewLink?: () => void;
  /** save + continue; may reject (shown as error) */
  onConnected: (c: ConnectedInput) => Promise<void> | void;
  /** saved connections: a code this device already redeemed for one of them continues with it (no "expired" error) */
  savedProfiles?: readonly ConnectionProfile[];
  step?: number;
  total?: number;
}) {
  const t = useTheme();
  const tr = useT();
  const [urlText, setUrlText] = useState(pair?.baseUrl ?? initialUrl ?? '');
  const [key, setKey] = useState(pair?.token ?? '');
  const [name, setName] = useState(pair?.nameFromLink ? pair.name : '');
  const [showKey, setShowKey] = useState(false);
  const [urlTouched, setUrlTouched] = useState(!!pair);
  const [autoTest] = useState(() => initialAutoTest(mode, pair));
  const [probing, setProbing] = useState(!!autoTest);
  const [probe, setProbe] = useState<{ sig: string; result: ProbeResult } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
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

  const url = useMemo(() => normalizeServerUrl(urlText), [urlText]);
  const keyTrim = key.trim();
  const keyError = keyTrim && !isHeaderSafeToken(keyTrim) ? tr('onboarding.form.keyInvalid') : null;
  const sig = url.ok ? `${url.baseUrl}\n${keyTrim}` : '';
  const current = probe && probe.sig === sig ? probe.result : null;

  /** runs the probe; only sets state after the first await (safe to start from an effect) */
  const execute = async (ctrl: AbortController, target: NormalizedUrl, apiKey: string, forSig: string) => {
    try {
      const result = await probeConnection({ url: target, apiKey }, { platform: Platform.OS, pageProtocol: pageProtocol(), signal: ctrl.signal });
      if (!ctrl.signal.aborted) setProbe({ sig: forSig, result });
    } finally {
      if (abort.current === ctrl) {
        abort.current = null;
        setProbing(false);
      }
    }
  };

  const runTest = () => {
    if (!url.ok || keyError) {
      setUrlTouched(true);
      return;
    }
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setProbing(true);
    setSaveError(null);
    void execute(ctrl, url, keyTrim, sig);
  };

  // pairing: test right away (the user still confirms with "Verbinden"); `probing` starts true for this
  useEffect(() => {
    if (!autoTest) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    void execute(ctrl, autoTest.url, autoTest.key, autoTest.sig);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount
  }, []);

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
      await onConnected({ url, apiKey: keyTrim, name: name.trim() || (livePair?.name ?? displayHost(url)), probe: current });
    } catch (e) {
      setSaveError(isProfilesReadOnlyError(e) ? tr('settings.storage.readOnlySave') : e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const urlError = urlTouched && !url.ok ? tr(`onboarding.urlErrors.${url.error}`) : null;
  const urlHelp = url.ok && (url.addedScheme || url.addedV1 || url.baseUrl !== urlText.trim()) ? tr('onboarding.form.urlPreview', { url: url.baseUrl }) : undefined;
  const page = pageProtocol();

  let resultView: ReactNode = null;
  if (current?.ok) {
    const r = current;
    const lines = [
      r.hermes ? tr('onboarding.result.okHermes', { version: r.version ? ` ${r.version}` : '', ms: r.ms }) : tr('onboarding.result.okGeneric', { ms: r.ms }),
      r.bridge ? tr('onboarding.result.okBridge') : tr('onboarding.result.okDirect'),
    ];
    if (r.catalog) lines.push(tr('onboarding.result.catalog', { models: r.catalog.models, providers: r.catalog.providers }));
    else if (r.models.length) lines.push(tr('onboarding.result.models', { count: r.models.length }));
    resultView = <Notice tone="success" title={tr('onboarding.result.okTitle')} text={lines.join('\n')} />;
  } else if (current?.error) {
    const d = describeConnError(current.error, tr);
    resultView = <Notice tone="danger" title={d.title} text={d.message} hints={d.hints} hintsTitle={tr('onboarding.result.hintsTitle')} detail={d.detail} />;
  }

  return (
    <OnbScreen
      onBack={connecting ? undefined : onBack}
      step={step}
      total={total}
      footer={
        pairStage ? (
          redeemError?.final ? (
            <Button label={tr('onboarding.redeem.newLink')} onPress={onNewLink ?? onBack} />
          ) : (
            <Button label={connecting ? tr('onboarding.redeem.busy') : tr('onboarding.form.connect')} onPress={() => void connectPair()} loading={connecting} disabled={!url.ok} />
          )
        ) : current?.ok ? (
          <Button label={tr('onboarding.form.connect')} onPress={() => void save()} loading={saving} />
        ) : (
          <>
            <Button label={probing ? tr('onboarding.form.testing') : tr('onboarding.form.test')} onPress={runTest} loading={probing} disabled={!!keyError || !urlText.trim()} />
            {current && !current.ok && url.ok && !keyError ? <Button variant="tertiary" label={tr('onboarding.form.saveAnyway')} onPress={() => void save()} disabled={saving} /> : null}
          </>
        )
      }
    >
      <Title lead={mode === 'pair' ? tr('onboarding.form.leadPair') : tr('onboarding.form.leadDirect')}>{mode === 'pair' ? tr('onboarding.form.titlePair') : tr('onboarding.form.titleDirect')}</Title>

      {mode === 'pair' && livePair ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: t.spacing.l, flexWrap: 'wrap' }}>
          <HText variant="caption" color="muted">
            {tr('onboarding.form.pairFrom')}:
          </HText>
          <HText variant="caption" weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>
            {livePair.nameFromLink ? `${livePair.name} · ${displayHost(livePair.url)}` : displayHost(livePair.url)}
          </HText>
        </View>
      ) : null}

      {pairStage ? (
        <>
          {redeemError ? <Notice tone="danger" text={tr(redeemError.key)} /> : pending ? <Notice tone="info" text={tr('onboarding.redeem.pending')} /> : null}
          <Field
            label={tr('onboarding.form.nameLabel')}
            value={name}
            onChangeText={setName}
            editable={!connecting}
            placeholder={livePair?.name || (url.ok ? displayHost(url) : tr('onboarding.form.namePlaceholder'))}
            autoCapitalize="sentences"
            maxLength={48}
            returnKeyType="done"
          />
        </>
      ) : (
        <>
          <Field
            label={tr('onboarding.form.urlLabel')}
            value={urlText}
            onChangeText={setUrlText}
            onBlur={() => setUrlTouched(true)}
            placeholder={tr('onboarding.form.urlPlaceholder')}
            keyboardType={Platform.OS === 'web' ? 'default' : 'url'}
            textContentType="URL"
            autoComplete="url"
            returnKeyType="next"
            error={urlError}
            help={urlHelp}
          />

          {url.ok && url.cleartext !== 'none' ? (
            <Notice
              tone={url.cleartext === 'public' || page === 'https:' ? 'warning' : 'info'}
              text={page === 'https:' ? tr('onboarding.form.cleartextWeb') : url.cleartext === 'public' ? tr('onboarding.form.cleartextPublic') : tr('onboarding.form.cleartextPrivate')}
            />
          ) : null}

          <Field
            label={tr('onboarding.form.keyLabel')}
            value={key}
            onChangeText={setKey}
            placeholder={tr('onboarding.form.keyPlaceholder')}
            secureTextEntry={!showKey}
            textContentType="password"
            autoComplete="off"
            returnKeyType="go"
            onSubmitEditing={() => current?.ok ? void save() : runTest()}
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

          <Field
            label={tr('onboarding.form.nameLabel')}
            value={name}
            onChangeText={setName}
            placeholder={url.ok ? displayHost(url) : tr('onboarding.form.namePlaceholder')}
            autoCapitalize="sentences"
            maxLength={48}
            returnKeyType="done"
          />
        </>
      )}

      {resultView}
      {saveError ? <Notice tone="danger" text={saveError} /> : null}
    </OnbScreen>
  );
}
