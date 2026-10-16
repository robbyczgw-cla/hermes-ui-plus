/**
 * Dev-gallery section "Tagesplan, Wetter" (modules-c2). Mounted near the end of ui/Gallery.tsx.
 * Actions (calendar, send) go to the gallery's onAction logger ("LETZTE AKTION").
 */
import { View } from 'react-native';
import { useTheme } from '../../../theme';
import { HText } from '../../../primitives/basics';
import { HuiView } from '../../../HuiView';
import type { HuiActionHandler } from '../../../primitives/context';
import { localIsoDate } from './agendaModel.ts';

const today = localIsoDate(new Date());
const plusDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localIsoDate(d);
};

export const AGENDA_SAMPLE = {
  type: 'agenda',
  id: 'tag',
  date: today,
  title: 'Dein Tag',
  blocks: [
    { start: '08:00', end: '08:30', title: 'Frühstück', kind: 'meal' },
    { start: '08:30', end: '09:00', title: 'Pendeln', kind: 'travel', location: 'S-Bahn' },
    { start: '09:00', end: '11:00', title: 'Fokus: Bericht', kind: 'focus' },
    { start: '10:00', end: '10:30', title: 'Stand-up', kind: 'work', location: 'Raum 2' },
    { start: '10:15', end: '11:15', title: 'Kundencall', kind: 'event', note: 'Folien vorher teilen' },
    { start: '12:00', end: '13:00', title: 'Mittagessen', kind: 'meal', location: 'Kantine' },
    { start: '13:00', end: '16:00', title: 'Projektarbeit', kind: 'work' },
    { start: '17:30', end: '18:30', title: 'Laufen', kind: 'sport', location: 'Park' },
    { start: '19:00', end: '21:00', title: 'Freie Zeit', kind: 'free' },
  ],
};

export const WEATHER_SAMPLE = {
  type: 'weather',
  location: 'Berlin',
  unit: 'C',
  basis: 'sourced',
  source: 'https://open-meteo.com',
  current: { temp: 14.2, condition: 'partly', feelsLike: 12, wind: 18, humidity: 72, precip: 20 },
  hourly: [
    { time: '14:00', temp: 14, condition: 'partly' },
    { time: '15:00', temp: 15, condition: 'sunny' },
    { time: '16:00', temp: 15, condition: 'cloudy', precip: 10 },
    { time: '17:00', temp: 13, condition: 'showers', precip: 55 },
    { time: '18:00', temp: 12, condition: 'rain', precip: 70 },
    { time: '19:00', temp: 11, condition: 'drizzle', precip: 40 },
    { time: '20:00', temp: 10, condition: 'cloudy' },
    { time: '21:00', temp: 9, condition: 'partly' },
    { time: '22:00', temp: 8, condition: 'clear' },
    { time: '23:00', temp: 7, condition: 'clear' },
  ],
  daily: [
    { date: today, min: 7, max: 16, condition: 'showers', precip: 60 },
    { date: plusDays(1), min: 6, max: 13, condition: 'rain', precip: 85 },
    { date: plusDays(2), min: 4, max: 11, condition: 'cloudy', precip: 20 },
    { date: plusDays(3), min: 2, max: 9, condition: 'fog' },
    { date: plusDays(4), min: -1, max: 6, condition: 'snow', precip: 65 },
    { date: plusDays(5), min: 1, max: 12, condition: 'sunny' },
    { date: plusDays(6), min: 8, max: 19, condition: 'thunder', precip: 45 },
  ],
};

const WEATHER_NIGHT_SAMPLE = {
  type: 'weather',
  location: 'New York',
  unit: 'F',
  basis: 'sourced',
  source: 'National Weather Service',
  current: { temp: 58, condition: 'clear-night', feelsLike: 55, wind: 7, humidity: 61 },
  hourly: [
    { time: '22:00', temp: 57, condition: 'clear' },
    { time: '23:00', temp: 55, condition: 'partly' },
    { time: '00:00', temp: 54, condition: 'partly' },
    { time: '01:00', temp: 53, condition: 'wind' },
    { time: '02:00', temp: 52, condition: 'overcast' },
    { time: '03:00', temp: 51, condition: 'sleet', precip: 30 },
  ],
};

const ICON_ROW_SAMPLE = {
  type: 'weather',
  location: 'Alle Symbole',
  basis: 'illustrative',
  hourly: ['clear', 'sunny', 'partly', 'cloudy', 'overcast', 'fog', 'drizzle', 'rain', 'showers', 'thunder', 'snow', 'sleet', 'wind', 'clear-night', 'partly-night'].map((condition, i) => ({ time: `${String(i + 8).padStart(2, '0')}:00`, temp: 10 + i, condition })),
};

const SAMPLES: { title: string; node: unknown; streaming?: boolean }[] = [
  { title: 'agenda · heute, Überschneidungen, bearbeitbar', node: AGENDA_SAMPLE },
  { title: 'agenda · nicht bearbeitbar', node: { type: 'agenda', id: 'reise', date: plusDays(1), title: 'Reisetag', editable: false, blocks: [{ start: '06:40', end: '07:10', title: 'Taxi zum Flughafen', kind: 'travel' }, { start: '08:05', end: '09:20', title: 'Flug LH 172 → München', kind: 'travel', location: 'Terminal 1' }, { start: '10:00', end: '12:00', title: 'Workshop', kind: 'event' }] } },
  { title: 'agenda · streaming', node: { type: 'agenda', id: 'tag2', title: 'Plan', blocks: [{ start: '09:00', end: '10:00', title: 'Erster Block' }] }, streaming: true },
  { title: 'weather · Tag, °C', node: WEATHER_SAMPLE },
  { title: 'weather · Nacht, °F', node: WEATHER_NIGHT_SAMPLE },
  { title: 'weather · alle Bedingungen', node: ICON_ROW_SAMPLE },
  { title: 'weather · streaming', node: { type: 'weather', location: 'Hamburg' }, streaming: true },
];

export function GallerySectionC2({ onAction }: { onAction: HuiActionHandler }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.xl }}>
      <HText variant="title" style={{ marginTop: t.spacing.l }}>
        Tagesplan, Wetter
      </HText>
      {SAMPLES.map((s, i) => (
        <View key={i} style={{ gap: t.spacing.s }} nativeID={`gallery-c2-${i}`}>
          <HText variant="caption" weight="600" color="subtle">
            {s.title}
          </HText>
          <HuiView node={s.node} streaming={!!s.streaming} onAction={onAction} />
        </View>
      ))}
    </View>
  );
}
