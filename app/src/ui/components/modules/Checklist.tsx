import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Platform, Share, View } from 'react-native';
import { TextInput } from '../../primitives/Text';
import { noOutline } from '../../lib/webStyle';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import { useTheme, type Theme } from '../../theme';
import { useHui } from '../../primitives/context';
import { HText, InlineText, PressableScale, Surface, textStyle } from '../../primitives/basics';
import { Button } from '../../primitives/Button';
import { Icon } from '../../primitives/Icon';
import { Skeleton } from '../../primitives/Skeleton';
import { haptic } from '../../primitives/haptics';
import { asOptString } from '../../lib/format';
import { useSettledAfter } from '../../lib/useSettledAfter';
import { keepWebFocusOnId } from '../../lib/webA11y';
import { useNodeScope, useNodeState } from '../../../nodestate';
import { listBus } from '../../../actions/listBus.ts';
import { checklistCreatedAt, isChecklistState, withMessageCreatedAt } from '../../../actions/lists.ts';
import type { HuiChecklist } from '../../types';
import {
  addItem,
  asKind,
  checklistReplyFor,
  categoryLabel,
  checklistShareText,
  formatQty,
  groupChecklist,
  itemLabel,
  removeItem,
  restoreItem,
  shouldGroup,
  stateFromNode,
  toggleItem,
  type CItem,
  type ChecklistState,
} from './a/checklistModel.ts';
import { ExtraIcon } from './a/ExtraIcon';
import { UndoBar, useModuleId, useNodeStateReady, useSend } from './a/shared';
import { useS } from './useS';
import { ChecklistSkeleton } from '../../skeletons';
import { useCaptureMode } from '../../lib/capture';

let idSeq = 0;
const newItemId = () => `u${Date.now().toString(36)}${(idSeq++).toString(36)}`;

/**
 * `checklist` – persisted (nodestate, actions/lists.ts contract: written once on mount), check /
 * uncheck, checked items sink into "Erledigt", shopping category headers, quick-add ("2 l Milch"),
 * long-press or edit mode to delete (with undo), share as text, "An Hermes senden"
 * (`[checklist:<id>] erledigt: … · offen: …`). Live-updates from `add_to_list` via nodestate + listBus.
 */
export function Checklist({ node }: { node: Partial<HuiChecklist> }) {
  const S = useS();
  const t = useTheme();
  const { streaming } = useHui();
  const id = useModuleId('checklist', node as Record<string, unknown>);
  const kind = asKind(node.kind);
  const editable = node.editable !== false;
  const scope = useNodeScope();
  const ready = useNodeStateReady();
  const [raw, setRaw] = useNodeState<ChecklistState | null>(id, null, { version: 1 });
  const stored = raw && isChecklistState(raw) ? raw : null;
  const fromNode = useMemo(() => stateFromNode(node as Record<string, unknown>, 0), [node]);
  const state = stored ?? fromNode;

  // ordering key for add_to_list = the message's creation time (not the first render)
  const messageCreatedAt = scope?.createdAt;
  // materialise once (so add_to_list can find an untouched list); never before the store loaded
  useEffect(() => {
    if (ready && !streaming && !stored && (fromNode.items.length || node.title)) setRaw(stateFromNode(node as Record<string, unknown>, checklistCreatedAt(messageCreatedAt, Date.now())));
  }, [ready, streaming, stored, fromNode, node, setRaw, messageCreatedAt]);
  // lists materialised by older builds carry their first-render time → re-stamp with the message time
  useEffect(() => {
    const fixed = stored ? withMessageCreatedAt(stored, messageCreatedAt) : null;
    if (ready && fixed) setRaw((prev) => (prev && isChecklistState(prev) ? (withMessageCreatedAt(prev, messageCreatedAt) ?? prev) : prev));
  }, [ready, stored, messageCreatedAt, setRaw]);

  const update = useCallback(
    (fn: (s: ChecklistState) => ChecklistState) =>
      setRaw((prev) => fn(prev && isChecklistState(prev) ? prev : stateFromNode(node as Record<string, unknown>, checklistCreatedAt(messageCreatedAt, Date.now())))),
    [setRaw, node, messageCreatedAt],
  );

  const grouped = shouldGroup(kind, node.groupBy, state.items);
  const g = useMemo(() => groupChecklist(state.items, { kind, grouped }), [state.items, kind, grouped]);
  const title = state.title ?? asOptString(node.title) ?? S.checklist.defaultTitle[kind];

  const [editing, setEditing] = useState(false);
  const [showDone, setShowDone] = useState(true);
  // share-as-image: the list as it stands, without the share / edit buttons, the empty "add item" field, the "Done"
  // chevron (done items always shown) and the Send button (a Button: hidden in capture mode by itself)
  const capture = useCaptureMode();
  const rowIdPrefix = `chk${useId().replace(/\W/g, '')}-`;
  const [removed, setRemoved] = useState<{ item: CItem; index: number } | null>(null);
  const [flash, setFlash] = useState<{ ids: string[]; note: string } | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const send = useSend(id);

  // add_to_list → highlight new / reopened items
  const itemsRef = useRef(state.items);
  const stateRef = useRef(state);
  useEffect(() => {
    itemsRef.current = state.items;
    stateRef.current = state;
  });
  useEffect(() => {
    if (!scope) return;
    return listBus.subscribe((e) => {
      if (e.type !== 'items_added' || e.conversationId !== scope.conversationId || e.messageId !== scope.messageId || e.nodeId !== id) return;
      const texts = new Set([...e.added, ...e.reopened].map((s) => s.trim().toLowerCase()));
      if (!texts.size) return;
      // items arrive through the nodestate subscription; resolve ids on the next frame
      setTimeout(() => {
        const ids = itemsRef.current.filter((i) => texts.has(i.text.trim().toLowerCase())).map((i) => i.id);
        haptic('success');
        setFlash({ ids, note: S.checklist.added(texts.size) });
      }, 0);
    });
  }, [scope, id]);
  useEffect(() => {
    if (!flash) return;
    const h = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(h);
  }, [flash]);
  useEffect(() => {
    if (!removed) return;
    const h = setTimeout(() => setRemoved(null), 4000);
    return () => clearTimeout(h);
  }, [removed]);
  useEffect(() => {
    if (!shareNote) return;
    const h = setTimeout(() => setShareNote(null), 1800);
    return () => clearTimeout(h);
  }, [shareNote]);

  const toggle = useCallback(
    (itemId: string) => {
      const next = toggleItem(stateRef.current, itemId);
      const nowChecked = next.items.find((i) => i.id === itemId)?.checked;
      haptic(nowChecked && next.items.every((i) => i.checked) ? 'success' : 'selection');
      update((s) => toggleItem(s, itemId));
    },
    [update],
  );

  const remove = useCallback(
    (itemId: string) => {
      const r = removeItem(stateRef.current, itemId);
      if (!r.removed) return;
      haptic('medium');
      setRemoved({ item: r.removed, index: r.index });
      update((s) => removeItem(s, itemId).state);
    },
    [update],
  );

  const add = (text: string): boolean => {
    const nid = newItemId();
    const r = addItem(stateRef.current, text, () => nid, kind);
    if (r.outcome === 'empty') return false;
    if (r.id && r.outcome !== 'added') setFlash({ ids: [r.id], note: '' });
    update((s) => addItem(s, text, () => nid, kind).state);
    return true;
  };

  const share = async () => {
    const text = checklistShareText(title, state.items, { kind, grouped }, S);
    try {
      if (Platform.OS === 'web') throw new Error('web');
      await Share.share({ message: text, title });
    } catch {
      await Clipboard.setStringAsync(text).catch(() => {});
      setShareNote(S.checklist.shared);
    }
  };

  if (!state.items.length && !node.title && streaming) {
    return <ChecklistSkeleton />;
  }

  const interactive = !streaming;
  const ratio = g.total ? g.doneCount / g.total : 0;

  return (
    <Surface padded={false}>
      {/* header */}
      <View style={{ paddingHorizontal: t.spacing.l, paddingTop: t.spacing.l, paddingBottom: t.spacing.s, gap: t.spacing.s }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
          <View style={{ flex: 1, gap: 2 }}>
            <InlineText variant="headline" text={title} accessibilityRole="header" />
            {/* no "0/0" placeholder: the counter appears once the list is complete and has items */}
            {!streaming && g.total > 0 ? (
              <HText variant="caption" color="muted" tabular accessibilityLabel={S.checklist.progressA11y(g.doneCount, g.total)}>
                {g.doneCount === g.total ? `${S.checklist.allDone} · ` : ''}
                {S.checklist.progress(g.doneCount, g.total)}
              </HText>
            ) : null}
          </View>
          {interactive && !capture ? (
            <>
              <PressableScale haptic="selection" onPress={() => void share()} accessibilityLabel={S.checklist.share} hitSlop={6} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
                <ExtraIcon name="share" size={18} color={t.colors.muted} />
              </PressableScale>
              {editable ? (
                <PressableScale
                  haptic="selection"
                  onPress={() => setEditing((e) => !e)}
                  accessibilityLabel={editing ? S.checklist.editDone : S.checklist.edit}
                  accessibilityState={{ selected: editing }}
                  hitSlop={6}
                  style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: editing ? t.colors.accentSoft : 'transparent' }}
                >
                  {editing ? <Icon name="check" size={18} color={t.colors.accent} strokeWidth={2.25} /> : <ExtraIcon name="pencil" size={17} color={t.colors.muted} />}
                </PressableScale>
              ) : null}
            </>
          ) : null}
        </View>
        <ProgressLine t={t} ratio={ratio} />
      </View>

      {/* open items: plain Views without Reanimated layout / exit animations (their frames live on the UI thread only).
          When the card grew at the turn end (counter + Share/Edit appear), the items stayed frozen at their old
          position, 53 px up over the progress bar (E2E `checklist`, 2026-10-15). React owns the final layout. */}
      <View style={{ paddingHorizontal: t.spacing.s }}>
        {g.groups.map((grp) => (
          <View key={grp.key || '_'}>
            {grp.title ? (
              <HText variant="caption" weight="600" color="muted" style={{ paddingHorizontal: t.spacing.s, paddingTop: t.spacing.m, paddingBottom: 2 }} accessibilityRole="header">
                {categoryLabel(grp.title, S)}
              </HText>
            ) : null}
            {grp.items.map((it) => (
              <Row key={it.id} idPrefix={rowIdPrefix} t={t} item={it} onToggle={toggle} onDelete={remove} editing={editing && editable} deletable={editable} interactive={interactive} highlight={!!flash?.ids.includes(it.id)} />
            ))}
          </View>
        ))}
        {!g.groups.length && !g.done.length && !streaming ? (
          <HText variant="callout" color="muted" style={{ padding: t.spacing.s }}>
            {S.checklist.empty}
          </HText>
        ) : null}
        {/* while streaming: the next (still incomplete) item shimmers; with few items, extra rows keep
            the height of the initial skeleton so the card grows instead of jumping */}
        {streaming
          ? Array.from({ length: Math.max(1, 3 - state.items.length) }, (_, i) => (
              <View key={`sk${i}`} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: t.spacing.s, minHeight: 44 }}>
                <Skeleton width={22} height={22} radius={11} />
                <Skeleton width={`${50 - i * 10}%`} height={12} />
              </View>
            ))
          : null}
      </View>

      {/* done */}
      {g.done.length ? (
        <View style={{ paddingHorizontal: t.spacing.s, marginTop: t.spacing.xs }}>
          <PressableScale
            haptic="selection"
            scaleTo={0.99}
            onPress={() => setShowDone((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showDone }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: t.spacing.s, minHeight: 36 }}
          >
            <HText variant="caption" weight="600" color="muted" style={{ flex: 1 }}>
              {S.checklist.done(g.done.length)}
            </HText>
            {capture ? null : (
              <View style={{ transform: [{ rotate: showDone ? '180deg' : '0deg' }] }}>
                <Icon name="chevronDown" size={14} color={t.colors.muted} />
              </View>
            )}
          </PressableScale>
          {/* share-as-image: the done items are always shown */}
          {showDone || capture
            ? g.done.map((it) => (
                <Row key={it.id} idPrefix={rowIdPrefix} t={t} item={it} onToggle={toggle} onDelete={remove} editing={editing && editable} deletable={editable} interactive={interactive} highlight={false} />
              ))
            : null}
        </View>
      ) : null}

      {/* footer (share-as-image: only the card's bottom padding, its controls are not in the picture) */}
      <View style={capture ? { height: t.spacing.m } : { padding: t.spacing.l, paddingTop: t.spacing.s, gap: t.spacing.m }}>
        {editable && interactive && !capture ? <AddField t={t} kind={kind} onAdd={add} /> : null}
        {removed ? (
          <UndoBar
            key={removed.item.id}
            label={S.checklist.deleted(itemLabel(removed.item))}
            ms={4000}
            onUndo={() => {
              const r = removed;
              setRemoved(null);
              update((s) => restoreItem(s, r.item, r.index));
            }}
          />
        ) : null}
        {flash?.note || shareNote ? (
          <View accessibilityLiveRegion="polite">
            <HText variant="caption" color="accent" weight="500">
              {flash?.note || shareNote}
            </HText>
          </View>
        ) : null}
        {interactive && state.items.length ? (
          <Button
            label={state.sentAt ? S.checklist.sent : S.checklist.sendToHermes}
            variant={state.sentAt ? 'secondary' : 'primary'}
            icon={state.sentAt ? 'check' : 'send'}
            onPress={() => {
              if (!send(checklistReplyFor(id, state.items))) return;
              update((s) => ({ ...s, sentAt: Date.now() }));
            }}
          />
        ) : null}
      </View>
    </Surface>
  );
}

function ProgressLine({ t, ratio }: { t: Theme; ratio: number }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(ratio);
  useEffect(() => {
    p.value = reduced ? ratio : withTiming(ratio, { duration: 380 });
  }, [ratio, reduced, p]);
  const anim = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }));
  // settled: React owns the current width (a dropped animated value would fall back to the mount ratio)
  const settled = useSettledAfter(reduced ? 0 : 460, [ratio, reduced]);
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}>
      <Animated.View style={[{ height: 4, borderRadius: 2, backgroundColor: ratio >= 1 ? t.colors.success : t.colors.accent }, anim, settled ? ({ width: `${ratio * 100}%` } as object) : null]} />
    </View>
  );
}

const Row = memo(function Row({
  idPrefix,
  t,
  item,
  onToggle,
  onDelete,
  editing,
  deletable,
  interactive,
  highlight,
}: {
  /** web: DOM id prefix of this checklist, so a toggled row (it moves to the done group) can keep keyboard focus */
  idPrefix: string;
  t: Theme;
  item: CItem;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  editing: boolean;
  deletable: boolean;
  interactive: boolean;
  highlight: boolean;
}) {
  const S = useS();
  const qty = formatQty(item);
  const label = itemLabel(item);
  const domId = Platform.OS === 'web' ? `${idPrefix}${item.id}` : undefined;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <PressableScale
        haptic={false}
        // while streaming the row is inert but NOT dimmed (disabled would fade it to 45 % and the
        // arriving list would look washed out / empty on a bright phone screen)
        scaleTo={interactive ? 0.985 : 1}
        nativeID={domId}
        onPress={
          interactive
            ? () => {
                keepWebFocusOnId(domId);
                onToggle(item.id);
              }
            : undefined
        }
        onLongPress={deletable && interactive ? () => onDelete(item.id) : undefined}
        delayLongPress={450}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.checked, disabled: !interactive }}
        accessibilityLabel={S.checklist.itemA11y(label, item.checked)}
        accessibilityHint={deletable ? S.checklist.itemHint : undefined}
        accessibilityActions={deletable ? [{ name: 'activate' }, { name: 'delete', label: S.checklist.delete }] : undefined}
        onAccessibilityAction={(e) => {
          if (!interactive) return;
          if (e.nativeEvent.actionName === 'delete') onDelete(item.id);
          else onToggle(item.id);
        }}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.spacing.m,
          minHeight: 44,
          paddingHorizontal: t.spacing.s,
          paddingVertical: 6,
          borderRadius: t.radii.control,
          backgroundColor: highlight ? t.colors.accentSoft : 'transparent',
        }}
        pressedStyle={interactive ? { backgroundColor: t.colors.surfacePressed } : undefined}
      >
        <CheckCircle t={t} on={item.checked} />
        <View style={{ flex: 1, gap: 1 }}>
          <HText
            variant="body"
            style={item.checked ? { color: t.colors.subtle, textDecorationLine: 'line-through' } : undefined}
          >
            {item.text}
          </HText>
          {item.note ? (
            <HText variant="caption" color="subtle" numberOfLines={2}>
              {item.note}
            </HText>
          ) : null}
        </View>
        {qty ? (
          <HText variant="callout" color={item.checked ? 'subtle' : 'muted'} tabular>
            {qty}
          </HText>
        ) : null}
      </PressableScale>
      {editing ? (
        <View>
          <IconButtonTrash t={t} label={S.checklist.deleteA11y(label)} onPress={() => onDelete(item.id)} />
        </View>
      ) : null}
    </View>
  );
});

function IconButtonTrash({ t, label, onPress }: { t: Theme; label: string; onPress: () => void }) {
  return (
    <PressableScale haptic={false} onPress={onPress} accessibilityLabel={label} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <ExtraIcon name="trash" size={18} color={t.colors.danger} />
    </PressableScale>
  );
}

function CheckCircle({ t, on }: { t: Theme; on: boolean }) {
  const reduced = useReducedMotion();
  const s = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (on && !reduced) s.value = withSequence(withTiming(1.18, { duration: 110 }), withSpring(1, { damping: 12, stiffness: 260 }));
  }, [on, reduced, s]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Animated.View
      style={[
        {
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: on ? 0 : 1.5,
          borderColor: t.colors.borderControl,
          backgroundColor: on ? t.colors.success : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        },
        anim,
      ]}
    >
      {on ? <Icon name="check" size={14} color={t.dark ? '#0B1A10' : '#FFFFFF'} strokeWidth={2.75} /> : null}
    </Animated.View>
  );
}

function AddField({ t, kind, onAdd }: { t: Theme; kind: ReturnType<typeof asKind>; onAdd: (text: string) => boolean }) {
  const S = useS();
  const [text, setText] = useState('');
  const [focus, setFocus] = useState(false);
  const submit = () => {
    if (!text.trim()) return;
    if (onAdd(text)) {
      haptic('light');
      setText('');
    }
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.spacing.s,
          minHeight: 44,
          borderRadius: t.radii.control,
          borderWidth: 1,
          borderColor: focus ? t.colors.accent : t.colors.borderControl,
          backgroundColor: t.colors.surfaceAlt,
          paddingHorizontal: t.spacing.m,
        }}
      >
        <Icon name="plus" size={16} color={t.colors.subtle} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={S.checklist.addPlaceholder[kind]}
          placeholderTextColor={t.colors.subtle}
          accessibilityLabel={S.checklist.addPlaceholder[kind]}
          returnKeyType="done"
          blurOnSubmit={false}
          maxLength={120}
          onSubmitEditing={submit}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={[textStyle(t, 'callout'), { flex: 1, color: t.colors.text, paddingVertical: 10, ...noOutline } as object]}
        />
      </View>
      {text.trim() ? (
        <View>
          <PressableScale
            haptic={false}
            onPress={submit}
            accessibilityLabel={S.checklist.add}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.colors.ink, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="plus" size={20} color={t.colors.onInk} strokeWidth={2.25} />
          </PressableScale>
        </View>
      ) : null}
    </View>
  );
}
