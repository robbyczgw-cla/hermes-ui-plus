/**
 * `recipe` node (docs/SPEC-modules-v2.md): hero photo (imageQuery), time chips, servings stepper
 * that rescales quantities (b/quantity.ts: smart rounding, ½ ¼ ¾ fractions, g→kg, sub-linear
 * pinches), ingredient checkboxes ("habe ich"), steps with timers (TimerStore: persisted,
 * notification when done), "Zutaten auf Einkaufsliste" (add_to_list via onAction → confirm sheet),
 * cooking mode (keeps the screen awake, one large step at a time). State persisted per node.
 */
import { useMemo, useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type Theme } from '../../theme';
import { useHui } from '../../primitives/context';
import { HText, InlineText, PressableScale, Surface } from '../../primitives/basics';
import { Icon } from '../../primitives/Icon';
import { Skeleton, SkeletonLines } from '../../primitives/Skeleton';
import { haptic } from '../../primitives/haptics';
import { useNodeScope, useNodeState } from '../../../nodestate';
import { getTimerStore } from '../../../actions/timers';
import { useTimers } from '../../../actions/useTimers';
import { remainingMs, type TimerRecord } from '../../../actions/timerModel';
import { asArray, asNumber, asObjects, asOptString, asString } from '../../lib/format';
import { ImageBlock } from '../media';
import type { NodeProps } from '../content';
import type { HuiRecipe } from '../../types';
import { clampServings, MAX_SERVINGS, MIN_SERVINGS, scaleQuantity, scaledItem, ingredientLine } from './b/quantity';
import { formatCountdown, formatTimerLabel, timeChips, timerProgress, validTimerSeconds } from './b/timerMath';
import { BIcon, Btn, RoundBtn, Stepper } from './b/controls';
import { useS } from './useS';
import { useLocale } from '../../../i18n';
import { RecipeSkeleton } from '../../skeletons';

type Ingredient = { qty?: number; unit?: string; item: string; plural?: string; group?: string };
type Step = { text: string; timerSeconds: number | null };
type RecipeState = { servings?: number; have: number[]; done: number[]; step: number };
const INITIAL: RecipeState = { have: [], done: [], step: 0 };

function readIngredients(v: unknown): Ingredient[] {
  return asObjects(v)
    .map((o) => ({ qty: asNumber(o.qty), unit: asOptString(o.unit), item: asString(o.item).trim(), plural: asOptString(o.plural), group: asOptString(o.group) }))
    .filter((i) => i.item);
}
function readSteps(v: unknown): Step[] {
  return asArray(v)
    .map((s) => (typeof s === 'string' ? { text: s, timerSeconds: null } : s && typeof s === 'object' ? { text: asString((s as Record<string, unknown>).text).trim(), timerSeconds: validTimerSeconds((s as Record<string, unknown>).timerSeconds) } : null))
    .filter((s): s is Step => !!s && !!s.text);
}

export function Recipe({ node }: NodeProps<HuiRecipe>) {
  const S = useS();
  const RECIPE = S.recipe;
  const { lang } = useLocale();
  const t = useTheme();
  const { streaming, onAction } = useHui();
  const scope = useNodeScope();
  const id = asString(node.id) || `recipe:${asString(node.title)}`;
  const title = asString(node.title);
  const baseServings = (() => {
    const s = asNumber(node.servings);
    return s && s > 0 && s <= 100 ? s : 4;
  })();
  // while streaming, a still-open last ingredient / step object is dropped by the stream parser
  // (prunePartialItems); plain-string items may grow letter by letter, which is harmless
  const ingredients = useMemo(() => readIngredients(node.ingredients), [node.ingredients]);
  const steps = useMemo(() => readSteps(node.steps), [node.steps]);
  const tips = useMemo(() => asArray(node.tips).map((x) => asString(x).trim()).filter(Boolean), [node.tips]);
  const chips = useMemo(() => timeChips(node.time as never, { prep: RECIPE.timePrep, cook: RECIPE.timeCook, total: RECIPE.timeTotal, units: S.time }), [node.time, RECIPE, S.time]);
  const [state, setState] = useNodeState<RecipeState>(id, INITIAL);
  const [cooking, setCooking] = useState(false);
  const { timers, now } = useTimers();

  const servings = clampServings(state.servings ?? Math.round(baseServings));
  const factor = servings / baseServings;
  const have = new Set(state.have);
  const done = new Set(state.done);
  const groups = useMemo(() => groupIngredients(ingredients), [ingredients]);
  const missing = ingredients.map((ing, i) => ({ ing, i })).filter(({ i }) => !have.has(i));
  const timerSource = (i: number) => `${scope?.messageId ?? 'local'}:${id}:step${i}`;
  const timerFor = (i: number) => timers.find((x) => x.source === timerSource(i));

  if (!title && !ingredients.length && !steps.length) {
    return streaming ? <RecipeSkeleton /> : null;
  }

  const setServings = (n: number) => {
    haptic('selection');
    setState((s) => ({ ...s, servings: clampServings(n) }));
  };
  const toggle = (key: 'have' | 'done', i: number) => {
    haptic('selection');
    setState((s) => {
      const set = new Set(s[key]);
      if (set.has(i)) set.delete(i);
      else set.add(i);
      return { ...s, [key]: [...set].sort((a, b) => a - b) };
    });
  };
  const addToList = () => {
    const items = missing.map(({ ing }) => ingredientLine(ing.qty, ing.unit, ing.item, factor, lang, ing.plural)).slice(0, 50);
    if (!items.length) return;
    // confirmed in the action sheet by the chat shell (actions/INTEGRATION.md: onAction → run)
    onAction({ type: 'add_to_list', items, listTitle: RECIPE.listTitle }, undefined, { nodeId: id });
  };
  const timerProps = (i: number): StepTimerProps | null => {
    const sec = steps[i]?.timerSeconds;
    if (!sec) return null;
    return { seconds: sec, record: timerFor(i), now, label: `${title || RECIPE.defaultTitle} · ${RECIPE.step(i + 1, steps.length)}`, source: timerSource(i) };
  };

  return (
    <Surface padded={false}>
      {asOptString(node.imageQuery) ? (
        <View style={{ padding: t.spacing.s, paddingBottom: 0 }}>
          <ImageBlock node={{ type: 'image', query: asOptString(node.imageQuery), aspect: 16 / 9, alt: title }} />
        </View>
      ) : null}
      <View style={{ padding: t.spacing.l, gap: t.spacing.l }}>
        {/* header */}
        <View style={{ gap: t.spacing.s }}>
          {title ? <InlineText variant="title" text={title} accessibilityRole="header" /> : <Skeleton width="60%" height={20} />}
          {chips.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <BIcon name="timer" size={16} color={t.colors.muted} />
              {chips.map((c) => (
                <View key={c.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, minHeight: 28, borderRadius: t.radii.pill, backgroundColor: t.colors.surfaceAlt }} accessible accessibilityLabel={`${c.label}: ${c.value}`}>
                  <HText variant="caption" color="muted">
                    {c.label}
                  </HText>
                  <HText variant="caption" weight="600">
                    {c.value}
                  </HText>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* servings */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m }}>
          <BIcon name="users" size={18} color={t.colors.muted} />
          <HText variant="callout" color="muted" style={{ flex: 1 }}>
            {RECIPE.servingsLabel}
          </HText>
          <Stepper
            value={RECIPE.servings(servings)}
            label={RECIPE.servingsLabel}
            onDec={() => setServings(servings - 1)}
            onInc={() => setServings(servings + 1)}
            decDisabled={servings <= MIN_SERVINGS || streaming}
            incDisabled={servings >= MAX_SERVINGS || streaming}
            decLabel={RECIPE.fewer}
            incLabel={RECIPE.more}
          />
        </View>

        {/* ingredients */}
        <View style={{ gap: t.spacing.s }}>
          <SectionHead t={t} title={RECIPE.ingredients} right={ingredients.length ? RECIPE.checked(have.size, ingredients.length) : undefined} />
          {groups.map((g, gi) => (
            <View key={gi} style={{ gap: 2 }}>
              {g.name ? (
                <HText variant="micro" color="subtle" style={{ textTransform: 'uppercase', marginTop: gi ? t.spacing.s : 0, marginBottom: 2 }}>
                  {g.name}
                </HText>
              ) : null}
              {g.items.map(({ ing, i }) => (
                <IngredientRow key={i} t={t} ing={ing} factor={factor} checked={have.has(i)} onPress={() => toggle('have', i)} />
              ))}
            </View>
          ))}
          {streaming ? <SkeletonLines lines={2} /> : null}
          {factor !== 1 && ingredients.length ? (
            <HText variant="caption" color="subtle">
              {RECIPE.scaledNote}
            </HText>
          ) : null}
          {ingredients.length ? (
            <Btn
              label={missing.length ? RECIPE.addToListOpen(missing.length) : RECIPE.allChecked}
              bicon="cart"
              onPress={addToList}
              disabled={!missing.length || streaming}
              style={{ marginTop: t.spacing.xs }}
            />
          ) : null}
        </View>

        {/* steps */}
        {steps.length ? (
          <View style={{ gap: t.spacing.m }}>
            <SectionHead t={t} title={RECIPE.steps} right={RECIPE.stepsDone(done.size, steps.length)} />
            {steps.map((s, i) => (
              <StepRow key={i} t={t} index={i} step={s} done={done.has(i)} onToggle={() => toggle('done', i)} timer={timerProps(i)} />
            ))}
          </View>
        ) : null}

        {/* tips */}
        {tips.length ? (
          <View style={{ gap: 6, backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.m, padding: t.spacing.m }}>
            <HText variant="caption" weight="600">
              {RECIPE.tips}
            </HText>
            {tips.map((tip, i) => (
              <InlineText key={i} variant="callout" text={`• ${tip}`} />
            ))}
          </View>
        ) : null}

        {steps.length && !streaming ? (
          <Btn label={RECIPE.cookMode} kind="primary" bicon="chef" onPress={() => setCooking(true)} accessibilityHint={RECIPE.cookModeHint} />
        ) : null}
      </View>

      {cooking ? (
        <CookingMode
          title={title}
          steps={steps}
          ingredients={ingredients}
          factor={factor}
          step={Math.min(state.step, steps.length - 1)}
          onStep={(n) => setState((s) => ({ ...s, step: n, done: n > s.step ? [...new Set([...s.done, s.step])].sort((a, b) => a - b) : s.done }))}
          onFinish={() => {
            setState((s) => ({ ...s, done: steps.map((_, i) => i), step: 0 }));
            setCooking(false);
          }}
          onClose={() => setCooking(false)}
          timer={timerProps}
        />
      ) : null}
    </Surface>
  );
}

function groupIngredients(list: Ingredient[]): { name?: string; items: { ing: Ingredient; i: number }[] }[] {
  const out: { name?: string; items: { ing: Ingredient; i: number }[] }[] = [];
  list.forEach((ing, i) => {
    let g = out.find((x) => x.name === ing.group);
    if (!g) {
      g = { name: ing.group, items: [] };
      out.push(g);
    }
    g.items.push({ ing, i });
  });
  return out;
}

function SectionHead({ t, title, right }: { t: Theme; title: string; right?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 2 }}>
      <HText variant="headline" style={{ flex: 1 }} accessibilityRole="header">
        {title}
      </HText>
      {right ? (
        <HText variant="caption" color="subtle" tabular>
          {right}
        </HText>
      ) : null}
    </View>
  );
}

function Check({ t, on, round }: { t: Theme; on: boolean; round?: boolean }) {
  return (
    <View style={{ width: 22, height: 22, borderRadius: round ? 11 : 6, borderWidth: on ? 0 : 1.5, borderColor: t.colors.borderStrong, backgroundColor: on ? t.colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
      {on ? <Icon name="check" size={14} color={t.colors.onAccent} strokeWidth={2.5} /> : null}
    </View>
  );
}

function IngredientRow({ t, ing, factor, checked, onPress }: { t: Theme; ing: Ingredient; factor: number; checked: boolean; onPress: () => void }) {
  const { lang } = useLocale();
  const q = scaleQuantity(ing.qty, ing.unit, factor, ing.item, lang);
  const name = scaledItem(ing.item, ing.qty, ing.unit, factor, lang, ing.plural);
  return (
    <PressableScale
      haptic={false}
      scaleTo={0.99}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${q.text} ${name}`.trim()}
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, minHeight: 40, paddingVertical: 4 }}
    >
      <Check t={t} on={checked} />
      <HText variant="body" weight="600" tabular style={{ minWidth: 76, color: checked ? t.colors.subtle : t.colors.text }}>
        {q.text}
      </HText>
      <HText variant="body" style={{ flex: 1, color: checked ? t.colors.subtle : t.colors.text, textDecorationLine: checked ? 'line-through' : 'none' }}>
        {name}
      </HText>
    </PressableScale>
  );
}

/* ───────────── steps + timers ───────────── */

type StepTimerProps = { seconds: number; record: TimerRecord | undefined; now: number; label: string; source: string };

function StepRow({ t, index, step, done, onToggle, timer }: { t: Theme; index: number; step: Step; done: boolean; onToggle: () => void; timer: StepTimerProps | null }) {
  const RECIPE = useS().recipe;
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.m }}>
      <PressableScale haptic={false} onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={RECIPE.stepShort(index + 1)} hitSlop={8} style={{ alignSelf: 'flex-start', width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? t.colors.accent : t.colors.surfaceAlt, marginTop: -2 }}>
        {done ? <Icon name="check" size={15} color={t.colors.onAccent} strokeWidth={2.5} /> : <HText variant="caption" weight="600" tabular>{index + 1}</HText>}
      </PressableScale>
      <View style={{ flex: 1, gap: t.spacing.s }}>
        <InlineText variant="body" text={step.text} style={{ color: done ? t.colors.muted : t.colors.text }} />
        {timer ? <StepTimer {...timer} /> : null}
      </View>
    </View>
  );
}

function StepTimer({ seconds, record, now, label, source, big }: StepTimerProps & { big?: boolean }) {
  const S = useS();
  const RECIPE = S.recipe;
  const t = useTheme();
  const store = getTimerStore();
  const status = record?.status;
  const rem = record ? remainingMs(record, now) : seconds * 1000;
  const prog = record ? timerProgress(record.totalMs, rem) : 0;
  const start = () => {
    haptic('light');
    void store.start({ label, seconds, source });
  };
  if (!record) {
    return (
      <Btn label={RECIPE.startTimer(formatTimerLabel(seconds, S.time))} bicon="timer" kind="ghost" compact={!big} onPress={start} style={{ alignSelf: 'flex-start', paddingHorizontal: big ? undefined : 10, backgroundColor: t.colors.accentSoft }} />
    );
  }
  const doneNow = status === 'done';
  const color = doneNow ? t.colors.success : t.colors.accent;
  return (
    <View
      style={{ alignSelf: big ? 'stretch' : 'flex-start', flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, paddingLeft: 12, paddingRight: 4, minHeight: big ? 64 : 40, borderRadius: t.radii.pill, backgroundColor: doneNow ? t.colors.successSoft : t.colors.accentSoft, overflow: 'hidden' }}
      accessibilityLiveRegion={doneNow ? 'assertive' : 'none'}
    >
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${prog * 100}%`, backgroundColor: color, opacity: 0.12 }} />
      <BIcon name="timer" size={big ? 22 : 16} color={color} />
      <HText variant={big ? 'title' : 'callout'} weight="600" tabular style={{ color, minWidth: big ? 90 : 48 }} accessibilityLabel={doneNow ? RECIPE.timerDone : `${formatCountdown(rem)} ${status === 'paused' ? RECIPE.timerPaused : RECIPE.timerRunning}`}>
        {doneNow ? RECIPE.timerDone : formatCountdown(rem)}
      </HText>
      {big ? <View style={{ flex: 1 }} /> : null}
      {status === 'running' ? <RoundBtn bicon="pause" label={RECIPE.pause} onPress={() => void store.pause(record.id)} size={big ? 48 : 32} /> : null}
      {status === 'paused' ? <RoundBtn bicon="play" label={RECIPE.resume} onPress={() => void store.resume(record.id)} size={big ? 48 : 32} /> : null}
      <RoundBtn bicon="reset" label={RECIPE.restart} onPress={start} size={big ? 48 : 32} />
    </View>
  );
}

/* ───────────── cooking mode ───────────── */

function KeepAwake() {
  useKeepAwake('hui-recipe-cooking', { suppressDeactivateWarnings: true });
  return null;
}

function CookingMode({
  title,
  steps,
  ingredients,
  factor,
  step,
  onStep,
  onFinish,
  onClose,
  timer,
}: {
  title: string;
  steps: Step[];
  ingredients: Ingredient[];
  factor: number;
  step: number;
  onStep: (n: number) => void;
  onFinish: () => void;
  onClose: () => void;
  timer: (i: number) => StepTimerProps | null;
}) {
  const RECIPE = useS().recipe;
  const { lang } = useLocale();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [showIngredients, setShowIngredients] = useState(false);
  const i = Math.max(0, step);
  const s = steps[i];
  const last = i >= steps.length - 1;
  const tp = timer(i);
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} statusBarTranslucent>
      <KeepAwake />
      <View style={{ flex: 1, backgroundColor: t.colors.bg, paddingTop: insets.top + t.spacing.s, paddingBottom: insets.bottom + t.spacing.m }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: t.spacing.l, gap: t.spacing.m }}>
          <View style={{ flex: 1, gap: 2 }}>
            <HText variant="caption" color="muted" numberOfLines={1}>
              {title}
            </HText>
            <HText variant="headline" accessibilityRole="header">
              {RECIPE.step(i + 1, steps.length)}
            </HText>
          </View>
          <RoundBtn bicon="cart" label={RECIPE.ingredients} onPress={() => setShowIngredients((x) => !x)} size={44} filled={showIngredients} />
          <RoundBtn icon="x" label={RECIPE.close} onPress={onClose} size={44} />
        </View>
        {/* progress */}
        <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: t.spacing.l, marginTop: t.spacing.m }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {steps.map((_, k) => (
            <View key={k} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: k <= i ? t.colors.accent : t.colors.surfaceAlt }} />
          ))}
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: t.spacing.xl, gap: t.spacing.xl, flexGrow: 1, justifyContent: 'center' }}>
          {showIngredients ? (
            <View style={{ gap: 6, backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.l, padding: t.spacing.l }}>
              {ingredients.map((ing, k) => (
                <HText key={k} variant="body">
                  <HText variant="body" weight="600">
                    {scaleQuantity(ing.qty, ing.unit, factor, ing.item, lang).text}
                  </HText>
                  {` ${scaledItem(ing.item, ing.qty, ing.unit, factor, lang, ing.plural)}`}
                </HText>
              ))}
            </View>
          ) : null}
          {s ? <InlineText variant="display" text={s.text} style={{ fontSize: 26, lineHeight: 36, fontWeight: '500' }} /> : null}
          {tp ? <StepTimer {...tp} big /> : null}
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: t.spacing.m, paddingHorizontal: t.spacing.l }}>
          <Btn label={RECIPE.prev} icon="chevronLeft" onPress={() => onStep(i - 1)} disabled={i === 0} style={{ flex: 1, minHeight: 56 }} />
          {last ? (
            <Btn label={RECIPE.done} kind="primary" icon="check" onPress={onFinish} style={{ flex: 1, minHeight: 56 }} />
          ) : (
            <Btn label={RECIPE.next} kind="primary" icon="chevronRight" iconRight onPress={() => onStep(i + 1)} style={{ flex: 1, minHeight: 56 }} />
          )}
        </View>
      </View>
    </Modal>
  );
}
