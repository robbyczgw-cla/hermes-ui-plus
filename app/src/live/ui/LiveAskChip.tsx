/**
 * Composer context chip after "Hermes fragen" (mockup 08): "Einkauf Samstag · v6", ×. The next message carries
 * `"focus":true` for this card (and its pending edits).
 */
import { View } from 'react-native';
import { useT } from '../../i18n';
import { HText, PressableScale } from '../../ui/primitives/basics';
import { Icon } from '../../chat/icons';
import { useTheme } from '../../ui/theme';
import { useLive } from '../LiveProvider';
import { ListTile } from './parts';

export function LiveAskChip() {
  const live = useLive();
  const t = useTheme();
  const tr = useT();
  const model = live?.focus ? live.byId.get(live.focus) : undefined;
  if (!live || !model) return null;
  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: t.spacing.m, paddingBottom: t.spacing.xs }}>
      <View accessible accessibilityLabel={tr('live.ask.chipA11y', { title: model.title })} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, paddingLeft: 4, paddingRight: 2, paddingVertical: 4, borderRadius: t.radii.pill, borderWidth: 1, borderColor: t.colors.accent, backgroundColor: t.colors.accentSoft, maxWidth: '100%' }}>
        <ListTile t={t} size={26} />
        <HText variant="caption" weight="600" numberOfLines={1} style={{ flexShrink: 1, color: t.colors.accentText }}>
          {tr('live.ask.chip', { title: model.title, n: model.head.n })}
        </HText>
        <PressableScale haptic="selection" onPress={() => live.setFocus(null)} accessibilityRole="button" accessibilityLabel={tr('live.ask.remove')} hitSlop={8} style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={14} color={t.colors.accent} />
        </PressableScale>
      </View>
    </View>
  );
}
