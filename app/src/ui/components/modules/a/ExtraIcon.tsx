import Svg, { Path, Polyline, Rect } from 'react-native-svg';

export type ExtraIconName = 'share' | 'trash' | 'play' | 'pause' | 'reset' | 'shuffle' | 'pencil' | 'link' | 'flip' | 'clock';

/** Extra stroke icons for modules-a (same geometry conventions as primitives/Icon). */
export function ExtraIcon({ name, size = 18, color, strokeWidth = 1.75 }: { name: ExtraIconName; size?: number; color: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body: React.ReactNode;
  switch (name) {
    case 'share':
      body = (
        <>
          <Path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" {...p} />
          <Path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" {...p} />
        </>
      );
      break;
    case 'trash':
      body = <Path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" {...p} />;
      break;
    case 'play':
      body = <Path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" fill={color} stroke="none" />;
      break;
    case 'pause':
      body = (
        <>
          <Rect x={6} y={4.5} width={4} height={15} rx={1.2} fill={color} />
          <Rect x={14} y={4.5} width={4} height={15} rx={1.2} fill={color} />
        </>
      );
      break;
    case 'reset':
      body = <Path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v5h5" {...p} />;
      break;
    case 'shuffle':
      body = <Path d="M3 7h3.5c2 0 3.3.9 4.5 2.6l2 2.8c1.2 1.7 2.5 2.6 4.5 2.6H21M3 17h3.5c1.4 0 2.4-.4 3.3-1.2M14 8.2c.9-.8 1.9-1.2 3.3-1.2H21M18 4l3 3-3 3M18 14l3 3-3 3" {...p} />;
      break;
    case 'pencil':
      body = <Path d="M14.5 5.5l4 4M4 20l1-4.5L15.8 4.7a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L8.5 19z" {...p} />;
      break;
    case 'link':
      body = <Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" {...p} />;
      break;
    case 'flip':
      body = <Path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6M18 3v4h-4M6 21v-4h4" {...p} />;
      break;
    case 'clock':
      body = (
        <>
          <Path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" {...p} />
          <Polyline points="12 7 12 12 15.5 14" {...p} />
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
