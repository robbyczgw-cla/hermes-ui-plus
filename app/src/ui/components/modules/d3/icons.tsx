// Stroke icons for studyplan / vocab / mindmap (24 grid, same geometry style as primitives/Icon).
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type D3IconName = 'learn' | 'practice' | 'review' | 'test' | 'today' | 'zoomIn' | 'zoomOut' | 'fit' | 'outline' | 'mindmap' | 'clock' | 'cards' | 'quiz' | 'type' | 'layers';

export function D3Icon({ name, size = 18, color, strokeWidth = 1.8 }: { name: D3IconName; size?: number; color: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body;
  switch (name) {
    case 'learn': // open book
      body = <Path d="M12 6.5C10.3 5.2 8 4.5 4 4.5v13c4 0 6.3.7 8 2 1.7-1.3 4-2 8-2v-13c-4 0-6.3.7-8 2zM12 6.5v13" {...p} />;
      break;
    case 'practice': // pencil
      body = <Path d="M15.5 4.5l4 4L9 19l-4.5 1 1-4.5L15.5 4.5zM13.5 6.5l4 4" {...p} />;
      break;
    case 'review': // circular arrows
      body = <Path d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1M17.5 3.5v3.4h-3.4M6.5 20.5v-3.4h3.4" {...p} />;
      break;
    case 'test': // clipboard with check
      body = (
        <>
          <Rect x={5} y={4.5} width={14} height={16} rx={2} {...p} />
          <Path d="M9 4.5V3.5h6v1M9 12.5l2 2 4-4" {...p} />
        </>
      );
      break;
    case 'today': // calendar with dot
      body = (
        <>
          <Rect x={4} y={5} width={16} height={15} rx={2} {...p} />
          <Path d="M4 9.5h16M8.5 3v4M15.5 3v4" {...p} />
          <Circle cx={12} cy={14.5} r={1.6} fill={color} stroke="none" />
        </>
      );
      break;
    case 'zoomIn':
      body = (
        <>
          <Circle cx={10.5} cy={10.5} r={6} {...p} />
          <Path d="M15 15l5 5M8 10.5h5M10.5 8v5" {...p} />
        </>
      );
      break;
    case 'zoomOut':
      body = (
        <>
          <Circle cx={10.5} cy={10.5} r={6} {...p} />
          <Path d="M15 15l5 5M8 10.5h5" {...p} />
        </>
      );
      break;
    case 'fit': // four corners
      body = <Path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" {...p} />;
      break;
    case 'outline':
      body = <Path d="M4 6h3M10 6h10M7 12h2M12 12h8M7 18h2M12 18h8M5.5 6v12" {...p} />;
      break;
    case 'mindmap':
      body = (
        <>
          <Circle cx={12} cy={12} r={2.6} {...p} />
          <Circle cx={4.5} cy={6} r={1.8} {...p} />
          <Circle cx={19.5} cy={6} r={1.8} {...p} />
          <Circle cx={4.5} cy={18} r={1.8} {...p} />
          <Circle cx={19.5} cy={18} r={1.8} {...p} />
          <Path d="M9.8 10.4 6 7.2M14.2 10.4 18 7.2M9.8 13.6 6 16.8M14.2 13.6 18 16.8" {...p} />
        </>
      );
      break;
    case 'clock':
      body = (
        <>
          <Circle cx={12} cy={12} r={8} {...p} />
          <Path d="M12 7.5V12l3 2" {...p} />
        </>
      );
      break;
    case 'cards':
      body = (
        <>
          <Rect x={7} y={4} width={13} height={16} rx={2} {...p} />
          <Path d="M4 7.5v10.5a2 2 0 0 0 2 2h1" {...p} />
        </>
      );
      break;
    case 'quiz': // list with selected bullet
      body = (
        <>
          <Circle cx={6} cy={7} r={1.8} fill={color} stroke="none" />
          <Circle cx={6} cy={12} r={1.8} {...p} />
          <Circle cx={6} cy={17} r={1.8} {...p} />
          <Path d="M10.5 7H20M10.5 12H20M10.5 17H20" {...p} />
        </>
      );
      break;
    case 'type': // keyboard
      body = (
        <>
          <Rect x={3} y={6} width={18} height={12} rx={2} {...p} />
          <Path d="M7 10h.01M10.3 10h.01M13.7 10h.01M17 10h.01M8 14.5h8" {...p} strokeWidth={strokeWidth + 0.4} />
        </>
      );
      break;
    case 'layers':
      body = <Path d="M12 4 3.5 8.5 12 13l8.5-4.5L12 4zM3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5" {...p} />;
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}

/** Progress ring (plain stroke-dasharray arc – no clipPath, safe on Android). */
export function Ring({ ratio, size, stroke, color, track }: { ratio: number; size: number; stroke: number; color: string; track: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, ratio));
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
      {v > 0 ? (
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ) : null}
    </Svg>
  );
}

/** True while a screen reader (VoiceOver / TalkBack) is running. */
export function useScreenReader(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    // react-native-web always reports `true` here → can't tell; web users get the outline via the switch
    if (Platform.OS === 'web') return;
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((v) => {
        if (alive) setOn(!!v);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (v: boolean) => setOn(!!v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return on;
}
