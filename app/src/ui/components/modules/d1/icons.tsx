/**
 * Stroke icons for the places / products modules (Lucide-like geometry, 24 grid). Category glyphs are
 * used for image fallbacks, action glyphs for the buttons. No emoji in chrome.
 */
import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { PlaceKind, ProductKind } from './d1Model.ts';

export type D1IconName =
  | PlaceKind
  | ProductKind
  | 'route'
  | 'phone'
  | 'globe'
  | 'bookmark'
  | 'bookmarkFilled'
  | 'map'
  | 'compare'
  | 'cart'
  | 'external'
  | 'copy'
  | 'clock'
  | 'plus'
  | 'minus'
  | 'check'
  | 'x'
  | 'tag';

export function D1Icon({ name, size = 18, color, strokeWidth = 1.8 }: { name: D1IconName; size?: number; color: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body;
  switch (name) {
    case 'pin':
      body = (
        <>
          <Path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0" {...p} />
          <Circle cx={12} cy={10} r={3} {...p} />
        </>
      );
      break;
    case 'food':
      body = (
        <>
          <Path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20" {...p} />
          <Path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" {...p} />
        </>
      );
      break;
    case 'cafe':
      body = (
        <>
          <Path d="M10 2v2M14 2v2M6 2v2" {...p} />
          <Path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" {...p} />
        </>
      );
      break;
    case 'bar':
      body = <Path d="M8 22h8M7 10h10M12 15v7M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5z" {...p} />;
      break;
    case 'hotel':
      body = <Path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9" {...p} />;
      break;
    case 'sight':
      body = <Path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z" {...p} />;
      break;
    case 'park':
      body = <Path d="M12 22v-6M12 3l6 8h-3l4 5H5l4-5H6z" {...p} />;
      break;
    case 'shop':
      body = (
        <>
          <Path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18" {...p} />
          <Path d="M16 10a4 4 0 0 1-8 0" {...p} />
        </>
      );
      break;
    case 'health':
      body = <Path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" {...p} />;
      break;
    case 'headphones':
      body = <Path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" {...p} />;
      break;
    case 'gamepad':
      body = (
        <>
          <Path d="M6 11h4M8 9v4M15 12h.01M18 10h.01" {...p} />
          <Path d="M17.3 5H6.7a4 4 0 0 0-4 3.6C2.6 9.4 2 14.5 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.4-1.4A2 2 0 0 1 9.8 16h4.4a2 2 0 0 1 1.4.6L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.5-.6-6.6-.7-7.3A4 4 0 0 0 17.3 5z" {...p} />
        </>
      );
      break;
    case 'phone':
      body = <Path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" {...p} />;
      break;
    case 'laptop':
      body = <Path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.3 2.6a1 1 0 0 1-.9 1.4H3.6a1 1 0 0 1-.9-1.4L4 16" {...p} />;
      break;
    case 'watch':
      body = (
        <>
          <Circle cx={12} cy={12} r={6} {...p} />
          <Path d="M12 10v2l1 1M16.1 7.7l-.8-4.1a2 2 0 0 0-2-1.6h-2.7a2 2 0 0 0-2 1.6l-.8 4.1M7.9 16.4l.8 4a2 2 0 0 0 2 1.6h2.7a2 2 0 0 0 2-1.6l.8-4.1" {...p} />
        </>
      );
      break;
    case 'camera':
      body = (
        <>
          <Path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" {...p} />
          <Circle cx={12} cy={13} r={3} {...p} />
        </>
      );
      break;
    case 'screen':
      body = (
        <>
          <Rect x={2} y={3} width={20} height={14} rx={2} {...p} />
          <Path d="M8 21h8M12 17v4" {...p} />
        </>
      );
      break;
    case 'box':
      body = <Path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7zM3.3 7 12 12l8.7-5M12 22V12" {...p} />;
      break;
    case 'route':
      body = <Path d="M3 11 22 2l-9 19-2-8z" {...p} />;
      break;
    case 'globe':
      body = (
        <>
          <Circle cx={12} cy={12} r={10} {...p} />
          <Path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20" {...p} />
        </>
      );
      break;
    case 'bookmark':
      body = <Path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" {...p} />;
      break;
    case 'bookmarkFilled':
      body = <Path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" {...p} fill={color} />;
      break;
    case 'map':
      body = <Path d="M14.1 5.6a2 2 0 0 0 1.8 0l3.7-1.9a1 1 0 0 1 1.4.9v12.8a1 1 0 0 1-.6.9l-4.5 2.3a2 2 0 0 1-1.8 0l-4.2-2.1a2 2 0 0 0-1.8 0l-3.7 1.8a1 1 0 0 1-1.4-.9V6.6a1 1 0 0 1 .6-.9l4.5-2.3a2 2 0 0 1 1.8 0zM15 5.8v15M9 3.2v15" {...p} />;
      break;
    case 'compare':
      body = (
        <>
          <Rect x={3} y={3} width={18} height={18} rx={2.5} {...p} />
          <Path d="M12 3v18M6.5 8h2.5M15 8h2.5M6.5 12h2.5M15 12h2.5" {...p} />
        </>
      );
      break;
    case 'cart':
      body = (
        <>
          <Circle cx={8} cy={21} r={1} {...p} />
          <Circle cx={19} cy={21} r={1} {...p} />
          <Path d="M2 2h2l2.7 12.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L22 7H5.1" {...p} />
        </>
      );
      break;
    case 'external':
      body = <Path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" {...p} />;
      break;
    case 'copy':
      body = (
        <>
          <Rect x={8} y={8} width={14} height={14} rx={2} {...p} />
          <Path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" {...p} />
        </>
      );
      break;
    case 'clock':
      body = (
        <>
          <Circle cx={12} cy={12} r={10} {...p} />
          <Path d="M12 6v6l4 2" {...p} />
        </>
      );
      break;
    case 'plus':
      body = <Path d="M12 5v14M5 12h14" {...p} />;
      break;
    case 'minus':
      body = <Path d="M5 12h14" {...p} />;
      break;
    case 'check':
      body = <Path d="M20 6 9 17l-5-5" {...p} />;
      break;
    case 'x':
      body = <Path d="M18 6 6 18M6 6l12 12" {...p} />;
      break;
    case 'tag':
      body = (
        <>
          <Path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z" {...p} />
          <Circle cx={7.5} cy={7.5} r={0.6} fill={color} stroke={color} />
        </>
      );
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}

const STAR = 'M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.45 6.2 20.5l1.1-6.45-4.7-4.6 6.5-.95z';

/** One filled star; `fill` 0–1 clips the coloured part from the left over a neutral track. */
export function StarGlyph({ fill, size, color, track }: { fill: number; size: number; color: string; track: string }) {
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24" style={{ position: 'absolute' }}>
        <Path d={STAR} fill={track} />
      </Svg>
      {fill > 0 ? (
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: size * Math.min(1, fill), overflow: 'hidden' }}>
          <Svg width={size} height={size} viewBox="0 0 24 24">
            <Path d={STAR} fill={color} />
          </Svg>
        </View>
      ) : null}
    </View>
  );
}
