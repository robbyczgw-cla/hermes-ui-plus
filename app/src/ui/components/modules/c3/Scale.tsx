/**
 * `scale` – single rating answer (docs/SPEC-modules-v3.md): styles slider / stars / emoji / segments,
 * end labels, sends on tap (or slider release) after a ~1.5 s undo window (like `choice`) →
 * `[scale:<id>] 4/5` (+ end label). Locked afterwards (persisted), "Neu beantworten" re-opens.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, View, type GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useTheme, useMotionReduced, type Theme } from '../../../theme';
import { scaleFont } from '../../../themes';
import { useHui } from '../../../primitives/context';
import { BlockTitle, HText, PressableScale, Surface } from '../../../primitives/basics';
import { haptic } from '../../../primitives/haptics';
import { useNodeState } from '../../../../nodestate';
import { useLocale, useT } from '../../../../i18n';
import type { HuiScale } from '../../../types';
import { AnsweredSummary, UndoBar, useModuleId, usePendingCommit, useSend } from '../a/shared';
import { clampScale, emojiFor, endLabel, normalizeScale, scaleReply, scaleValueText, scaleValues, type ScaleModel } from './scaleModel.ts';
import { numLang, trimNum, type NumLang } from './format.ts';
import { C3Icon, C3Skeleton } from './parts';
import { sliderWebProps } from '../../../lib/sliderKeys';

type ScaleState = { status: 'open' | 'answered'; value?: number };
const INITIAL: ScaleState = { status: 'open' };

export function Scale({ node }: { node: Partial<HuiScale> }) {
  const t = useTheme();
  const tr = useT();
  const { lang } = useLocale();
  const L = numLang(lang);
  const { streaming } = useHui();
  const id = useModuleId('scale', node as Record<string, unknown>);
  const model = useMemo(() => normalizeScale(node, id), [node, id]);
  const [st, setSt] = useNodeState<ScaleState>(id, INITIAL);
  const [draft, setDraft] = useState<number | null>(null);
  const send = useSend(id);
  const undo = usePendingCommit();

  if (!model.question && streaming && node.min === undefined && node.max === undefined) return <C3Skeleton rows={1} rowHeight={44} />;

  const describe = (v: number) => {
    const text = scaleValueText(v, model, L);
    const label = endLabel(v, model);
    return { text, label, full: label ? `${text} · ${label}` : text };
  };

  if (st.status === 'answered' && typeof st.value === 'number') {
    const v = clampScale(st.value, model) ?? st.value;
    const d = describe(v);
    return (
      <Surface>
        <AnsweredSummary
          title={model.question || undefined}
          answer={model.style === 'emoji' ? `${emojiFor(v, model)}  ${d.full}` : d.full}
          onReopen={() => {
            haptic('selection');
            setDraft(null);
            setSt({ status: 'open' });
          }}
        >
          {model.style === 'stars' ? <StarsReadOnly t={t} model={model} value={v} /> : null}
        </AnsweredSummary>
      </Surface>
    );
  }

  const commit = (v: number) => {
    if (!send(scaleReply(model, v))) {
      setDraft(null); // refused (turn running) → stays open
      return;
    }
    setSt({ status: 'answered', value: v });
  };
  const choose = (raw: number) => {
    const v = clampScale(raw, model);
    if (v === null || streaming) return;
    haptic('selection');
    setDraft(v);
    undo.start(tr('ui.scale.sending', { value: describe(v).text }), () => commit(v));
  };
  const props: ControlProps = { t, model, value: draft, lang: L, disabled: streaming, onChoose: choose, describe: (v) => describe(v).full };

  return (
    <Surface style={{ gap: t.spacing.m }}>
      {model.question ? <BlockTitle title={model.question} /> : null}
      {model.style === 'stars' ? <Stars {...props} /> : model.style === 'emoji' ? <Emojis {...props} /> : model.style === 'segments' ? <Segments {...props} /> : <ScaleSlider {...props} onDraft={setDraft} />}
      {model.labels.min || model.labels.max ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.m, marginTop: -t.spacing.xs }}>
          <HText variant="caption" color="muted" style={{ flex: 1 }}>
            {model.labels.min ?? ''}
          </HText>
          <HText variant="caption" color="muted" style={{ flex: 1, textAlign: 'right' }}>
            {model.labels.max ?? ''}
          </HText>
        </View>
      ) : null}
      {undo.pending ? (
        <UndoBar
          label={undo.pending.label}
          ms={undo.ms}
          onUndo={() => {
            undo.cancel();
            setDraft(null);
          }}
        />
      ) : null}
    </Surface>
  );
}

type ControlProps = {
  t: Theme;
  model: ScaleModel;
  value: number | null;
  lang: NumLang;
  disabled: boolean;
  onChoose: (v: number) => void;
  describe: (v: number) => string;
};

/* ───────────── stars ───────────── */

const starValues = (m: ScaleModel) => scaleValues(m).filter((v, i) => !(i === 0 && v === 0));

function Stars({ t, model, value, disabled, onChoose, describe }: ControlProps) {
  const tr = useT();
  const values = starValues(model);
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center' }} accessibilityRole="radiogroup">
      {values.map((v, i) => {
        const on = value !== null && v <= value;
        return (
          <PressableScale
            key={v}
            haptic={false}
            scaleTo={0.9}
            disabled={disabled}
            onPress={() => onChoose(v)}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === v }}
            accessibilityLabel={`${tr('ui.scale.stars', { n: i + 1 })} · ${describe(v)}`}
            style={{ flex: 1, maxWidth: 52, height: 48, alignItems: 'center', justifyContent: 'center' }}
          >
            <Pop on={value === v}>
              <C3Icon name={on ? 'star' : 'starOutline'} size={values.length > 7 ? 26 : 34} color={on ? t.colors.warning : t.colors.borderStrong} strokeWidth={1.6} />
            </Pop>
          </PressableScale>
        );
      })}
    </View>
  );
}

function StarsReadOnly({ t, model, value }: { t: Theme; model: ScaleModel; value: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2, paddingLeft: 26 }} importantForAccessibility="no-hide-descendants">
      {starValues(model).map((v) => (
        <C3Icon key={v} name={v <= value ? 'star' : 'starOutline'} size={18} color={v <= value ? t.colors.warning : t.colors.borderStrong} strokeWidth={1.6} />
      ))}
    </View>
  );
}

/* ───────────── emoji ───────────── */

function Emojis({ t, model, value, disabled, onChoose, describe }: ControlProps) {
  const values = scaleValues(model);
  return (
    <View style={{ flexDirection: 'row', gap: values.length > 6 ? 2 : t.spacing.xs }} accessibilityRole="radiogroup">
      {values.map((v) => {
        const on = value === v;
        const dim = value !== null && !on;
        return (
          <PressableScale
            key={v}
            haptic={false}
            scaleTo={0.9}
            disabled={disabled}
            onPress={() => onChoose(v)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={describe(v)}
            style={{
              flex: 1,
              height: 56,
              borderRadius: t.radii.control,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: on ? 1.5 : 1,
              borderColor: on ? t.colors.accent : 'transparent',
              backgroundColor: on ? t.colors.accentSoft : t.colors.surfaceAlt,
              opacity: dim ? 0.55 : 1,
            }}
          >
            <Pop on={on}>
              <HText style={values.length > 7 ? scaleFont(22, 28, t.fontScale) : scaleFont(28, 34, t.fontScale)}>{emojiFor(v, model)}</HText>
            </Pop>
          </PressableScale>
        );
      })}
    </View>
  );
}

/* ───────────── segments ───────────── */

function Segments({ t, model, value, lang, disabled, onChoose, describe }: ControlProps) {
  const values = scaleValues(model);
  return (
    <View style={{ flexDirection: 'row', borderRadius: t.radii.control, borderWidth: 1, borderColor: t.colors.borderControl, overflow: 'hidden' }} accessibilityRole="radiogroup">
      {values.map((v, i) => {
        const on = value === v;
        return (
          <PressableScale
            key={v}
            haptic={false}
            scaleTo={1}
            disabled={disabled}
            onPress={() => onChoose(v)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={describe(v)}
            style={{ flex: 1, height: 46, alignItems: 'center', justifyContent: 'center', borderLeftWidth: i ? 1 : 0, borderColor: t.colors.border, backgroundColor: on ? t.colors.accent : t.colors.surface }}
            pressedStyle={{ backgroundColor: on ? t.colors.accent : t.colors.surfacePressed }}
          >
            <HText variant={values.length > 8 ? 'caption' : 'callout'} weight={on ? '700' : '500'} tabular style={{ color: on ? t.colors.onAccent : t.colors.text }}>
              {trimNum(v, lang)}
            </HText>
          </PressableScale>
        );
      })}
    </View>
  );
}

/* ───────────── slider ───────────── */

const THUMB = 28;

function ScaleSlider({ t, model, value, lang, disabled, onChoose, describe, onDraft }: ControlProps & { onDraft: (v: number) => void }) {
  const tr = useT();
  const [w, setW] = useState(0);
  const [live, setLive] = useState<number | null>(null);
  const last = useRef<number | null>(null);
  const shown = live ?? value;
  const v = shown ?? model.min;
  const ratio = (v - model.min) / (model.max - model.min);
  const at = (e: GestureResponderEvent) => {
    if (w <= 0) return null;
    const r = Math.min(1, Math.max(0, (e.nativeEvent.locationX - THUMB / 2) / (w - THUMB)));
    return clampScale(model.min + r * (model.max - model.min), model);
  };
  const move = (e: GestureResponderEvent) => {
    const nv = at(e);
    if (nv === null || nv === last.current) return;
    last.current = nv;
    haptic('selection');
    setLive(nv);
    onDraft(nv);
  };
  const release = () => {
    const nv = last.current;
    setLive(null);
    if (nv !== null) onChoose(nv);
  };
  const step = (dir: 1 | -1) => {
    const nv = clampScale((value ?? (dir > 0 ? model.min - model.step : model.max + model.step)) + dir * model.step, model);
    if (nv !== null) onChoose(nv);
  };
  const valueText = shown === null ? '–' : describe(shown);
  const web =
    Platform.OS === 'web' && !disabled
      ? sliderWebProps({
          value: v,
          range: { min: model.min, max: model.max, step: model.step },
          label: model.question || tr('ui.scale.sliderHint'),
          text: valueText,
          onChange: (nv) => onChoose(nv),
        })
      : null;
  return (
    <View style={{ gap: t.spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6, minHeight: 34 }} accessibilityLiveRegion="polite">
        <HText variant="stat" tabular style={{ color: shown === null ? t.colors.subtle : t.colors.accentText }}>
          {shown === null ? '–' : trimNum(shown, lang)}
        </HText>
        <HText variant="callout" color="muted" tabular>
          {`/ ${trimNum(model.max, lang)}`}
        </HText>
      </View>
      <View
        {...web}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        style={{ height: 44, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}
        onStartShouldSetResponder={() => !disabled}
        onMoveShouldSetResponder={() => !disabled}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => {
          last.current = null;
          move(e);
        }}
        onResponderMove={move}
        onResponderRelease={release}
        onResponderTerminate={release}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={model.question || tr('ui.scale.sliderHint')}
        accessibilityHint={tr('ui.scale.sliderHint')}
        accessibilityValue={{ min: model.min, max: model.max, now: shown ?? undefined, text: valueText }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      >
        <View pointerEvents="none" style={{ marginHorizontal: THUMB / 2, height: 6, borderRadius: 3, backgroundColor: t.colors.surfaceAlt }}>
          <View style={{ width: `${(shown === null ? 0 : ratio) * 100}%`, height: 6, borderRadius: 3, backgroundColor: t.colors.accent }} />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: ratio * Math.max(0, w - THUMB),
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: shown === null ? t.colors.surface : '#FFFFFF',
            borderWidth: shown === null ? 1.5 : t.dark ? 0 : 1,
            borderColor: shown === null ? t.colors.borderStrong : t.colors.border,
            ...t.shadows.md,
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: -4, paddingHorizontal: 2 }}>
        <HText variant="micro" color="subtle" tabular>
          {trimNum(model.min, lang)}
        </HText>
        <HText variant="micro" color="subtle" tabular>
          {trimNum(model.max, lang)}
        </HText>
      </View>
    </View>
  );
}

/* ───────────── selection pop ───────────── */

function Pop({ on, children }: { on: boolean; children: ReactNode }) {
  const reduced = useMotionReduced();
  const s = useSharedValue(1);
  useEffect(() => {
    if (!on || reduced) return;
    s.value = withSequence(withTiming(1.22, { duration: 110 }), withSpring(1, { damping: 9, stiffness: 220 }));
  }, [on, reduced, s]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
