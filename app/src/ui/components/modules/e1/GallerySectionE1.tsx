/**
 * Dev-gallery sections "Wege & Varianten" (`paths`) and "Architektur & Bausteine" (`blocks`).
 * Mounted once in ui/Gallery.tsx. The paths select sample's reply (`[paths:backup-weg] …`) goes to
 * the gallery's onAction logger; blocks is display-only.
 */
import { View } from 'react-native';
import { useTheme } from '../../../theme';
import { HText } from '../../../primitives/basics';
import { HuiView } from '../../../HuiView';
import type { HuiActionHandler } from '../../../primitives/context';
import { BLOCKS_SAMPLES, PATHS_SAMPLES } from './samples';

type Sample = { title: string; node: unknown; streaming?: boolean };

export function GallerySectionE1({ onAction }: { onAction: HuiActionHandler }) {
  return (
    <>
      <Section heading="Wege & Varianten" prefix="gallery-e1" samples={PATHS_SAMPLES} onAction={onAction} />
      <Section heading="Architektur & Bausteine" prefix="gallery-e1-blocks" samples={BLOCKS_SAMPLES} onAction={onAction} />
    </>
  );
}

function Section({ heading, prefix, samples, onAction }: { heading: string; prefix: string; samples: Sample[]; onAction: HuiActionHandler }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.xl }}>
      <HText variant="title" style={{ marginTop: t.spacing.l }}>
        {heading}
      </HText>
      {samples.map((s, i) => (
        <View key={i} style={{ gap: t.spacing.s }} nativeID={`${prefix}-${i}`}>
          <HText variant="caption" weight="600" color="subtle">
            {s.title}
          </HText>
          <HuiView node={s.node} streaming={!!s.streaming} onAction={onAction} />
        </View>
      ))}
    </View>
  );
}
