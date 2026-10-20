/**
 * The open live trip (mockup 05): day chips (with a brass count of the blocks Hermes changed since you last looked)
 * and a map chip, the selected day's blocks in time order: mono time column (the old time struck below when Hermes
 * moved the block), title, note / place, "vorgezogen" / "später" / "getauscht" tags and the brass outline of a block
 * Hermes changed, your own note in blue ("von dir: Tisch für 2"). Tick circle = done; tap or long-press a block to
 * edit your note, move it to another day or delete it; "+ Termin" adds one. Every edit is an op (pending until the
 * next message). The map tab renders the card's map with the app's map node.
 */
import { useMemo, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useLocale, useT } from '../../i18n';
import { HText, PressableScale, textStyle } from '../../ui/primitives/basics';
import { Button } from '../../ui/primitives/Button';
import { TextInput } from '../../ui/primitives/Text';
import { Icon } from '../../chat/icons';
import { haptic } from '../../ui/primitives/haptics';
import { noOutline } from '../../ui/lib/webStyle';
import type { Theme } from '../../ui/theme';
import { CheckCircle } from '../../ui/components/modules/Checklist';
import { MapNode } from '../../ui/components/modules/MapNode';
import { formatClock, kindPaletteIndex, localIsoDate, toMinutes } from '../../ui/components/modules/c2/agendaModel.ts';
import type { HuiAgendaKind, HuiMap } from '../../protocol/types';
import type { LiveCardModel } from '../derive.ts';
import { stateAt, type LiveDay, type LiveItem, type LiveOp } from '../model.ts';
import { newUserItemId } from '../pending.ts';
import { dayBlocks, dayLabel, freshPerDay, initialDay, parseTimeInput, tripDays, tripShifts, type TripShift } from '../trip.ts';
import { RemovedLine, Tag } from './parts';

const MAP = '__map';
const TIME_W = 58;

function useClock(): (hhmm: string | undefined) => string {
  const { locale, lang } = useLocale();
  return (s) => {
    const m = toMinutes(s);
    return m === undefined ? (s ?? '') : formatClock(m, locale, lang);
  };
}

export function LiveTripBody({ model, t, onEdit }: { model: LiveCardModel; t: Theme; onEdit: (op: LiveOp) => void }) {
  const tr = useT();
  const state = model.view.state;
  const days = tripDays(state);
  const hasMap = !!state.map?.markers.length;
  const [pick, setPick] = useState<string | undefined>(() => initialDay(state, model.fresh, localIsoDate(new Date())));
  const selected = pick === MAP && hasMap ? MAP : days.some((d) => d.id === pick) ? pick! : days[0]?.id;
  // what you last looked at: the old times of the blocks Hermes moved since then
  const seen = useMemo(() => stateAt(model.card, model.since), [model.card, model.since]);
  const shifts = useMemo(() => tripShifts(seen, state, model.fresh), [seen, state, model.fresh]);
  const perDay = freshPerDay(state, model.fresh, days);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const interactive = !model.closed;
  const blocks = selected && selected !== MAP ? dayBlocks(state, selected, days) : [];

  return (
    <View>
      <DayChips t={t} days={days} selected={selected} perDay={perDay} hasMap={hasMap} onSelect={(id) => { setPick(id); setEditing(null); }} />
      {selected === MAP && state.map ? (
        <View style={{ paddingHorizontal: t.spacing.l, paddingTop: t.spacing.s }}>
          <MapNode node={{ type: 'map', id: `${model.id}-map`, ...(state.map.title ? { title: state.map.title } : {}), markers: state.map.markers, ...(state.map.route ? { route: true } : {}) } as Partial<HuiMap>} />
        </View>
      ) : (
        <View style={{ paddingHorizontal: t.spacing.l, paddingTop: t.spacing.s, gap: t.spacing.s }}>
          {blocks.map((b) =>
            editing === b.id ? (
              <BlockEditor key={b.id} t={t} item={b} days={days} onEdit={onEdit} onDone={() => setEditing(null)} />
            ) : (
              <BlockRow
                key={b.id}
                t={t}
                item={b}
                days={days}
                fresh={model.fresh.has(b.id) && !b.checked}
                shift={b.checked ? undefined : shifts.get(b.id)}
                mine={model.view.ownAdded.has(b.id)}
                interactive={interactive}
                onToggle={() => {
                  haptic(b.checked ? 'selection' : 'light');
                  onEdit(b.checked ? { uncheck: b.id } : { check: b.id });
                }}
                onOpen={interactive ? () => setEditing(b.id) : undefined}
              />
            ),
          )}
          {!blocks.length ? (
            <HText variant="callout" color="muted" style={{ paddingVertical: t.spacing.s }}>
              {tr('live.trip.empty')}
            </HText>
          ) : null}
        </View>
      )}
      {model.removed.length && model.removedIn && interactive ? <RemovedLine t={t} n={model.removedIn} items={model.removed} onRestore={() => model.removed.forEach((it) => onEdit({ add: { ...it } }))} /> : null}
      {interactive && selected !== MAP ? (
        <View style={{ paddingHorizontal: t.spacing.l, paddingTop: t.spacing.m }}>
          {adding ? (
            <AddBlock t={t} days={days} day={selected} onAdd={(op) => { onEdit(op); setAdding(false); if (op.to) setPick(op.to); }} onCancel={() => setAdding(false)} />
          ) : (
            <Button label={tr('live.trip.add')} accessibilityLabel={tr('live.trip.addA11y')} icon="plus" variant="secondary" size="small" onPress={() => setAdding(true)} style={{ alignSelf: 'flex-start' }} />
          )}
        </View>
      ) : null}
    </View>
  );
}

function DayChips({ t, days, selected, perDay, hasMap, onSelect }: { t: Theme; days: readonly LiveDay[]; selected: string | undefined; perDay: Map<string, number>; hasMap: boolean; onSelect: (id: string) => void }) {
  const tr = useT();
  const chips = [...days.map((d) => ({ id: d.id, label: d.label || d.id, count: perDay.get(d.id) ?? 0 })), ...(hasMap ? [{ id: MAP, label: tr('live.trip.map'), count: 0 }] : [])];
  if (chips.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: t.spacing.l, gap: t.spacing.s }}>
      <View accessibilityRole="tablist" accessibilityLabel={tr('live.trip.days')} style={{ flexDirection: 'row', gap: t.spacing.s }}>
        {chips.map((c) => {
          const on = c.id === selected;
          return (
            <PressableScale
              key={c.id}
              haptic="selection"
              scaleTo={0.97}
              onPress={() => onSelect(c.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={c.id === MAP ? c.label : tr('live.trip.dayA11y', { day: c.label, count: c.count })}
              style={{ minHeight: 44, minWidth: 56, paddingHorizontal: t.spacing.l, borderRadius: t.radii.control + 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: on ? t.colors.ink : t.colors.surfaceAlt }}
            >
              <HText variant="callout" weight={on ? '700' : '600'} style={{ color: on ? t.colors.onInk : t.colors.muted }} numberOfLines={1}>
                {c.label}
              </HText>
              {c.count ? (
                <View style={{ minWidth: 20, paddingHorizontal: 5, borderRadius: t.radii.inline, backgroundColor: t.colors.accentSoft, alignItems: 'center' }} aria-hidden>
                  <HText variant="caption" weight="700" style={{ color: t.colors.accentText, fontFamily: t.typography.mono.fontFamily }}>
                    {String(c.count)}
                  </HText>
                </View>
              ) : null}
            </PressableScale>
          );
        })}
      </View>
    </ScrollView>
  );
}

function BlockRow({
  t,
  item,
  days,
  fresh,
  shift,
  mine,
  interactive,
  onToggle,
  onOpen,
}: {
  t: Theme;
  item: LiveItem;
  days: readonly LiveDay[];
  fresh: boolean;
  shift?: TripShift;
  mine: boolean;
  interactive: boolean;
  onToggle: () => void;
  onOpen?: () => void;
}) {
  const tr = useT();
  const clock = useClock();
  const time = clock(item.start);
  const kindColor = t.colors.chart[kindPaletteIndex(item.kind as HuiAgendaKind | undefined, t.colors.chart.length)] ?? t.colors.accent;
  const sub = [item.note, item.location].filter(Boolean).join(' · ');
  const tag = shift ? tr(`live.trip.tag.${shift.kind}`, { day: dayLabel(days, shift.fromDay) }) : mine ? tr('live.card.tagMine') : '';
  const shiftA11y = !shift
    ? ''
    : shift.kind === 'day'
      ? tr('live.trip.shiftA11y.day', { from: [dayLabel(days, shift.fromDay), shift.from ? clock(shift.from) : ''].filter(Boolean).join(' ') })
      : tr(`live.trip.shiftA11y.${shift.kind}`, { from: clock(shift.from), to: time });
  const label = [
    tr('live.trip.blockA11y', { time, title: item.text }),
    shiftA11y || (fresh ? tr('live.trip.changedA11y') : mine ? tr('live.card.tagMine') : ''),
    sub,
    item.userNote ? tr('live.trip.userNote', { note: item.userNote }) : '',
  ]
    .filter(Boolean)
    .join(', ');
  const done = !!item.checked;
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.m }}>
      <View style={{ width: TIME_W, paddingTop: 14 }} aria-hidden>
        <HText variant="callout" color={done ? 'subtle' : 'muted'} style={{ fontFamily: t.typography.mono.fontFamily }}>
          {time}
        </HText>
        {shift?.from && shift.kind !== 'day' ? (
          <HText variant="caption" color="subtle" style={{ fontFamily: t.typography.mono.fontFamily, textDecorationLine: 'line-through' }}>
            {clock(shift.from)}
          </HText>
        ) : null}
      </View>
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 56,
          borderRadius: t.radii.card,
          borderLeftWidth: 3,
          borderLeftColor: kindColor,
          borderWidth: fresh ? 1.5 : 0,
          borderColor: fresh ? t.colors.accent : 'transparent',
          backgroundColor: fresh ? t.colors.accentSoft : t.colors.surfaceAlt,
          overflow: 'hidden',
        }}
      >
        <PressableScale
          haptic="selection"
          scaleTo={onOpen ? 0.99 : 1}
          onPress={onOpen}
          onLongPress={onOpen}
          delayLongPress={450}
          disabled={!onOpen}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={onOpen ? tr('live.card.itemHint') : undefined}
          accessibilityActions={onOpen ? [{ name: 'activate' }, { name: 'longpress', label: tr('live.card.edit') }] : undefined}
          onAccessibilityAction={() => onOpen?.()}
          style={{ flex: 1, paddingLeft: t.spacing.m, paddingRight: t.spacing.s, paddingVertical: t.spacing.m, gap: 2 }}
          pressedStyle={onOpen ? { backgroundColor: t.colors.surfacePressed } : undefined}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, rowGap: 2 }}>
            <HText variant="bodyStrong" style={done ? { color: t.colors.subtle, textDecorationLine: 'line-through' } : undefined}>
              {item.text}
            </HText>
            {tag ? <Tag label={tag} tone={shift ? 'accent' : 'info'} t={t} /> : null}
          </View>
          {sub ? (
            <HText variant="callout" color="muted" numberOfLines={2}>
              {sub}
            </HText>
          ) : null}
          {item.userNote ? (
            <HText variant="callout" color="info" numberOfLines={2}>
              {tr('live.trip.userNote', { note: item.userNote })}
            </HText>
          ) : null}
        </PressableScale>
        <PressableScale
          haptic={false}
          onPress={interactive ? onToggle : undefined}
          disabled={!interactive}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done, disabled: !interactive }}
          accessibilityLabel={item.text}
          style={{ width: 48, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }}
        >
          <CheckCircle t={t} on={done} />
        </PressableScale>
      </View>
    </View>
  );
}

const inputStyle = (t: Theme) => [textStyle(t, 'callout'), { color: t.colors.text, paddingVertical: 10, ...(Platform.OS === 'web' ? noOutline : {}) } as object];

function Field({ t, label, value, onChange, placeholder, autoFocus, width, mono, onSubmit }: { t: Theme; label: string; value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; width?: number; mono?: boolean; onSubmit?: () => void }) {
  return (
    <View style={{ gap: 4, ...(width ? { width } : { flex: 1 }) }}>
      <HText variant="micro" weight="600" color="muted" style={{ letterSpacing: 1.1, textTransform: 'uppercase' }} aria-hidden>
        {label}
      </HText>
      <View style={{ minHeight: 44, borderRadius: t.radii.control, borderWidth: 1, borderColor: t.colors.borderControl, backgroundColor: t.colors.surfaceAlt, paddingHorizontal: t.spacing.m, justifyContent: 'center' }}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={t.colors.subtle}
          autoFocus={autoFocus}
          accessibilityLabel={label}
          returnKeyType="done"
          onSubmitEditing={onSubmit}
          maxLength={160}
          style={[...inputStyle(t), mono ? { fontFamily: t.typography.mono.fontFamily } : null]}
        />
      </View>
    </View>
  );
}

function DayPicker({ t, days, value, onPick, exclude }: { t: Theme; days: readonly LiveDay[]; value?: string; onPick: (id: string) => void; exclude?: string }) {
  const tr = useT();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.s }} accessibilityRole="radiogroup">
      {days
        .filter((d) => d.id !== exclude)
        .map((d) => {
          const on = d.id === value;
          return (
            <PressableScale
              key={d.id}
              haptic="selection"
              onPress={() => onPick(d.id)}
              accessibilityRole={exclude ? 'button' : 'radio'}
              accessibilityState={exclude ? undefined : { selected: on, checked: on }}
              accessibilityLabel={exclude ? tr('live.trip.moveA11y', { day: d.label }) : d.label}
              style={{ minHeight: 44, paddingHorizontal: t.spacing.l, borderRadius: t.radii.control, borderWidth: on ? 2 : 1, borderColor: on ? t.colors.accent : t.colors.borderControl, backgroundColor: on ? t.colors.accentSoft : 'transparent', alignItems: 'center', justifyContent: 'center' }}
            >
              <HText variant="callout" weight="600">
                {d.label}
              </HText>
            </PressableScale>
          );
        })}
    </View>
  );
}

/** Your note on a block (`userNote`, never overwritten by Hermes), move to another day, delete. */
function BlockEditor({ t, item, days, onEdit, onDone }: { t: Theme; item: LiveItem; days: readonly LiveDay[]; onEdit: (op: LiveOp) => void; onDone: () => void }) {
  const tr = useT();
  const [note, setNote] = useState(item.userNote ?? '');
  const commit = () => {
    const v = note.trim();
    if (v !== (item.userNote ?? '')) onEdit({ set: item.id, userNote: v || null });
    onDone();
  };
  return (
    <View style={{ borderRadius: t.radii.card, borderWidth: 1, borderColor: t.colors.accent, padding: t.spacing.m, gap: t.spacing.m }}>
      <HText variant="bodyStrong">{item.text}</HText>
      <Field t={t} label={tr('live.trip.noteLabel')} value={note} onChange={setNote} placeholder={tr('live.trip.notePlaceholder')} autoFocus onSubmit={commit} />
      {days.length > 1 ? (
        <View style={{ gap: 4 }}>
          <HText variant="micro" weight="600" color="muted" style={{ letterSpacing: 1.1, textTransform: 'uppercase' }}>
            {tr('live.trip.moveTo')}
          </HText>
          <DayPicker
            t={t}
            days={days}
            exclude={item.day ?? days[0]?.id}
            onPick={(id) => {
              onEdit({ move: item.id, to: id });
              onDone();
            }}
          />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: t.spacing.s }}>
        <PressableScale haptic="medium" onPress={() => { onEdit({ del: item.id }); onDone(); }} accessibilityRole="button" accessibilityLabel={tr('live.card.deleteA11y', { item: item.text })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="trash" size={18} color={t.colors.danger} />
        </PressableScale>
        <PressableScale haptic="selection" onPress={commit} accessibilityRole="button" accessibilityLabel={tr('live.card.editDone')} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.colors.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={18} color={t.colors.onInk} strokeWidth={2.2} />
        </PressableScale>
      </View>
    </View>
  );
}

/** "+ Termin": title, start, end (optional), day → one `add` with a `u-` id and `to`. */
function AddBlock({ t, days, day, onAdd, onCancel }: { t: Theme; days: readonly LiveDay[]; day?: string; onAdd: (op: Extract<LiveOp, { add: LiveItem }>) => void; onCancel: () => void }) {
  const tr = useT();
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [to, setTo] = useState(day ?? days[0]?.id);
  const [bad, setBad] = useState(false);
  const submit = () => {
    const text = title.trim();
    const s = parseTimeInput(start);
    const e = end.trim() ? parseTimeInput(end) : undefined;
    if (!text) return;
    if (!s || (end.trim() && !e)) {
      setBad(true);
      return;
    }
    haptic('light');
    onAdd({ add: { id: newUserItemId(), text: text.slice(0, 160), start: s, ...(e ? { end: e } : {}) }, ...(to ? { to } : {}) });
  };
  return (
    <View style={{ borderRadius: t.radii.card, borderWidth: 1, borderColor: t.colors.borderControl, padding: t.spacing.m, gap: t.spacing.m }}>
      <Field t={t} label={tr('live.trip.addTitle')} value={title} onChange={setTitle} placeholder={tr('live.trip.addTitlePlaceholder')} autoFocus />
      <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
        <Field t={t} label={tr('live.trip.start')} value={start} onChange={(v) => { setStart(v); setBad(false); }} placeholder={tr('live.trip.timePlaceholder')} width={110} mono />
        <Field t={t} label={tr('live.trip.end')} value={end} onChange={(v) => { setEnd(v); setBad(false); }} placeholder={tr('live.trip.timePlaceholder')} width={110} mono onSubmit={submit} />
      </View>
      {bad ? (
        <HText variant="caption" color="danger" accessibilityLiveRegion="polite" accessibilityRole="alert">
          {tr('live.trip.badTime')}
        </HText>
      ) : null}
      {days.length > 1 ? (
        <View style={{ gap: 4 }}>
          <HText variant="micro" weight="600" color="muted" style={{ letterSpacing: 1.1, textTransform: 'uppercase' }}>
            {tr('live.trip.day')}
          </HText>
          <DayPicker t={t} days={days} value={to} onPick={setTo} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
        <Button label={tr('live.trip.cancel')} variant="secondary" size="small" grow onPress={onCancel} />
        <Button label={tr('live.trip.addDone')} variant="primary" size="small" grow disabled={!title.trim() || !start.trim()} onPress={submit} />
      </View>
    </View>
  );
}
