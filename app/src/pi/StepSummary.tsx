/**
 * `StepSummary` – one line over a group of Pi steps: a chevron, "Thought, read 3 files, edited 2, ran 3 commands"
 * (muted callout, up to two lines), the duration, and under it a wrap row of outcome chips (`+12 −3`, `48 passed / 1
 * failed`, `exit 1`, `needs approval`). Tapping toggles `open`, which shows `children` (the step timeline).
 *
 * Text and chips come from the pure `stepSummary` (./outcome.ts, logic ported from Pi Pocket – NOTICE.md),
 * translated through `ui.steps.*`. `open` may be controlled (`open` + `onToggle`) or left to the component.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme, type Theme } from '../ui/theme';
import { HText, PressableScale } from '../ui/primitives/basics';
import { Icon } from '../ui/primitives/Icon';
import { useT, type TKey } from '../i18n';
import { stepSummary, type Outcome, type StepInput, type Tr } from './outcome.ts';

export type StepSummaryProps = {
  steps: readonly StepInput[];
  /** a thought is still being written (the line says "Thinking" while it is all there is) */
  thinking?: boolean;
  durationMs?: number;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children?: ReactNode;
};

export function StepSummary({ steps, thinking, durationMs, open, onToggle, children }: StepSummaryProps) {
  const t = useTheme();
  const tr = useT();
  const [own, setOwn] = useState(false);
  const isOpen = open ?? own;
  const model = useMemo(() => {
    const trSteps: Tr = (key, vars) => tr(`ui.steps.${key}` as TKey, vars);
    return stepSummary(steps, { thinking, durationMs }, trSteps);
  }, [steps, thinking, durationMs, tr]);

  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setOwn(next);
    onToggle?.(next);
  };

  return (
    <View style={{ gap: t.spacing.xs }}>
      <PressableScale
        haptic="selection"
        scaleTo={0.99}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={model.a11y}
        accessibilityHint={tr(isOpen ? 'ui.steps.collapse' : 'ui.steps.expand')}
        accessibilityState={{ expanded: isOpen }}
        hitSlop={4}
        style={{ gap: t.spacing.xs, paddingVertical: t.spacing.xs, minHeight: 36, justifyContent: 'center' }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.xs }}>
          <View style={{ paddingTop: 2, transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }}>
            <Icon name="chevronRight" size={16} color={t.colors.subtle} strokeWidth={2} />
          </View>
          <HText variant="callout" color="muted" numberOfLines={2} style={{ flex: 1 }}>
            {model.line}
          </HText>
          {model.duration ? (
            <HText variant="caption" color="subtle" tabular style={{ paddingTop: 1 }}>
              {model.duration}
            </HText>
          ) : null}
        </View>
        {model.chips.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs, paddingLeft: 16 + t.spacing.xs }}>
            {model.chips.map((chip, i) => (
              <Chip key={`${chip.kind}:${i}`} t={t} chip={chip} />
            ))}
          </View>
        ) : null}
      </PressableScale>
      {isOpen && children ? <View style={{ paddingLeft: 16 + t.spacing.xs }}>{children}</View> : null}
    </View>
  );
}

function chipColors(t: Theme, chip: Outcome): [bg: string, fg: string] {
  if (chip.kind === 'diff') return [t.colors.surfaceAlt, t.colors.muted];
  switch (chip.tone) {
    case 'good':
      return [t.colors.successSoft, t.colors.success];
    case 'bad':
      return [t.colors.dangerSoft, t.colors.danger];
    case 'warn':
      return [t.colors.warningSoft, t.colors.warning];
    default:
      return [t.colors.surfaceAlt, t.colors.muted];
  }
}

/** A pill; a diff chip draws `+12` in the success colour and `−3` in the danger colour. */
function Chip({ t, chip }: { t: Theme; chip: Outcome }) {
  const [bg, fg] = chipColors(t, chip);
  return (
    <View style={{ backgroundColor: bg, borderRadius: t.radii.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
      {chip.kind === 'diff' ? (
        <HText variant="micro" tabular numberOfLines={1}>
          <HText variant="micro" tabular style={{ color: t.colors.success }}>{`+${chip.added ?? 0}`}</HText>
          {' '}
          <HText variant="micro" tabular style={{ color: t.colors.danger }}>{`−${chip.removed ?? 0}`}</HText>
        </HText>
      ) : (
        <HText variant="micro" numberOfLines={1} style={{ color: fg }}>
          {chip.label}
        </HText>
      )}
    </View>
  );
}
