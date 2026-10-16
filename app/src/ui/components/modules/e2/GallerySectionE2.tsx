/**
 * Dev-gallery sections of the coding views: "Diff", "Terminal", "Änderungen" (changes). Mounted once in ui/Gallery.tsx.
 * Review comments ("Request changes") go to the gallery's onAction logger.
 */
import { View } from 'react-native';
import { useTheme } from '../../../theme';
import { HText } from '../../../primitives/basics';
import { HuiView } from '../../../HuiView';
import type { HuiActionHandler } from '../../../primitives/context';
import { CHANGES_SAMPLES, DIFF_SAMPLES, TERMINAL_SAMPLES } from './samples';

type Sample = { title: string; node: unknown; streaming?: boolean };

export function GallerySectionE2({ onAction }: { onAction: HuiActionHandler }) {
  return (
    <>
      <Section heading="Diff" prefix="gallery-e2-diff" samples={DIFF_SAMPLES} onAction={onAction} />
      <Section heading="Terminal" prefix="gallery-e2-terminal" samples={TERMINAL_SAMPLES} onAction={onAction} />
      <Section heading="Änderungen" prefix="gallery-e2-changes" samples={CHANGES_SAMPLES} onAction={onAction} />
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
          <HText variant="micro" color="subtle" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
            {s.title}
          </HText>
          <HuiView node={s.node} streaming={!!s.streaming} onAction={onAction} />
        </View>
      ))}
    </View>
  );
}
