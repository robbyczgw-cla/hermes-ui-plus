// Small stroke icon set (react-native-svg, 24×24 viewBox, 1.8 stroke). No icon-font dependency.
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'newChat'
  | 'settings'
  | 'send'
  | 'stop'
  | 'arrowDown'
  | 'copy'
  | 'check'
  | 'retry'
  | 'close'
  | 'chevronDown'
  | 'chevronRight'
  | 'alert'
  | 'search'
  | 'tool'
  | 'trash'
  | 'plus'
  | 'checklist'
  | 'calendar'
  | 'scale'
  | 'barChart'
  | 'timer'
  | 'bulb'
  | 'bell'
  | 'mail'
  | 'bowl'
  | 'menu'
  | 'sidebar'
  | 'share'
  | 'shield'
  | 'star'
  | 'starFilled'
  | 'eye'
  | 'globe'
  | 'bolt'
  | 'boltFilled'
  | 'spark'
  | 'server'
  | 'play'
  | 'external'
  | 'terminal'
  | 'file'
  | 'image'
  | 'users'
  | 'brain'
  | 'book'
  | 'history'
  | 'compress'
  | 'download'
  | 'edit'
  | 'code'
  | 'more'
  | 'flag'
  | 'archive'
  | 'branch'
  | 'pin'
  | 'lock'
  | 'chevronLeft'
  | 'cloud'
  | 'cloudCheck'
  | 'phone'
  | 'laptop';

type Props = { name: IconName; size?: number; color: string; strokeWidth?: number };

export function Icon({ name, size = 22, color, strokeWidth = 1.8 }: Props) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {render(name, p, color)}
    </Svg>
  );
}

function render(name: IconName, p: object, color: string) {
  switch (name) {
    case 'newChat':
      return (
        <>
          <Path d="M12 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V12" {...p} />
          <Path d="M17.6 3.6a1.9 1.9 0 0 1 2.8 2.8L12.5 14.3 9 15l.7-3.5 7.9-7.9z" {...p} />
        </>
      );
    case 'settings':
      return (
        <>
          <Path d="M4 7h10M18 7h2M4 17h4M12 17h8" {...p} />
          <Circle cx="16" cy="7" r="2" {...p} />
          <Circle cx="10" cy="17" r="2" {...p} />
        </>
      );
    case 'send':
      return <Path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" {...p} />;
    case 'stop':
      return <Rect x="7" y="7" width="10" height="10" rx="2" fill={color} />;
    case 'arrowDown':
      return <Path d="M12 5v14M5.5 12.5 12 19l6.5-6.5" {...p} />;
    case 'copy':
      return (
        <>
          <Rect x="8.5" y="8.5" width="11" height="11" rx="2.5" {...p} />
          <Path d="M15.5 8.5V6.5A2 2 0 0 0 13.5 4.5h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" {...p} />
        </>
      );
    case 'check':
      return <Path d="M5 12.5 10 17.5 19 7" {...p} />;
    case 'retry':
      return (
        <>
          <Path d="M4.5 12a7.5 7.5 0 0 1 13-5.1L20 9.5" {...p} />
          <Path d="M20 4.5v5h-5" {...p} />
          <Path d="M19.5 12a7.5 7.5 0 0 1-13 5.1L4 14.5" {...p} />
          <Path d="M4 19.5v-5h5" {...p} />
        </>
      );
    case 'close':
      return <Path d="M6 6l12 12M18 6 6 18" {...p} />;
    case 'chevronDown':
      return <Path d="M6.5 9.5 12 15l5.5-5.5" {...p} />;
    case 'chevronRight':
      return <Path d="M9.5 6.5 15 12l-5.5 5.5" {...p} />;
    case 'alert':
      return (
        <>
          <Circle cx="12" cy="12" r="8.5" {...p} />
          <Path d="M12 7.5v5.5" {...p} />
          <Circle cx="12" cy="16.3" r="0.6" fill={color} stroke={color} />
        </>
      );
    case 'search':
      return (
        <>
          <Circle cx="11" cy="11" r="6" {...p} />
          <Path d="m20 20-4.5-4.5" {...p} />
        </>
      );
    case 'tool':
      return <Path d="M14.5 6.5a4 4 0 0 0 5 5L13 18a2.1 2.1 0 0 1-3-3l6.5-6.5a4 4 0 0 1-2-2zM6 18l-1.5 1.5" {...p} />;
    case 'trash':
      return (
        <>
          <Path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5" {...p} />
        </>
      );
    case 'plus':
      return <Path d="M12 5v14M5 12h14" {...p} />;
    case 'sidebar':
      return <Path d="M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2zM9.5 4.5v15" {...p} />;
    case 'menu':
      return <Path d="M4 7.5h16M4 12h11M4 16.5h16" {...p} />;
    case 'share':
      return (
        <>
          <Path d="M12 14.5V4M8 7.5 12 3.5l4 4" {...p} />
          <Path d="M8.5 10.5H7A2.5 2.5 0 0 0 4.5 13v5A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-5a2.5 2.5 0 0 0-2.5-2.5h-1.5" {...p} />
        </>
      );
    case 'shield':
      return (
        <>
          <Path d="M12 3.5 5 6.5v5c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9v-5l-7-3z" {...p} />
          <Path d="M12 8.5v4" {...p} />
          <Circle cx="12" cy="15.6" r="0.6" fill={color} stroke={color} />
        </>
      );
    // model picker: favorites + capability badges
    case 'star':
    case 'starFilled':
      return <Path d="M12 3.8l2.5 5.1 5.6.8-4.05 3.95.95 5.6L12 16.6l-5 2.65.95-5.6L3.9 9.7l5.6-.8L12 3.8z" {...p} fill={name === 'starFilled' ? color : 'none'} />;
    case 'eye':
      return (
        <>
          <Path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z" {...p} />
          <Circle cx="12" cy="12" r="2.8" {...p} />
        </>
      );
    case 'globe':
      return (
        <>
          <Circle cx="12" cy="12" r="8.5" {...p} />
          <Path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5s1.2-6.1 3.6-8.5z" {...p} />
        </>
      );
    case 'bolt':
    case 'boltFilled':
      return <Path d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12L13 3z" {...p} fill={name === 'boltFilled' ? color : 'none'} />;
    case 'spark':
      return <Path d="M12 3.5c.6 4.3 2.2 5.9 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.6 5.9-2.2 6.5-6.5zM18.5 16.5c.25 1.6.9 2.25 2.5 2.5-1.6.25-2.25.9-2.5 2.5-.25-1.6-.9-2.25-2.5-2.5 1.6-.25 2.25-.9 2.5-2.5z" {...p} />;
    // connection kinds
    case 'server':
      return (
        <>
          <Rect x="4" y="4.5" width="16" height="6.5" rx="2" {...p} />
          <Rect x="4" y="13" width="16" height="6.5" rx="2" {...p} />
          <Path d="M7.5 7.75h.01M7.5 16.25h.01M11 7.75h5M11 16.25h5" {...p} />
        </>
      );
    case 'play':
      return <Path d="M8 5.5v13l10.5-6.5L8 5.5z" {...p} />;
    case 'external':
      return <Path d="M13.5 4.5h6v6M19.5 4.5 11 13M17 14v3.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2H10" {...p} />;
    // starter tiles: a hint of the interactive card the prompt produces
    case 'checklist':
      return (
        <>
          <Path d="M4 6.6l1.7 1.7L8.9 5" {...p} />
          <Path d="M4 12.6l1.7 1.7 3.2-3.3" {...p} />
          <Rect x="4.2" y="16.8" width="4.4" height="4.4" rx="1.2" {...p} />
          <Path d="M12 6.8h8M12 12.8h8M12 19h5.5" {...p} />
        </>
      );
    case 'calendar':
      return (
        <>
          <Rect x="3.75" y="5" width="16.5" height="15.5" rx="2.75" {...p} />
          <Path d="M3.75 9.75h16.5M8.25 3v4M15.75 3v4M7.75 13.5h3.5M7.75 16.75h7" {...p} />
        </>
      );
    case 'scale':
      return (
        <>
          <Path d="M12 4v16M8.5 20h7M5.5 7h13" {...p} />
          <Path d="M5.5 7 3 13.25M5.5 7 8 13.25M3 13.25a2.5 2.5 0 0 0 5 0z" {...p} />
          <Path d="M18.5 7 16 13.25M18.5 7 21 13.25M16 13.25a2.5 2.5 0 0 0 5 0z" {...p} />
        </>
      );
    case 'barChart':
      return <Path d="M4 20h16M7 16.5V12M12 16.5V6.5M17 16.5V9.5" {...p} />;
    case 'timer':
      return (
        <>
          <Circle cx="12" cy="13.5" r="7" {...p} />
          <Path d="M12 13.5V10M9.75 3.5h4.5M12 3.5v3M17.6 6.9l1.4-1.4" {...p} />
        </>
      );
    case 'bulb':
      return (
        <>
          <Path d="M9.25 17.5h5.5M10.25 20.75h3.5" {...p} />
          <Path d="M12 3.25a6 6 0 0 0-3.6 10.8c.65.5 1.1 1.2 1.1 2V17.5h5v-1.45c0-.8.45-1.5 1.1-2A6 6 0 0 0 12 3.25z" {...p} />
        </>
      );
    case 'bell':
      return (
        <>
          <Path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5l1.5-2z" {...p} />
          <Path d="M10 21h4" {...p} />
        </>
      );
    case 'mail':
      return (
        <>
          <Rect x="3.5" y="5.5" width="17" height="13" rx="2.5" {...p} />
          <Path d="m4.5 7.5 7.5 5.5 7.5-5.5" {...p} />
        </>
      );
    case 'bowl':
      return (
        <>
          <Path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0z" {...p} />
          <Path d="M9 8.5c0-1.2 1-1.5 1-2.75M13.5 8.5c0-1.2 1-1.5 1-2.75" {...p} />
        </>
      );
    // Hermes tool chips, file chips (hermesTools.ts)
    case 'terminal':
      return (
        <>
          <Rect x="3.5" y="5" width="17" height="14" rx="2.5" {...p} />
          <Path d="m7.5 10 3 2.5-3 2.5M13 15h3.5" {...p} />
        </>
      );
    case 'file':
      return <Path d="M7 3.5h6.5l5 5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5zM13.5 3.5v5h5M8.5 13h7M8.5 16.5h5" {...p} />;
    case 'image':
      return (
        <>
          <Rect x="3.5" y="4.5" width="17" height="15" rx="2.5" {...p} />
          <Circle cx="9" cy="10" r="1.6" {...p} />
          <Path d="m4 17 4.5-4.5 3.5 3.5 3-3 5 4.5" {...p} />
        </>
      );
    case 'users':
      return (
        <>
          <Circle cx="9" cy="9" r="3" {...p} />
          <Path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" {...p} />
          <Circle cx="17" cy="8.5" r="2.3" {...p} />
          <Path d="M16.5 13.5c2.5 0 4 1.6 4 4" {...p} />
        </>
      );
    case 'brain':
      return (
        <>
          <Path d="M9.5 4.5A3 3 0 0 0 6.5 7.5 3 3 0 0 0 5 12.7a3 3 0 0 0 2 4.8 2.5 2.5 0 0 0 5 .5V5.5a2 2 0 0 0-2.5-1z" {...p} />
          <Path d="M14.5 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.2 3 3 0 0 1-2 4.8 2.5 2.5 0 0 1-5 .5" {...p} />
        </>
      );
    case 'book':
      return <Path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h12v13.5h-12A1.5 1.5 0 0 0 5 19V5.5zM5 19a1.5 1.5 0 0 0 1.5 1.5h12v-3" {...p} />;
    case 'history':
      return (
        <>
          <Path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" {...p} />
          <Path d="M4 4v4.5h4.5M12 8v4l2.5 1.5" {...p} />
        </>
      );
    case 'compress':
      return <Path d="M4 9.5h5.5V4M20 9.5h-5.5V4M4 14.5h5.5V20M20 14.5h-5.5V20" {...p} />;
    case 'download':
      return <Path d="M12 4v11M7.5 11 12 15.5l4.5-4.5M5 19.5h14" {...p} />;
    case 'edit':
      return <Path d="M14.5 5.5l4 4L9 19H5v-4l9.5-9.5z" {...p} />;
    case 'code':
      return <Path d="m8.5 8-4 4 4 4m7-8 4 4-4 4M13.5 6l-3 12" {...p} />;
    case 'more':
      return (
        <>
          <Circle cx={5.5} cy={12} r={1.4} fill={color} stroke="none" />
          <Circle cx={12} cy={12} r={1.4} fill={color} stroke="none" />
          <Circle cx={18.5} cy={12} r={1.4} fill={color} stroke="none" />
        </>
      );
    case 'flag':
      return <Path d="M5.5 21V4.5m0 0h11l-2 4 2 4h-11" {...p} />;
    case 'archive':
      return <Path d="M4 5.5h16v3.5H4zM5.5 9v9a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9M10 12.5h4" {...p} />;
    case 'branch':
      return (
        <>
          <Circle cx={7} cy={5.5} r={2} {...p} />
          <Circle cx={7} cy={18.5} r={2} {...p} />
          <Circle cx={17} cy={8.5} r={2} {...p} />
          <Path d="M7 7.5v9M17 10.5c0 4-10 2.5-10 6" {...p} />
        </>
      );
    case 'cloud':
      return <Path d="M7 18.5h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.06 9.6 4.5 4.5 0 0 0 7 18.5z" {...p} />;
    case 'cloudCheck':
      return (
        <>
          <Path d="M7 18.5h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.06 9.6 4.5 4.5 0 0 0 7 18.5z" {...p} />
          <Path d="m9.5 13.8 1.8 1.8 3.4-3.4" {...p} />
        </>
      );
    case 'phone':
      return (
        <>
          <Rect x="7" y="3.5" width="10" height="17" rx="2.5" {...p} />
          <Path d="M11 17.5h2" {...p} />
        </>
      );
    case 'laptop':
      return (
        <>
          <Rect x="5" y="5.5" width="14" height="9.5" rx="1.5" {...p} />
          <Path d="M3 18.5h18" {...p} />
        </>
      );
    case 'pin':
      return <Path d="M12 17v4.5M9 3h6l-1 6 3 3.5V14H7v-1.5L10 9z" {...p} />;
    case 'lock':
      return (
        <>
          <Rect x="5.5" y="10.5" width="13" height="9.5" rx="2" {...p} />
          <Path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" {...p} />
        </>
      );
    case 'chevronLeft':
      return <Path d="M14.5 6 8.5 12l6 6" {...p} />;
  }
}
