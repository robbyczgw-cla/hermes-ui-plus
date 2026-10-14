// Stroke icons for the attachments UI (24×24, same geometry style as chat/icons.tsx).
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type AttachmentIconName = 'plus' | 'camera' | 'image' | 'file' | 'close' | 'alert' | 'share' | 'retry';

export function AttIcon({ name, size = 22, color, strokeWidth = 1.8 }: { name: AttachmentIconName; size?: number; color: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {render(name, p)}
    </Svg>
  );
}

function render(name: AttachmentIconName, p: object) {
  switch (name) {
    case 'plus':
      return <Path d="M12 5v14M5 12h14" {...p} />;
    case 'camera':
      return (
        <>
          <Path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" {...p} />
          <Circle cx="12" cy="13" r="3.5" {...p} />
        </>
      );
    case 'image':
      return (
        <>
          <Rect x="3.5" y="4.5" width="17" height="15" rx="2.5" {...p} />
          <Circle cx="9" cy="10" r="1.6" {...p} />
          <Path d="m20.5 16-4.8-4.8a1 1 0 0 0-1.4 0L6 19.5" {...p} />
        </>
      );
    case 'file':
      return (
        <>
          <Path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" {...p} />
          <Path d="M14 3.5V8h4.5M9 13h6M9 16.5h4" {...p} />
        </>
      );
    case 'close':
      return <Path d="M7 7l10 10M17 7 7 17" {...p} />;
    case 'alert':
      return (
        <>
          <Circle cx="12" cy="12" r="8.5" {...p} />
          <Path d="M12 7.5v5.5M12 16.4v.1" {...p} />
        </>
      );
    case 'share':
      return (
        <>
          <Path d="M12 3.5v11M8 7.5l4-4 4 4" {...p} />
          <Path d="M8 10.5H6.5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H16" {...p} />
        </>
      );
    case 'retry':
      return (
        <>
          <Path d="M4.5 12a7.5 7.5 0 0 1 13-5.1L20 9.5" {...p} />
          <Path d="M20 4.5v5h-5" {...p} />
        </>
      );
  }
}
