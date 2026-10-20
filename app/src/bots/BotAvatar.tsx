/**
 * A bot's avatar: a squircle with its monogram. The default bot keeps the app's brass "H" look (hairline ring); every
 * other bot gets Hermes Desktop's colour, else a stable hue of the theme's categorical palette (bots/core.ts).
 */
import { View } from 'react-native';
import { ensureContrast, HText, useTheme, withAlpha } from '../ui';
import { botMonogram, botTintIndex } from './core';

export type BotAvatarProps = {
  name: string;
  /** profile name (stable colour); undefined = the default bot */
  bot?: string;
  color?: string;
  size?: number;
};

export function BotAvatar({ name, bot, color, size = 42 }: BotAvatarProps) {
  const t = useTheme();
  const c = t.colors;
  const radius = Math.round(size * 0.3);
  const letter = botMonogram(name);
  const fontSize = Math.round(size * 0.44);
  if (!bot) {
    return (
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: c.accentSoft, borderWidth: 1.5, borderColor: c.accent, alignItems: 'center', justifyContent: 'center' }}
      >
        <HText style={{ color: c.accentText, fontSize, lineHeight: Math.round(fontSize * 1.2), fontWeight: '700' }}>{letter}</HText>
      </View>
    );
  }
  const ink = color ?? c.chart[botTintIndex(bot, c.chart.length)] ?? c.accent;
  const bg = withAlpha(ink, t.dark ? 0.24 : 0.14);
  const fg = ensureContrast(ink, c.surface, 4.5);
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: radius, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <HText style={{ color: fg, fontSize, lineHeight: Math.round(fontSize * 1.2), fontWeight: '700' }}>{letter}</HText>
    </View>
  );
}
