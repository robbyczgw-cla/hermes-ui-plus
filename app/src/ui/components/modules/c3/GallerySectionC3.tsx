/**
 * Dev-gallery section "Entscheiden, Sortieren, Bewerten" (modules-c3). Mounted in ui/Gallery.tsx.
 * Replies go to the gallery's onAction logger ("LETZTE AKTION").
 */
import { View } from 'react-native';
import { useTheme } from '../../../theme';
import { HText } from '../../../primitives/basics';
import { HuiView } from '../../../HuiView';
import type { HuiActionHandler } from '../../../primitives/context';

export const DECISION_SAMPLE = {
  type: 'decision',
  id: 'wohnung',
  title: 'Welche Wohnung?',
  criteria: [
    { id: 'preis', label: 'Preis', weight: 8 },
    { id: 'lage', label: 'Lage', weight: 6 },
    { id: 'groesse', label: 'Größe', weight: 5 },
    { id: 'licht', label: 'Licht & Balkon', weight: 3 },
  ],
  options: [
    { id: 'a', label: 'Wohnung A · Altbau', scores: { preis: 6, lage: 9, groesse: 6, licht: 8 }, note: '3. OG ohne Aufzug' },
    { id: 'b', label: 'Wohnung B · Neubau', scores: { preis: 8, lage: 7, groesse: 8, licht: 6 } },
    { id: 'c', label: 'Wohnung C · Stadtrand', scores: { preis: 9, Lage: 4, 'Größe': 9 } },
  ],
  note: 'Bewertungen 0–10 aus deinen Angaben; fehlende Werte zählen nicht mit.',
};

export const RANK_SAMPLE = {
  type: 'rank',
  id: 'urlaub-prio',
  prompt: 'Was ist dir im Urlaub am wichtigsten?',
  items: [
    { id: 'strand', label: 'Strand & Meer', description: 'Baden, Sonne, Ruhe' },
    { id: 'kultur', label: 'Kultur & Städte' },
    { id: 'essen', label: 'Gutes Essen', description: 'Märkte, Restaurants, Kochkurs' },
    { id: 'natur', label: 'Wandern & Natur' },
    { id: 'budget', label: 'Niedrige Kosten' },
  ],
};

export const SCALE_SAMPLES = [
  { type: 'scale', id: 'zufrieden', question: 'Wie zufrieden bist du mit dem Vorschlag?', style: 'stars', labels: { min: 'gar nicht', max: 'sehr' } },
  { type: 'scale', id: 'stimmung', question: 'Wie geht es dir heute?', style: 'emoji' },
  { type: 'scale', id: 'nps', question: 'Wie wahrscheinlich empfiehlst du uns weiter?', min: 0, max: 10, style: 'segments', labels: { min: 'unwahrscheinlich', max: 'sehr wahrscheinlich' } },
  { type: 'scale', id: 'schaerfe', question: 'Wie scharf darf es sein?', min: 0, max: 100, step: 5, style: 'slider', labels: { min: 'mild', max: 'feurig' } },
];

const SAMPLES: { title: string; node: unknown; streaming?: boolean }[] = [
  { title: 'decision · Entscheidungsmatrix', node: DECISION_SAMPLE },
  { title: 'rank · Reihenfolge', node: RANK_SAMPLE },
  ...SCALE_SAMPLES.map((n) => ({ title: `scale · ${n.style}`, node: n })),
  { title: 'decision · streaming (teilweise)', node: { type: 'decision', id: 'teil', criteria: DECISION_SAMPLE.criteria.slice(0, 2), options: DECISION_SAMPLE.options.slice(0, 1) }, streaming: true },
  { title: 'rank · streaming (teilweise)', node: { ...RANK_SAMPLE, id: 'teil-rank', items: RANK_SAMPLE.items.slice(0, 2) }, streaming: true },
];

export function GallerySectionC3({ onAction }: { onAction: HuiActionHandler }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.xl }}>
      <HText variant="title" style={{ marginTop: t.spacing.l }}>
        Entscheiden, Sortieren, Bewerten
      </HText>
      {SAMPLES.map((s, i) => (
        <View key={i} style={{ gap: t.spacing.s }} nativeID={`gallery-c3-${i}`}>
          <HText variant="caption" weight="600" color="subtle">
            {s.title}
          </HText>
          <HuiView node={s.node} streaming={!!s.streaming} onAction={onAction} />
        </View>
      ))}
    </View>
  );
}
