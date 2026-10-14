import { StyleSheet, View } from 'react-native';
import { FadeIn, HText, useTheme } from '../ui';
import { useT } from '../i18n';
import { Button, OnbIcon, OnbScreen, SmallLink } from './ui';

const POINTS = [
  { id: 'point1', icon: 'sparkle' },
  { id: 'point2', icon: 'check' },
  { id: 'point3', icon: 'info' },
] as const;

export function Welcome({ onStart, onDemo }: { onStart: () => void; onDemo: () => void }) {
  const t = useTheme();
  const tr = useT();
  return (
    <OnbScreen
      footer={
        <>
          <Button label={tr('onboarding.welcome.start')} onPress={onStart} />
          <View style={{ alignItems: 'center' }}>
            <SmallLink label={tr('onboarding.welcome.demoLink')} onPress={onDemo} />
          </View>
        </>
      }
    >
      <FadeIn style={styles.hero}>
        <View style={[styles.logo, { backgroundColor: t.colors.surfaceAlt }]}>
          <OnbIcon name="sparkle" size={30} color={t.colors.text} />
        </View>
        <View style={[styles.badge, { borderColor: t.colors.border }]}>
          <HText variant="micro" color="muted" align="center">
            {tr('onboarding.welcome.badge')}
          </HText>
        </View>
        <HText variant="display" align="center" accessibilityRole="header">
          {tr('onboarding.welcome.title')}
        </HText>
        <HText variant="body" color="muted" align="center">
          {tr('onboarding.welcome.lead')}
        </HText>
      </FadeIn>
      <View style={{ gap: t.spacing.l, marginTop: t.spacing.xxl }}>
        {POINTS.map((p, i) => (
          <FadeIn key={p.id} delay={120 + i * 70} style={styles.point}>
            <View style={[styles.pointIcon, { backgroundColor: t.colors.surfaceAlt }]}>
              <OnbIcon name={p.icon} size={18} color={t.colors.text} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <HText variant="bodyStrong">{tr(`onboarding.welcome.${p.id}.title`)}</HText>
              <HText variant="callout" color="muted">
                {tr(`onboarding.welcome.${p.id}.text`)}
              </HText>
            </View>
          </FadeIn>
        ))}
      </View>
    </OnbScreen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 12, marginTop: 24 },
  logo: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  point: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  pointIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
