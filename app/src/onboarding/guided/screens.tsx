// Guided onboarding: the small screens (setup choice, bridge options, agent / self setup, no Hermes yet, done).
// Welcome: WelcomeGuided.tsx · verification + diagnostics: ConnectCheck.tsx / Diagnostics.tsx · scanner: ../ScanPair.
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useI18n, useT } from '../../i18n';
import { FadeIn, HText, Icon, PressableScale, useTheme } from '../../ui';
import { AgentSetupSheet } from '../AgentSetupSheet';
import { DEMO_STARTERS, STARTERS, type StarterPrompt } from '../starters';
import { Button, CodeBox, Notice, OnbIcon, OnbScreen, OptionCard, Title, heroVariant } from '../ui';
import { BRIDGE_SETUP_COMMAND, bridgeDocsUrl, copyText, HERMES_AGENT_URL, openDocs, promptsFor, sharePrompt } from './actions';

type Progress = { step?: number; total?: number };

// ── "Wie ist dein Hermes eingerichtet?" ──────────────────────────────────────────────────────
export type SetupChoice = 'link' | 'noBridge' | 'noHermes';

export function SetupChoiceScreen({ onChoose, onBack, step, total }: { onChoose: (c: SetupChoice) => void; onBack?: () => void } & Progress) {
  const tr = useT();
  const [agentSheet, setAgentSheet] = useState(false);
  return (
    <OnbScreen onBack={onBack} step={step} total={total}>
      <Title lead={tr('onboarding.guided.setup.lead')}>{tr('onboarding.guided.setup.title')}</Title>
      <OptionCard icon="qr" title={tr('onboarding.guided.setup.link.title')} text={tr('onboarding.guided.setup.link.text')} badge={tr('onboarding.guided.setup.link.badge')} onPress={() => onChoose('link')} />
      <OptionCard icon="agent" title={tr('onboarding.agentSetup.option.title')} text={tr('onboarding.agentSetup.option.text')} onPress={() => setAgentSheet(true)} delay={25} />
      <OptionCard icon="server" title={tr('onboarding.guided.setup.noBridge.title')} text={tr('onboarding.guided.setup.noBridge.text')} onPress={() => onChoose('noBridge')} delay={50} />
      <OptionCard icon="sparkle" title={tr('onboarding.guided.setup.noHermes.title')} text={tr('onboarding.guided.setup.noHermes.text')} onPress={() => onChoose('noHermes')} delay={100} />
      <AgentSetupSheet
        visible={agentSheet}
        onClose={() => setAgentSheet(false)}
        onPasteLink={() => {
          setAgentSheet(false);
          onChoose('link');
        }}
      />
    </OnbScreen>
  );
}

// ── Hermes without the bridge ──────────────────────────────────────────────────────────────────
export function NoBridgeScreen({ onOption, onBack, step, total }: { onOption: (o: 'agent' | 'self' | 'manual') => void; onBack?: () => void } & Progress) {
  const tr = useT();
  return (
    <OnbScreen onBack={onBack} step={step} total={total}>
      <Title lead={tr('onboarding.guided.noBridge.lead')}>{tr('onboarding.guided.noBridge.title')}</Title>
      <OptionCard icon="sparkle" title={tr('onboarding.guided.noBridge.agent.title')} text={tr('onboarding.guided.noBridge.agent.text')} badge={tr('onboarding.guided.noBridge.agent.badge')} onPress={() => onOption('agent')} />
      <OptionCard icon="terminal" title={tr('onboarding.guided.noBridge.self.title')} text={tr('onboarding.guided.noBridge.self.text')} onPress={() => onOption('self')} delay={50} />
      <OptionCard icon="key" title={tr('onboarding.guided.noBridge.manual.title')} text={tr('onboarding.guided.noBridge.manual.text')} onPress={() => onOption('manual')} delay={100} />
    </OnbScreen>
  );
}

// ── "Lass Hermes das einrichten" ──────────────────────────────────────────────────────────────
function useCopied(): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return [
    copied,
    () => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2200);
    },
  ];
}

export function AgentSetupScreen({ onHaveLink, onBack, step, total }: { onHaveLink: () => void; onBack?: () => void } & Progress) {
  const t = useTheme();
  const tr = useT();
  const { lang } = useI18n();
  const [coder, setCoder] = useState(false);
  const [copied, markCopied] = useCopied();
  const prompts = promptsFor(lang);
  const text = coder ? prompts.coderSetup : prompts.hermesSetup;
  return (
    <OnbScreen onBack={onBack} step={step} total={total} footer={<Button label={tr('onboarding.guided.agent.haveLink')} onPress={onHaveLink} />}>
      <Title lead={tr('onboarding.guided.agent.lead')}>{tr('onboarding.guided.agent.title')}</Title>
      <View style={[styles.promptBox, { borderColor: t.colors.border, backgroundColor: t.colors.codeBg, borderRadius: t.radii.l }]}>
        <View style={[styles.promptHead, { borderBottomColor: t.colors.border }]}>
          <HText variant="caption" color="muted" weight="600">
            {coder ? tr('onboarding.guided.agent.promptLabelCoder') : tr('onboarding.guided.agent.promptLabel')}
          </HText>
        </View>
        <ScrollView style={styles.promptScroll} nestedScrollEnabled contentContainerStyle={{ padding: 12 }}>
          <HText variant="callout" selectable style={{ color: t.colors.codeText }}>
            {text}
          </HText>
        </ScrollView>
      </View>
      <View style={styles.btnCol}>
        <Button
          variant="secondary"
          icon={copied ? 'check' : 'copy'}
          label={copied ? tr('onboarding.guided.agent.copied') : tr('onboarding.guided.agent.copy')}
          onPress={() => void copyText(text).then((ok) => ok && markCopied())}
        />
        <Button variant="secondary" icon="send" label={tr('onboarding.guided.agent.share')} onPress={() => void sharePrompt(text, tr('onboarding.guided.agent.shareTitle'))} />
      </View>
      <Pressable onPress={() => setCoder((v) => !v)} accessibilityRole="button" hitSlop={6} style={styles.linkRow}>
        <HText variant="caption" color="accent" weight="600">
          {coder ? tr('onboarding.guided.agent.useHermes') : tr('onboarding.guided.agent.useCoder')}
        </HText>
      </Pressable>
    </OnbScreen>
  );
}

// ── "Selbst einrichten" ───────────────────────────────────────────────────────────────────────
export function SelfSetupScreen({ onHaveLink, onBack, step, total }: { onHaveLink: () => void; onBack?: () => void } & Progress) {
  const t = useTheme();
  const tr = useT();
  const docs = bridgeDocsUrl();
  return (
    <OnbScreen onBack={onBack} step={step} total={total} footer={<Button icon="qr" label={tr('onboarding.guided.self.haveLink')} onPress={onHaveLink} />}>
      <Title lead={tr('onboarding.guided.self.lead')}>{tr('onboarding.guided.self.title')}</Title>
      <CodeBox code={BRIDGE_SETUP_COMMAND} label={tr('onboarding.guided.self.commandLabel')} />
      <HText variant="callout" color="muted" style={{ marginBottom: t.spacing.l }}>
        {tr('onboarding.guided.self.what')}
      </HText>
      <Notice tone="info" text={tr('onboarding.guided.self.privacy')} />
      {docs ? (
        <View style={{ alignItems: 'flex-start' }}>
          <Button variant="secondary" icon="external" label={tr('onboarding.guided.self.docs')} onPress={() => openDocs(docs)} />
        </View>
      ) : null}
    </OnbScreen>
  );
}

// ── "Ich habe noch kein Hermes" ───────────────────────────────────────────────────────────────
export function NoHermesScreen({ onDemo, onBack, step, total }: { onDemo: () => void; onBack?: () => void } & Progress) {
  const t = useTheme();
  const tr = useT();
  return (
    <OnbScreen onBack={onBack} step={step} total={total} footer={<Button icon="play" label={tr('onboarding.guided.noHermes.demo')} onPress={onDemo} />}>
      <Title lead={tr('onboarding.guided.noHermes.lead')}>{tr('onboarding.guided.noHermes.title')}</Title>
      <View style={[styles.stepsCard, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.l }]}>
        <OnbIcon name="terminal" size={20} color={t.colors.text} />
        <HText variant="callout" style={styles.flex1}>
          {tr('onboarding.guided.noHermes.steps')}
        </HText>
      </View>
      <View style={{ alignItems: 'flex-start', marginBottom: t.spacing.l }}>
        <Button variant="secondary" icon="external" label={tr('onboarding.guided.noHermes.docs')} onPress={() => openDocs(HERMES_AGENT_URL)} />
      </View>
      <HText variant="caption" color="subtle">
        {tr('onboarding.guided.noHermes.later')}
      </HText>
    </OnbScreen>
  );
}

// ── "Fertig" ──────────────────────────────────────────────────────────────────────────────────
export function DoneGuidedScreen({
  demo,
  connectionName,
  onStart,
  onBack,
  step,
  total,
}: {
  demo: boolean;
  connectionName?: string;
  /** prompt = tapped starter (sent as first message) or undefined (empty chat) */
  onStart: (prompt?: string) => void;
  onBack?: () => void;
} & Progress) {
  const t = useTheme();
  const tr = useT();
  const starters: readonly StarterPrompt[] = (demo ? DEMO_STARTERS : STARTERS).slice(0, 3);
  return (
    <OnbScreen onBack={onBack} step={step} total={total} footer={<Button label={tr('onboarding.guided.done.newChat')} onPress={() => onStart()} />}>
      <FadeIn style={styles.hero}>
        <View style={[styles.check, { backgroundColor: t.colors.successSoft }]}>
          <Icon name="check" size={28} color={t.colors.success} />
        </View>
        <HText variant={heroVariant(tr('onboarding.guided.done.title'))} align="center" accessibilityRole="header">
          {tr('onboarding.guided.done.title')}
        </HText>
        <HText variant="body" color="muted" align="center">
          {demo ? tr('onboarding.guided.done.leadDemo') : tr('onboarding.guided.done.leadConnected', { name: connectionName ? tr('onboarding.done.quotedName', { name: connectionName }) : 'Hermes' })}
        </HText>
      </FadeIn>
      <View style={{ gap: t.spacing.s, marginTop: t.spacing.xl, marginBottom: t.spacing.l }}>
        {starters.map((p, i) => (
          <FadeIn key={p.id} delay={100 + i * 60}>
            <PressableScale
              onPress={() => onStart(p.promptKey ? tr(p.promptKey) : p.prompt)}
              accessibilityRole="button"
              accessibilityLabel={`${tr(p.titleKey)}, ${tr(p.subtitleKey)}`}
              haptic="selection"
              scaleTo={0.985}
              style={[styles.starter, { borderColor: t.colors.border, borderRadius: t.radii.l, backgroundColor: t.dark ? t.colors.surface : t.colors.bg }]}
              pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
            >
              <View style={[styles.starterIcon, { backgroundColor: t.colors.accentSoft, borderRadius: t.radii.m }]}>
                <Icon name={p.id === 'compare' ? 'table' : p.id === 'chart' ? 'chart' : 'sparkle'} size={18} color={t.colors.accent} />
              </View>
              <View style={styles.flex1}>
                <HText variant="bodyStrong" numberOfLines={1}>
                  {tr(p.titleKey)}
                </HText>
                <HText variant="callout" color="muted" numberOfLines={1}>
                  {tr(p.subtitleKey)}
                </HText>
              </View>
              <Icon name="arrowRight" size={18} color={t.colors.subtle} />
            </PressableScale>
          </FadeIn>
        ))}
      </View>
      <FadeIn delay={300}>
        <View style={[styles.tip, { borderColor: t.colors.border, borderRadius: t.radii.l }]}>
          <View style={[styles.slashKey, { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.borderControl, borderRadius: t.radii.inline }]}>
            <HText variant="bodyStrong" style={{ fontFamily: t.fonts.mono }}>
              /
            </HText>
          </View>
          <View style={styles.flex1}>
            <HText variant="caption" weight="600">
              {tr('onboarding.guided.done.tipTitle')}
            </HText>
            <HText variant="caption" color="muted">
              {tr('onboarding.guided.done.tip')}
            </HText>
          </View>
        </View>
      </FadeIn>
      {demo ? (
        <View style={{ marginTop: t.spacing.l }}>
          <Notice tone="info" text={tr('onboarding.done.demoNote')} />
        </View>
      ) : null}
    </OnbScreen>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  promptBox: { borderWidth: 1, overflow: 'hidden', marginBottom: 12 },
  promptHead: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  promptScroll: { maxHeight: 220 },
  btnCol: { gap: 8 },
  linkRow: { alignSelf: 'flex-start', paddingVertical: 10 },
  stepsCard: { flexDirection: 'row', gap: 12, padding: 14, marginBottom: 16, alignItems: 'flex-start' },
  hero: { alignItems: 'center', gap: 10, marginTop: 16 },
  check: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  starter: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1 },
  starterIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  tip: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, borderWidth: 1, borderStyle: 'dashed' },
  slashKey: { width: 32, height: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
