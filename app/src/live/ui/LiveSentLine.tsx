/**
 * Quiet lines under a user bubble that carried live-card edits (mockup 01). The raw `[hui:live]` trailer is never shown.
 * First line: what went along, by name ("An „Einkauf Samstag“: Milch abgehakt, Brot hinzugefügt"). Second line: how
 * far it got (live/receipts.ts): "Hermes antwortet …", "Gespeichert in v4", "Hermes hat danach anders entschieden: Brot
 * entfernt" with "Meine Änderung wiederherstellen", "Nicht bestätigt, die Antwort brach ab …", or what was not applied
 * because its item was gone.
 */
import { View } from 'react-native';
import { useT } from '../../i18n';
import { HText, PressableScale } from '../../ui/primitives/basics';
import { Icon } from '../../chat/icons';
import { useTheme, type Theme } from '../../ui/theme';
import type { LiveBatches } from '../trailer.ts';
import { useLive } from '../LiveProvider';
import type { BatchOutcome } from '../receipts.ts';
import { SyncIcon, usePhrases, type SyncTone } from './LiveSync';

export function LiveSentLine({ batches, messageId }: { batches: LiveBatches; messageId?: string }) {
  const t = useTheme();
  const tr = useT();
  const live = useLive();
  const phrases = usePhrases();
  const outcomes = new Map((messageId && live ? live.outcomesOf(messageId) : []).map((o) => [o.card, o]));
  const rows = Object.entries(batches).map(([id, b]) => {
    const title = live?.byId.get(id)?.title ?? b.state?.title ?? id;
    const o = outcomes.get(id);
    const ops = b.ops ?? [];
    // a list made a live card here / the whole card again after Hermes may have lost it (design §9.3)
    let what: string;
    if (b.create) what = tr('live.sent.created', { title });
    else if (b.state) what = tr('live.sent.state', { title });
    else if (o?.changes.length) what = tr('live.sent.line', { title, items: phrases.list(o.changes.map(phrases.change)) });
    else if (!ops.length) what = tr('live.sent.ask', { title });
    else what = tr(ops.every((op) => 'check' in op) ? 'live.sent.ticks' : 'live.sent.changes', { count: ops.length, title });
    return { id, what, o };
  });
  return (
    <View style={{ alignSelf: 'flex-end', gap: 2, paddingTop: 4, paddingRight: 4, maxWidth: '100%' }}>
      {rows.map((r) => (
        <View key={r.id} style={{ alignItems: 'flex-end', gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="check" size={14} color={t.colors.muted} />
            <HText variant="caption" color="muted" numberOfLines={2} style={{ flexShrink: 1 }}>
              {r.what}
            </HText>
          </View>
          {r.o ? <Outcome t={t} o={r.o} /> : null}
        </View>
      ))}
    </View>
  );
}

function Outcome({ t, o }: { t: Theme; o: BatchOutcome }) {
  const tr = useT();
  const live = useLive();
  const phrases = usePhrases();
  const model = live?.byId.get(o.card);
  const lines: { text: string; tone: SyncTone }[] = [];
  let restore: { label: string } | null = null;
  if (o.state === 'waiting') lines.push({ text: tr('live.sent.waiting'), tone: 'waiting' });
  else if (o.state === 'resent') lines.push({ text: tr(model?.resend ? 'live.sent.resentPending' : 'live.sent.resent'), tone: model?.resend ? 'warning' : 'synced' });
  else if (o.state === 'changed') {
    const items = phrases.list(o.undone.map(phrases.undone));
    lines.push({ text: tr('live.sync.undone', { items }), tone: 'warning' });
    // only while that answer is still the card's newest version and nothing else waits
    if (model && model.undone?.answerN === o.answerN && !model.pendingCount && !model.closed) restore = { label: tr('live.sync.restoreA11y', { items }) };
  } else if (o.state === 'saved' && o.n) lines.push({ text: tr('live.sent.saved', { n: o.n }), tone: 'synced' });
  else if (o.state === 'nothing' && !o.missed.length) lines.push({ text: tr('live.sent.nothing'), tone: 'synced' });
  if (o.missed.length) lines.push({ text: tr('live.receipt.missed', { items: phrases.list(o.missed) }), tone: 'warning' });
  if (!lines.length) return null;
  return (
    <View style={{ alignItems: 'flex-end', gap: 2 }} accessibilityLiveRegion="polite">
      {lines.map((l) => (
        <View key={l.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <SyncIcon t={t} tone={l.tone} size={14} />
          <HText variant="caption" color={l.tone === 'warning' ? 'warning' : 'muted'} numberOfLines={3} style={{ flexShrink: 1 }}>
            {l.text}
          </HText>
        </View>
      ))}
      {restore && live ? (
        <PressableScale
          haptic="selection"
          onPress={() => live.restore(o.card, o.restore)}
          accessibilityRole="button"
          accessibilityLabel={restore.label}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }}
        >
          <Icon name="retry" size={14} color={t.colors.accent} />
          <HText variant="caption" weight="600" color="accent">
            {tr('live.sync.restore')}
          </HText>
        </PressableScale>
      ) : null}
    </View>
  );
}
