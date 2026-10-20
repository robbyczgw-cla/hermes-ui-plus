/**
 * Honest lines when an answer did NOT change a live card although the turn was about it (real-user round 2, R2-01):
 * - under a plain list that does not continue the card ("Nicht in „Einkauf“ übernommen", "In die Live-Karte
 *   übernehmen" applies it as the user's own edit, sent with the next message), or under a patch for a card this chat
 *   does not have;
 * - under an answer without any card block after a message about the card ("„Einkauf“ wurde nicht geändert").
 * Nothing is applied silently and nothing is ignored silently. The fold decides (live/model.ts `continuationOf`).
 */
import { View } from 'react-native';
import { useT } from '../../i18n';
import { HText, PressableScale } from '../../ui/primitives/basics';
import { Icon } from '../../chat/icons';
import { useTheme } from '../../ui/theme';
import { useNodeScope } from '../../nodestate';
import { useLive } from '../LiveProvider';
import { normText } from '../model.ts';
import { fullFromPlainNode, type LiveNodeShape } from '../nodes.ts';

/** The note's key for a top-level node: its id, or `patch:<card>` for a callout carrying a patch. */
export function noteKey(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as { id?: unknown; type?: unknown; live?: unknown; livePatch?: { card?: unknown } };
  if (n.type === 'callout') return typeof n.livePatch?.card === 'string' ? `patch:${n.livePatch.card}` : undefined;
  if (n.live === true) return undefined;
  return typeof n.id === 'string' ? n.id : '';
}

/** Under a top-level node of an answer (ui/HuiView.tsx): the "not applied" note, or nothing. */
export function LiveUnappliedNote({ node }: { node: unknown }) {
  const live = useLive();
  const scope = useNodeScope();
  const t = useTheme();
  const tr = useT();
  const key = noteKey(node);
  if (!live || !scope || key === undefined) return null;
  const mark = live.marks.get(scope.messageId)?.find((m) => m.unapplied && m.adopted === key);
  if (!mark) return null;
  const model = live.byId.get(mark.card);
  const full = key.startsWith('patch:') ? null : fullFromPlainNode(node as Partial<LiveNodeShape>);
  // the card already holds what this list says (the user took it over, or later versions did): nothing to say
  if (model && full) {
    const have = new Set(model.view.state.items.filter((it) => !it.hidden).map((it) => normText(it.text)));
    const want = new Set(full.items.map((it) => normText(it.text)));
    if (have.size === want.size && Array.from(want).every((x) => have.has(x))) return null;
  }
  const text = model ? tr('live.note.unapplied', { title: model.title }) : tr('live.note.noCard', { card: mark.card });
  return (
    <View style={{ gap: t.spacing.xs, paddingTop: t.spacing.s }} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.s }}>
        <Icon name="alert" size={16} color={t.colors.muted} />
        <HText variant="caption" color="muted" style={{ flex: 1 }}>
          {text}
        </HText>
      </View>
      {model && full && !model.closed ? (
        <PressableScale
          haptic="selection"
          onPress={() => {
            live.takeOver(model.id, full);
            live.openSheet({ kind: 'card', id: model.id });
          }}
          accessibilityRole="button"
          accessibilityLabel={tr('live.note.takeOverA11y', { title: model.title })}
          style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, minHeight: 44 }}
        >
          <Icon name="pin" size={16} color={t.colors.accent} />
          <HText variant="callout" weight="600" color="accent">
            {tr('live.note.takeOver')}
          </HText>
        </PressableScale>
      ) : null}
    </View>
  );
}

/** Under a finished answer without any card block after a message about a card: the card stayed as it was. */
export function LiveQuietLine({ messageId }: { messageId: string }) {
  const live = useLive();
  const t = useTheme();
  const tr = useT();
  const mark = live?.marks.get(messageId)?.find((m) => m.quiet);
  const model = mark ? live?.byId.get(mark.card) : undefined;
  if (!live || !mark || !model) return null;
  return (
    <PressableScale
      haptic="selection"
      onPress={() => live.openSheet({ kind: 'card', id: model.id })}
      accessibilityRole="button"
      accessibilityLabel={`${tr('live.note.quiet', { title: model.title })} ${tr('live.receipt.open')}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, minHeight: 36, alignSelf: 'flex-start' }}
    >
      <Icon name="alert" size={14} color={t.colors.muted} />
      <HText variant="caption" color="muted" style={{ flexShrink: 1 }}>
        {tr('live.note.quiet', { title: model.title })}
      </HText>
      <HText variant="caption" weight="600" color="accent">
        {tr('live.receipt.open')}
      </HText>
    </PressableScale>
  );
}
