// Step 4: hint to install the `hermes-ui` skill on the Hermes host. Generic: clone command only with a published
// repo URL (brand identity), else just the copy step from a source checkout – never a placeholder URL.
import * as WebBrowser from 'expo-web-browser';
import { View } from 'react-native';
import { useT } from '../i18n';
import { HText, useTheme } from '../ui';
import { SKILL_DOCS_URL, PROJECT_REPO_URL, skillInstallCommand } from './model';
import { Button, CodeBox, Notice, OnbScreen, Title } from './ui';

export function SkillHint({ bridge, onDone, onBack, step, total }: { bridge: boolean; onDone: () => void; onBack?: () => void; step?: number; total?: number }) {
  const t = useTheme();
  const tr = useT();
  return (
    <OnbScreen
      onBack={onBack}
      step={step}
      total={total}
      footer={
        <>
          <Button label={tr('onboarding.skill.done')} onPress={onDone} />
          <Button variant="tertiary" label={tr('onboarding.skill.later')} onPress={onDone} />
        </>
      }
    >
      <Title lead={tr('onboarding.skill.lead')}>{tr('onboarding.skill.title')}</Title>
      <HText variant="headline" style={{ marginBottom: t.spacing.s }}>
        {tr('onboarding.skill.stepsTitle')}
      </HText>
      <CodeBox code={skillInstallCommand()} label="bash" />
      {PROJECT_REPO_URL ? null : (
        <HText variant="caption" color="subtle" style={{ marginBottom: t.spacing.l }}>
          {tr('onboarding.skill.sourceNote')}
        </HText>
      )}
      <Notice tone="info" text={bridge ? tr('onboarding.skill.bridgeNote') : tr('onboarding.skill.directNote')} />
      {SKILL_DOCS_URL ? (
        <View style={{ alignItems: 'flex-start' }}>
          <Button variant="secondary" icon="external" label={tr('onboarding.skill.docs')} onPress={() => void WebBrowser.openBrowserAsync(SKILL_DOCS_URL!)} />
        </View>
      ) : null}
    </OnbScreen>
  );
}
