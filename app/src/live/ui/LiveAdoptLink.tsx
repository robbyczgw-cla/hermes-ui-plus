/**
 * "Als Live-Karte weiterführen" under a plain checklist (design §15): the list as it stands (with this device's ticks)
 * becomes a live card, pinned at the top and sent to Hermes with the next message. Afterwards the old list points to
 * the card ("Läuft als Live-Karte weiter · Öffnen"). Only in chats that fold live cards (live/LiveProvider).
 */
import { View } from 'react-native';
import { useT } from '../../i18n';
import { HText, PressableScale } from '../../ui/primitives/basics';
import { Icon } from '../../chat/icons';
import { useTheme } from '../../ui/theme';
import type { HuiChecklistKind } from '../../protocol/types';
import { useLive } from '../LiveProvider';
import { adoptChecklist, type PlainItem } from '../adopt.ts';

export function LiveAdoptLink({ source, nodeId, title, kind, groupBy, items }: { source: string; nodeId?: string; title: string; kind: HuiChecklistKind; groupBy?: 'category' | 'none'; items: readonly PlainItem[] }) {
  const live = useLive();
  const t = useTheme();
  const tr = useT();
  if (!live) return null;
  const card = live.adoptedFrom(source);
  if (card) {
    return (
      <PressableScale
        haptic="selection"
        onPress={() => live.openSheet({ kind: 'card', id: card.id })}
        accessibilityRole="button"
        accessibilityLabel={tr('live.adopt.doneA11y', { title: card.title })}
        style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, minHeight: 44 }}
      >
        <View aria-hidden style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.accent }} />
        <HText variant="callout" color="muted" style={{ flex: 1 }}>
          {tr('live.adopt.done')}
        </HText>
        <HText variant="callout" weight="600" color="accent">
          {tr('live.receipt.open')}
        </HText>
        <Icon name="chevronRight" size={16} color={t.colors.accent} />
      </PressableScale>
    );
  }
  return (
    <PressableScale
      haptic="selection"
      onPress={() => {
        const id = live.adopt({ id: nodeId, type: 'checklist', state: adoptChecklist({ title, kind, groupBy, items }), source });
        if (id) live.openSheet({ kind: 'card', id });
      }}
      accessibilityRole="button"
      accessibilityLabel={tr('live.adopt.action')}
      accessibilityHint={tr('live.adopt.hint')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, minHeight: 44 }}
    >
      <Icon name="pin" size={16} color={t.colors.accent} />
      <HText variant="callout" weight="600" color="accent">
        {tr('live.adopt.action')}
      </HText>
    </PressableScale>
  );
}
