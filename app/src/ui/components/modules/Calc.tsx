/**
 * `calc` node – native calculator (docs/SPEC-modules-v2.md). Expressions are evaluated only by
 * the safe engine in app/src/calc (no eval). Inputs: slider (+ readout tap → direct entry),
 * number (field + ±), select chips, toggle. Outputs live, emphasised one large. Invalid input →
 * field error and "–" (never a stale result). Optional sweep chart, "So wird gerechnet"
 * disclosure, reset, "Ergebnis übernehmen" → `[calc:<id>] …`. State persisted via useNodeState.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTheme, type Theme } from '../../theme';
import { useHui } from '../../primitives/context';
import { BlockTitle, HText, InlineText, PressableScale, Surface } from '../../primitives/basics';
import { Icon } from '../../primitives/Icon';
import { Skeleton } from '../../primitives/Skeleton';
import { haptic } from '../../primitives/haptics';
import { FormSkeleton } from '../../skeletons';
import { useNodeState } from '../../../nodestate';
import { Chart } from '../Chart';
import type { NodeProps } from '../content';
import type { HuiCalc, HuiChart } from '../../types';
import {
  buildCalcReply,
  computeOutputs,
  computeSweep,
  formatInputValue,
  normalizeCalc,
  numberToInputText,
  parseNumberInput,
  sliderRange,
  splitHero,
  valueOf,
  type CalcInputDef,
  type CalcModel,
  type CalcValue,
  type OutputRow,
} from './b/calcModel';
import { formatDecimal } from './b/quantity';
import { Btn, Chips, Disclosure, NumField, RoundBtn, Slider, Switch, snapValue } from './b/controls';
import { ProvenanceChip } from './ProvenanceChip';
import { useS } from './useS';
import { useLocale } from '../../../i18n';

type CalcState = { v: Record<string, CalcValue>; sent?: string };
const INITIAL: CalcState = { v: {} };

export function Calc({ node }: NodeProps<HuiCalc>) {
  const CALC = useS().calc;
  const { locale } = useLocale();
  const t = useTheme();
  const { streaming, onAction } = useHui();
  const model = useMemo(() => normalizeCalc(node), [node]);
  const [state, setState] = useNodeState<CalcState>(model.id, INITIAL);
  // field-level errors + raw text of number fields (local; values themselves are persisted)
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [resetKey, setResetKey] = useState(0);

  const values = useMemo(() => {
    const out: Record<string, CalcValue> = {};
    for (const i of model.inputs) out[i.name] = valueOf(i, state.v);
    return out;
  }, [model.inputs, state.v]);

  const live = !streaming;
  // an input with a field error counts as "no value" → dependent outputs show "–" (never stale)
  const effective = useMemo(() => {
    const out: Record<string, CalcValue> = { ...values };
    for (const k of Object.keys(errors)) if (errors[k]) out[k] = null;
    return out;
  }, [values, errors]);
  const rows = useMemo(() => (live ? computeOutputs(model, effective, locale) : []), [live, model, effective, locale]);
  // protocol reply stays German whatever the UI language (docs/SPEC-modules-v2.md)
  const replyRows = useMemo(() => (live ? computeOutputs(model, effective) : []), [live, model, effective]);
  const sweepPts = useMemo(() => (live ? computeSweep(model, effective) : null), [live, model, effective]);
  const anyError = model.inputs.some((i) => errors[i.name] || ((i.kind === 'number' || i.kind === 'slider') && values[i.name] === null));
  const reply = live && !anyError ? buildCalcReply(model, values, replyRows) : null;
  const sent = !!reply && state.sent === reply;

  if (!model.inputs.length && !model.outputs.length) {
    return streaming ? <FormSkeleton /> : null;
  }

  const set = (name: string, v: CalcValue) => setState((s) => ({ ...s, v: { ...s.v, [name]: v } }));
  const setError = (name: string, e: string | null) => setErrors((x) => (x[name] === e ? x : { ...x, [name]: e }));
  const reset = () => {
    haptic('light');
    setState(INITIAL);
    setErrors({});
    setResetKey((k) => k + 1);
  };
  const apply = () => {
    if (!reply) return;
    // refused while a turn is running → not marked as sent
    if (onAction({ type: 'send', text: reply }, undefined, { nodeId: model.id, composed: true }) === false) return;
    haptic('success');
    setState((s) => ({ ...s, sent: reply }));
  };

  const { hero, rest } = splitHero(rows);
  const basis = (node as { basis?: unknown }).basis;
  const source = (node as { source?: unknown }).source;

  return (
    <Surface style={{ gap: t.spacing.l }}>
      {model.title || basis || source ? (
        <View style={{ gap: t.spacing.xs }}>
          <BlockTitle title={model.title} />
          <View style={{ marginTop: model.title ? -t.spacing.s : 0 }}>
            <ProvenanceChip basis={basis} source={source} />
          </View>
        </View>
      ) : null}

      {/* inputs */}
      <View style={{ gap: t.spacing.l }} key={resetKey}>
        {model.inputs.map((inp) => (
          <InputRow key={inp.name} t={t} inp={inp} value={values[inp.name]} error={errors[inp.name] ?? null} onValue={(v) => set(inp.name, v)} onError={(e) => setError(inp.name, e)} disabled={streaming} />
        ))}
      </View>

      {/* outputs */}
      {streaming ? (
        <View style={{ gap: t.spacing.s }}>
          <Skeleton width="40%" height={12} />
          <Skeleton width="60%" height={30} />
        </View>
      ) : (
        <Outputs t={t} hero={hero} rest={rest} invalid={anyError} />
      )}

      {/* chart */}
      {live && model.chart && sweepPts && !anyError ? <SweepChart model={model} points={sweepPts} /> : null}

      {/* formula / assumptions */}
      {live && model.outputs.length ? <Formula t={t} model={model} rows={rows} /> : null}

      {model.note ? <InlineText variant="caption" color="muted" text={model.note} /> : null}

      {/* actions */}
      <View style={{ flexDirection: 'row', gap: t.spacing.s, alignItems: 'center' }}>
        <RoundBtn bicon="reset" label={CALC.reset} onPress={reset} disabled={streaming} size={44} />
        {sent ? (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, paddingHorizontal: t.spacing.l, borderRadius: t.radii.pill, backgroundColor: t.colors.successSoft }}>
            <Icon name="check" size={16} color={t.colors.success} strokeWidth={2.25} />
            <HText variant="callout" weight="600" style={{ color: t.colors.success }}>
              {CALC.applied}
            </HText>
          </View>
        ) : (
          <Btn label={CALC.apply} kind="primary" icon="send" onPress={apply} disabled={!reply} accessibilityHint={CALC.applyHint} style={{ flex: 1 }} />
        )}
      </View>
    </Surface>
  );
}

/* ───────────── inputs ───────────── */

function InputRow({ t, inp, value, error, onValue, onError, disabled }: { t: Theme; inp: CalcInputDef; value: CalcValue; error: string | null; onValue: (v: CalcValue) => void; onError: (e: string | null) => void; disabled: boolean }) {
  if (inp.kind === 'toggle') {
    return (
      <PressableScale haptic="selection" scaleTo={1} disabled={disabled} onPress={() => onValue(!value)} accessibilityRole="switch" accessibilityLabel={inp.label} accessibilityState={{ checked: !!value }} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, minHeight: 36 }}>
        <HText variant="body" style={{ flex: 1 }}>
          {inp.label}
        </HText>
        <Switch on={!!value} />
      </PressableScale>
    );
  }
  if (inp.kind === 'select') {
    return (
      <View style={{ gap: 8 }}>
        <HText variant="caption" color="muted" weight="500">
          {inp.label}
        </HText>
        <Chips options={inp.options} value={value as string | number | null} onChange={(v) => onValue(v)} label={inp.label} />
      </View>
    );
  }
  if (inp.kind === 'slider') return <SliderInput t={t} inp={inp} value={value} error={error} onValue={onValue} onError={onError} />;
  return <NumberInput t={t} inp={inp} value={value} error={error} onValue={onValue} onError={onError} />;
}

function FieldError({ t, text }: { t: Theme; text: string | null }) {
  if (!text) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} accessibilityLiveRegion="polite">
      <Icon name="alert" size={13} color={t.colors.danger} />
      <HText variant="caption" style={{ color: t.colors.danger }}>
        {text}
      </HText>
    </View>
  );
}

function SliderInput({ t, inp, value, error, onValue, onError }: { t: Theme; inp: CalcInputDef; value: CalcValue; error: string | null; onValue: (v: CalcValue) => void; onError: (e: string | null) => void }) {
  const CALC = useS().calc;
  const { locale } = useLocale();
  const fmt = { locale, text: CALC };
  const { min, max, step } = sliderRange(inp);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const num = typeof value === 'number' ? value : null;
  const valueText = formatInputValue(inp, num, fmt);
  const range = { min, max, unit: inp.unit };
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 38, gap: t.spacing.s }}>
        <HText variant="caption" color="muted" weight="500" style={{ flex: 1 }}>
          {inp.label}
        </HText>
        {editing ? (
          <NumField
            compact
            autoFocus
            label={inp.label}
            text={text}
            unit={inp.unit}
            error={error}
            onChangeText={(s) => {
              setText(s);
              const r = parseNumberInput(s, range, fmt);
              onError(r.ok ? null : r.error);
              if (r.ok) onValue(r.value);
            }}
            onBlur={() => {
              // leaving the field with an invalid entry restores the last valid value
              const r = parseNumberInput(text, range, fmt);
              if (!r.ok) onError(null);
              setEditing(false);
            }}
          />
        ) : (
          <PressableScale
            haptic="selection"
            onPress={() => {
              setText(numberToInputText(num, locale));
              setEditing(true);
            }}
            accessibilityLabel={CALC.edit(inp.label)}
            style={{ minHeight: 36, paddingHorizontal: 10, justifyContent: 'center', borderRadius: t.radii.s, backgroundColor: t.colors.accentSoft }}
          >
            <HText variant="callout" weight="600" tabular style={{ color: t.colors.accent }}>
              {valueText}
            </HText>
          </PressableScale>
        )}
      </View>
      <Slider
        value={num}
        min={min}
        max={max}
        step={step}
        label={inp.label}
        valueText={valueText}
        onChange={(v) => {
          onError(null);
          if (editing) setEditing(false);
          onValue(v);
        }}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 }}>
        <HText variant="micro" color="subtle" tabular>
          {formatInputValue(inp, min, fmt)}
        </HText>
        <HText variant="micro" color="subtle" tabular>
          {formatInputValue(inp, max, fmt)}
        </HText>
      </View>
      {editing ? <FieldError t={t} text={error} /> : null}
    </View>
  );
}

function NumberInput({ t, inp, value, error, onValue, onError }: { t: Theme; inp: CalcInputDef; value: CalcValue; error: string | null; onValue: (v: CalcValue) => void; onError: (e: string | null) => void }) {
  const CALC = useS().calc;
  const { locale } = useLocale();
  const fmt = { locale, text: CALC };
  const num = typeof value === 'number' ? value : null;
  const [text, setText] = useState(() => numberToInputText(num, locale));
  const step = inp.step ?? 1;
  const range = { min: inp.min, max: inp.max, unit: inp.unit };
  const change = (s: string) => {
    setText(s);
    const r = parseNumberInput(s, range, fmt);
    if (r.ok) {
      onValue(r.value);
      onError(null);
    } else {
      onValue(null); // no stale result: outputs show "–"
      onError(r.error);
    }
  };
  const bump = (dir: 1 | -1) => {
    const base = num ?? inp.min ?? 0;
    let next = snapValue(base + dir * step, inp.min ?? 0, step);
    if (inp.min !== undefined) next = Math.max(inp.min, next);
    if (inp.max !== undefined) next = Math.min(inp.max, next);
    setText(numberToInputText(next, locale));
    onValue(next);
    onError(null);
  };
  const atMin = num !== null && inp.min !== undefined && num <= inp.min;
  const atMax = num !== null && inp.max !== undefined && num >= inp.max;
  return (
    <View style={{ gap: 8 }}>
      <HText variant="caption" color="muted" weight="500">
        {inp.label}
      </HText>
      <View style={{ flexDirection: 'row', gap: t.spacing.s, alignItems: 'center' }}>
        <RoundBtn icon="minus" label={`${inp.label}: ${CALC.decrease}`} onPress={() => bump(-1)} disabled={atMin} size={44} />
        <NumField label={inp.label} text={text} unit={inp.unit} error={error} onChangeText={change} />
        <RoundBtn icon="plus" label={`${inp.label}: ${CALC.increase}`} onPress={() => bump(1)} disabled={atMax} size={44} />
      </View>
      <FieldError t={t} text={error ?? (num === null ? CALC.errEmpty : null)} />
    </View>
  );
}

/* ───────────── outputs ───────────── */

function Outputs({ t, hero, rest, invalid }: { t: Theme; hero: OutputRow | null; rest: OutputRow[]; invalid: boolean }) {
  const CALC = useS().calc;
  return (
    <View style={{ gap: t.spacing.s }} accessibilityLiveRegion="polite">
      {hero ? (
        <View style={{ backgroundColor: t.colors.accentSoft, borderRadius: t.radii.m, paddingVertical: t.spacing.m, paddingHorizontal: t.spacing.l, gap: 2 }} accessible accessibilityLabel={`${hero.label}: ${hero.text}`}>
          <HText variant="caption" color="muted" weight="500">
            {hero.label}
          </HText>
          <HText variant="display" tabular style={{ color: hero.value === null ? t.colors.subtle : t.colors.text }} numberOfLines={1} adjustsFontSizeToFit>
            {hero.text}
          </HText>
        </View>
      ) : null}
      {rest.length ? (
        <View style={{ borderRadius: t.radii.m, borderWidth: 1, borderColor: t.colors.border }}>
          {rest.map((r, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.spacing.m, paddingVertical: 10, paddingHorizontal: t.spacing.m, borderTopWidth: i ? 1 : 0, borderColor: t.colors.border }} accessible accessibilityLabel={`${r.label}: ${r.text}`}>
              <HText variant="callout" color="muted" style={{ flex: 1 }}>
                {r.label}
              </HText>
              <HText variant="bodyStrong" tabular style={{ color: r.value === null ? t.colors.subtle : t.colors.text }}>
                {r.text}
              </HText>
            </View>
          ))}
        </View>
      ) : null}
      {invalid ? (
        <HText variant="caption" color="muted">
          {CALC.invalidHint}
        </HText>
      ) : null}
    </View>
  );
}

/* ───────────── chart ───────────── */

function SweepChart({ model, points }: { model: CalcModel; points: { x: number; y: number }[] }) {
  const CALC = useS().calc;
  const { lang } = useLocale();
  const chart = model.chart!;
  const inp = model.inputs.find((i) => i.name === chart.sweep.input);
  const out = model.outputs.find((o) => o.name === chart.y);
  const unit = out ? (out.format === 'currency' ? '€' : out.format === 'percent' ? '%' : out.unit) : undefined;
  const scale = out?.format === 'percent' ? 100 : 1;
  const node: HuiChart = {
    type: 'chart',
    kind: chart.kind,
    title: chart.label ?? (out ? CALC.chartTitle(out.label, inp?.label ?? chart.sweep.input) : CALC.chartFallback),
    unit,
    xLabel: inp ? `${inp.label}${inp.unit ? ` (${inp.unit})` : ''}` : chart.sweep.input,
    series: [{ name: out?.label ?? chart.label ?? CALC.chartFallback, data: points.map((p) => ({ x: formatDecimal(p.x, 2, lang), y: Math.round(p.y * scale * 100) / 100 })) }],
  };
  return <Chart node={node} />;
}

/* ───────────── formula disclosure ───────────── */

function Formula({ t, model, rows }: { t: Theme; model: CalcModel; rows: OutputRow[] }) {
  const CALC = useS().calc;
  const mono = { fontFamily: t.fonts.mono, fontSize: 12.5, lineHeight: 18 };
  return (
    <Disclosure title={CALC.formulaTitle}>
      {model.outputs.map((o, i) => (
        <View key={i} style={{ gap: 2 }}>
          <HText variant="caption" weight="600">
            {o.label}
            {o.name ? <HText variant="caption" color="subtle">{`  (${o.name})`}</HText> : null}
          </HText>
          <HText selectable style={[mono, { color: t.colors.text }]}>
            {`= ${o.expr}`}
          </HText>
          {rows[i]?.error ? (
            <HText variant="caption" style={{ color: t.colors.danger }}>
              {`${CALC.formulaError}: ${rows[i].error}`}
            </HText>
          ) : null}
        </View>
      ))}
      {model.inputs.length ? (
        <View style={{ gap: 2, marginTop: 4 }}>
          <HText variant="caption" weight="600">
            {CALC.inputsLegend}
          </HText>
          {model.inputs.map((i) => (
            <HText key={i.name} variant="caption" color="muted">
              <HText style={[mono, { color: t.colors.muted }]}>{i.name}</HText>
              {` = ${i.label}${i.unit ? ` (${i.unit})` : ''}`}
            </HText>
          ))}
        </View>
      ) : null}
      {model.assumptions.length ? (
        <View style={{ gap: 2, marginTop: 4 }}>
          <HText variant="caption" weight="600">
            {CALC.assumptions}
          </HText>
          {model.assumptions.map((a, i) => (
            <InlineText key={i} variant="caption" color="muted" text={`• ${a}`} />
          ))}
        </View>
      ) : null}
    </Disclosure>
  );
}
