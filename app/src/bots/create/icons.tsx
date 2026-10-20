// Role and "may" icons of the create flow (same geometry as chat/icons: 24 grid, 1.8 stroke, Lucide-like).
import Svg, { Circle, Path } from 'react-native-svg';
import type { TemplateId } from './core';

export type CreateIconName = 'globe' | 'tag' | 'plane' | 'sun' | 'code' | 'pencil' | 'bookmark' | 'repeat' | 'terminal' | 'sparkle';

export const TEMPLATE_ICON: Record<TemplateId, CreateIconName> = {
  research: 'globe', deals: 'tag', travel: 'plane', briefing: 'sun', code: 'code', own: 'pencil', blank: 'sparkle',
};

export function CreateIcon({ name, size = 20, color }: { name: CreateIconName; size?: number; color: string }) {
  const p = { stroke: color, strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'globe' ? (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" {...p} />
        </>
      ) : name === 'tag' ? (
        <>
          <Path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12l9 9-9 9-9-9z" {...p} />
          <Circle cx={7.5} cy={7.5} r={1.2} {...p} />
        </>
      ) : name === 'plane' ? (
        <Path d="M10.5 13.5 4 11l-1 1.5 5.5 3.5L7 21l1.5.5 3.5-5 3.5 5.5 1.5-1-2.5-6.5L20 8.5a1.8 1.8 0 0 0-2.5-2.5l-6 6.5" {...p} />
      ) : name === 'sun' ? (
        <>
          <Circle cx={12} cy={12} r={4} {...p} />
          <Path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" {...p} />
        </>
      ) : name === 'code' ? (
        <Path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" {...p} />
      ) : name === 'pencil' ? (
        <Path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" {...p} />
      ) : name === 'bookmark' ? (
        <Path d="M6 3h12v18l-6-4-6 4V3z" {...p} />
      ) : name === 'repeat' ? (
        <Path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" {...p} />
      ) : name === 'terminal' ? (
        <Path d="m5 7 5 5-5 5M12 18h7" {...p} />
      ) : (
        <Path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" {...p} />
      )}
    </Svg>
  );
}
