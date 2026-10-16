/**
 * `decision` – weighted decision matrix (docs/SPEC-modules-v3.md). Weight sliders per criterion
 * (Calc slider look), live weighted totals Σ w·s / Σ w (0–10, 1 decimal), animated ranked bars with
 * winner highlight, tap an option for its per-criterion breakdown, "Entscheidung senden" →
 * `[decision:<id>] Gewinner: … (7,8) · Gewichte: …`. Weights persisted via useNodeState.
 */
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme, useMotionReduced, type Theme } from '../../../theme';
import { withAlpha } from '../../../color';
import { useHui } from '../../../primitives/context';
import { BlockTitle, FadeIn, HText, InlineText, PressableScale, Surface } from '../../../primitives/basics';
import { Icon } from '../../../primitives/Icon';
import { haptic } from '../../../primitives/haptics';
import { useNodeState } from '../../../../nodestate';
import { useLocale, useT } from '../../../../i18n';
import type { HuiDecision } from '../../../types';
import { useModuleId, useSend } from '../a/shared';
import { Btn, RoundBtn, Slider } from '../b/controls';
import { useSettledAfter } from '../../../lib/useSettledAfter';
import { breakdown, decisionReply, effectiveWeights, normalizeDecision, rankOptions, type DecisionCriterion, type DecisionModel, type RankedOption } from './decisionModel.ts';
import { fixed1, numLang, type NumLang } from './format.ts';
import { C3Icon, C3Skeleton } from './parts';

type DecisionState = { w: Record<string, number>; sent?: string };
const INITIAL: DecisionState = { w: {} };

const ROW_H = 54;
const ROW_GAP = 6;
const EASE = Easing.out(Easing.cubic);

export function Decision({ node }: { node: Partial<HuiDecision> }) {
  const t = useTheme();
  const tr = useT();
  const { lang } = useLocale();
  const L = numLang(lang);
  const { streaming } = useHui();
  const id = useModuleId('decision', node as Record<string, unknown>);
  const model = useMemo(() => normalizeDecision(node, id), [node, id]);
  const [st, setSt] = useNodeState<DecisionState>(id, INITIAL);
  const weights = useMemo(() => effectiveWeights(model.criteria, st.w), [model.criteria, st.w]);
  const ranked = useMemo(() => rankOptions(model.options, model.criteria, weights), [model, weights]);
  const [sel, setSel] = useState<string | null>(null);
  const send = useSend(id);

  if (!model.criteria.length && !model.options.length) {
    return streaming ? <C3Skeleton rows={3} rowHeight={ROW_H} /> : null;
  }

  const reply = streaming ? null : decisionReply(model, weights);
  const sent = !!reply && st.sent === reply;
  const allZero = model.criteria.length > 0 && model.criteria.every((c) => !(weights[c.key] > 0));
  const changed = model.criteria.some((c) => weights[c.key] !== c.weight);
  const selected = sel ? model.options.find((o) => o.key === sel) : undefined;

  const setWeight = (key: string, v: number) => setSt((s) => ({ ...s, w: { ...s.w, [key]: v } }));
  const reset = () => {
    haptic('light');
    setSt((s) => ({ ...s, w: {} }));
  };
  const submit = () => {
    if (!reply) return;
    if (!send(reply)) return; // turn running → stays sendable
    setSt((s) => ({ ...s, sent: reply }));
  };

  return (
    <Surface style={{ gap: t.spacing.l }}>
      {model.title ? <BlockTitle title={model.title} /> : null}

      {/* results */}
      <View style={{ gap: t.spacing.s }}>
        <SectionLabel t={t} text={tr('ui.decision.results')} />
        <RankedBars t={t} ranked={ranked} selected={sel} lang={L} streaming={streaming} onSelect={(k) => setSel((cur) => (cur === k ? null : k))} />
        {!selected && ranked.length > 1 && !streaming ? (
          <HText variant="caption" color="subtle">
            {tr('ui.decision.tapHint')}
          </HText>
        ) : null}
        {selected ? <Breakdown key={selected.key} t={t} model={model} optionKey={selected.key} weights={weights} lang={L} onClose={() => setSel(null)} /> : null}
      </View>

      {/* weights */}
      {model.criteria.length ? (
        <View style={{ gap: t.spacing.s }}>
          <View style={{ gap: 2 }}>
            <SectionLabel t={t} text={tr('ui.decision.weights')} />
            <HText variant="caption" color="muted">
              {tr('ui.decision.weightsHint')}
            </HText>
          </View>
          <View style={{ gap: t.spacing.xs, opacity: streaming ? 0.6 : 1 }} pointerEvents={streaming ? 'none' : 'auto'}>
            {model.criteria.map((c) => (
              <WeightRow key={c.key} t={t} c={c} value={weights[c.key]} onChange={(v) => setWeight(c.key, v)} />
            ))}
          </View>
          {allZero ? (
            <HText variant="caption" color="warning" accessibilityLiveRegion="polite">
              {tr('ui.decision.allZero')}
            </HText>
          ) : null}
        </View>
      ) : null}

      {model.note ? <InlineText variant="caption" color="muted" text={model.note} /> : null}
      <HText variant="micro" color="subtle">
        {tr('ui.decision.formula')}
      </HText>

      {/* actions */}
      <View style={{ flexDirection: 'row', gap: t.spacing.s, alignItems: 'center' }}>
        <RoundBtn bicon="reset" label={tr('ui.decision.reset')} onPress={reset} disabled={streaming || !changed} size={44} />
        {sent ? (
          <View
            accessibilityLiveRegion="polite"
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, paddingHorizontal: t.spacing.l, borderRadius: t.radii.pill, backgroundColor: t.colors.successSoft }}
          >
            <Icon name="check" size={16} color={t.colors.success} strokeWidth={2.25} />
            <HText variant="callout" weight="600" style={{ color: t.colors.success }} numberOfLines={1}>
              {tr('ui.decision.sent')}
            </HText>
          </View>
        ) : (
          <Btn label={tr('ui.decision.send')} kind="primary" icon="send" onPress={submit} disabled={!reply} accessibilityHint={tr('ui.decision.sendHint')} style={{ flex: 1 }} />
        )}
      </View>
    </Surface>
  );
}

function SectionLabel({ t, text }: { t: Theme; text: string }) {
  return (
    <HText variant="caption" weight="600" color="muted" accessibilityRole="header">
      {text}
    </HText>
  );
}

/* ───────────── ranked bars ───────────── */

function RankedBars({ t, ranked, selected, lang, streaming, onSelect }: { t: Theme; ranked: RankedOption[]; selected: string | null; lang: NumLang; streaming: boolean; onSelect: (key: string) => void }) {
  const n = ranked.length;
  const height = n ? n * ROW_H + (n - 1) * ROW_GAP : 0;
  const tie = ranked.filter((r) => r.winner).length > 1;
  // render in a stable (node) order so rows keep their identity; position = rank order
  const pos = new Map(ranked.map((r, i) => [r.option.key, i]));
  const stable = [...ranked].sort((a, b) => a.index - b.index);
  return (
    <View style={{ height }}>
      {stable.map((r) => (
        <BarRow key={r.option.key} t={t} r={r} top={(pos.get(r.option.key) ?? 0) * (ROW_H + ROW_GAP)} tie={tie} selected={selected === r.option.key} lang={lang} disabled={streaming} onPress={() => onSelect(r.option.key)} />
      ))}
    </View>
  );
}

function BarRow({ t, r, top, tie, selected, lang, disabled, onPress }: { t: Theme; r: RankedOption; top: number; tie: boolean; selected: boolean; lang: NumLang; disabled: boolean; onPress: () => void }) {
  const tr = useT();
  const reduced = useMotionReduced();
  const y = useSharedValue(top);
  const fill = useSharedValue(reduced ? (r.score ?? 0) / 10 : 0);
  useEffect(() => {
    y.value = reduced ? top : withTiming(top, { duration: 320, easing: EASE });
  }, [top, reduced, y]);
  useEffect(() => {
    const v = (r.score ?? 0) / 10;
    fill.value = reduced ? v : withTiming(v, { duration: 380, easing: EASE });
  }, [r.score, reduced, fill]);
  const move = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.0001, fill.value) }] }));
  // settled: React owns the ranked position + fill (a dropped value would pile rows at the first slot, bars at 0)
  const settled = useSettledAfter(reduced ? 0 : 460, [top, r.score, reduced]);

  const win = r.winner;
  const scoreText = r.score === null ? '–' : fixed1(r.score, lang);
  const a11y =
    r.score === null
      ? tr('ui.decision.rowA11yNone', { label: r.option.label })
      : tr('ui.decision.rowA11y', { rank: r.rank, label: r.option.label, score: scoreText }) + (win ? tr('ui.decision.winnerA11y') : '');
  const fillColor = win ? t.colors.accent : withAlpha(t.colors.accent, t.dark ? 0.45 : 0.35);

  return (
    <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, height: ROW_H }, move, settled ? { transform: [{ translateY: top }] } : null]}>
      <PressableScale
        haptic="selection"
        scaleTo={0.985}
        disabled={disabled}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint={tr('ui.decision.openBreakdown')}
        accessibilityState={{ selected, expanded: selected }}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.spacing.s,
          paddingHorizontal: t.spacing.s + 2,
          borderRadius: t.radii.control,
          borderWidth: win || selected ? 1.5 : 1,
          borderColor: selected ? t.colors.accent : win ? withAlpha(t.colors.accent, 0.55) : t.colors.border,
          backgroundColor: selected || win ? t.colors.accentSoft : t.colors.surface,
        }}
        pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
      >
        <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: win ? t.colors.accent : t.colors.surfaceAlt }}>
          {win ? (
            <C3Icon name="crown" size={14} color={t.colors.onAccent} strokeWidth={2} />
          ) : (
            <HText variant="micro" weight="700" color="muted" tabular>
              {r.score === null ? '–' : String(r.rank)}
            </HText>
          )}
        </View>
        <View style={{ flex: 1, gap: 5, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <HText variant="callout" weight={win ? '600' : '500'} numberOfLines={1} style={{ flexShrink: 1 }}>
              {r.option.label}
            </HText>
            {win ? (
              <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: t.radii.pill, backgroundColor: t.colors.accent }}>
                <HText variant="micro" weight="600" style={{ color: t.colors.onAccent }} numberOfLines={1}>
                  {tie ? tr('ui.decision.tie') : tr('ui.decision.winner')}
                </HText>
              </View>
            ) : null}
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}>
            <Animated.View style={[{ height: 6, width: '100%', borderRadius: 3, backgroundColor: fillColor, transformOrigin: 'left' } as object, bar, settled ? { transform: [{ scaleX: Math.max(0.0001, (r.score ?? 0) / 10) }] } : null]} />
          </View>
        </View>
        <HText variant="headline" tabular style={{ minWidth: 34, textAlign: 'right', color: win ? t.colors.accentText : t.colors.text }}>
          {scoreText}
        </HText>
      </PressableScale>
    </Animated.View>
  );
}

/* ───────────── breakdown ───────────── */

function Breakdown({ t, model, optionKey, weights, lang, onClose }: { t: Theme; model: DecisionModel; optionKey: string; weights: Record<string, number>; lang: NumLang; onClose: () => void }) {
  const tr = useT();
  const option = model.options.find((o) => o.key === optionKey);
  if (!option) return null;
  const rows = breakdown(option, model.criteria, weights);
  const total = rows.reduce((a, r) => a + (r.contribution ?? 0), 0);
  const anyScored = rows.some((r) => r.contribution !== null && r.weight > 0);
  return (
    <FadeIn>
      <View style={{ borderRadius: t.radii.control, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surfaceAlt, padding: t.spacing.m, gap: t.spacing.s }} accessibilityLiveRegion="polite">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
          <HText variant="callout" weight="600" style={{ flex: 1 }} numberOfLines={2}>
            {tr('ui.decision.breakdownTitle', { label: option.label })}
          </HText>
          <PressableScale haptic="selection" onPress={onClose} accessibilityLabel={tr('ui.decision.close')} hitSlop={6} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }} pressedStyle={{ backgroundColor: t.colors.surfacePressed }}>
            <Icon name="x" size={16} color={t.colors.muted} />
          </PressableScale>
        </View>
        {rows.map((r) => (
          <CriterionBar key={r.key} t={t} label={r.label} score={r.score} weight={r.weight} points={r.contribution} lang={lang} />
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', borderTopWidth: 1, borderColor: t.colors.border, paddingTop: t.spacing.s }}>
          <HText variant="callout" weight="600" style={{ flex: 1 }}>
            {tr('ui.decision.total')}
          </HText>
          <HText variant="bodyStrong" tabular>
            {anyScored ? `${fixed1(total, lang)} / 10` : '–'}
          </HText>
        </View>
        {option.note ? <InlineText variant="caption" color="muted" text={option.note} /> : null}
      </View>
    </FadeIn>
  );
}

function CriterionBar({ t, label, score, weight, points, lang }: { t: Theme; label: string; score: number | null; weight: number; points: number | null; lang: NumLang }) {
  const tr = useT();
  const reduced = useMotionReduced();
  const p = useSharedValue(reduced ? (score ?? 0) / 10 : 0);
  useEffect(() => {
    const v = (score ?? 0) / 10;
    p.value = reduced ? v : withTiming(v, { duration: 360, easing: EASE });
  }, [score, reduced, p]);
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.0001, p.value) }] }));
  const settled = useSettledAfter(reduced ? 0 : 440, [score, reduced]);
  const muted = weight === 0 || score === null;
  const pts = points === null ? '–' : fixed1(points, lang);
  const a11y = score === null ? `${label}: ${tr('ui.decision.notRated')}` : tr('ui.decision.breakdownRow', { label, score: fixed1(score, lang).replace(/[.,]0$/, ''), weight, points: pts });
  return (
    <View style={{ gap: 4, opacity: muted ? 0.6 : 1 }} accessible accessibilityLabel={a11y}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.spacing.s }}>
        <HText variant="caption" weight="500" style={{ flex: 1 }} numberOfLines={1}>
          {label}
        </HText>
        <HText variant="micro" color="subtle" tabular>
          {`× ${weight}`}
        </HText>
        <HText variant="caption" tabular color="muted" style={{ minWidth: 52, textAlign: 'right' }}>
          {score === null ? tr('ui.decision.notRated') : tr('ui.decision.points', { points: pts })}
        </HText>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
        <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: t.colors.border, overflow: 'hidden' }}>
          <Animated.View style={[{ height: 5, width: '100%', borderRadius: 3, backgroundColor: t.colors.accent, transformOrigin: 'left' } as object, bar, settled ? { transform: [{ scaleX: Math.max(0.0001, (score ?? 0) / 10) }] } : null]} />
        </View>
        <HText variant="micro" tabular color="muted" style={{ minWidth: 28, textAlign: 'right' }}>
          {score === null ? '–' : fixed1(score, lang).replace(/[.,]0$/, '')}
        </HText>
      </View>
    </View>
  );
}

/* ───────────── weights ───────────── */

function WeightRow({ t, c, value, onChange }: { t: Theme; c: DecisionCriterion; value: number; onChange: (v: number) => void }) {
  const tr = useT();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, minHeight: 28 }}>
        <HText variant="caption" weight="500" style={{ flex: 1 }} numberOfLines={1}>
          {c.label}
        </HText>
        <View style={{ minWidth: 30, height: 24, paddingHorizontal: 6, borderRadius: t.radii.control, backgroundColor: value > 0 ? t.colors.accentSoft : t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
          <HText variant="caption" weight="600" tabular style={{ color: value > 0 ? t.colors.accentText : t.colors.subtle }}>
            {String(value)}
          </HText>
        </View>
      </View>
      <Slider value={value} min={0} max={10} step={1} label={tr('ui.decision.weightLabel', { label: c.label })} valueText={String(value)} onChange={onChange} invalid={value === 0} />
    </View>
  );
}
