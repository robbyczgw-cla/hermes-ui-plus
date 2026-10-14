// Guided onboarding, step 0: app name + tagline, a live mini answer, three value props, the "unofficial" note.
import { Image, StyleSheet, View } from 'react-native';
import { brand } from '../../brand';
import { useT } from '../../i18n';
import { FadeIn, HText, useTheme } from '../../ui';
import { Button, OnbIcon, OnbScreen, type OnbIconName } from '../ui';
import { MiniDemo } from './MiniDemo';

const POINTS: readonly { id: 'point1' | 'point2' | 'point3'; icon: OnbIconName | 'sparkle' }[] = [
  { id: 'point1', icon: 'sparkle' },
  { id: 'point2', icon: 'shield' },
  { id: 'point3', icon: 'plug' },
];

// static asset (Metro resolves require() at build time; no *.png module typings in this project)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ICON = require('../../../assets/icon.png') as number;

export function WelcomeGuided({ onConnect, onDemo }: { onConnect: () => void; onDemo: () => void }) {
  const t = useTheme();
  const tr = useT();
  return (
    <OnbScreen
      footer={
        <>
          <Button label={tr('onboarding.guided.welcome.start')} onPress={onConnect} />
          <Button variant="ghost" label={tr('onboarding.guided.welcome.demo')} onPress={onDemo} />
        </>
      }
    >
      <FadeIn style={styles.hero}>
        <Image source={ICON} style={[styles.logo, { borderRadius: 16 }]} accessibilityIgnoresInvertColors accessible={false} />
        <HText variant="display" align="center" accessibilityRole="header">
          {brand().name}
        </HText>
        <HText variant="body" color="muted" align="center">
          {tr('onboarding.guided.welcome.tagline')}
        </HText>
        <View style={[styles.badge, { borderColor: t.colors.border }]}>
          <HText variant="micro" color="muted" align="center">
            {tr('onboarding.guided.welcome.disclaimer')}
          </HText>
        </View>
      </FadeIn>

      <FadeIn delay={120} style={{ marginTop: t.spacing.xl }}>
        <MiniDemo />
      </FadeIn>

      <View style={{ gap: t.spacing.m, marginTop: t.spacing.xl }}>
        {POINTS.map((p, i) => (
          <FadeIn key={p.id} delay={220 + i * 70} style={styles.point}>
            <View style={[styles.pointIcon, { backgroundColor: t.colors.surfaceAlt }]}>
              <OnbIcon name={p.icon} size={18} color={t.colors.text} />
            </View>
            <View style={{ flex: 1 }}>
              <HText variant="bodyStrong">{tr(`onboarding.guided.welcome.${p.id}.title`)}</HText>
              <HText variant="callout" color="muted">
                {tr(`onboarding.guided.welcome.${p.id}.text`)}
              </HText>
            </View>
          </FadeIn>
        ))}
      </View>

    </OnbScreen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 6 },
  logo: { width: 60, height: 60, marginBottom: 8 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6 },
  point: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  pointIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
