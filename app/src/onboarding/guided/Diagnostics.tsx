// Connection check UI: runs probeConnection + probeFeatures and shows the result as
//   testing → a calm progress row
//   error   → ONE fix (diagnose.ts adviceForError) with buttons, more hints on demand
//   ok      → "Verbunden" + what was detected (chips) + remaining notes (skill missing, old Hermes, no bridge)
// Used by the guided onboarding (ConnectCheck) and Settings → "Verbindung prüfen" (ConnectionCheckPage).
import Constants from 'expo-constants';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { brand } from '../../brand';
import { useI18n, useT, type TKey } from '../../i18n';
import { FadeIn, HText, Icon, useTheme, type IconName } from '../../ui';
import { diagnose, MIN_HERMES_VERSION, type Advice, type AdviceAction, type DetectedItem } from '../diagnose';
import { describeConnError } from '../errors';
import { probeFeatures, type Features } from '../features';
import { probeConnection, type ProbeResult } from '../probe';
import { diagnosticsSummary, fillTroubleshootPrompt } from '../troubleshoot';
import type { NormalizedUrl } from '../url';
import { ActionPill } from '../ui';
import { copyText, openTailscale, promptsFor } from './actions';
import { a11yState } from '../../ui/lib/a11yState';

export type CheckState =
  | { phase: 'idle' }
  | { phase: 'testing'; url: NormalizedUrl }
  | { phase: 'done'; url: NormalizedUrl; sig: string; probe: ProbeResult; features: Features | null; featuresLoading: boolean };

const pageProtocol = (): string | undefined => (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location?.protocol : undefined);

/** Runs the check; a newer run (or unmount) cancels the previous one. */
export function useConnectionCheck() {
  const [state, setState] = useState<CheckState>({ phase: 'idle' });
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback((url: NormalizedUrl, apiKey: string) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const sig = `${url.baseUrl}\n${apiKey.trim()}`;
    setState({ phase: 'testing', url });
    void (async () => {
      const probe = await probeConnection({ url, apiKey }, { platform: Platform.OS, pageProtocol: pageProtocol(), signal: c.signal });
      if (c.signal.aborted) return;
      setState({ phase: 'done', url, sig, probe, features: null, featuresLoading: probe.ok });
      if (!probe.ok) return;
      const features = await probeFeatures({ url, apiKey }, { bridge: probe.bridge, signal: c.signal });
      if (c.signal.aborted) return;
      setState({ phase: 'done', url, sig, probe, features, featuresLoading: false });
    })();
  }, []);

  const reset = useCallback(() => {
    ctrl.current?.abort();
    setState({ phase: 'idle' });
  }, []);

  return { state, run, reset };
}

/** Fixes the panel can't do itself (they change the form or rerun). */
export type FixAction = Extract<AdviceAction, 'editKey' | 'editUrl' | 'useHttp' | 'useHttps' | 'retry'>;

const ADVICE_ICON: Record<Advice['severity'], IconName> = { error: 'alertOctagon', warning: 'alert', info: 'info' };

export function CheckResult({ state, onFix }: { state: CheckState; onFix: (a: FixAction) => void }) {
  const t = useTheme();
  const tr = useT();
  const { lang } = useI18n();
  const [copied, setCopied] = useState<AdviceAction | null>(null);
  const [moreHints, setMoreHints] = useState(false);

  if (state.phase === 'idle') return null;
  if (state.phase === 'testing') {
    return (
      <View style={[styles.testing, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.l }]} accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color={t.colors.muted} />
        <HText variant="callout" color="muted" style={styles.flex1} numberOfLines={2}>
          {tr('onboarding.guided.check.testing', { host: state.url.host })}
        </HText>
      </View>
    );
  }

  const { probe, features, url } = state;
  const d = diagnose(probe, features, { platform: Platform.OS, url });
  const prompts = promptsFor(lang);
  const repo = brand().repoUrl ?? 'hermes-ui-plus';

  const act = (a: AdviceAction, advice: Advice) => {
    const copy = (text: string) =>
      void copyText(text).then((ok) => {
        if (ok) setCopied(a);
      });
    switch (a) {
      case 'openTailscale':
        void openTailscale();
        return;
      case 'copyTroubleshoot': {
        const summary = diagnosticsSummary({
          error: probe.error,
          advice: advice.id,
          host: url.host + (url.port ? `:${url.port}` : ''),
          scheme: url.scheme,
          bridge: probe.bridge,
          hermesVersion: probe.version,
          platform: Platform.OS,
          appVersion: Constants.expoConfig?.version,
        });
        copy(fillTroubleshootPrompt(prompts.troubleshoot, summary));
        return;
      }
      case 'copySkillPrompt':
        copy(tr('onboarding.diag.skillPrompt', { repo }));
        return;
      case 'copyUpdatePrompt':
        copy(tr('onboarding.diag.hermesUpdatePrompt', { min: MIN_HERMES_VERSION }));
        return;
      case 'copyBridgeSetup':
        copy(prompts.hermesSetup);
        return;
      default:
        onFix(a);
    }
  };

  const adviceCard = (a: Advice, i: number) => {
    const tone = a.severity === 'error' ? 'danger' : a.severity;
    const vars = { host: probe.error?.host ?? url.host, path: probe.error?.path ?? '', status: probe.error?.status ?? '', min: MIN_HERMES_VERSION };
    const hints = a.severity === 'error' && probe.error ? describeConnError(probe.error, tr) : null;
    return (
      <FadeIn key={a.id} delay={i * 60}>
        <View style={[styles.advice, { backgroundColor: t.colors[`${tone}Soft`], borderRadius: t.radii.l }]} accessibilityLiveRegion={a.severity === 'error' ? 'polite' : undefined}>
          <View style={styles.row}>
            <Icon name={ADVICE_ICON[a.severity]} size={18} color={t.colors[tone]} />
            <HText variant="bodyStrong" style={styles.flex1} accessibilityRole="header">
              {tr(`onboarding.diag.advice.${a.id}.title` as TKey, vars)}
            </HText>
          </View>
          <HText variant="callout" color="muted">
            {tr(`onboarding.diag.advice.${a.id}.text` as TKey, vars)}
          </HText>
          <View style={styles.pills}>
            {a.actions.map((x, k) => (
              <ActionPill
                key={x}
                label={copied === x ? tr('onboarding.diag.actions.copied') : tr(`onboarding.diag.actions.${x}` as TKey)}
                icon={copied === x ? 'check' : x.startsWith('copy') ? 'copy' : x === 'openTailscale' ? 'external' : undefined}
                tone={k === 0 ? 'accent' : 'neutral'}
                onPress={() => act(x, a)}
              />
            ))}
          </View>
          {hints && (hints.hints.length || hints.detail) ? (
            <>
              <Pressable onPress={() => setMoreHints((v) => !v)} accessibilityRole="button" {...a11yState({ expanded: moreHints })} hitSlop={6} style={styles.more}>
                <HText variant="caption" color="muted" weight="600">
                  {moreHints ? tr('onboarding.guided.check.fewerHints') : tr('onboarding.guided.check.moreHints')}
                </HText>
                <Icon name={moreHints ? 'chevronDown' : 'chevronRight'} size={14} color={t.colors.muted} />
              </Pressable>
              {moreHints ? (
                <View style={{ gap: 4 }}>
                  {hints.hints.map((h, k) => (
                    <View key={k} style={styles.hintRow}>
                      <HText variant="caption" color="muted">
                        •
                      </HText>
                      <HText variant="caption" color="muted" style={styles.flex1}>
                        {h}
                      </HText>
                    </View>
                  ))}
                  {hints.detail ? (
                    <HText variant="micro" color="subtle" style={{ fontFamily: t.fonts.mono }} numberOfLines={3} selectable>
                      {hints.detail}
                    </HText>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </FadeIn>
    );
  };

  if (d.status === 'error') return <View>{d.advice.map(adviceCard)}</View>;

  return (
    <View>
      <FadeIn>
        <View style={[styles.okHead, { backgroundColor: t.colors.successSoft, borderRadius: t.radii.l }]} accessibilityLiveRegion="polite">
          <View style={[styles.okIcon, { backgroundColor: t.colors.success }]}>
            <Icon name="check" size={16} color={t.colors.bg} strokeWidth={2.4} />
          </View>
          <View style={styles.flex1}>
            <HText variant="bodyStrong">{d.status === 'warning' ? tr('onboarding.guided.check.warnTitle') : tr('onboarding.guided.check.okTitle')}</HText>
            <HText variant="caption" color="muted">
              {tr('onboarding.guided.check.okLead', { ms: probe.ms })}
            </HText>
          </View>
        </View>
      </FadeIn>
      <DetectedList items={d.detected} loading={state.featuresLoading} />
      {d.advice.map(adviceCard)}
    </View>
  );
}

function DetectedList({ items, loading }: { items: DetectedItem[]; loading: boolean }) {
  const t = useTheme();
  const tr = useT();
  // unknown feature rows are noise once the check is complete
  const shown = items.filter((i) => loading || i.state !== 'unknown' || i.id === 'hermes' || i.id === 'models');
  const label = (i: DetectedItem): string => {
    if (i.id === 'hermes') return i.value ? tr('onboarding.diag.detected.hermesVersion', { version: String(i.value) }) : tr('onboarding.diag.detected.hermes');
    if (i.id === 'models') return tr('onboarding.diag.detected.models', { count: Number(i.value ?? 0) });
    return tr(`onboarding.diag.detected.${i.id}` as TKey);
  };
  return (
    <View style={{ marginBottom: t.spacing.l }}>
      <HText variant="caption" color="muted" weight="600" style={{ marginBottom: 8 }}>
        {tr('onboarding.guided.check.detectedTitle')}
      </HText>
      <View style={styles.chips}>
        {shown.map((i) => {
          const pending = loading && i.state === 'unknown' && i.id !== 'hermes' && i.id !== 'models';
          const color = i.state === 'ok' ? t.colors.success : i.state === 'off' ? (i.id === 'skill' || i.id === 'hermes' ? t.colors.warning : t.colors.subtle) : t.colors.subtle;
          const icon: IconName = i.state === 'ok' ? 'check' : i.state === 'off' ? (i.id === 'skill' || i.id === 'hermes' ? 'alert' : 'minus') : 'dot';
          return (
            <View
              key={i.id}
              accessible
              accessibilityLabel={`${label(i)}: ${tr(`onboarding.diag.detected.${i.state}` as TKey)}`}
              style={[styles.chip, { borderColor: t.colors.border, borderRadius: t.radii.pill, opacity: pending ? 0.5 : 1 }]}
            >
              {pending ? <ActivityIndicator size="small" color={t.colors.subtle} style={{ transform: [{ scale: 0.6 }], width: 14, height: 14 }} /> : <Icon name={icon} size={14} color={color} strokeWidth={2.2} />}
              <HText variant="caption" color={i.state === 'ok' ? 'text' : 'muted'} numberOfLines={1}>
                {label(i)}
              </HText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  testing: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 16 },
  advice: { padding: 14, gap: 8, marginBottom: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4, marginTop: 2 },
  hintRow: { flexDirection: 'row', gap: 6 },
  okHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 14 },
  okIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth },
});
