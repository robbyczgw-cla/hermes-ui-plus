/**
 * "Live-Karten in diesem Chat" (mockup 07): pinned cards, cards only in the chat (unpinned here), finished cards.
 * Pinning is per device; tapping a card opens it.
 */
import { ScrollView, View } from 'react-native';
import { useT } from '../../i18n';
import { HText, PressableScale } from '../../ui/primitives/basics';
import { SheetGrabber, SheetModal } from '../../ui/primitives/Sheet';
import { Icon } from '../../chat/icons';
import { useTheme, type Theme } from '../../ui/theme';
import { asKind } from '../../ui/components/modules/a/checklistModel.ts';
import { useLive } from '../LiveProvider';
import type { LiveCardModel } from '../derive.ts';
import { ListTile, VersionChip } from './parts';

export function LiveListSheet() {
  const live = useLive();
  const t = useTheme();
  const tr = useT();
  const open = live?.sheet?.kind === 'list';
  const close = () => live?.openSheet(null);
  const cards = live?.cards ?? [];
  const groups: [string, LiveCardModel[]][] = [
    [tr('live.list.pinned'), cards.filter((c) => c.pinned && !c.closed)],
    [tr('live.list.inChat'), cards.filter((c) => !c.pinned && !c.closed)],
    [tr('live.list.closed'), cards.filter((c) => c.closed)],
  ];
  return (
    <SheetModal visible={open} onClose={close} closeLabel={tr('actions.close')} label={tr('live.list.title')} maxHeight="88%">
      <SheetGrabber />
      <View style={{ paddingHorizontal: t.spacing.xl, paddingBottom: t.spacing.s, gap: 4 }}>
        <HText variant="title" accessibilityRole="header">
          {tr('live.list.title')}
        </HText>
        <HText variant="callout" color="muted">
          {tr('live.list.subtitle')}
        </HText>
      </View>
      <ScrollView style={{ flexShrink: 1 }}>
        {groups.map(([title, list]) =>
          list.length ? (
            <View key={title} style={{ paddingTop: t.spacing.m }}>
              <HText variant="micro" weight="600" color="muted" style={{ paddingHorizontal: t.spacing.xl, paddingBottom: t.spacing.xs, letterSpacing: 1.1, textTransform: 'uppercase' }} accessibilityRole="header">
                {title}
              </HText>
              {list.map((c) => (
                <Row key={c.id} t={t} c={c} onOpen={() => live?.openSheet({ kind: 'card', id: c.id })} onPin={() => live?.setPinned(c.id, !c.pinned)} />
              ))}
            </View>
          ) : null,
        )}
      </ScrollView>
    </SheetModal>
  );
}

function Row({ t, c, onOpen, onPin }: { t: Theme; c: LiveCardModel; onOpen: () => void; onPin: () => void }) {
  const tr = useT();
  const kind = tr(`live.list.kind.${asKind(c.view.state.kind)}`);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, paddingHorizontal: t.spacing.xl, paddingVertical: t.spacing.s }}>
      <PressableScale haptic="selection" scaleTo={0.99} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${c.title}, ${kind}, ${tr('live.progress', c.progress)}`} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, minHeight: 56 }}>
        <ListTile t={t} muted={c.closed} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
            <HText variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }} color={c.closed ? 'muted' : undefined}>
              {c.title}
            </HText>
            {!c.closed ? <VersionChip n={c.head.n} t={t} small /> : null}
          </View>
          <HText variant="caption" color="muted" numberOfLines={1}>
            {`${kind} · ${tr('live.progress', c.progress)}`}
          </HText>
        </View>
      </PressableScale>
      {c.closed ? (
        <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} aria-hidden>
          <Icon name="lock" size={18} color={t.colors.muted} />
        </View>
      ) : (
        <PressableScale
          haptic="selection"
          onPress={onPin}
          accessibilityRole="switch"
          accessibilityState={{ checked: c.pinned }}
          accessibilityLabel={tr(c.pinned ? 'live.list.unpin' : 'live.list.pin', { title: c.title })}
          style={{ width: 48, height: 44, borderRadius: t.radii.control, alignItems: 'center', justifyContent: 'center', backgroundColor: c.pinned ? t.colors.accentSoft : 'transparent' }}
        >
          <Icon name="pin" size={18} color={c.pinned ? t.colors.accent : t.colors.muted} />
        </PressableScale>
      )}
    </View>
  );
}
