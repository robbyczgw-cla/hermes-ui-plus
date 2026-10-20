/**
 * Small shared pieces of the live-card UI (design §3.3): the static Live seal (brass ringed dot + small caps, no
 * pulsing), the monospaced version chip, the progress ring of the tray, the card tile per type, tags, the
 * "In v5 entfernt" row and the time label.
 */
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useLocale, useT } from '../../i18n';
import { HText, PressableScale } from '../../ui/primitives/basics';
import { Icon } from '../../chat/icons';
import { D1Icon } from '../../ui/components/modules/d1/icons';
import { useTheme, type Theme } from '../../ui/theme';
import type { LiveCardType, LiveItem } from '../model.ts';

export function LiveSeal({ t }: { t: Theme }) {
  const tr = useT();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }} accessible accessibilityLabel={tr('live.seal')}>
      <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: t.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.colors.accent }} />
      </View>
      <HText variant="micro" weight="700" color="accent" style={{ letterSpacing: 1.2, textTransform: 'uppercase' }}>
        {tr('live.seal')}
      </HText>
    </View>
  );
}

export function VersionChip({ n, t, small }: { n: number; t: Theme; small?: boolean }) {
  const tr = useT();
  return (
    <View style={{ paddingHorizontal: small ? 6 : 7, paddingVertical: 1, borderRadius: t.radii.inline, backgroundColor: t.colors.surfaceAlt }}>
      <HText variant="caption" weight="600" color="muted" style={{ fontFamily: t.typography.mono.fontFamily, fontSize: small ? 12 : 13 }}>
        {tr('live.version', { n })}
      </HText>
    </View>
  );
}

/** Thin progress ring (tray). Brass while open, sage when done. */
export function ProgressRing({ done, total, size = 30 }: { done: number; total: number; size?: number }) {
  const t = useTheme();
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = total ? done / total : 0;
  return (
    <Svg width={size} height={size} aria-hidden>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.colors.surfaceAlt} strokeWidth={stroke} fill="none" />
      {ratio > 0 ? (
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={ratio >= 1 ? t.colors.success : t.colors.accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * ratio} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ) : null}
    </Svg>
  );
}

/** The card's icon tile (brass on a soft brass square; muted when finished): list, calendar (trip), tag (watchlist). */
export function ListTile({ t, size = 40, muted, type = 'checklist' }: { t: Theme; size?: number; muted?: boolean; type?: LiveCardType }) {
  const color = muted ? t.colors.subtle : t.colors.accent;
  const s = Math.round(size * 0.5);
  return (
    <View style={{ width: size, height: size, borderRadius: t.radii.control, backgroundColor: muted ? t.colors.surfaceAlt : t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }} aria-hidden>
      {type === 'products' ? <D1Icon name="tag" size={s} color={color} /> : <Icon name={type === 'trip' ? 'calendar' : 'checklist'} size={s} color={color} />}
    </View>
  );
}

/** "In v5 entfernt: Pantheon · Zurückholen" (trip and watchlist bodies; the restore is an `add` per item). */
export function RemovedLine({ t, n, items, onRestore }: { t: Theme; n: number; items: readonly LiveItem[]; onRestore: () => void }) {
  const tr = useT();
  const names = items.map((i) => i.text).join(', ');
  return (
    <View style={{ marginHorizontal: t.spacing.l, marginTop: t.spacing.s, flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, minHeight: 48, paddingHorizontal: t.spacing.m, borderRadius: t.radii.control, backgroundColor: t.colors.surfaceAlt }}>
      <Icon name="retry" size={16} color={t.colors.muted} />
      <HText variant="callout" color="muted" style={{ flex: 1 }} numberOfLines={2}>
        {tr('live.card.removed', { n })} <HText variant="callout" weight="600">{names}</HText>
      </HText>
      <PressableScale haptic="selection" onPress={onRestore} accessibilityRole="button" accessibilityLabel={tr('live.card.restoreA11y', { items: names })} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
        <HText variant="callout" weight="600" color="accent">
          {tr('live.card.restore')}
        </HText>
      </PressableScale>
    </View>
  );
}

export function Tag({ label, tone, t }: { label: string; tone: 'accent' | 'info' | 'danger'; t: Theme }) {
  const bg = tone === 'accent' ? t.colors.accentSoft : tone === 'info' ? t.colors.infoSoft : t.colors.dangerSoft;
  const fg = tone === 'accent' ? t.colors.accentText : tone === 'info' ? t.colors.info : t.colors.danger;
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: t.radii.inline, backgroundColor: bg }}>
      <HText variant="micro" weight="700" style={{ color: fg }}>
        {label}
      </HText>
    </View>
  );
}

/** "12:41" today, "Do 18:20" this week, else a short date. */
export function useTimeLabel(): (at: number) => string {
  const { formatDate } = useLocale();
  return (at: number) => {
    const d = new Date(at);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return formatDate(d, { hour: '2-digit', minute: '2-digit' });
    if (now.getTime() - d.getTime() < 6 * 86400_000) return formatDate(d, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    return formatDate(d, { day: 'numeric', month: 'short' });
  };
}
