/**
 * A live card block inside a Hermes answer (design §3.1, mockups 01 and 09), for every card type:
 * - the first version renders the card inline as long as Hermes has not sent a newer one (a checklist in full and
 *   editable; a trip or a watchlist as a compact card with a short summary and "Öffnen", edited in the open card);
 *   afterwards it collapses to a one-line snapshot row ("Version 1 · 12 Einträge · aktuelle Version oben");
 * - every later version (a full version or a Hermes patch) renders as a receipt: title, vN, what changed (+ added,
 *   − removed, ~ changed with the old value struck: "15:00 → 11:00", "269 € → 239 €"), "Öffnen";
 * - while the answer streams: a compact "Wird aktualisiert …" row (the fold only takes finished answers).
 * The renderers of live-capable nodes hand over with `useLiveHandOver` / `useLivePatchHandOver`.
 */
import { StyleSheet, View } from 'react-native';
import { useLocale, useT } from '../../i18n';
import { HText, PressableScale } from '../../ui/primitives/basics';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { useHui } from '../../ui/primitives/context';
import { Icon } from '../../chat/icons';
import { useTheme, type Theme } from '../../ui/theme';
import { useNodeScope } from '../../nodestate';
import { formatQty, itemLabel, type CItem } from '../../ui/components/modules/a/checklistModel.ts';
import { formatClock, toMinutes } from '../../ui/components/modules/c2/agendaModel.ts';
import { formatPrice, numLang } from '../../ui/components/modules/d1/d1Model.ts';
import { ProgressLine } from '../../ui/components/modules/Checklist';
import { useLive } from '../LiveProvider';
import { cardLevelChange, type LiveCardModel } from '../derive.ts';
import { diffStates, stateAt, type ItemChange, type LiveCardType, type LiveDay, type MessageMark } from '../model.ts';
import { dayBlocks, tripChangeDetail, tripDays } from '../trip.ts';
import { watchChangeDetail, watchCounts } from '../watch.ts';
import { LiveChecklistBody } from './LiveChecklistBody';
import { ListTile, LiveSeal, VersionChip } from './parts';

const RECEIPT_LINES = 6;
const PREVIEW_LINES = 4;

type HandOver = { mark?: MessageMark; streaming: boolean };

/**
 * A full live node (`"live":true`) of this message: what LiveNode needs, or null = render the plain node (no provider,
 * other backends, a node the fold did not take). Matches the node's own id (`m.node`) when the card got another one.
 */
export function useLiveHandOver(node: { id?: unknown; live?: unknown }): HandOver | null {
  const live = useLive();
  const scope = useNodeScope();
  const { streaming } = useHui();
  if (node.live !== true) {
    // a plain list the fold applied to a card it continues (model.ts `continuationOf`): its receipt
    if (!live || !scope || streaming) return null;
    const key = typeof node.id === 'string' ? node.id : '';
    const mark = live.marks.get(scope.messageId)?.find((m) => m.adopted === key && !m.unapplied);
    return mark ? { mark, streaming } : null;
  }
  if (!live || !scope || typeof node.id !== 'string' || !node.id) return null;
  const mark = live.marks.get(scope.messageId)?.find((m) => (m.node ?? m.card) === node.id);
  return mark || streaming ? { mark, streaming } : null;
}

/** A callout with `livePatch` (a Hermes patch): the receipt of its version, or null = the plain callout. */
export function useLivePatchHandOver(patch: { card?: unknown } | undefined): HandOver | null {
  const live = useLive();
  const scope = useNodeScope();
  const { streaming } = useHui();
  const card = patch?.card;
  if (!live || !scope || typeof card !== 'string' || !card) return null;
  const mark = live.marks.get(scope.messageId)?.find((m) => m.card === card);
  // a patch for a card this chat does not have: the callout stays a callout (with a note, LiveNotes.tsx)
  if (mark?.unapplied) return null;
  if (mark) return { mark, streaming };
  // a patch for a card this chat has, still streaming; a patch for an unknown card stays a callout
  return streaming && live.byId.has(card) ? { streaming } : null;
}

export function LiveNode({ node, mark, streaming, type }: { node: { id?: string; title?: string }; mark?: MessageMark; streaming: boolean; type?: LiveCardType }) {
  const t = useTheme();
  const live = useLive();
  const id = mark?.card ?? node.id;
  const model = id ? live?.byId.get(id) : undefined;
  if (streaming || !mark || !model) return <Updating t={t} title={node.title ?? model?.title ?? ''} type={model?.type ?? type} />;
  const laterHermes = model.card.versions.some((v) => v.n > mark.n && v.author === 'hermes');
  if (mark.n === 1 && !mark.unchanged) {
    if (laterHermes) return <SnapshotRow t={t} model={model} />;
    return model.type === 'checklist' ? <InlineCard t={t} model={model} /> : <InlineSummary t={t} model={model} />;
  }
  return <Receipt t={t} model={model} mark={mark} />;
}

function Updating({ t, title, type }: { t: Theme; title: string; type?: LiveCardType }) {
  const tr = useT();
  return (
    <View style={[styles.card, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radii.card }]} accessibilityLabel={`${title} ${tr('live.receipt.updating')}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, padding: t.spacing.l }}>
        <ListTile t={t} type={type} />
        <View style={{ flex: 1, gap: 6 }}>
          {title ? <HText variant="headline">{title}</HText> : <Skeleton width="50%" height={14} />}
          <HText variant="caption" color="muted">
            {tr('live.receipt.updating')}
          </HText>
        </View>
      </View>
    </View>
  );
}

function InlineCard({ t, model }: { t: Theme; model: LiveCardModel }) {
  const tr = useT();
  const live = useLive()!;
  const { done, total } = model.progress;
  return (
    <View style={[styles.card, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radii.card }]}>
      <View style={{ paddingHorizontal: t.spacing.l, paddingTop: t.spacing.l, paddingBottom: t.spacing.s, gap: t.spacing.s }}>
        <HText variant="headline" accessibilityRole="header">
          {model.title}
        </HText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
          <LiveSeal t={t} />
          <VersionChip n={model.head.n} t={t} small />
          <HText variant="caption" color="muted" tabular>
            {tr('live.progress', { done, total })}
          </HText>
        </View>
        <ProgressLine t={t} ratio={total ? done / total : 0} />
      </View>
      <LiveChecklistBody model={model} t={t} onEdit={(op) => live.edit(model.id, op)} highlights={false} />
      <SyncLine t={t} model={model} />
    </View>
  );
}

/** Trip / watchlist first version in the chat: title, seal, vN, a summary, a few lines, "Öffnen" (edits in the card). */
function InlineSummary({ t, model }: { t: Theme; model: LiveCardModel }) {
  const tr = useT();
  const live = useLive()!;
  const { lang } = useLocale();
  const state = model.view.state;
  let summary: string;
  let lines: { key: string; left: string; right: string }[];
  if (model.type === 'trip') {
    const days = tripDays(state);
    summary = tr('live.trip.summary', { days: days.length, count: state.items.length });
    lines = days.map((d) => ({ key: d.id, left: d.label, right: tr('live.trip.blocks', { count: dayBlocks(state, d.id, days).length }) }));
  } else {
    const shown = state.items.filter((it) => !it.hidden);
    summary = tr('live.watch.count', { count: watchCounts(state).shown });
    lines = shown.map((it) => ({ key: it.id, left: it.text, right: typeof it.price === 'number' ? formatPrice(it.price, it.currency, numLang(lang)) : tr('live.watch.noPrice') }));
  }
  const rest = lines.length - PREVIEW_LINES;
  const open = () => live.openSheet({ kind: 'card', id: model.id });
  return (
    <View style={[styles.card, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radii.card }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.m, paddingHorizontal: t.spacing.l, paddingTop: t.spacing.l, paddingBottom: t.spacing.s }}>
        <ListTile t={t} type={model.type} size={36} />
        <View style={{ flex: 1, gap: t.spacing.xs }}>
          <HText variant="headline" accessibilityRole="header">
            {model.title}
          </HText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, flexWrap: 'wrap' }}>
            <LiveSeal t={t} />
            <VersionChip n={model.head.n} t={t} small />
            <HText variant="caption" color="muted" tabular>
              {summary}
            </HText>
          </View>
        </View>
      </View>
      <View style={{ paddingHorizontal: t.spacing.l, paddingBottom: t.spacing.xs }}>
        {lines.slice(0, PREVIEW_LINES).map((l) => (
          <View key={l.key} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, minHeight: 32 }}>
            <HText variant="body" numberOfLines={1} style={{ flex: 1 }}>
              {l.left}
            </HText>
            <HText variant="callout" color="muted" tabular numberOfLines={1}>
              {l.right}
            </HText>
          </View>
        ))}
        {rest > 0 ? (
          <HText variant="caption" color="muted" style={{ paddingTop: 2 }}>
            {tr('live.receipt.more', { count: rest })}
          </HText>
        ) : null}
      </View>
      <PressableScale
        haptic="selection"
        scaleTo={0.99}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={tr('live.receipt.openA11y', { title: model.title, n: model.head.n })}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, minHeight: 44, paddingHorizontal: t.spacing.l }}
      >
        <HText variant="callout" weight="600" color="accent">
          {tr('live.receipt.open')}
        </HText>
        <Icon name="chevronRight" size={16} color={t.colors.accent} />
      </PressableScale>
      <SyncLine t={t} model={model} />
    </View>
  );
}

function SnapshotRow({ t, model }: { t: Theme; model: LiveCardModel }) {
  const tr = useT();
  const live = useLive()!;
  const count = stateAt(model.card, 1).items.length;
  return (
    <PressableScale
      haptic="selection"
      scaleTo={0.99}
      onPress={() => live.openSheet({ kind: 'history', id: model.id, n: 1 })}
      accessibilityRole="button"
      accessibilityLabel={tr('live.receipt.snapshotA11y', { n: 1, title: model.title })}
      style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, padding: t.spacing.m, borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radii.card }]}
    >
      <ListTile t={t} size={32} muted type={model.type} />
      <View style={{ flex: 1, gap: 1 }}>
        <HText variant="bodyStrong" numberOfLines={1}>
          {model.title}
        </HText>
        <HText variant="caption" color="muted" numberOfLines={2}>
          {tr('live.receipt.snapshot', { n: 1, count })}
        </HText>
      </View>
      <Icon name="history" size={18} color={t.colors.muted} />
    </PressableScale>
  );
}

function Receipt({ t, model, mark }: { t: Theme; model: LiveCardModel; mark: MessageMark }) {
  const tr = useT();
  const live = useLive()!;
  const after = stateAt(model.card, mark.n);
  const changes = mark.unchanged ? [] : sortChanges(diffStates(stateAt(model.card, mark.n - 1), after));
  const shown = changes.slice(0, RECEIPT_LINES);
  const rest = changes.length - shown.length;
  return (
    <View style={[styles.card, { borderColor: t.colors.border, backgroundColor: t.colors.surface, borderRadius: t.radii.card }]}>
      <PressableScale
        haptic="selection"
        scaleTo={0.99}
        onPress={() => live.openSheet({ kind: 'card', id: model.id })}
        accessibilityRole="button"
        accessibilityLabel={tr('live.receipt.openA11y', { title: model.title, n: mark.n })}
        style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, padding: t.spacing.l, paddingBottom: shown.length ? t.spacing.s : t.spacing.l }}
      >
        <ListTile t={t} size={36} type={model.type} />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, flexWrap: 'wrap' }}>
          <HText variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
            {model.title}
          </HText>
          <VersionChip n={mark.n} t={t} small />
        </View>
        <HText variant="callout" weight="600" color="accent">
          {tr('live.receipt.open')}
        </HText>
        <Icon name="chevronRight" size={16} color={t.colors.accent} />
      </PressableScale>
      {mark.unchanged || !changes.length ? (
        <HText variant="caption" color="muted" style={{ paddingHorizontal: t.spacing.l, paddingBottom: t.spacing.m }}>
          {tr(mark.unchanged ? (mark.failed ? 'live.receipt.failed' : 'live.receipt.unchanged') : `live.receipt.card.${cardLevelChange(model.card.versions[mark.n - 1]?.ops ?? []) ?? 'other'}`)}
        </HText>
      ) : (
        <View style={{ paddingHorizontal: t.spacing.l, paddingBottom: t.spacing.s }}>
          {shown.map((c) => (
            <ChangeLine key={`${c.kind}:${c.id}`} t={t} c={c} type={model.type} days={after.days ?? model.view.state.days} />
          ))}
          {rest > 0 ? (
            <HText variant="caption" color="muted" style={{ paddingTop: 4 }}>
              {tr('live.receipt.more', { count: rest })}
            </HText>
          ) : null}
        </View>
      )}
      <SyncLine t={t} model={model} />
    </View>
  );
}

const KIND_ORDER: Record<ItemChange['kind'], number> = { added: 0, removed: 1, changed: 2, checked: 3, unchecked: 4 };
/** Receipt / history order: added, removed, changed, ticks (stable within a kind). */
export function sortChanges(changes: ItemChange[]): ItemChange[] {
  return changes.map((c, i) => ({ c, i })).sort((a, b) => KIND_ORDER[a.c.kind] - KIND_ORDER[b.c.kind] || a.i - b.i).map((x) => x.c);
}

/** The line's right side in the card type's terms: "before → after" (before struck), a value, or a flag word. */
type LineDetail = { before?: string; after?: string; flag?: string; a11y?: string; mono?: boolean };

function useLineDetail(c: ItemChange, type: LiveCardType, days: readonly LiveDay[] | undefined): LineDetail | null {
  const tr = useT();
  const { locale, lang } = useLocale();
  if (type === 'trip') {
    const clock = (s: string) => {
      const m = toMinutes(s);
      return m === undefined ? s : formatClock(m, locale, lang);
    };
    const d = tripChangeDetail(c, days ?? [], clock);
    const a11y =
      d.shift === 'day'
        ? `${tr('live.trip.shiftA11y.day', { from: d.before ?? '' })}, ${d.after ?? ''}`
        : d.shift
          ? tr(`live.trip.shiftA11y.${d.shift}`, { from: d.before ?? '', to: d.after ?? '' })
          : undefined;
    return { ...d, ...(a11y ? { a11y } : {}), mono: true };
  }
  if (type === 'products') {
    const d = watchChangeDetail(c, (n, cur) => formatPrice(n, cur, numLang(lang)));
    if (d.flag === 'hidden' || d.flag === 'shown') return { flag: tr(d.flag === 'hidden' ? 'live.watch.hiddenLine' : 'live.watch.shownLine') };
    if (d.flag === 'target') return { before: d.before, after: d.after ? tr('live.watch.target', { price: d.after }) : '', a11y: `${tr('live.watch.targetLine')}: ${d.before || '–'} → ${d.after || '–'}` };
    const a11y = c.kind === 'changed' && d.before !== undefined && c.fields?.price ? tr('live.watch.priceA11y', { from: d.before || '–', to: d.after || '–' }) : undefined;
    return { ...d, ...(a11y ? { a11y } : {}) };
  }
  return null;
}

/**
 * One diff line, per card type: + Grillkohle · 1 Sack / − Tomaten (struck) / ~ Senf  mittelscharf → süß;
 * trip ~ Vatikanische Museen  15:00 → 11:00, + Pantheon  So 15. 10:00; watchlist ~ WH-1000XM5  269 € → 239 €.
 * Also used by the history.
 */
export function ChangeLine({ t, c, tinted, type = 'checklist', days }: { t: Theme; c: ItemChange; tinted?: boolean; type?: LiveCardType; days?: readonly LiveDay[] }) {
  const tr = useT();
  const detail = useLineDetail(c, type, days);
  const item = { ...c.item, checked: !!c.item.checked } as CItem;
  const qty = type === 'checklist' ? formatQty(item) : '';
  const sign = c.kind === 'added' ? '+' : c.kind === 'removed' ? '−' : c.kind === 'changed' ? '~' : '✓';
  const signColor = c.kind === 'added' ? t.colors.success : c.kind === 'removed' ? t.colors.danger : c.kind === 'changed' ? t.colors.accent : t.colors.muted;
  const bg = !tinted ? 'transparent' : c.kind === 'added' ? t.colors.successSoft : c.kind === 'removed' ? t.colors.dangerSoft : 'transparent';
  const struck = c.kind === 'removed' ? { textDecorationLine: 'line-through' as const, color: t.colors.danger } : null;
  const fieldChange: [string, string] | null = detail
    ? c.kind === 'changed' && detail.before !== undefined && detail.after !== undefined
      ? [detail.before, detail.after]
      : null
    : c.kind === 'changed'
      ? firstFieldChange(c)
      : null;
  const value = detail ? (fieldChange ? '' : (detail.flag ?? detail.after ?? '')) : qty;
  const kindWord = c.kind === 'checked' && type !== 'checklist' ? tr(type === 'trip' ? 'live.trip.checked' : 'live.watch.checked') : tr(`live.receipt.${c.kind}`);
  const name = type === 'checklist' ? itemLabel(item) : c.text;
  const label = detail?.a11y
    ? `${name}, ${detail.a11y}`
    : `${name}, ${kindWord}${fieldChange ? `: ${fieldChange[0] || '–'} → ${fieldChange[1] || '–'}` : value && type !== 'checklist' ? `, ${value}` : ''}`;
  const mono = detail?.mono ? { fontFamily: t.typography.mono.fontFamily } : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, minHeight: 34, paddingHorizontal: tinted ? t.spacing.m : 0, backgroundColor: bg }} accessible accessibilityLabel={label}>
      <HText variant="bodyStrong" style={{ width: 14, textAlign: 'center', color: signColor }} aria-hidden>
        {sign}
      </HText>
      <HText variant="body" style={[{ flex: 1 }, struck, c.kind === 'unchecked' ? { color: t.colors.muted } : null]} numberOfLines={1}>
        {c.text}
      </HText>
      {fieldChange ? (
        <HText variant="callout" color="muted" numberOfLines={1} tabular style={mono}>
          {fieldChange[0] ? (
            <HText variant="callout" color="subtle" tabular style={[{ textDecorationLine: 'line-through' }, mono]}>
              {fieldChange[0]}
            </HText>
          ) : null}
          {fieldChange[0] ? ' → ' : ''}
          {fieldChange[1]}
        </HText>
      ) : value ? (
        <HText variant="callout" color="muted" tabular numberOfLines={1} style={detail?.flag ? null : mono}>
          {value}
        </HText>
      ) : null}
    </View>
  );
}

/** Checklists: the first changed field as "before → after" (quantity with its unit). */
function firstFieldChange(c: ItemChange): [string, string] | null {
  const f = c.fields;
  if (!f) return null;
  if (f.qty || f.unit) {
    const before = { qty: f.qty ? f.qty[0] : c.item.qty, unit: f.unit ? f.unit[0] : c.item.unit } as CItem;
    return [formatQty(before), formatQty(c.item as CItem)];
  }
  for (const k of ['note', 'text', 'category'] as const) {
    const v = f[k];
    if (v) return [String(v[0] ?? ''), String(v[1] ?? '')];
  }
  return null;
}

function SyncLine({ t, model }: { t: Theme; model: LiveCardModel }) {
  const tr = useT();
  const demo = !!useLive()?.demo;
  const n = model.pendingCount;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border, paddingHorizontal: t.spacing.l, paddingVertical: t.spacing.m }}>
      <Icon name={n ? 'cloud' : 'cloudCheck'} size={18} color={n ? t.colors.info : t.colors.success} />
      <HText variant="caption" color="muted" style={{ flex: 1 }} accessibilityLiveRegion="polite">
        {n ? tr('live.sync.pending', { count: n }) : tr(demo ? 'live.sync.demo' : 'live.sync.synced')}
      </HText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
