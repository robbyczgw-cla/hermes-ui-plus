import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useTheme, type Theme } from '../../theme';
import { useHui } from '../../primitives/context';
import { BlockTitle, FadeIn, HText, InlineText, PressableScale, Surface, textStyle } from '../../primitives/basics';
import { Icon } from '../../primitives/Icon';
import { Skeleton } from '../../primitives/Skeleton';
import { haptic } from '../../primitives/haptics';
import { Thumb } from '../imageParts';
import { ImageSlotGroup } from '../imageSlot';
import { asOptString } from '../../lib/format';
import { useNodeState } from '../../../nodestate';
import type { HuiChoice } from '../../types';
import { canSubmitSelection, pickChoiceLayout, readOptions, selectionRules, toggleSelection, type ChoiceLayout, type ChoiceOptionLite } from './a/misc.ts';
import { choiceReply } from './a/replies.ts';
import { AnsweredSummary, PrimaryButton, UndoBar, useModuleId, usePendingCommit, useSend } from './a/shared';
import { useS } from './useS';
import { ChoiceSkeleton } from '../../skeletons';

const OTHER = '__other__';

type ChoiceState = { status: 'open' | 'answered'; selected: string[]; other?: string; labels?: string[] };

/**
 * `choice` – single select sends on tap (1.5 s undo window), multi select needs the submit button.
 * After sending the node is locked and shows the answer (persisted); "Neu beantworten" re-opens.
 * Reply: `[choice:<id>] <question> → <label>, <label>, Andere: <text>`.
 */
export function Choice({ node }: { node: Partial<HuiChoice> }) {
  const S = useS();
  const t = useTheme();
  const { streaming } = useHui();
  const id = useModuleId('choice', node as Record<string, unknown>);
  const options = useMemo(() => readOptions(node.options), [node.options]);
  const allowOther = node.allowOther === true;
  const rules = selectionRules(node.multiple, node.min, node.max, options.length + (allowOther ? 1 : 0));
  // no option streamed yet: the auto layout can't be known – use the list shape of the skeleton
  // instead of guessing "chips" (which would shrink the card, then jump back for described options)
  const layout = streaming && !options.length && node.layout === undefined ? 'list' : pickChoiceLayout(node.layout, options);
  const question = asOptString(node.question);
  const [st, setSt] = useNodeState<ChoiceState>(id, { status: 'open', selected: [] });
  const [draft, setDraft] = useState<string[]>(st.selected);
  const [otherText, setOtherText] = useState(st.other ?? '');
  const [hint, setHint] = useState<string | null>(null);
  const send = useSend(id);
  const undo = usePendingCommit();
  const locked = st.status === 'answered';

  const labelsOf = (keys: string[]) => keys.filter((k) => k !== OTHER).map((k) => options.find((o) => o.key === k)?.label ?? k);

  const commit = (keys: string[], other: string | undefined) => {
    const labels = labelsOf(keys);
    const o = keys.includes(OTHER) && other?.trim() ? other.trim() : undefined;
    if (!send(choiceReply(id, question, labels, o))) return; // refused (turn running) → stay open
    setSt({ status: 'answered', selected: keys, labels, ...(o ? { other: o } : {}) });
  };

  if (!options.length && !question) {
    return streaming ? <ChoiceSkeleton /> : null;
  }

  if (locked) {
    const shown = [...(st.labels ?? labelsOf(st.selected)), ...(st.other ? [`${S.choice.otherPrefix}: ${st.other}`] : [])];
    return (
      <Surface>
        <AnsweredSummary
          title={question}
          answer={shown.join(', ')}
          onReopen={() => {
            haptic('selection');
            setDraft(st.selected);
            setOtherText(st.other ?? '');
            setSt((s) => ({ ...s, status: 'open' }));
          }}
        />
      </Surface>
    );
  }

  const disabled = streaming || !!undo.pending;
  const otherSelected = draft.includes(OTHER);

  const tap = (key: string) => {
    if (disabled) return;
    if (!rules.multiple) {
      if (key === OTHER) {
        setDraft([OTHER]);
        return;
      }
      haptic('selection');
      setDraft([key]);
      const label = labelsOf([key])[0] ?? key;
      undo.start(S.choice.sendingAnswer(label), () => commit([key], undefined));
      return;
    }
    const next = toggleSelection(draft, key, rules);
    if (!next) {
      haptic('warning');
      setHint(S.choice.maxReached(rules.max));
      return;
    }
    haptic('selection');
    setHint(null);
    setDraft(next);
  };

  const count = draft.filter((k) => k !== OTHER || otherText.trim()).length;
  const canSubmit = canSubmitSelection(count, rules) && !(otherSelected && !otherText.trim());

  return (
    <Surface style={{ gap: t.spacing.m }}>
      {question || rules.multiple ? (
        <BlockTitle
          title={question}
          subtitle={rules.multiple ? `${S.choice.multiHint} · ${S.choice.selectedCount(count, rules.max < options.length + (allowOther ? 1 : 0) ? rules.max : undefined)}` : undefined}
        />
      ) : null}
      <View style={{ marginTop: question ? -t.spacing.s : 0 }}>
        <Options
          t={t}
          layout={layout}
          options={options}
          selected={draft}
          multiple={rules.multiple}
          onTap={tap}
          disabled={disabled}
          streaming={streaming}
          allowOther={allowOther}
        />
      </View>
      {otherSelected && !undo.pending ? (
        <FadeIn>
          <OtherInput
            t={t}
            value={otherText}
            onChange={setOtherText}
            onSubmit={
              rules.multiple
                ? undefined
                : () => {
                    if (otherText.trim()) commit([OTHER], otherText);
                  }
            }
          />
        </FadeIn>
      ) : null}
      {hint ? (
        <HText variant="caption" color="warning" accessibilityLiveRegion="polite">
          {hint}
        </HText>
      ) : null}
      {undo.pending ? <UndoBar label={undo.pending.label} ms={undo.ms} onUndo={() => { undo.cancel(); setDraft([]); }} /> : null}
      {rules.multiple ? (
        <PrimaryButton
          label={asOptString(node.submitLabel) ?? S.choice.submit}
          disabled={!canSubmit || streaming}
          onPress={() => commit(draft, otherText)}
          accessibilityHint={!canSubmit ? S.choice.needMin(rules.min) : undefined}
        />
      ) : null}
    </Surface>
  );
}

function Options({
  t,
  layout,
  options,
  selected,
  multiple,
  onTap,
  disabled,
  streaming,
  allowOther,
}: {
  t: Theme;
  layout: ChoiceLayout;
  options: ChoiceOptionLite[];
  selected: string[];
  multiple: boolean;
  onTap: (key: string) => void;
  disabled: boolean;
  streaming: boolean;
  allowOther: boolean;
}) {
  const S = useS();
  const all: ChoiceOptionLite[] = allowOther && !streaming ? [...options, { key: OTHER, label: S.choice.other }] : options;
  const delay = (i: number) => (streaming ? 0 : Math.min(i, 6) * 50);
  const role = multiple ? 'checkbox' : 'radio';

  if (layout === 'chips') {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.s }} accessibilityRole={multiple ? undefined : 'radiogroup'}>
        {all.map((o, i) => {
          const on = selected.includes(o.key);
          return (
            <FadeIn key={o.key} delay={delay(i)}>
              <PressableScale
                haptic={false}
                disabled={disabled && !on}
                onPress={() => onTap(o.key)}
                accessibilityRole={role}
                accessibilityState={{ checked: on, selected: on }}
                accessibilityLabel={S.choice.a11yOption(o.label, on, multiple)}
                style={{
                  minHeight: 40,
                  paddingHorizontal: 14,
                  borderRadius: t.radii.pill,
                  borderWidth: 1,
                  borderColor: on ? t.colors.accent : t.colors.borderStrong,
                  backgroundColor: on ? t.colors.accent : t.colors.surface,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}
                pressedStyle={{ backgroundColor: on ? t.colors.accent : t.colors.surfacePressed }}
              >
                {on ? <Icon name="check" size={14} color={t.colors.onAccent} strokeWidth={2.5} /> : o.icon ? <HText style={{ fontSize: 15 }}>{o.icon}</HText> : null}
                <HText variant="callout" weight="500" style={{ color: on ? t.colors.onAccent : t.colors.text }}>
                  {o.label}
                </HText>
              </PressableScale>
            </FadeIn>
          );
        })}
        {streaming ? <Skeleton width={84} height={40} radius={t.radii.pill} /> : null}
      </View>
    );
  }

  if (layout === 'grid') {
    return (
      <ImageSlotGroup>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.s }}>
        {all.map((o, i) => {
          const on = selected.includes(o.key);
          const iconTile = (
            <View style={{ height: 56, borderRadius: t.radii.s, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
              {o.icon ? <HText style={{ fontSize: 28, lineHeight: 34 }}>{o.icon}</HText> : <Icon name={o.key === OTHER ? 'plus' : 'sparkle'} size={20} color={t.colors.subtle} />}
            </View>
          );
          return (
            <FadeIn key={o.key} delay={delay(i)} style={{ flexBasis: '47%', flexGrow: 1 }}>
              <PressableScale
                haptic={false}
                disabled={disabled && !on}
                onPress={() => onTap(o.key)}
                accessibilityRole={role}
                accessibilityState={{ checked: on, selected: on }}
                accessibilityLabel={S.choice.a11yOption(o.label, on, multiple)}
                style={{
                  borderRadius: t.radii.m,
                  borderWidth: on ? 2 : 1,
                  borderColor: on ? t.colors.accent : t.colors.border,
                  backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
                  padding: on ? 7 : 8,
                  gap: 8,
                }}
                pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
              >
                {o.imageQuery ? (
                  <Thumb query={o.imageQuery} size="100%" height={92} selectOnTap label={o.label} enabled={!streaming || i < options.length - 1} whenCollapsed={o.icon ? iconTile : null} />
                ) : (
                  iconTile
                )}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                  <HText variant="callout" weight="600" style={{ flex: 1 }} numberOfLines={2}>
                    {o.label}
                  </HText>
                  <Indicator t={t} on={on} multiple={multiple} />
                </View>
                {o.description ? (
                  <HText variant="caption" color="muted" numberOfLines={3}>
                    {o.description}
                  </HText>
                ) : null}
              </PressableScale>
            </FadeIn>
          );
        })}
        {streaming ? <Skeleton width="47%" height={120} radius={t.radii.m} style={{ flexGrow: 1 }} /> : null}
      </View>
      </ImageSlotGroup>
    );
  }

  return (
    <ImageSlotGroup>
    <View style={{ gap: t.spacing.s }} accessibilityRole={multiple ? undefined : 'radiogroup'}>
      {all.map((o, i) => {
        const on = selected.includes(o.key);
        return (
          <FadeIn key={o.key} delay={delay(i)}>
            <PressableScale
              haptic={false}
              scaleTo={0.985}
              disabled={disabled && !on}
              onPress={() => onTap(o.key)}
              accessibilityRole={role}
              accessibilityState={{ checked: on, selected: on }}
              accessibilityLabel={S.choice.a11yOption(o.label, on, multiple)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.spacing.m,
                minHeight: 48,
                paddingHorizontal: t.spacing.m,
                paddingVertical: t.spacing.s + 2,
                borderRadius: t.radii.m,
                borderWidth: 1,
                borderColor: on ? t.colors.accent : t.colors.border,
                backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
              }}
              pressedStyle={{ backgroundColor: on ? t.colors.accentSoft : t.colors.surfacePressed }}
            >
              <Indicator t={t} on={on} multiple={multiple} />
              {o.imageQuery ? (
                <Thumb query={o.imageQuery} size={44} selectOnTap label={o.label} enabled={!streaming || i < options.length - 1} whenCollapsed={o.icon ? <HText style={{ fontSize: 20, lineHeight: 26 }}>{o.icon}</HText> : null} />
              ) : o.icon ? (
                <HText style={{ fontSize: 20, lineHeight: 26 }}>{o.icon}</HText>
              ) : null}
              <View style={{ flex: 1, gap: 2 }}>
                <InlineText variant={o.description ? 'bodyStrong' : 'body'} text={o.label} />
                {o.description ? <InlineText variant="caption" color="muted" text={o.description} /> : null}
              </View>
            </PressableScale>
          </FadeIn>
        );
      })}
      {/* next option shimmers; with few options, extra rows keep the skeleton's height */}
      {streaming ? Array.from({ length: Math.max(1, 3 - options.length) }, (_, i) => <Skeleton key={`sk${i}`} height={48} radius={t.radii.m} />) : null}
    </View>
    </ImageSlotGroup>
  );
}

function Indicator({ t, on, multiple }: { t: Theme; on: boolean; multiple: boolean }) {
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: multiple ? 6 : 11,
        borderWidth: on ? 0 : 1.5,
        borderColor: t.colors.borderStrong,
        backgroundColor: on ? t.colors.accent : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on ? multiple ? <Icon name="check" size={14} color={t.colors.onAccent} strokeWidth={2.75} /> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.onAccent }} /> : null}
    </View>
  );
}

function OtherInput({ t, value, onChange, onSubmit }: { t: Theme; value: string; onChange: (s: string) => void; onSubmit?: () => void }) {
  const S = useS();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.s, alignItems: 'center' }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={S.choice.otherPlaceholder}
        placeholderTextColor={t.colors.subtle}
        accessibilityLabel={S.choice.otherPlaceholder}
        autoFocus
        maxLength={300}
        returnKeyType={onSubmit ? 'send' : 'done'}
        onSubmitEditing={onSubmit}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={[
          textStyle(t, 'body'),
          {
            flex: 1,
            minHeight: 44,
            borderRadius: t.radii.m,
            borderWidth: 1,
            borderColor: focus ? t.colors.accent : t.colors.borderStrong,
            paddingHorizontal: t.spacing.m,
            color: t.colors.text,
            backgroundColor: t.colors.surface,
            outlineStyle: 'none',
          } as object,
        ]}
      />
      {onSubmit ? (
        <PressableScale
          haptic={false}
          disabled={!value.trim()}
          onPress={onSubmit}
          accessibilityLabel={S.choice.otherSend}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.colors.accent, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="send" size={18} color={t.colors.onAccent} strokeWidth={2.25} />
        </PressableScale>
      ) : null}
    </View>
  );
}
