import Svg, { Circle, Path, Polyline, Rect } from 'react-native-svg';

export type IconName =
  | 'check'
  | 'copy'
  | 'chevronDown'
  | 'chevronRight'
  | 'chevronLeft'
  | 'arrowUpRight'
  | 'arrowDownRight'
  | 'arrowRight'
  | 'trendUp'
  | 'trendDown'
  | 'minus'
  | 'plus'
  | 'info'
  | 'alert'
  | 'alertOctagon'
  | 'checkCircle'
  | 'x'
  | 'sparkle'
  | 'calendar'
  | 'external'
  | 'table'
  | 'chart'
  | 'send'
  | 'dot';

/** Minimal stroke icon set (Lucide-like geometry, 24 grid, 1.75 stroke). */
export function Icon({ name, size = 18, color, strokeWidth = 1.75 }: { name: IconName; size?: number; color: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body: React.ReactNode;
  switch (name) {
    case 'check':
      body = <Polyline points="20 6 9 17 4 12" {...p} />;
      break;
    case 'copy':
      body = (
        <>
          <Rect x={9} y={9} width={12} height={12} rx={2.5} {...p} />
          <Path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" {...p} />
        </>
      );
      break;
    case 'chevronDown':
      body = <Polyline points="6 9 12 15 18 9" {...p} />;
      break;
    case 'chevronRight':
      body = <Polyline points="9 6 15 12 9 18" {...p} />;
      break;
    case 'chevronLeft':
      body = <Polyline points="15 6 9 12 15 18" {...p} />;
      break;
    case 'arrowUpRight':
      body = <Path d="M7 17 17 7M8 7h9v9" {...p} />;
      break;
    case 'arrowDownRight':
      body = <Path d="M7 7l10 10M17 8v9H8" {...p} />;
      break;
    case 'arrowRight':
      body = <Path d="M5 12h14M13 6l6 6-6 6" {...p} />;
      break;
    case 'trendUp':
      body = <Path d="M3 17l6-6 4 4 8-8M15 7h6v6" {...p} />;
      break;
    case 'trendDown':
      body = <Path d="M3 7l6 6 4-4 8 8M15 17h6v-6" {...p} />;
      break;
    case 'minus':
      body = <Path d="M5 12h14" {...p} />;
      break;
    case 'plus':
      body = <Path d="M12 5v14M5 12h14" {...p} />;
      break;
    case 'info':
      body = (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M12 11v5M12 8h.01" {...p} />
        </>
      );
      break;
    case 'alert':
      body = (
        <>
          <Path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" {...p} />
          <Path d="M12 9v4M12 17h.01" {...p} />
        </>
      );
      break;
    case 'alertOctagon':
      body = (
        <>
          <Path d="M7.9 2.5h8.2l5.4 5.4v8.2l-5.4 5.4H7.9l-5.4-5.4V7.9z" {...p} />
          <Path d="M12 8v4.5M12 16h.01" {...p} />
        </>
      );
      break;
    case 'checkCircle':
      body = (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Polyline points="8.5 12.5 11 15 16 9.5" {...p} />
        </>
      );
      break;
    case 'x':
      body = <Path d="M6 6l12 12M18 6 6 18" {...p} />;
      break;
    case 'sparkle':
      body = <Path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" {...p} />;
      break;
    case 'calendar':
      body = (
        <>
          <Rect x={3.5} y={5} width={17} height={15.5} rx={2.5} {...p} />
          <Path d="M8 3v4M16 3v4M3.5 10h17" {...p} />
        </>
      );
      break;
    case 'external':
      body = <Path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" {...p} />;
      break;
    case 'table':
      body = (
        <>
          <Rect x={3.5} y={4.5} width={17} height={15} rx={2} {...p} />
          <Path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" {...p} />
        </>
      );
      break;
    case 'chart':
      body = <Path d="M4 20V10M10 20V4M16 20v-7M22 20H2" {...p} />;
      break;
    case 'send':
      body = <Path d="M12 19V5M5 12l7-7 7 7" {...p} />;
      break;
    case 'dot':
      body = <Circle cx={12} cy={12} r={3} fill={color} />;
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}
