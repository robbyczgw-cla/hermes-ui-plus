import Svg, { Circle, G, Path } from 'react-native-svg';
import { useTheme } from '../theme';

// Geometry of the app icon's mark (app/brand/icon/petasos.svg, 1024 grid): the chat bubble wearing the two wings of
// Hermes' winged hat, typing dots cut out. Without the icon's ink tile, so it sits on any theme background.
const BUBBLE =
  'M432 390 H592 A140 140 0 0 1 732 530 V600 A140 140 0 0 1 592 740 H470 L386 800 Q370 811 373 792 L380 736 A140 140 0 0 1 292 600 V530 A140 140 0 0 1 432 390 Z';
const WING =
  'M0 -60 C -60 -130 -160 -220 -300 -262 C -352 -277 -380 -222 -342 -194 C -310 -170 -282 -154 -258 -142 C -312 -136 -328 -84 -290 -64 C -262 -50 -232 -40 -205 -34 C -248 -22 -250 34 -206 44 C -140 60 -70 64 0 56 Z';
// mark bounds (wing tips to bubble tail), 4:3
const VIEWBOX = '128 236 768 576';

/**
 * The Petasos brand mark in theme colours: wings in the accent, bubble in the text colour (ivory on dark = the icon),
 * the gap and the typing dots in the background colour behind it (`bg`, default the screen background).
 */
export function PetasosMark({ width = 40, bg }: { width?: number; bg?: string }) {
  const t = useTheme();
  const cut = bg ?? t.colors.bg;
  return (
    <Svg width={width} height={(width * 3) / 4} viewBox={VIEWBOX} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <G transform="translate(0 -30)">
        <G fill={t.colors.accent}>
          <Path transform="translate(410 500) scale(0.72)" d={WING} />
          <Path transform="translate(614 500) scale(-0.72 0.72)" d={WING} />
        </G>
        {/* the icon masks the wings around the bubble; on a flat background a stroke in that colour is the same */}
        <Path d={BUBBLE} fill={t.colors.text} stroke={cut} strokeWidth={60} strokeLinejoin="round" />
        <Path d={BUBBLE} fill={t.colors.text} />
        <G fill={cut}>
          <Circle cx={420} cy={565} r={38} />
          <Circle cx={512} cy={565} r={38} />
          <Circle cx={604} cy={565} r={38} />
        </G>
      </G>
    </Svg>
  );
}
