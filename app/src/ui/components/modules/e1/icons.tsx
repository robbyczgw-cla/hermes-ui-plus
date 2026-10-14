/**
 * Node icons of the `paths` chain: the fixed HuiPathIcon set mapped onto the app's stroke icons
 * (products/places glyphs for laptop, desktop, phone, globe, container; translation glyph for user;
 * the rest in the same Lucide-like 24 grid). Anything else renders nothing – never throws.
 */
import type { ReactNode } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import type { HuiPathIcon } from '../../../types';
import { D1Icon } from '../d1/icons';
import { C1Icon } from '../c1/icons';

export function PathIcon({ name, size = 15, color, strokeWidth = 1.8 }: { name: HuiPathIcon | string | undefined; size?: number; color: string; strokeWidth?: number }) {
  switch (name) {
    case 'laptop':
      return <D1Icon name="laptop" size={size} color={color} strokeWidth={strokeWidth} />;
    case 'desktop':
      return <D1Icon name="screen" size={size} color={color} strokeWidth={strokeWidth} />;
    case 'phone':
      return <D1Icon name="phone" size={size} color={color} strokeWidth={strokeWidth} />;
    case 'globe':
      return <D1Icon name="globe" size={size} color={color} strokeWidth={strokeWidth} />;
    case 'container':
      return <D1Icon name="box" size={size} color={color} strokeWidth={strokeWidth} />;
    case 'user':
      return <C1Icon name="user" size={size} color={color} strokeWidth={strokeWidth} />;
  }
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body: ReactNode;
  switch (name) {
    case 'server':
      body = (
        <>
          <Rect x={4} y={4.5} width={16} height={6.5} rx={2} {...p} />
          <Rect x={4} y={13} width={16} height={6.5} rx={2} {...p} />
          <Path d="M7.5 7.75h.01M7.5 16.25h.01M11 7.75h5M11 16.25h5" {...p} />
        </>
      );
      break;
    case 'cloud':
      body = <Path d="M17.5 19H7a5 5 0 1 1 1.1-9.9A6 6 0 0 1 19.6 11 4 4 0 0 1 17.5 19z" {...p} />;
      break;
    case 'disk':
      body = (
        <>
          <Path d="M22 12H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z" {...p} />
          <Path d="M6 16h.01M10 16h.01" {...p} />
        </>
      );
      break;
    case 'folder':
      body = <Path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" {...p} />;
      break;
    case 'file':
      body = <Path d="M7 3.5h6.5l5 5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5zM13.5 3.5v5h5M8.5 13h7M8.5 16.5h5" {...p} />;
      break;
    case 'database':
      body = (
        <>
          <Path d="M4 5c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z" {...p} />
          <Path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" {...p} />
        </>
      );
      break;
    case 'network':
      body = (
        <>
          <Rect x={9} y={2} width={6} height={6} rx={1} {...p} />
          <Rect x={2} y={16} width={6} height={6} rx={1} {...p} />
          <Rect x={16} y={16} width={6} height={6} rx={1} {...p} />
          <Path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8" {...p} />
        </>
      );
      break;
    case 'lock':
      body = (
        <>
          <Rect x={4} y={11} width={16} height={10} rx={2} {...p} />
          <Path d="M8 11V7a4 4 0 0 1 8 0v4" {...p} />
        </>
      );
      break;
    case 'app':
      body = (
        <>
          <Rect x={3} y={3} width={7} height={7} rx={1.5} {...p} />
          <Rect x={14} y={3} width={7} height={7} rx={1.5} {...p} />
          <Rect x={3} y={14} width={7} height={7} rx={1.5} {...p} />
          <Rect x={14} y={14} width={7} height={7} rx={1.5} {...p} />
        </>
      );
      break;
    case 'vm':
      body = (
        <>
          <Rect x={2} y={3} width={20} height={14} rx={2} {...p} />
          <Rect x={6} y={6.5} width={12} height={7} rx={1} {...p} />
          <Path d="M8 21h8M12 17v4" {...p} />
        </>
      );
      break;
    case 'terminal':
      body = (
        <>
          <Rect x={3.5} y={5} width={17} height={14} rx={2.5} {...p} />
          <Path d="m7.5 10 3 2.5-3 2.5M13 15h3.5" {...p} />
        </>
      );
      break;
    default:
      return null;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}
