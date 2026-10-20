import { StyleSheet, View } from 'react-native';
import { FadeIn, HText, useTheme } from '../ui';
import { useT } from '../i18n';
import { Button, OnbIcon, OnbScreen, SmallLink, HeroText } from './ui';

const POINTS = [
  { id: 'point1', icon: 'sparkle' },
  { id: 'point2', icon: 'check' },
  { id: 'point3', icon: 'info' },
] as const;

export function Welcome({ onStart, onDemo }: { onStart: () => void; onDemo: () => void }) {
  const t = useTheme();
  const tr = useT();
  const overlay = null;
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
        <View style={[styles.logo, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.card }]}>
          <OnbIcon name="sparkle" size={30} color={t.colors.text} />
        </View>
        {overlay ? null : (
          <View style={[styles.badge, { borderColor: t.colors.border, borderRadius: t.radii.inline }]}>
            <HText variant="micro" color="muted" align="center">
              {tr('onboarding.welcome.badge')}
            </HText>
          </View>
        )}
        <HeroText align="center">{tr('onboarding.welcome.title')}</HeroText>
        <HText variant="body" color="muted" align="center">{tr('onboarding.welcome.lead')}</HText>
      </FadeIn>
      <View style={{ gap: t.spacing.l, marginTop: t.spacing.xxl }}>
        {POINTS.map((p, i) => (
          <FadeIn key={p.id} delay={120 + i * 70} style={styles.point}>
            <View style={[styles.pointIcon, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.control }]}>
              <OnbIcon name={p.icon} size={18} color={t.colors.text} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <HText variant="bodyStrong">{tr(`onboarding.welcome.${p.id}.title`)}</HText>
              <HText variant="callout" color="muted">{tr(`onboarding.welcome.${p.id}.text`)}</HText>
            </View>
          </FadeIn>
        ))}
      </View>
    </OnbScreen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 12, marginTop: 24 },
  logo: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  badge: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  point: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  pointIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
