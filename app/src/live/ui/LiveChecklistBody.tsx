/**
 * The items of a live checklist as this device shows them (head + pending edits): category groups, the done section,
 * "neu" (Hermes changed it since you last looked: brass rule + tag) and "von dir" (your pending item: blue tag), the
 * "In v5 entfernt: … · Zurückholen" row and the add field. Every edit is an op (pending until the next message).
 * Shared by the open card (LiveCardSheet) and the first version inline in the chat (LiveNode).
 */
import { memo, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { useT } from '../../i18n';
import { HText, PressableScale, textStyle } from '../../ui/primitives/basics';
import { TextInput } from '../../ui/primitives/Text';
import { Icon } from '../../chat/icons';
import { haptic } from '../../ui/primitives/haptics';
import { noOutline } from '../../ui/lib/webStyle';
import type { Theme } from '../../ui/theme';
import { AddField, CheckCircle } from '../../ui/components/modules/Checklist';
import { addItem, asKind, categoryLabel, formatQty, groupChecklist, itemLabel, parseItemInput, shouldGroup, type CItem } from '../../ui/components/modules/a/checklistModel.ts';
import { useS } from '../../ui/components/modules/useS';
import type { LiveCardModel } from '../derive.ts';
import { fitCategory, type LiveItem, type LiveOp } from '../model.ts';
import { newUserItemId } from '../pending.ts';
import { Tag } from './parts';

const toCItem = (it: LiveItem): CItem => ({ ...it, checked: !!it.checked, ...(it.qty !== undefined ? { qty: it.qty as CItem['qty'] } : {}) }) as CItem;

export function LiveChecklistBody({ model, t, onEdit, highlights = true, readOnly }: { model: LiveCardModel; t: Theme; onEdit: (op: LiveOp) => void; highlights?: boolean; readOnly?: boolean }) {
  const tr = useT();
  const S = useS();
  const state = model.view.state;
  const kind = asKind(state.kind);
  const items = useMemo(() => state.items.map(toCItem), [state.items]);
  const grouped = shouldGroup(kind, state.groupBy, items);
  const g = useMemo(() => groupChecklist(items, { kind, grouped }), [items, kind, grouped]);
  const [showDone, setShowDone] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const interactive = !readOnly && !model.closed;

  const toggle = (id: string) => {
    const it = state.items.find((x) => x.id === id);
    if (!it) return;
    haptic(it.checked ? 'selection' : 'light');
    onEdit(it.checked ? { uncheck: id } : { check: id });
  };
  const add = (text: string): boolean => {
    const st = { kind: 'checklist' as const, createdAt: 0, items };
    const id = newUserItemId();
    const r = addItem(st, text, () => id, kind);
    if (r.outcome === 'empty') return false;
    if (r.outcome === 'reopened' && r.id) onEdit({ uncheck: r.id });
    if (r.outcome === 'added') {
      const it = r.state.items.find((x) => x.id === id);
      const category = fitCategory(it?.category, state.items.map((x) => x.category));
      if (it) onEdit({ add: { id, text: it.text, ...(it.qty !== undefined ? { qty: it.qty } : {}), ...(it.unit ? { unit: it.unit } : {}), ...(category ? { category } : {}) } });
    }
    return true;
  };

  const row = (it: CItem) =>
    editing === it.id ? (
      <EditRow key={it.id} t={t} item={it} onDone={() => setEditing(null)} onEdit={onEdit} />
    ) : (
      <LiveRow
        key={it.id}
        t={t}
        item={it}
        fresh={highlights && model.fresh.has(it.id) && !it.checked}
        mine={model.view.ownAdded.has(it.id)}
        interactive={interactive}
        onToggle={toggle}
        onLongPress={interactive ? () => setEditing(it.id) : undefined}
      />
    );

  return (
    <View>
      {g.groups.map((grp) => (
        <View key={grp.key || '_'}>
          {grp.title ? (
            <HText variant="micro" weight="600" color="muted" style={{ paddingHorizontal: t.spacing.l, paddingTop: t.spacing.m, paddingBottom: 2, letterSpacing: 1.1, textTransform: 'uppercase' }} accessibilityRole="header">
              {categoryLabel(grp.title, S)}
            </HText>
          ) : null}
          {grp.items.map(row)}
        </View>
      ))}
      {!g.groups.length && !g.done.length ? (
        <HText variant="callout" color="muted" style={{ paddingHorizontal: t.spacing.l, paddingVertical: t.spacing.s }}>
          {tr('live.card.empty')}
        </HText>
      ) : null}
      {g.done.length ? (
        <View style={{ marginTop: t.spacing.xs }}>
          <PressableScale
            haptic="selection"
            scaleTo={0.99}
            onPress={() => setShowDone((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showDone }}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: t.spacing.l, minHeight: 40 }}
          >
            <HText variant="micro" weight="600" color="muted" style={{ flex: 1, letterSpacing: 1.1, textTransform: 'uppercase' }}>
              {tr('live.card.done', { count: g.done.length })}
            </HText>
            <View style={{ transform: [{ rotate: showDone ? '180deg' : '0deg' }] }}>
              <Icon name="chevronDown" size={16} color={t.colors.muted} />
            </View>
          </PressableScale>
          {showDone ? g.done.map(row) : null}
        </View>
      ) : null}
      {model.removed.length && model.removedIn && interactive ? (
        <RemovedRow t={t} n={model.removedIn} items={model.removed} onRestore={() => model.removed.forEach((it) => onEdit({ add: { ...it } }))} />
      ) : null}
      {interactive ? (
        <View style={{ paddingHorizontal: t.spacing.l, paddingTop: t.spacing.s }}>
          <AddField t={t} kind={kind} onAdd={add} />
        </View>
      ) : null}
    </View>
  );
}

const LiveRow = memo(function LiveRow({
  t,
  item,
  fresh,
  mine,
  interactive,
  onToggle,
  onLongPress,
}: {
  t: Theme;
  item: CItem;
  fresh: boolean;
  mine: boolean;
  interactive: boolean;
  onToggle: (id: string) => void;
  onLongPress?: () => void;
}) {
  const tr = useT();
  const S = useS();
  const qty = formatQty(item);
  const label = itemLabel(item);
  const tag = fresh ? tr('live.card.tagNew') : mine ? tr('live.card.tagMine') : '';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
      {/* brass rule: Hermes changed this since you last looked */}
      <View style={{ width: 3, borderTopRightRadius: 2, borderBottomRightRadius: 2, marginVertical: 6, backgroundColor: fresh ? t.colors.accent : 'transparent' }} />
      <PressableScale
        haptic={false}
        scaleTo={interactive ? 0.985 : 1}
        onPress={interactive ? () => onToggle(item.id) : undefined}
        onLongPress={onLongPress}
        delayLongPress={450}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.checked, disabled: !interactive }}
        accessibilityLabel={`${S.checklist.itemA11y(label, item.checked)}${tag ? `, ${tag}` : ''}`}
        accessibilityHint={onLongPress ? tr('live.card.itemHint') : undefined}
        accessibilityActions={onLongPress ? [{ name: 'activate' }, { name: 'longpress', label: tr('live.card.edit') }] : undefined}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'longpress') onLongPress?.();
          else if (interactive) onToggle(item.id);
        }}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, minHeight: 48, paddingLeft: t.spacing.l - 3, paddingRight: t.spacing.l, paddingVertical: 6 }}
        pressedStyle={interactive ? { backgroundColor: t.colors.surfacePressed } : undefined}
      >
        <CheckCircle t={t} on={item.checked} />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, rowGap: 2 }}>
          <HText variant="body" style={item.checked ? { color: t.colors.subtle, textDecorationLine: 'line-through' } : undefined}>
            {item.note && !item.checked ? `${item.text}, ${item.note}` : item.text}
          </HText>
          {tag ? <Tag label={tag} tone={fresh ? 'accent' : 'info'} t={t} /> : null}
        </View>
        {qty ? (
          <HText variant="callout" color={item.checked ? 'subtle' : 'muted'} tabular>
            {qty}
          </HText>
        ) : null}
      </PressableScale>
    </View>
  );
});

function RemovedRow({ t, n, items, onRestore }: { t: Theme; n: number; items: LiveItem[]; onRestore: () => void }) {
  const tr = useT();
  const names = items.map((i) => i.text).join(', ');
  return (
    <View style={{ marginHorizontal: t.spacing.l, marginTop: t.spacing.s, flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, minHeight: 48, paddingHorizontal: t.spacing.m, borderRadius: t.radii.control, backgroundColor: t.colors.surfaceAlt }}>
      <Icon name="retry" size={16} color={t.colors.muted} />
      <HText variant="callout" color="muted" style={{ flex: 1 }} numberOfLines={2}>
        {tr('live.card.removed', { n })} <HText variant="callout" weight="600">{names}</HText>
      </HText>
      <PressableScale haptic="selection" onPress={onRestore} accessibilityRole="button" accessibilityLabel={tr('live.card.restoreA11y', { items: names })} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
        <HText variant="callout" weight="600" color="accent">
          {tr('live.card.restore')}
        </HText>
      </PressableScale>
    </View>
  );
}

/** Long-press edit: text (with "2 l Milch" quantity parsing) and delete. */
function EditRow({ t, item, onDone, onEdit }: { t: Theme; item: CItem; onDone: () => void; onEdit: (op: LiveOp) => void }) {
  const tr = useT();
  const [text, setText] = useState(() => [formatQty(item), item.text].filter(Boolean).join(' '));
  const commit = () => {
    const p = parseItemInput(text);
    if (p && (p.text !== item.text || String(p.qty ?? '') !== String(item.qty ?? '') || (p.unit ?? '') !== (item.unit ?? ''))) {
      onEdit({ set: item.id, text: p.text, qty: p.qty ?? null, unit: p.unit ?? null });
    }
    onDone();
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, paddingHorizontal: t.spacing.l, paddingVertical: 4 }}>
      <View style={{ flex: 1, minHeight: 44, borderRadius: t.radii.control, borderWidth: 1, borderColor: t.colors.accent, backgroundColor: t.colors.surfaceAlt, paddingHorizontal: t.spacing.m, justifyContent: 'center' }}>
        <TextInput
          value={text}
          onChangeText={setText}
          autoFocus
          accessibilityLabel={tr('live.card.textLabel')}
          returnKeyType="done"
          onSubmitEditing={commit}
          maxLength={160}
          style={[textStyle(t, 'callout'), { color: t.colors.text, paddingVertical: 10, ...(Platform.OS === 'web' ? noOutline : {}) } as object]}
        />
      </View>
      <PressableScale haptic="medium" onPress={() => { onEdit({ del: item.id }); onDone(); }} accessibilityLabel={tr('live.card.deleteA11y', { item: item.text })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="trash" size={18} color={t.colors.danger} />
      </PressableScale>
      <PressableScale haptic="selection" onPress={commit} accessibilityLabel={tr('live.card.editDone')} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.colors.ink, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="check" size={18} color={t.colors.onInk} strokeWidth={2.2} />
      </PressableScale>
    </View>
  );
}
