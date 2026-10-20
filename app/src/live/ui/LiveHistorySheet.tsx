/**
 * Version history of a live card (mockup 04), read from the chat itself: newest first, who (Hermes monogram / a
 * device glyph for your own edits), when, compact counts and, for Hermes, the first sentence of its answer. Tapping
 * a version shows its diff against the version before. Pending edits of this device are on top as "wartet".
 * "Auf vN zurück" turns the card back into the selected version with ordinary edits (live/LiveProvider `revert`).
 */
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { HText, PressableScale } from '../../ui/primitives/basics';
import { Button } from '../../ui/primitives/Button';
import { SheetGrabber, SheetModal } from '../../ui/primitives/Sheet';
import { Icon } from '../../chat/icons';
import { useTheme, type Theme } from '../../ui/theme';
import { useLive } from '../LiveProvider';
import type { LiveCardModel } from '../derive.ts';
import { countChanges, diffStates, stateAt, type ChangeCounts, type ItemChange, type LiveCardType, type LiveDay, type LiveVersion } from '../model.ts';
import { ChangeLine, sortChanges } from './LiveNode';
import { useTimeLabel } from './parts';

export function LiveHistorySheet() {
  const live = useLive();
  const tr = useT();
  const sheet = live?.sheet;
  const model = sheet?.kind === 'history' ? live?.byId.get(sheet.id) : undefined;
  const back = () => live?.openSheet(model ? { kind: 'card', id: model.id } : null);
  return (
    <SheetModal visible={!!model} onClose={back} closeLabel={tr('actions.close')} label={tr('live.history.title')} maxHeight="88%">
      <SheetGrabber />
      {model ? <History model={model} initial={sheet?.kind === 'history' ? sheet.n : undefined} onDone={back} /> : null}
    </SheetModal>
  );
}

type Entry = { key: string; n: number; who: 'hermes' | 'user'; at: number; mine: boolean; waiting: boolean; changes: ItemChange[]; counts: ChangeCounts; excerpt?: string; created?: number };

function History({ model, initial, onDone }: { model: LiveCardModel; initial?: number; onDone: () => void }) {
  const t = useTheme();
  const tr = useT();
  const time = useTimeLabel();
  const live = useLive()!;
  const versions = model.card.versions;
  const entries: Entry[] = versions.map((v) => entryOf(model, v, live.ownBids)).reverse();
  if (model.pendingCount) {
    const changes = sortChanges(diffStates(model.head.state, model.view.state));
    entries.unshift({ key: 'pending', n: model.head.n + 1, who: 'user', at: Date.now(), mine: true, waiting: true, changes, counts: countChanges(changes) });
  }
  const [open, setOpen] = useState<number | undefined>(initial ?? versions[versions.length - 1]?.n);
  useEffect(() => setOpen(initial ?? versions[versions.length - 1]?.n), [initial, versions]);
  // "Auf vN zurück": any older version (with edits waiting, also the head itself); nothing is rewritten, the way back
  // is a batch of ordinary edits that goes with the next message
  const canRevert = open !== undefined && !model.closed && open < model.head.n + (model.pendingCount ? 1 : 0);
  return (
    <View style={{ flexShrink: 1 }}>
      <View style={{ paddingHorizontal: t.spacing.xl, paddingBottom: t.spacing.m, gap: 4 }}>
        <HText variant="title" accessibilityRole="header">
          {tr('live.history.title')}
        </HText>
        <HText variant="callout" color="muted">
          {tr('live.history.subtitle', { title: model.title, count: versions.length })}
        </HText>
      </View>
      <ScrollView style={{ flexShrink: 1 }}>
        {entries.map((e, i) => (
          <Row key={e.key} t={t} e={e} last={i === entries.length - 1} expanded={open === e.n} onToggle={() => setOpen((cur) => (cur === e.n ? undefined : e.n))} time={time} type={model.type} days={model.view.state.days} />
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: t.spacing.s, paddingHorizontal: t.spacing.xl, paddingTop: t.spacing.m }}>
        {canRevert ? (
          <View style={{ flex: 1 }}>
            <Button
              label={tr('live.history.revert', { n: open })}
              accessibilityHint={tr('live.history.revertHint')}
              variant="secondary"
              icon="reset"
              onPress={() => {
                live.revert(model.id, open!);
                onDone();
              }}
            />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Button label={tr('live.history.done')} variant="primary" onPress={onDone} />
        </View>
      </View>
    </View>
  );
}

function entryOf(model: LiveCardModel, v: LiveVersion, ownBids: ReadonlySet<string>): Entry {
  const changes = v.n === 1 ? [] : sortChanges(diffStates(stateAt(model.card, v.n - 1), v.state));
  const mine = v.author === 'user' && !!v.bid && ownBids.has(v.bid);
  return { key: v.key, n: v.n, who: v.author, at: v.at, mine, waiting: false, changes, counts: countChanges(changes), excerpt: v.excerpt, ...(v.n === 1 ? { created: v.state.items.length } : {}) };
}

function Row({ t, e, last, expanded, onToggle, time, type, days }: { t: Theme; e: Entry; last: boolean; expanded: boolean; onToggle: () => void; time: (at: number) => string; type: LiveCardType; days?: readonly LiveDay[] }) {
  const tr = useT();
  const who = tr(e.who === 'hermes' ? 'live.who.hermes' : 'live.who.you');
  const Who = who.charAt(0).toUpperCase() + who.slice(1);
  const summary = e.created !== undefined ? tr('live.history.created', { count: e.created }) : summaryText(e, tr);
  return (
    <View style={{ backgroundColor: expanded ? t.colors.accentSoft : 'transparent', borderLeftWidth: 3, borderLeftColor: expanded ? t.colors.accent : 'transparent' }}>
      <PressableScale
        haptic="selection"
        scaleTo={0.995}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={tr('live.history.rowA11y', { n: e.n, who, time: e.waiting ? tr('live.history.waiting') : time(e.at), summary })}
        style={{ flexDirection: 'row', gap: t.spacing.m, paddingLeft: t.spacing.xl - 3, paddingRight: t.spacing.xl, paddingTop: t.spacing.m }}
      >
        <View style={{ alignItems: 'center' }}>
          <Avatar t={t} who={e.who} mine={e.mine} />
          {!last ? <View style={{ flex: 1, width: 2, marginTop: 4, backgroundColor: t.colors.border }} /> : null}
        </View>
        <View style={{ flex: 1, gap: 2, paddingBottom: t.spacing.m }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.spacing.s }}>
            <HText variant="bodyStrong" style={{ flex: 1 }}>
              {tr('live.history.head', { n: e.n, who: Who })}
            </HText>
            <HText variant="caption" color="muted" tabular>
              {e.waiting ? tr('live.history.waiting') : time(e.at)}
            </HText>
          </View>
          <Counts t={t} e={e} summary={summary} />
          {expanded && e.changes.length ? (
            <View style={{ marginTop: t.spacing.s, borderRadius: t.radii.control, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border, backgroundColor: t.colors.surface }}>
              {e.changes.map((c) => (
                <ChangeLine key={`${c.kind}:${c.id}`} t={t} c={c} tinted type={type} days={days} />
              ))}
            </View>
          ) : null}
        </View>
      </PressableScale>
    </View>
  );
}

function summaryText(e: Entry, tr: ReturnType<typeof useT>): string {
  const c = e.counts;
  const parts: string[] = [];
  if (c.added) parts.push(`+${c.added}`);
  if (c.removed) parts.push(`−${c.removed}`);
  if (c.changed) parts.push(`~${c.changed}`);
  if (c.checked) parts.push(`✓${c.checked}`);
  if (c.unchecked) parts.push(`○${c.unchecked}`);
  if (!parts.length) parts.push(tr('live.history.unchanged'));
  return [parts.join(' '), e.excerpt ? `„${e.excerpt}“` : ''].filter(Boolean).join(' · ');
}

function Counts({ t, e, summary }: { t: Theme; e: Entry; summary: string }) {
  const tr = useT();
  if (e.created !== undefined) {
    return (
      <HText variant="callout" color="muted">
        {summary}
      </HText>
    );
  }
  const c = e.counts;
  const device = e.who === 'user' ? tr(e.mine ? 'live.history.thisDevice' : 'live.history.otherDevice') : '';
  const names = e.who === 'user' ? e.changes.slice(0, 3).map((ch) => ch.text).join(', ') : '';
  const quote = e.who === 'hermes' && e.excerpt ? `„${e.excerpt}“` : '';
  return (
    <HText variant="callout" color="muted" numberOfLines={2}>
      {device ? `${device} · ` : ''}
      {c.added ? <HText variant="callout" weight="700" style={{ color: t.colors.success }}>{`+${c.added} `}</HText> : null}
      {c.removed ? <HText variant="callout" weight="700" style={{ color: t.colors.danger }}>{`−${c.removed} `}</HText> : null}
      {c.changed ? <HText variant="callout" weight="700" style={{ color: t.colors.accentText }}>{`~${c.changed} `}</HText> : null}
      {c.checked ? <HText variant="callout" weight="700" color="muted">{`✓${c.checked} `}</HText> : null}
      {c.unchecked ? <HText variant="callout" weight="700" color="muted">{`○${c.unchecked} `}</HText> : null}
      {names || quote}
    </HText>
  );
}

function Avatar({ t, who, mine }: { t: Theme; who: 'hermes' | 'user'; mine: boolean }) {
  if (who === 'hermes') {
    return (
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.colors.ink, alignItems: 'center', justifyContent: 'center' }} aria-hidden>
        <HText style={{ color: t.colors.onInk, fontFamily: t.typography.hero.fontFamily, fontSize: 18, lineHeight: 22 }}>H</HText>
      </View>
    );
  }
  return (
    <View style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: t.colors.borderStrong, alignItems: 'center', justifyContent: 'center' }} aria-hidden>
      <Icon name={!mine ? 'edit' : Platform.OS === 'web' ? 'laptop' : 'phone'} size={16} color={t.colors.muted} />
    </View>
  );
}
