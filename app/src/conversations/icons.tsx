import Svg, { Circle, Path } from 'react-native-svg';

export type ConvIconName = 'search' | 'pin' | 'trash' | 'edit' | 'more' | 'chat' | 'settings' | 'select' | 'sidebar' | 'archive' | 'chevronDown' | 'chevronRight';

/** Small stroke icons missing from ui/Icon (same 24 grid / 1.75 stroke geometry). */
export function ConvIcon({ name, size = 18, color, strokeWidth = 1.75 }: { name: ConvIconName; size?: number; color: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body;
  switch (name) {
    case 'search':
      body = (
        <>
          <Circle cx={11} cy={11} r={6.5} {...p} />
          <Path d="M20 20l-4.2-4.2" {...p} />
        </>
      );
      break;
    case 'settings':
      body = (
        <>
          <Path d="M4 7h10M18 7h2M4 17h4M12 17h8" {...p} />
          <Circle cx={16} cy={7} r={2} {...p} />
          <Circle cx={10} cy={17} r={2} {...p} />
        </>
      );
      break;
    case 'sidebar':
      body = (
        <>
          <Path d="M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2zM9.5 4.5v15" {...p} />
        </>
      );
      break;
    case 'pin':
      body = <Path d="M12 17v5M9 3h6l-1 6 3 3.5v1.5H7v-1.5L10 9z" {...p} />;
      break;
    case 'trash':
      body = <Path d="M4 7h16M10 7V4.5h4V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5" {...p} />;
      break;
    case 'edit':
      body = <Path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17zM14.5 7.5l3 3" {...p} />;
      break;
    case 'more':
      body = (
        <>
          <Circle cx={5.5} cy={12} r={1.4} fill={color} />
          <Circle cx={12} cy={12} r={1.4} fill={color} />
          <Circle cx={18.5} cy={12} r={1.4} fill={color} />
        </>
      );
      break;
    case 'select':
      body = (
        <>
          <Path d="M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4z" {...p} />
          <Path d="M8.5 12.2l2.4 2.4 4.6-5" {...p} />
        </>
      );
      break;
    case 'archive':
      body = <Path d="M4 5.5h16v3.5H4zM5.5 9v9a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9M10 12.5h4" {...p} />;
      break;
    case 'chevronDown':
      body = <Path d="M6 9.5l6 6 6-6" {...p} />;
      break;
    case 'chevronRight':
      body = <Path d="M9.5 6l6 6-6 6" {...p} />;
      break;
    case 'chat':
      body = <Path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z" {...p} />;
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}
