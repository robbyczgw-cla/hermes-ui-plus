import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTheme, type Theme } from '../../theme';
import { useHui } from '../../primitives/context';
import { FadeIn, HText, InlineText, PressableScale, Surface } from '../../primitives/basics';
import { Button } from '../../primitives/Button';
import { Icon } from '../../primitives/Icon';
import { haptic } from '../../primitives/haptics';
import { asOptString } from '../../lib/format';
import { useNodeState } from '../../../nodestate';
import type { HuiQuiz } from '../../types';
import { advanceQuiz, answerQuestion, initialQuizState, isCorrect, readQuestions, scoreQuiz, type QuizQuestion, type QuizState } from './a/learnModel.ts';
import { quizReply } from './a/replies.ts';
import { PrimaryButton, SecondaryButton, useModuleId, useSend } from './a/shared';
import { useS } from './useS';
import { QuizSkeleton } from '../../skeletons';

/**
 * `quiz` – one question at a time, immediate feedback + explanation, score at the end (local).
 * Progress is persisted. "Ergebnis an Hermes senden" (optional) sends `[quiz:<id>] 4/5 richtig`.
 */
export function Quiz({ node }: { node: Partial<HuiQuiz> }) {
  const S = useS();
  const t = useTheme();
  const { streaming } = useHui();
  const id = useModuleId('quiz', node as Record<string, unknown>);
  const questions = useMemo(() => readQuestions(node.questions), [node.questions]);
  const [st, setSt] = useNodeState<QuizState>(id, initialQuizState);
  const [draftState, setDraftState] = useState<{ i: number; sel: number[] }>({ i: 0, sel: [] });
  const send = useSend(id);
  const title = asOptString(node.title);
  const i = Math.min(st.i, Math.max(0, questions.length - 1));
  const draft = draftState.i === i ? draftState.sel : [];

  if (!questions.length) {
    return streaming ? (
      <QuizSkeleton />
    ) : (
      <Surface>
        <HText variant="callout" color="muted">
          {S.quiz.noQuestions}
        </HText>
      </Surface>
    );
  }

  if (st.finished && !streaming) {
    const { correct, total } = scoreQuiz(questions, st.answers);
    return <Result t={t} title={title} questions={questions} answers={st.answers} correct={correct} total={total} sent={st.sent}
      onSend={() => {
        if (!send(quizReply(id, correct, total))) return;
        setSt((s) => ({ ...s, sent: true }));
      }}
      onRetry={() => {
        haptic('selection');
        setSt(initialQuizState);
      }}
    />;
  }

  const q = questions[i];
  const answered = st.answers[i] ?? null;
  const revealed = answered !== null;
  // while streaming, the last question may still be incomplete → don't let the user move past what exists
  const isLast = i === questions.length - 1;
  const canAdvance = !(streaming && isLast);

  const submit = (sel: number[]) => {
    const ok = isCorrect(sel, q.answer);
    haptic(sel.length === 0 ? 'light' : ok ? 'success' : 'warning');
    setSt((s) => answerQuestion(s, i, sel));
  };

  const tap = (k: number) => {
    if (revealed || streaming) return;
    if (q.multi) {
      haptic('selection');
      setDraftState({ i, sel: draft.includes(k) ? draft.filter((x) => x !== k) : [...draft, k] });
    } else submit([k]);
  };

  return (
    <Surface style={{ gap: t.spacing.m }}>
      <View style={{ gap: 6 }}>
        {title ? <InlineText variant="headline" text={title} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
          <HText variant="caption" color="muted" style={{ flex: 1 }} tabular>
            {S.quiz.question(i, questions.length)}
          </HText>
          <Dots t={t} questions={questions} answers={st.answers} current={i} />
        </View>
      </View>
      <FadeIn key={i} rise={8} style={{ gap: t.spacing.m }}>
        <View style={{ gap: 2 }}>
          <InlineText variant="bodyStrong" text={q.q} accessibilityRole="header" />
          {q.multi ? (
            <HText variant="caption" color="muted">
              {S.quiz.multiHint}
            </HText>
          ) : null}
        </View>
        <View style={{ gap: t.spacing.s }}>
          {q.options.map((label, k) => {
            const chosen = revealed ? answered!.includes(k) : draft.includes(k);
            const right = q.answer.includes(k);
            const state: 'idle' | 'chosen' | 'right' | 'wrong' | 'dim' = !revealed ? (chosen ? 'chosen' : 'idle') : right ? 'right' : chosen ? 'wrong' : 'dim';
            return <OptionRow key={k} t={t} label={label} state={state} multi={q.multi} onPress={() => tap(k)} disabled={streaming} locked={revealed} />;
          })}
        </View>
        {revealed ? (
          <FadeIn rise={4} style={{ gap: t.spacing.s }}>
            <Feedback t={t} q={q} answered={answered!} />
          </FadeIn>
        ) : null}
      </FadeIn>
      <View style={{ flexDirection: 'row', gap: t.spacing.s, alignItems: 'center' }}>
        {!revealed ? (
          <>
            <Button label={S.quiz.skip} variant="tertiary" disabled={streaming} onPress={() => submit([])} />
            {q.multi ? <PrimaryButton label={S.quiz.check} disabled={!draft.length || streaming} onPress={() => submit(draft)} style={{ flex: 1 }} /> : null}
          </>
        ) : (
          <PrimaryButton
            label={isLast ? S.quiz.finish : S.quiz.next}
            icon={isLast ? undefined : 'arrowRight'}
            disabled={!canAdvance}
            onPress={() => {
              haptic('light');
              setSt((s) => advanceQuiz({ ...s, i }, questions.length));
            }}
            style={{ flex: 1 }}
          />
        )}
      </View>
    </Surface>
  );
}

function Dots({ t, questions, answers, current }: { t: Theme; questions: QuizQuestion[]; answers: (number[] | null)[]; current: number }) {
  if (questions.length > 12) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 4 }} accessible={false} importantForAccessibility="no-hide-descendants">
      {questions.map((q, k) => {
        const a = answers[k];
        const bg = a == null ? (k === current ? t.colors.accent : t.colors.surfaceAlt) : isCorrect(a, q.answer) ? t.colors.success : t.colors.danger;
        return <View key={k} style={{ width: k === current ? 14 : 6, height: 6, borderRadius: 3, backgroundColor: bg, opacity: a == null && k !== current ? 1 : 0.9 }} />;
      })}
    </View>
  );
}

function OptionRow({ t, label, state, multi, onPress, disabled, locked }: { t: Theme; label: string; state: 'idle' | 'chosen' | 'right' | 'wrong' | 'dim'; multi: boolean; onPress: () => void; disabled: boolean; locked: boolean }) {
  const S = useS();
  const border = state === 'right' ? t.colors.success : state === 'wrong' ? t.colors.danger : state === 'chosen' ? t.colors.accent : t.colors.border;
  const bg = state === 'right' ? t.colors.successSoft : state === 'wrong' ? t.colors.dangerSoft : state === 'chosen' ? t.colors.accentSoft : t.colors.surface;
  const a11yState = state === 'right' ? S.quiz.isCorrect : state === 'wrong' ? S.quiz.isWrong : state === 'chosen' ? S.quiz.selected : '';
  return (
    <PressableScale
      haptic={false}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: state === 'chosen' || state === 'wrong', disabled: disabled || locked }}
      scaleTo={locked ? 1 : 0.985}
      accessibilityLabel={S.quiz.optionA11y(label, a11yState)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.m,
        minHeight: 48,
        paddingHorizontal: t.spacing.m,
        paddingVertical: t.spacing.s + 2,
        borderRadius: t.radii.control,
        borderWidth: state === 'idle' || state === 'dim' ? 1 : 1.5,
        borderColor: border,
        backgroundColor: bg,
        opacity: state === 'dim' ? 0.6 : 1,
      }}
      pressedStyle={locked ? undefined : { backgroundColor: t.colors.surfacePressed }}
    >
      <InlineText variant="body" text={label} style={{ flex: 1 }} />
      {state === 'right' ? <Icon name="checkCircle" size={20} color={t.colors.success} strokeWidth={2} /> : state === 'wrong' ? <Icon name="x" size={18} color={t.colors.danger} strokeWidth={2.25} /> : state === 'chosen' ? <Icon name="check" size={18} color={t.colors.accent} strokeWidth={2.25} /> : null}
    </PressableScale>
  );
}

function Feedback({ t, q, answered }: { t: Theme; q: QuizQuestion; answered: number[] }) {
  const S = useS();
  const skipped = answered.length === 0;
  const ok = isCorrect(answered, q.answer);
  const fg = ok ? t.colors.success : skipped ? t.colors.muted : t.colors.danger;
  return (
    <View style={{ gap: 4, backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.control, padding: t.spacing.m }} accessibilityLiveRegion="polite">
      <HText variant="bodyStrong" style={{ color: fg }}>
        {ok ? S.quiz.correct : skipped ? S.quiz.skipped : S.quiz.wrong}
      </HText>
      {!ok ? (
        <HText variant="callout" color="muted">
          {S.quiz.correctAnswer}: {q.answer.map((k) => q.options[k]).join(', ')}
        </HText>
      ) : null}
      {q.explanation ? <InlineText variant="callout" text={q.explanation} /> : null}
    </View>
  );
}

function Result({ t, title, questions, answers, correct, total, sent, onSend, onRetry }: { t: Theme; title?: string; questions: QuizQuestion[]; answers: (number[] | null)[]; correct: number; total: number; sent: boolean; onSend: () => void; onRetry: () => void }) {
  const S = useS();
  const ratio = total ? correct / total : 0;
  return (
    <Surface style={{ gap: t.spacing.l }}>
      <FadeIn style={{ alignItems: 'center', gap: 4, paddingTop: t.spacing.s }}>
        <HText variant="caption" weight="600" color="muted">
          {title ?? S.quiz.resultTitle}
        </HText>
        <HText variant="display" tabular accessibilityLabel={S.quiz.score(correct, total)}>
          {correct}
          <HText variant="title" color="muted">
            {' '}/ {total}
          </HText>
        </HText>
        <HText variant="callout" color={ratio >= 0.8 ? 'success' : 'muted'} weight="500">
          {S.quiz.verdict(ratio)}
        </HText>
      </FadeIn>
      <View style={{ gap: 6 }}>
        {questions.map((q, k) => {
          const ok = isCorrect(answers[k], q.answer);
          return (
            <View key={k} style={{ flexDirection: 'row', gap: t.spacing.s, alignItems: 'flex-start' }} accessible accessibilityLabel={`${q.q}: ${ok ? S.quiz.isCorrect : S.quiz.isWrong}`}>
              <View style={{ paddingTop: 2 }}>
                <Icon name={ok ? 'check' : 'x'} size={16} color={ok ? t.colors.success : t.colors.danger} strokeWidth={2.4} />
              </View>
              <HText variant="callout" style={{ flex: 1 }} numberOfLines={2}>
                {q.q}
              </HText>
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: t.spacing.s, flexWrap: 'wrap' }}>
        <SecondaryButton label={S.quiz.retry} onPress={onRetry} style={{ flexGrow: 1 }} />
        {sent ? (
          <View style={{ flexGrow: 2, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name="check" size={16} color={t.colors.success} strokeWidth={2.25} />
            <HText variant="callout" weight="500" style={{ color: t.colors.success }}>
              {S.quiz.sent}
            </HText>
          </View>
        ) : (
          <PrimaryButton label={S.quiz.sendResult} icon="send" onPress={onSend} style={{ flexGrow: 2 }} />
        )}
      </View>
    </Surface>
  );
}
