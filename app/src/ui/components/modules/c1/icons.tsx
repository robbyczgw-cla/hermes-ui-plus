// Small stroke icons for translation + poll (24 grid, same geometry style as primitives/Icon).
import Svg, { Circle, Path } from 'react-native-svg';

export type C1IconName = 'speaker' | 'pause' | 'swap' | 'user' | 'phone' | 'undo' | 'trophy' | 'globe';

export function C1Icon({ name, size = 18, color, strokeWidth = 1.8 }: { name: C1IconName; size?: number; color: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body;
  switch (name) {
    case 'speaker':
      body = (
        <>
          <Path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z" {...p} />
          <Path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" {...p} />
        </>
      );
      break;
    case 'pause':
      body = <Path d="M8.5 6v12M15.5 6v12" {...p} strokeWidth={strokeWidth + 1} />;
      break;
    case 'swap':
      body = <Path d="M7 4 3.5 7.5 7 11M3.5 7.5h13M17 13l3.5 3.5L17 20M20.5 16.5h-13" {...p} />;
      break;
    case 'user':
      body = (
        <>
          <Circle cx={12} cy={8.5} r={3.5} {...p} />
          <Path d="M5 19.5a7 7 0 0 1 14 0" {...p} />
        </>
      );
      break;
    case 'phone':
      body = <Path d="M8.5 3h7a1.5 1.5 0 0 1 1.5 1.5v15a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19.5v-15A1.5 1.5 0 0 1 8.5 3zM11 18h2" {...p} />;
      break;
    case 'undo':
      body = <Path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" {...p} />;
      break;
    case 'trophy':
      body = <Path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4" {...p} />;
      break;
    case 'globe':
      body = (
        <>
          <Circle cx={12} cy={12} r={8.5} {...p} />
          <Path d="M3.5 12h17M12 3.5c2.4 2.3 3.5 5.2 3.5 8.5s-1.1 6.2-3.5 8.5c-2.4-2.3-3.5-5.2-3.5-8.5s1.1-6.2 3.5-8.5z" {...p} />
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
