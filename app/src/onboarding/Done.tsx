// Step 5: ready → first chat with starter prompts.
import { StyleSheet, View } from 'react-native';
import { FadeIn, HText, Icon, PressableScale, useTheme } from '../ui';
import { useT } from '../i18n';
import { DEMO_STARTERS, STARTERS, type StarterPrompt } from './starters';
import { Button, Notice, OnbScreen, HeroText } from './ui';

export function Done({
  demo,
  connectionName,
  onStart,
  onBack,
  step,
  total,
}: {
  demo: boolean;
  connectionName?: string;
  /** prompt = tapped starter (send as first message) or undefined (empty chat) */
  onStart: (prompt?: string) => void;
  onBack?: () => void;
  step?: number;
  total?: number;
}) {
  const t = useTheme();
  const tr = useT();
  const starters: readonly StarterPrompt[] = demo ? DEMO_STARTERS : STARTERS;
  return (
    <OnbScreen onBack={onBack} step={step} total={total} footer={<Button label={tr('onboarding.done.newChat')} onPress={() => onStart()} />}>
      <FadeIn style={styles.hero}>
        <View style={[styles.check, { backgroundColor: t.colors.successSoft }]}>
          <Icon name="check" size={28} color={t.colors.success} />
        </View>
        <HeroText align="center">{tr('onboarding.done.title')}</HeroText>
        <HText variant="body" color="muted" align="center">
          {demo ? tr('onboarding.done.leadDemo') : tr('onboarding.done.leadConnected', { name: connectionName ? tr('onboarding.done.quotedName', { name: connectionName }) : 'Hermes' })}
        </HText>
      </FadeIn>
      <View style={{ gap: t.spacing.s, marginTop: t.spacing.xl, marginBottom: t.spacing.l }}>
        {starters.map((p, i) => (
          <FadeIn key={p.id} delay={100 + i * 60}>
            <PressableScale
              onPress={() => onStart(p.promptKey ? tr(p.promptKey) : p.prompt)}
              accessibilityLabel={`${tr(p.titleKey)} ${tr(p.subtitleKey)}`}
              haptic="selection"
              scaleTo={0.985}
              style={[styles.starter, { borderColor: t.colors.border, borderRadius: t.radii.l, backgroundColor: t.dark ? t.colors.surface : t.colors.bg }]}
              pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
            >
              <View style={{ flex: 1 }}>
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
      {demo ? <Notice tone="info" text={tr('onboarding.done.demoNote')} /> : null}
    </OnbScreen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 10, marginTop: 24 },
  check: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  starter: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1 },
});
