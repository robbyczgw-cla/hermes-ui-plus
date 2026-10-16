/**
 * `weather` node (docs/SPEC-modules-v3.md): header with location, current temperature + animated
 * condition icon, feels-like / wind / humidity / precipitation chips, hourly strip (horizontal
 * scroll, night variants), daily rows with min–max range bars on one shared scale (temperature
 * gradient, current-temp dot on today), precipitation drops, provenance chip, °C/°F toggle
 * (persisted per node). Not interactive (no reply).
 */
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { useTheme, type Theme } from '../../../theme';
import { scaleFont } from '../../../themes';
import { useHui } from '../../../primitives/context';
import { HText, PressableScale, Surface } from '../../../primitives/basics';
import { Skeleton, SkeletonLines } from '../../../primitives/Skeleton';
import { haptic } from '../../../primitives/haptics';
import { useNodeState } from '../../../../nodestate';
import { useLocale, useT } from '../../../../i18n';
import type { HuiWeather, HuiWeatherCondition } from '../../../types';
import { ProvenanceChip } from '../ProvenanceChip';
import { formatClock, formatShortClock, localIsoDate } from './agendaModel.ts';
import { WeatherIcon } from './WeatherIcon';
import {
  conditionKey,
  convertTemp,
  convertWind,
  dayKind,
  formatPercent,
  formatTemp,
  hourCondition,
  precipLabel,
  rangeBar,
  readWeather,
  scalePos,
  tempColor,
  tempScale,
  type Unit,
  type WDay,
  type WHour,
} from './weatherModel.ts';

type WState = { unit?: Unit };

function Drop({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3.5c3.2 4.2 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2.8-6.8 6-11z" fill={color} />
    </Svg>
  );
}

export function Weather({ node }: { node: Partial<HuiWeather> }) {
  const t = useTheme();
  const tr = useT();
  const { locale, lang } = useLocale();
  const { streaming } = useHui();
  const data = useMemo(() => readWeather(node as Record<string, unknown>), [node]);
  const stateId = typeof node.id === 'string' && node.id ? node.id : `weather:${data.location || 'x'}`;
  const [state, setState] = useNodeState<WState>(stateId, {});
  const unit: Unit = state.unit ?? data.unit;
  const T = (v: number) => convertTemp(v, data.unit, unit);
  const toC = (v: number) => convertTemp(v, data.unit, 'C');
  const rain = t.dark ? '#62AEF5' : '#2F80D9';
  const cond = (c: HuiWeatherCondition) => tr(`ui.weather.cond.${conditionKey(c)}`);

  const today = localIsoDate(new Date());
  const todayRow = data.daily.find((d) => d.date === today);
  const scale = useMemo(() => tempScale(data.daily, data.current && todayRow ? [data.current.temp] : []), [data.daily, data.current, todayRow]);

  if (!data.location && !data.current && !data.hourly.length && !data.daily.length) {
    return streaming ? <WeatherSkeleton /> : null;
  }

  const setUnit = (u: Unit) => {
    if (u === unit) return;
    haptic('selection');
    setState({ unit: u });
  };
  const windText = (w: number) => `${Math.round(convertWind(w, data.unit, unit))} ${unit === 'F' ? 'mph' : 'km/h'}`;
  const chips: { key: string; label: string; icon?: 'drop' }[] = [];
  const c = data.current;
  if (c?.feelsLike !== undefined) chips.push({ key: 'feels', label: tr('ui.weather.feelsLike', { value: formatTemp(T(c.feelsLike)) }) });
  if (c?.wind !== undefined) chips.push({ key: 'wind', label: tr('ui.weather.wind', { value: windText(c.wind) }) });
  if (c?.humidity !== undefined) chips.push({ key: 'hum', label: tr('ui.weather.humidity', { value: formatPercent(c.humidity, lang) }) });
  if (c?.precip !== undefined) chips.push({ key: 'precip', label: tr('ui.weather.precip', { value: formatPercent(c.precip, lang) }), icon: 'drop' });

  const weekday = (date: string) => {
    const k = dayKind(date, today);
    if (k === 'today') return tr('ui.weather.today');
    if (k === 'tomorrow') return tr('ui.weather.tomorrow');
    const [y, m, d] = date.split('-').map(Number);
    try {
      return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(y, m - 1, d)).replace(/\.$/, '');
    } catch {
      return date.slice(5);
    }
  };
  const hourPrecip = data.hourly.some((h) => precipLabel(h.precip, lang) !== null);
  const hourLabel = (h: WHour) => (h.minutes == null ? h.time : formatClock(h.minutes, locale, lang));
  // visible label: "12 PM" instead of "12:00 PM" (the screen reader keeps the full time)
  const hourShort = (h: WHour) => (h.minutes == null ? h.time : formatShortClock(h.minutes, locale, lang));

  return (
    <Surface>
      <View style={{ gap: t.spacing.l }}>
        {/* header */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.m }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <HText variant="headline" numberOfLines={1} accessibilityRole="header">
              {data.location || ' '}
            </HText>
            {c ? (
              <View accessible accessibilityLabel={tr('ui.weather.a11yCurrent', { temp: formatTemp(T(c.temp), unit), condition: cond(c.condition) })} style={{ gap: 0 }}>
                <HText tabular style={{ ...scaleFont(48, 56, t.fontScale), fontWeight: '400', letterSpacing: -1.5, color: t.colors.text }}>
                  {formatTemp(T(c.temp))}
                </HText>
                <HText variant="callout" color="muted" numberOfLines={1}>
                  {cond(c.condition)}
                </HText>
              </View>
            ) : streaming ? (
              <Skeleton width={90} height={40} />
            ) : null}
            {todayRow ? (
              <HText variant="caption" color="subtle" tabular>
                {`${tr('ui.weather.high', { value: formatTemp(T(todayRow.max)) })}  ·  ${tr('ui.weather.low', { value: formatTemp(T(todayRow.min)) })}`}
              </HText>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: t.spacing.s }}>
            <UnitToggle t={t} unit={unit} onChange={setUnit} label={tr('ui.weather.unitLabel')} />
            {c ? <WeatherIcon condition={c.condition} size={72} animate /> : null}
          </View>
        </View>

        {chips.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {chips.map((ch) => (
              <View key={ch.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, minHeight: 28, borderRadius: t.radii.pill, backgroundColor: t.colors.surfaceAlt }}>
                {ch.icon ? <Drop color={rain} /> : null}
                <HText variant="caption" tabular>
                  {ch.label}
                </HText>
              </View>
            ))}
          </View>
        ) : null}

        {/* hourly */}
        {data.hourly.length ? (
          <View style={{ gap: t.spacing.s }}>
            <SectionLabel text={tr('ui.weather.hourly')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, paddingRight: t.spacing.s }} style={{ marginHorizontal: -4 }}>
              {data.hourly.map((h, i) => (
                <HourCell key={`${h.time}-${i}`} t={t} showPrecip={hourPrecip} label={hourShort(h)} temp={formatTemp(T(h.temp))} condition={hourCondition(h)} precip={precipLabel(h.precip, lang)} rain={rain} a11y={`${tr('ui.weather.a11yHour', { time: hourLabel(h), temp: formatTemp(T(h.temp), unit), condition: cond(hourCondition(h)) })}${h.precip !== undefined && h.precip >= 10 ? `, ${tr('ui.weather.a11yPrecip', { value: formatPercent(h.precip, lang) })}` : ''}`} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* daily */}
        {data.daily.length && scale ? (
          <View style={{ gap: 2 }}>
            <SectionLabel text={tr('ui.weather.daily', { count: data.daily.length })} />
            {data.daily.map((d, i) => (
              <DayRow
                key={`${d.date}-${i}`}
                t={t}
                day={weekday(d.date)}
                d={d}
                T={T}
                toC={toC}
                scale={scale}
                current={d.date === today && c ? c.temp : undefined}
                precip={precipLabel(d.precip, lang)}
                rain={rain}
                a11y={`${tr('ui.weather.a11yDay', { day: weekday(d.date), condition: cond(d.condition), min: formatTemp(T(d.min), unit), max: formatTemp(T(d.max), unit) })}${d.precip !== undefined && d.precip >= 10 ? `, ${tr('ui.weather.a11yPrecip', { value: formatPercent(d.precip, lang) })}` : ''}`}
                last={i === data.daily.length - 1}
              />
            ))}
          </View>
        ) : null}

        {streaming ? <SkeletonLines lines={2} /> : null}
        <ProvenanceChip node={node} />
      </View>
    </Surface>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <HText variant="caption" weight="600" color="subtle" accessibilityRole="header">
      {text}
    </HText>
  );
}

function UnitToggle({ t, unit, onChange, label }: { t: Theme; unit: Unit; onChange: (u: Unit) => void; label: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.pill, padding: 2 }}>
      {(['C', 'F'] as const).map((u) => {
        const on = u === unit;
        return (
          <PressableScale
            key={u}
            haptic={false}
            onPress={() => onChange(u)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`°${u}`}
            hitSlop={{ top: 8, bottom: 8 }}
            style={{ minWidth: 36, height: 28, borderRadius: t.radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.colors.surface : 'transparent', ...(on ? t.shadows.sm : null) }}
          >
            <HText variant="caption" weight={on ? '600' : '400'} style={{ color: on ? t.colors.text : t.colors.muted }}>
              {`°${u}`}
            </HText>
          </PressableScale>
        );
      })}
    </View>
  );
}

function HourCell({ t, showPrecip, label, temp, condition, precip, rain, a11y }: { t: Theme; showPrecip: boolean; label: string; temp: string; condition: HuiWeatherCondition; precip: string | null; rain: string; a11y: string }) {
  return (
    // minWidth, not width: a longer label ("12:30 PM", large font scale) widens its cell instead of being cut to "12:00 P…"
    <View accessible accessibilityLabel={a11y} style={{ minWidth: 56, paddingHorizontal: 2, alignItems: 'center', gap: 6, paddingVertical: t.spacing.s, borderRadius: t.radii.control }}>
      <HText variant="caption" color="muted" tabular numberOfLines={1}>
        {label}
      </HText>
      <WeatherIcon condition={condition} size={28} />
      <HText variant="callout" weight="600" tabular>
        {temp}
      </HText>
      {showPrecip ? <View style={{ height: 14, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {precip ? (
          <>
            <Drop color={rain} size={9} />
            <HText variant="micro" tabular style={{ color: rain }}>
              {precip}
            </HText>
          </>
        ) : null}
      </View> : null}
    </View>
  );
}

function DayRow({
  t,
  day,
  d,
  T,
  toC,
  scale,
  current,
  precip,
  rain,
  a11y,
  last,
}: {
  t: Theme;
  day: string;
  d: WDay;
  T: (v: number) => number;
  toC: (v: number) => number;
  scale: { lo: number; hi: number };
  current?: number;
  precip: string | null;
  rain: string;
  a11y: string;
  last: boolean;
}) {
  const bar = rangeBar(d.min, d.max, scale);
  return (
    <View accessible accessibilityLabel={a11y} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, minHeight: 44, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.colors.border }}>
      <HText variant="callout" weight="500" numberOfLines={1} style={{ minWidth: 66, maxWidth: 120, flexShrink: 0 }}>
        {day}
      </HText>
      <WeatherIcon condition={d.condition} size={24} />
      <View style={{ width: 38, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {precip ? (
          <>
            <Drop color={rain} size={9} />
            <HText variant="micro" tabular style={{ color: rain }} numberOfLines={1}>
              {precip}
            </HText>
          </>
        ) : null}
      </View>
      <HText variant="callout" color="muted" tabular align="right" style={{ width: 34 }}>
        {formatTemp(T(d.min))}
      </HText>
      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: t.colors.surfaceAlt, minWidth: 40 }}>
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${bar.left * 100}%`, width: `${bar.width * 100}%`, borderRadius: 3, overflow: 'hidden' }}>
          <LinearGradient colors={[tempColor(toC(d.min)), tempColor(toC(d.max))]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1 }} />
        </View>
        {current !== undefined ? (
          <View style={{ position: 'absolute', top: -2, left: `${scalePos(current, scale) * 100}%`, marginLeft: -5, width: 10, height: 10, borderRadius: 5, backgroundColor: t.colors.surface, borderWidth: 2.5, borderColor: t.colors.text }} />
        ) : null}
      </View>
      <HText variant="callout" weight="600" tabular style={{ width: 34 }}>
        {formatTemp(T(d.max))}
      </HText>
    </View>
  );
}

export function WeatherSkeleton() {
  const t = useTheme();
  return (
    <Surface>
      <View style={{ gap: t.spacing.m }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ gap: t.spacing.s, flex: 1 }}>
            <Skeleton width="50%" height={16} />
            <Skeleton width={96} height={44} />
          </View>
          <Skeleton width={64} height={64} radius={32} />
        </View>
        <Skeleton height={64} />
        <SkeletonLines lines={3} />
      </View>
    </Surface>
  );
}
