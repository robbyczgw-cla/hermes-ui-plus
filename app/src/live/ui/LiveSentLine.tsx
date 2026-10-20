/**
 * Quiet line under a user bubble that carried live-card edits (mockup 01): "✓ 2 Häkchen in „Einkauf Samstag“
 * mitgeschickt". The raw `[hui:live]` trailer is never shown.
 */
import { View } from 'react-native';
import { useT } from '../../i18n';
import { HText } from '../../ui/primitives/basics';
import { Icon } from '../../chat/icons';
import { useTheme } from '../../ui/theme';
import type { LiveBatches } from '../trailer.ts';
import { useLive } from '../LiveProvider';

export function LiveSentLine({ batches }: { batches: LiveBatches }) {
  const t = useTheme();
  const tr = useT();
  const live = useLive();
  const lines = Object.entries(batches).map(([id, b]) => {
    const title = live?.byId.get(id)?.title ?? b.state?.title ?? id;
    const ops = b.ops ?? [];
    // a list made a live card here / the whole card again after Hermes may have lost it (design §9.3)
    if (b.create) return tr('live.sent.created', { title });
    if (b.state) return tr('live.sent.state', { title });
    if (!ops.length) return tr('live.sent.ask', { title });
    const ticks = ops.every((op) => 'check' in op);
    return tr(ticks ? 'live.sent.ticks' : 'live.sent.changes', { count: ops.length, title });
  });
  return (
    <View style={{ alignSelf: 'flex-end', gap: 2, paddingTop: 4, paddingRight: 4, maxWidth: '100%' }}>
      {lines.map((l) => (
        <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="check" size={14} color={t.colors.muted} />
          <HText variant="caption" color="muted" numberOfLines={2} style={{ flexShrink: 1 }}>
            {l}
          </HText>
        </View>
      ))}
    </View>
  );
}
