/**
 * Where a live card's edits are, in one honest line (open card footer, receipts): conflicts aside, in this order
 * - waiting on this device ("2 Änderungen noch nicht bei Hermes …", offline variant);
 * - sent again because their turn broke off ("nicht bestätigt, geht noch einmal mit");
 * - sent with a message whose answer still runs ("Mitgeschickt. Hermes antwortet …");
 * - Hermes' answer did some of the user's edits differently ("Hermes hat danach anders entschieden: Brot entfernt"),
 *   with "Meine Änderung wiederherstellen" (the user's version as new edits, sent with the next message);
 * - saved: "v7 gespeichert · auf allen Geräten über Hermes".
 * Plus the phrases that name items ("Milch abgehakt", "Brot entfernt") for the "mitgeschickt" line and the tray.
 */
import { View } from 'react-native';
import { useT } from '../../i18n';
import { HText, PressableScale } from '../../ui/primitives/basics';
import { Icon } from '../../chat/icons';
import type { Theme } from '../../ui/theme';
import { useLive } from '../LiveProvider';
import type { LiveCardModel } from '../derive.ts';
import type { ItemChange, LiveOp } from '../model.ts';
import type { UndoneChange } from '../receipts.ts';

/** At most this many items are named in one line, the rest counted ("und 2 weitere Änderungen"). */
export const NAMED_ITEMS = 3;

export function usePhrases() {
  const tr = useT();
  const change = (c: ItemChange) => tr('live.sent.item', { item: c.text, what: tr(`live.receipt.${c.kind}`) });
  const undone = (u: UndoneChange) => tr(`live.undone.${u.kind}`, { item: u.text });
  const list = (parts: readonly string[], max = NAMED_ITEMS) => {
    const shown = parts.slice(0, max).join(', ');
    return parts.length > max ? `${shown} ${tr('live.receipt.more', { count: parts.length - max })}` : shown;
  };
  return { change, undone, list };
}

export type SyncTone = 'synced' | 'waiting' | 'warning';

export interface CardSync {
  text: string;
  tone: SyncTone;
  /** "Meine Änderung wiederherstellen": the ops and the a11y label */
  restore?: { ops: LiveOp[]; label: string };
}

export function useCardSync(model: LiveCardModel, offline = false): CardSync {
  const tr = useT();
  const live = useLive();
  const p = usePhrases();
  const count = model.pendingCount;
  if (count && model.resend) return { text: tr('live.sync.resend', { count }), tone: 'warning' };
  if (count) return { text: tr(offline ? 'live.sync.offline' : 'live.sync.pending', { count }), tone: 'waiting' };
  if (model.sending) return { text: tr('live.sync.sending'), tone: 'waiting' };
  if (live?.demo) return { text: tr('live.sync.demo'), tone: 'synced' };
  const u = model.undone;
  if (u && u.undone.length && !model.closed) {
    const items = p.list(u.undone.map(p.undone));
    return { text: tr('live.sync.undone', { items }), tone: 'warning', restore: { ops: u.restore, label: tr('live.sync.restoreA11y', { items }) } };
  }
  return { text: tr('live.sync.synced', { n: model.head.n }), tone: 'synced' };
}

/** Cloud with a check (saved, sage), a plain cloud (waiting, blue), an alert (needs a look). */
export function SyncIcon({ t, tone, size = 20 }: { t: Theme; tone: SyncTone; size?: number }) {
  if (tone === 'warning') return <Icon name="alert" size={size} color={t.colors.warning} />;
  return <Icon name={tone === 'synced' ? 'cloudCheck' : 'cloud'} size={size} color={tone === 'synced' ? t.colors.success : t.colors.info} />;
}

/** The line itself, with the restore action when Hermes did the user's edits differently. */
export function SyncStatus({ t, model, offline = false, iconSize = 20, restore = true }: { t: Theme; model: LiveCardModel; offline?: boolean; iconSize?: number; restore?: boolean }) {
  const tr = useT();
  const live = useLive();
  const sync = useCardSync(model, offline);
  return (
    <View style={{ gap: t.spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }} accessibilityLiveRegion="polite">
        <SyncIcon t={t} tone={sync.tone} size={iconSize} />
        <HText variant="caption" color="muted" style={{ flex: 1 }}>
          {sync.text}
        </HText>
      </View>
      {restore && sync.restore && live ? (
        <PressableScale
          haptic="selection"
          onPress={() => live.restore(model.id, sync.restore!.ops)}
          accessibilityRole="button"
          accessibilityLabel={sync.restore.label}
          style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, minHeight: 44, alignSelf: 'flex-start' }}
        >
          <Icon name="retry" size={16} color={t.colors.accent} />
          <HText variant="callout" weight="600" color="accent">
            {tr('live.sync.restore')}
          </HText>
        </PressableScale>
      ) : null}
    </View>
  );
}
