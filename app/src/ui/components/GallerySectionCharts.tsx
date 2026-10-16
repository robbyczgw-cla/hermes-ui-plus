/**
 * Dev-gallery section "Diagramme v3" (charts-v3): one sample per new chart kind, stats sparklines and
 * partial-data (streaming) states. Mounted from ui/Gallery.tsx.
 */
import { View } from 'react-native';
import { useTheme } from '../theme';
import { HText } from '../primitives/basics';
import { HuiView } from '../HuiView';
import type { HuiActionHandler } from '../primitives/context';
import { dayToIso, isoDay } from '../lib/chartMath3';

function calendarData(): { x: string; y: number }[] {
  const end = isoDay('2026-10-10')!;
  const out: { x: string; y: number }[] = [];
  for (let d = end - 7 * 26 + 1; d <= end; d++) {
    const wd = (((d + 3) % 7) + 7) % 7;
    const wave = Math.sin(d / 9) * 3 + Math.cos(d / 4) * 2;
    const v = Math.max(0, Math.round((wd >= 5 ? 1 : 5) + wave + ((d * 37) % 7) - 3));
    out.push({ x: dayToIso(d), y: v });
  }
  return out;
}

function matrixData() {
  const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const slots = ['6–9', '9–12', '12–15', '15–18', '18–21', '21–24'];
  return days.flatMap((d, di) => slots.map((s, si) => ({ x: s, y2: d, y: Math.max(0, Math.round(((di < 5 ? [3, 8, 6, 7, 4, 1] : [0, 3, 6, 5, 7, 4])[si] + ((di * 5 + si * 3) % 4) - 1) * 10) / 10) })));
}

export const CHART_V3_SAMPLES: { title: string; node: unknown; streaming?: boolean }[] = [
  {
    title: 'chart · hbar (Ranking)',
    node: {
      type: 'chart',
      kind: 'hbar',
      title: 'Meistgenutzte Programmiersprachen',
      unit: '%',
      basis: 'sourced',
      source: 'https://survey.stackoverflow.co/2025',
      series: [{ name: 'Anteil', data: [{ x: 'JavaScript', y: 62.3 }, { x: 'Python', y: 51 }, { x: 'TypeScript', y: 38.5 }, { x: 'Java', y: 30.3 }, { x: 'C#', y: 27.1 }, { x: 'Go', y: 13.5 }] }],
    },
  },
  {
    title: 'chart · stacked (Legende tippen = ein-/ausblenden)',
    node: {
      type: 'chart',
      kind: 'stacked',
      title: 'Strommix je Quartal',
      unit: 'TWh',
      basis: 'illustrative',
      series: [
        { name: 'Wind', data: [{ x: 'Q1', y: 42 }, { x: 'Q2', y: 28 }, { x: 'Q3', y: 24 }, { x: 'Q4', y: 45 }] },
        { name: 'Solar', data: [{ x: 'Q1', y: 9 }, { x: 'Q2', y: 26 }, { x: 'Q3', y: 28 }, { x: 'Q4', y: 7 }] },
        { name: 'Kohle', data: [{ x: 'Q1', y: 30 }, { x: 'Q2', y: 18 }, { x: 'Q3', y: 20 }, { x: 'Q4', y: 31 }] },
        { name: 'Gas', data: [{ x: 'Q1', y: 16 }, { x: 'Q2', y: 10 }, { x: 'Q3', y: 11 }, { x: 'Q4', y: 17 }] },
      ],
    },
  },
  {
    title: 'chart · scatter (Punkt tippen = Label)',
    node: {
      type: 'chart',
      kind: 'scatter',
      title: 'Preis vs. Akkulaufzeit',
      xLabel: 'Preis (€)',
      yLabel: 'Akku',
      unit: 'h',
      basis: 'estimate',
      series: [
        { name: 'Android', data: [{ x: 349, y: 21, label: 'Pixel 9a' }, { x: 899, y: 24, label: 'Galaxy S25' }, { x: 1299, y: 27, label: 'Galaxy S25 Ultra' }, { x: 229, y: 18, label: 'Moto G85' }, { x: 699, y: 19, label: 'Nothing 3' }] },
        { name: 'iOS', data: [{ x: 699, y: 20, label: 'iPhone 16e' }, { x: 949, y: 22, label: 'iPhone 17' }, { x: 1449, y: 31, label: 'iPhone 17 Pro Max' }] },
      ],
    },
  },
  {
    title: 'chart · radar (2 Reihen, Achsen umbrechen)',
    node: {
      type: 'chart',
      kind: 'radar',
      title: 'Smartphone-Vergleich',
      max: 10,
      basis: 'estimate',
      series: [
        { name: 'Pixel 9a', data: [{ x: 'Kamera', y: 8.5 }, { x: 'Akkulaufzeit', y: 8 }, { x: 'Display', y: 7.5 }, { x: 'Leistung', y: 7 }, { x: 'Preis-Leistungs-Verhältnis', y: 9.5 }, { x: 'Software Updates', y: 9.5 }] },
        { name: 'Galaxy S25', data: [{ x: 'Kamera', y: 8.8 }, { x: 'Akkulaufzeit', y: 7 }, { x: 'Display', y: 9.4 }, { x: 'Leistung', y: 9.3 }, { x: 'Preis-Leistungs-Verhältnis', y: 6.5 }, { x: 'Software Updates', y: 9 }] },
      ],
    },
  },
  {
    title: 'chart · gauge (Ziel-Markierung)',
    node: { type: 'chart', kind: 'gauge', title: 'Sparziel 2026', unit: '%', target: 80, basis: 'user', series: [{ name: 'Erreicht', data: [{ x: 'Okt', y: 72 }] }] },
  },
  {
    title: 'chart · gauge (Top-Level value, min/max)',
    node: { type: 'chart', kind: 'gauge', title: 'Luftfeuchte Wohnzimmer', unit: '%', min: 20, max: 80, value: 47.5, basis: 'sourced', source: 'Sensor Wohnzimmer' },
  },
  {
    title: 'chart · heatmap (Kalender)',
    node: { type: 'chart', kind: 'heatmap', title: 'Trainingsminuten', unit: 'min', basis: 'user', series: [{ name: 'Minuten', data: calendarData().map((p) => ({ ...p, y: p.y * 10 })) }] },
  },
  {
    title: 'chart · heatmap (Matrix)',
    node: { type: 'chart', kind: 'heatmap', title: 'Besucher nach Tag und Uhrzeit', unit: 'Tsd.', basis: 'illustrative', series: [{ name: 'Besucher', data: matrixData() }] },
  },
  {
    title: 'chart · waterfall',
    node: {
      type: 'chart',
      kind: 'waterfall',
      title: 'Monatsbudget Oktober',
      unit: '€',
      basis: 'calculated',
      series: [
        {
          name: 'Budget',
          data: [
            { x: 'Gehalt', y: 3200 },
            { x: 'Nebenjob', y: 450 },
            { x: 'Miete', y: -1150 },
            { x: 'Lebensmittel', y: -520 },
            { x: 'Verfügbar', y: 0, total: true },
            { x: 'Sparen', y: -600 },
            { x: 'Freizeit', y: -380 },
            { x: 'Rest', y: 0, total: true },
          ],
        },
      ],
    },
  },
  {
    title: 'stats · sparkline',
    node: {
      type: 'stats',
      basis: 'sourced',
      source: 'Depot-Auszug',
      items: [
        { label: 'Depotwert', value: '24.380 €', delta: '+3,2 %', sparkline: [21.1, 21.8, 21.4, 22.6, 23.0, 22.4, 23.6, 24.38] },
        { label: 'Ausgaben Okt.', value: '1.912 €', delta: '−8 %', trend: 'down', sparkline: [2300, 2150, 2210, 2080, 1990, 1912] },
        { label: 'Schritte/Tag', value: '8.412', sparkline: [7200, 9100, 6400, 8800, 10200, 7600, 8412] },
        { label: 'Ruhepuls', value: '58', delta: '±0', trend: 'flat', sparkline: [58, 58] },
      ],
    },
  },
  {
    title: 'partial · gauge ohne Wert (Skelett)',
    streaming: true,
    node: { type: 'chart', kind: 'gauge', title: 'Akku', series: [{ name: 'Akku', data: [] }] },
  },
  {
    title: 'partial · radar mit 2 Achsen (Skelett)',
    streaming: true,
    node: { type: 'chart', kind: 'radar', series: [{ name: 'A', data: [{ x: 'Kamera', y: 8 }, { x: 'Akku', y: 7 }] }] },
  },
  {
    title: 'partial · waterfall halb geladen',
    streaming: true,
    node: { type: 'chart', kind: 'waterfall', title: 'Gewinnbrücke', unit: 'Mio. €', series: [{ name: 'GuV', data: [{ x: 'Umsatz', y: 12.4 }, { x: 'Material', y: -5.1 }, { x: 'Personal' }] }] },
  },
  {
    title: 'partial · heatmap ohne Daten (Skelett)',
    streaming: true,
    node: { type: 'chart', kind: 'heatmap', title: 'Trainingsminuten', series: [] },
  },
  {
    title: 'partial · scatter ohne numerisches x (Skelett)',
    streaming: true,
    node: { type: 'chart', kind: 'scatter', series: [{ name: 'a', data: [{ x: 'kein', y: 1 }] }] },
  },
];

export function GallerySectionCharts({ onAction }: { onAction: HuiActionHandler }) {
  const t = useTheme();
  return (
    <>
      <HText variant="title" style={{ marginTop: t.spacing.l }}>
        Diagramme v3
      </HText>
      {CHART_V3_SAMPLES.map((s, i) => (
        <View key={i} style={{ gap: t.spacing.s }} testID={`charts-v3-${i}`}>
          <HText variant="caption" weight="600" color="subtle">
            {s.title}
          </HText>
          <HuiView node={s.node} streaming={s.streaming} onAction={onAction} />
        </View>
      ))}
    </>
  );
}
