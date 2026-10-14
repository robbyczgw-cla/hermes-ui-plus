// Stroke icons of the answer polish features (entity chips, sheets, share). 24×24 grid, round caps,
// same geometry family as chat/icons.tsx (kept separate: that file is shared by many workstreams).
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type AnswerIconName = 'pin' | 'calendar' | 'phone' | 'mail' | 'tag' | 'route' | 'copy' | 'message' | 'search' | 'external' | 'image' | 'chevronDown' | 'chevronUp';

export function AnswerIcon({ name, size = 16, color, strokeWidth = 1.8 }: { name: AnswerIconName; size?: number; color: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {render(name, p)}
    </Svg>
  );
}

function render(name: AnswerIconName, p: object) {
  switch (name) {
    case 'pin':
      return (
        <>
          <Path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" {...p} />
          <Circle cx="12" cy="10" r="2.4" {...p} />
        </>
      );
    case 'calendar':
      return (
        <>
          <Rect x="3.5" y="5" width="17" height="15.5" rx="2.5" {...p} />
          <Path d="M3.5 10h17M8 3v4M16 3v4" {...p} />
        </>
      );
    case 'phone':
      return <Path d="M5 4h3.2l1.6 4.2-2.1 1.3a11 11 0 0 0 6.8 6.8l1.3-2.1L20 15.8V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" {...p} />;
    case 'mail':
      return (
        <>
          <Rect x="3" y="5" width="18" height="14" rx="2.5" {...p} />
          <Path d="M3.5 6.5l8.5 6.5 8.5-6.5" {...p} />
        </>
      );
    case 'tag':
      return (
        <>
          <Path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.6 6.6a1.5 1.5 0 0 1-2.1 0z" {...p} />
          <Circle cx="8.2" cy="8.2" r="1.4" {...p} />
        </>
      );
    case 'route':
      return (
        <>
          <Circle cx="6" cy="18" r="2.2" {...p} />
          <Circle cx="18" cy="6" r="2.2" {...p} />
          <Path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8" {...p} />
        </>
      );
    case 'copy':
      return (
        <>
          <Rect x="8.5" y="8.5" width="12" height="12" rx="2.2" {...p} />
          <Path d="M15.5 8.5V5.7a2.2 2.2 0 0 0-2.2-2.2H5.7a2.2 2.2 0 0 0-2.2 2.2v7.6a2.2 2.2 0 0 0 2.2 2.2h2.8" {...p} />
        </>
      );
    case 'message':
      return <Path d="M4 5.5h16a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H9l-4.5 3.5V17H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z" {...p} />;
    case 'search':
      return (
        <>
          <Circle cx="11" cy="11" r="6.5" {...p} />
          <Path d="M16 16l4.5 4.5" {...p} />
        </>
      );
    case 'external':
      return <Path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" {...p} />;
    case 'image':
      return (
        <>
          <Rect x="3.5" y="4.5" width="17" height="15" rx="2.5" {...p} />
          <Circle cx="9" cy="10" r="1.8" {...p} />
          <Path d="M20.5 16l-5-5-8.5 8.5" {...p} />
        </>
      );
    case 'chevronDown':
      return <Path d="M6 9l6 6 6-6" {...p} />;
    case 'chevronUp':
      return <Path d="M6 15l6-6 6 6" {...p} />;
  }
}
