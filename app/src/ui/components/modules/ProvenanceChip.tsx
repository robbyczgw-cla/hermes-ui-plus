import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import { useHui } from '../../primitives/context';
import { HText, PressableScale } from '../../primitives/basics';
import { Icon } from '../../primitives/Icon';
import { provenanceInfo } from './a/misc.ts';
import { ExtraIcon } from './a/ExtraIcon';
import { useS } from './useS';

/**
 * Small data-provenance chip for data nodes (table, chart, stats, compare, calc, map):
 * `basis` → "Deine Angaben" / "Recherchiert" / "Berechnet" / "Schätzung" / "Beispielwerte",
 * plus "Quelle: …" (http(s) sources show the domain and open on tap). Renders nothing when the
 * node has neither `basis` nor `source`.
 *
 *   <ProvenanceChip node={node} />            // reads node.basis / node.source
 *   <ProvenanceChip basis="estimate" source="…" />
 */
export function ProvenanceChip({ node, basis, source, style }: { node?: unknown; basis?: unknown; source?: unknown; style?: StyleProp<ViewStyle> }) {
  const S = useS();
  const t = useTheme();
  const { onAction } = useHui();
  const n = node && typeof node === 'object' ? (node as { basis?: unknown; source?: unknown }) : {};
  const info = provenanceInfo(basis ?? n.basis, source ?? n.source, S);
  if (!info) return null;
  const caution = info.tone === 'caution';
  const fg = caution ? t.colors.warning : t.colors.muted;
  const bg = caution ? t.colors.warningSoft : t.colors.surfaceAlt;
  const body = (
    <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'flex-start', gap: 5, backgroundColor: bg, borderRadius: t.radii.pill, paddingHorizontal: 9, paddingVertical: 3, maxWidth: '100%' }}>
      <View style={{ paddingTop: 1 }}>{info.url ? <ExtraIcon name="link" size={12} color={fg} /> : <Icon name={caution ? 'alert' : 'info'} size={12} color={fg} strokeWidth={2} />}</View>
      {/* B7/R7: wrap instead of ellipsising – the whole source list (every domain, "Stand …") stays readable;
          a 2-line cap cut real answers to "tenways.c…" / "Stand Sep…" on Android */}
      <HText variant="micro" style={{ color: fg, flexShrink: 1 }}>
        {info.label}
      </HText>
    </View>
  );
  if (info.url) {
    const url = info.url;
    return (
      <PressableScale
        haptic="selection"
        onPress={() => onAction({ type: 'open_url', url })}
        accessibilityRole="link"
        accessibilityLabel={S.provenance.a11y(info.label)}
        hitSlop={8}
        style={[{ alignSelf: 'flex-start', maxWidth: '100%' }, style]}
      >
        {body}
      </PressableScale>
    );
  }
  return (
    <View accessible accessibilityLabel={S.provenance.a11y(info.label)} style={[{ alignSelf: 'flex-start', maxWidth: '100%' }, style]}>
      {body}
    </View>
  );
}
