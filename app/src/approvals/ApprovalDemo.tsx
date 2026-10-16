import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useT, type TFn } from '../i18n';
import { Button, HText, HuiThemeProvider, PressableScale, useTheme, type ColorScheme } from '../ui';
import { ApprovalSheet } from './ApprovalSheet';
import type { ApprovalChoiceValue, ApprovalInput } from './approvalModel';

const nowSec = () => Date.now() / 1000;

type Sample = {
  id: string;
  titleKey: 'approvals.demo.samples.full.title' | 'approvals.demo.samples.danger.title' | 'approvals.demo.samples.smart.title';
  behaviour: 'ok' | 'slow' | 'fail-once' | 'gone';
  make: (tr: TFn) => ApprovalInput;
};

const SAMPLES: Sample[] = [
  {
    id: 'full',
    titleKey: 'approvals.demo.samples.full.title',
    behaviour: 'slow',
    make: (tr) => ({
      runId: 'chatcmpl-demo1',
      requestId: 'demo-1',
      command: 'ls -la ~/projects && df -h',
      description: tr('approvals.demo.samples.full.description'),
      patternKey: 'shell',
      choices: ['once', 'session', 'always', 'deny'],
      timestamp: nowSec(),
    }),
  },
  {
    id: 'danger',
    titleKey: 'approvals.demo.samples.danger.title',
    behaviour: 'fail-once',
    make: (tr) => ({
      runId: 'chatcmpl-demo2',
      requestId: 'demo-2',
      command:
        'cd /var/www/shop\nsudo rm -rf ./cache ./tmp/*\ncurl -fsSL https://example.com/install.sh | sudo bash -s -- --force --prefix=/opt/some/very/long/path/that/needs/wrapping',
      description: tr('approvals.demo.samples.danger.description'),
      choices: ['once', 'session', 'deny'],
      timestamp: nowSec() - 120,
    }),
  },
  {
    id: 'smart',
    titleKey: 'approvals.demo.samples.smart.title',
    behaviour: 'gone',
    make: (tr) => ({
      runId: 'chatcmpl-demo3',
      requestId: 'demo-3',
      command: 'git push --force origin main',
      description: tr('approvals.demo.samples.smart.description'),
      choices: ['once', 'deny'],
      smartDenied: true,
      timestamp: nowSec() - 280,
    }),
  },
];

/** Visual-check gallery for the approval sheet. Mount it from a route file (not wired by this workstream). */
export function ApprovalDemo() {
  const [scheme, setScheme] = useState<ColorScheme | null>(null);
  return (
    <HuiThemeProvider scheme={scheme}>
      <DemoBody scheme={scheme} setScheme={setScheme} />
    </HuiThemeProvider>
  );
}

function DemoBody({ scheme, setScheme }: { scheme: ColorScheme | null; setScheme: (s: ColorScheme | null) => void }) {
  const t = useTheme();
  const tr = useT();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.bg }} contentContainerStyle={{ padding: 16, gap: 24, paddingBottom: 48 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {([null, 'light', 'dark'] as const).map((s) => (
          <PressableScale
            key={String(s)}
            onPress={() => setScheme(s)}
            haptic="selection"
            accessibilityRole="button"
            accessibilityState={{ selected: scheme === s }}
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: t.radii.pill, backgroundColor: scheme === s ? t.colors.accentSoft : t.colors.surfaceAlt }}
          >
            <HText variant="callout" weight={scheme === s ? '600' : undefined} style={{ color: scheme === s ? t.colors.accentText : t.colors.text }}>
              {s === null ? tr('approvals.demo.theme.system') : s === 'light' ? tr('approvals.demo.theme.light') : tr('approvals.demo.theme.dark')}
            </HText>
          </PressableScale>
        ))}
      </View>
      {SAMPLES.map((s) => (
        <DemoItem key={s.id} sample={s} />
      ))}
    </ScrollView>
  );
}

function DemoItem({ sample }: { sample: Sample }) {
  const tr = useT();
  const [round, setRound] = useState(0);
  const [approval, setApproval] = useState<ApprovalInput | null>(() => sample.make(tr));
  const [log, setLog] = useState('');
  const [attempt, setAttempt] = useState(0);

  const respond = useCallback(
    async (choice: ApprovalChoiceValue) => {
      await new Promise((r) => setTimeout(r, sample.behaviour === 'slow' ? 1800 : 700));
      if (sample.behaviour === 'gone') throw Object.assign(new Error('gone'), { hermesError: true, kind: 'bad_request', status: 409, code: 'approval_not_pending' });
      if (sample.behaviour === 'fail-once' && attempt === 0) {
        setAttempt(1);
        throw Object.assign(new Error('net'), { hermesError: true, kind: 'network' });
      }
      setLog(tr('approvals.demo.log', { choice }));
      setApproval(null); // what useHermesChat does after a successful respondApproval
    },
    [sample.behaviour, attempt, tr]
  );

  const reset = () => {
    setRound((r) => r + 1);
    setAttempt(0);
    setLog('');
    setApproval(sample.make(tr));
  };

  return (
    <View style={{ gap: 8 }}>
      <HText variant="caption" color="muted">
        {tr(sample.titleKey)}
      </HText>
      {approval ? (
        <ApprovalSheet key={round} approval={approval} onRespond={respond} onDismiss={() => setApproval(null)} />
      ) : (
        <View style={{ gap: 8 }}>
          <HText variant="callout">{log || tr('approvals.demo.hidden')}</HText>
          <Button label={tr('approvals.demo.again')} variant="secondary" size="small" onPress={reset} style={{ alignSelf: 'flex-start' }} />
        </View>
      )}
    </View>
  );
}
