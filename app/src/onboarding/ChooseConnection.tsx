import { useState } from 'react';
import { useT } from '../i18n';
import { AgentSetupSheet } from './AgentSetupSheet';
import { OnbScreen, OptionCard, Title } from './ui';

export type ConnectionChoice = 'pair' | 'direct' | 'demo' | 'other';

export function ChooseConnection({ onChoose, onBack, step, total }: { onChoose: (c: ConnectionChoice) => void; onBack?: () => void; step?: number; total?: number }) {
  const t = useT();
  const [agentSheet, setAgentSheet] = useState(false);
  return (
    <OnbScreen onBack={onBack} step={step} total={total}>
      <Title lead={t('onboarding.choose.lead')}>{t('onboarding.choose.title')}</Title>
      <OptionCard icon="qr" title={t('onboarding.choose.pair.title')} text={t('onboarding.choose.pair.text')} badge={t('onboarding.choose.pair.badge')} onPress={() => onChoose('pair')} />
      <OptionCard icon="agent" title={t('onboarding.agentSetup.option.title')} text={t('onboarding.agentSetup.option.text')} onPress={() => setAgentSheet(true)} delay={25} />
      <OptionCard icon="server" title={t('onboarding.choose.direct.title')} text={t('onboarding.choose.direct.text')} onPress={() => onChoose('direct')} delay={50} />
      <OptionCard icon="play" title={t('onboarding.choose.demo.title')} text={t('onboarding.choose.demo.text')} onPress={() => onChoose('demo')} delay={100} />
      <AgentSetupSheet
        visible={agentSheet}
        onClose={() => setAgentSheet(false)}
        onPasteLink={() => {
          setAgentSheet(false);
          onChoose('pair');
        }}
      />
    </OnbScreen>
  );
}
