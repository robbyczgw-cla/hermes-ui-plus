// Stroke icons for the voice UI (24×24, same geometry style as chat/icons.tsx and attachments/components/icons.tsx).
import Svg, { Path, Rect } from 'react-native-svg';

export type VoiceIconName = 'mic' | 'micOff' | 'stop' | 'check' | 'close' | 'speaker' | 'pause' | 'play' | 'alert' | 'retry';

export function VoiceIcon({ name, size = 22, color, strokeWidth = 1.8 }: { name: VoiceIconName; size?: number; color: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {render(name, p, color)}
    </Svg>
  );
}

function render(name: VoiceIconName, p: object, color: string) {
  switch (name) {
    case 'mic':
      return (
        <>
          <Rect x="9" y="3" width="6" height="11" rx="3" {...p} />
          <Path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" {...p} />
        </>
      );
    case 'micOff':
      return (
        <>
          <Path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5" {...p} />
          <Path d="M18.5 11a6.5 6.5 0 0 1-1 3.4M5.5 11a6.5 6.5 0 0 0 10.4 5.2M12 17.5V21M9 21h6M4 4l16 16" {...p} />
        </>
      );
    case 'stop':
      return <Rect x="6.5" y="6.5" width="11" height="11" rx="2.2" fill={color} stroke="none" />;
    case 'check':
      return <Path d="m5 12.5 4.5 4.5L19 7.5" {...p} />;
    case 'close':
      return <Path d="M6 6l12 12M18 6 6 18" {...p} />;
    case 'speaker':
      return (
        <>
          <Path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z" {...p} />
          <Path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" {...p} />
        </>
      );
    case 'pause':
      return (
        <>
          <Rect x="6.5" y="5.5" width="3.6" height="13" rx="1.2" fill={color} stroke="none" />
          <Rect x="13.9" y="5.5" width="3.6" height="13" rx="1.2" fill={color} stroke="none" />
        </>
      );
    case 'play':
      return <Path d="M8 5.8v12.4a1 1 0 0 0 1.5.86l10-6.2a1 1 0 0 0 0-1.72l-10-6.2A1 1 0 0 0 8 5.8z" fill={color} stroke="none" />;
    case 'alert':
      return <Path d="M12 8v5M12 16.5v.01M10.3 4.2 3 17a2 2 0 0 0 1.7 3h14.6A2 2 0 0 0 21 17L13.7 4.2a2 2 0 0 0-3.4 0z" {...p} />;
    case 'retry':
      return <Path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5" {...p} />;
  }
}
