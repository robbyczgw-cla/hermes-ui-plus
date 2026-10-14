import { View } from 'react-native';
import { useTheme } from '../../theme';
import { useHui } from '../../primitives/context';
import { HText, InlineText, Surface } from '../../primitives/basics';
import { Icon, type IconName } from '../../primitives/Icon';
import { Skeleton } from '../../primitives/Skeleton';
import { haptic } from '../../primitives/haptics';
import { asOptString } from '../../lib/format';
import { useNodeState } from '../../../nodestate';
import type { HuiConfirm, HuiTone } from '../../types';
import { confirmReply } from './a/replies.ts';
import { AnsweredSummary, PrimaryButton, SecondaryButton, useModuleId, useSend } from './a/shared';
import { useS } from './useS';
import { ConfirmSkeleton } from '../../skeletons';

const TONE_ICON: Record<HuiTone, IconName> = { info: 'info', success: 'checkCircle', warning: 'alert', danger: 'alertOctagon' };

type ConfirmState = { answer: 'ja' | 'nein' | null };

/**
 * `confirm` – model-proposed decision card; sends `[confirm:<id>] ja|nein` and locks. It does NOT
 * block Hermes (real blocking approvals are the ApprovalSheet); the answer arrives as the next message.
 */
export function Confirm({ node }: { node: Partial<HuiConfirm> }) {
  const S = useS();
  const t = useTheme();
  const { streaming } = useHui();
  const id = useModuleId('confirm', node as Record<string, unknown>);
  const [st, setSt] = useNodeState<ConfirmState>(id, { answer: null });
  const send = useSend(id);
  const tone: HuiTone = node.tone === 'warning' || node.tone === 'danger' || node.tone === 'success' ? node.tone : 'info';
  const title = asOptString(node.title);
  const text = asOptString(node.text);
  const confirmLabel = asOptString(node.confirmLabel) ?? S.confirm.confirm;
  const cancelLabel = asOptString(node.cancelLabel) ?? S.confirm.cancel;
  const fg = t.colors[tone];
  const soft = t.colors[`${tone}Soft` as const];

  if (!title && streaming) {
    return <ConfirmSkeleton />;
  }

  if (st.answer) {
    const yes = st.answer === 'ja';
    return (
      <Surface>
        <AnsweredSummary
          title={title}
          answer={`${yes ? S.confirm.confirmed : S.confirm.declined} – ${yes ? confirmLabel : cancelLabel}`}
          icon={yes ? 'checkCircle' : 'x'}
          tone={yes ? 'success' : 'muted'}
          onReopen={() => {
            haptic('selection');
            setSt({ answer: null });
          }}
        />
      </Surface>
    );
  }

  const answer = (yes: boolean) => {
    if (!send(confirmReply(id, yes))) return; // refused (turn running) → stay open
    setSt({ answer: yes ? 'ja' : 'nein' });
  };

  return (
    <Surface style={{ gap: t.spacing.l, borderColor: tone === 'danger' || tone === 'warning' ? fg : t.colors.border, borderWidth: 1 }}>
      <View style={{ flexDirection: 'row', gap: t.spacing.m }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={TONE_ICON[tone]} size={19} color={fg} />
        </View>
        <View style={{ flex: 1, gap: 4, paddingTop: 6 }}>
          {title ? <InlineText variant="headline" text={title} accessibilityRole="header" /> : null}
          {text ? <InlineText variant="callout" color="muted" text={text} /> : streaming ? <Skeleton width="80%" height={12} /> : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: t.spacing.s, flexWrap: 'wrap' }}>
        <SecondaryButton label={cancelLabel} onPress={() => answer(false)} disabled={streaming} style={{ flexGrow: 1, flexBasis: 120 }} />
        <PrimaryButton
          label={confirmLabel}
          tone={tone === 'danger' ? 'danger' : 'accent'}
          onPress={() => answer(true)}
          disabled={streaming}
          accessibilityHint={S.confirm.hint}
          style={{ flexGrow: 1, flexBasis: 120 }}
        />
      </View>
      <HText variant="micro" color="subtle">
        {S.confirm.hint}
      </HText>
    </Surface>
  );
}
