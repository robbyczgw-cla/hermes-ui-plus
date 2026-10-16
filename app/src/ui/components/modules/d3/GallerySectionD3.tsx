/**
 * Dev-gallery section "Lernen & Mindmap" (modules-d3). Mounted once in ui/Gallery.tsx.
 * Replies ("Fortschritt senden", vocab result, "Vertiefen") go to the gallery's onAction logger.
 */
import { View } from 'react-native';
import { useTheme } from '../../../theme';
import { HText } from '../../../primitives/basics';
import { HuiView } from '../../../HuiView';
import type { HuiActionHandler } from '../../../primitives/context';
import { MINDMAP_SAMPLE, STUDYPLAN_SAMPLE, VOCAB_SAMPLE } from './samples';

const VOCAB_TYPE_SAMPLE = {
  type: 'vocab',
  id: 'de-es-basics',
  title: 'Deutsch für Sam',
  from: 'de',
  to: 'es',
  mode: 'type',
  items: [
    { term: 'der Bahnhof', translation: 'la estación de tren', example: 'Wo ist der Bahnhof?' },
    { term: 'die Straße', translation: 'la calle' },
    { term: 'das Frühstück', translation: 'el desayuno' },
    { term: 'schön', translation: 'bonito / bonita' },
    { term: 'Grüß Gott', translation: 'hola (en Austria y Baviera)', note: 'Regional, sehr gebräuchlich in Österreich.' },
  ],
};

const PARTIAL_STUDYPLAN = { type: 'studyplan', id: 'sp-part', title: 'Führerschein Theorie', weeks: [{ label: 'Woche 1', days: [{ label: 'Mo', tasks: [{ text: 'Vorfahrtsregeln', minutes: 30, kind: 'learn' }] }] }] };
const PARTIAL_MINDMAP = { type: 'mindmap', id: 'mm-part', root: { label: 'Photosynthese', children: [{ label: 'Licht' }, { label: 'Chlorophyll' }] } };

const SAMPLES: { title: string; node: unknown; streaming?: boolean }[] = [
  { title: 'studyplan · Spanisch A1 in 4 Wochen', node: STUDYPLAN_SAMPLE },
  { title: 'studyplan · streaming (erste Woche)', node: PARTIAL_STUDYPLAN, streaming: true },
  { title: 'studyplan · streaming (leer)', node: { type: 'studyplan', id: 'sp-empty', title: 'Lernplan' }, streaming: true },
  { title: 'vocab · 12 spanische Wörter (Karten, 🔊)', node: VOCAB_SAMPLE },
  { title: 'vocab · Eintippen de ← es', node: VOCAB_TYPE_SAMPLE },
  { title: 'vocab · streaming (leer)', node: { type: 'vocab', id: 'v-empty', from: 'es', to: 'de', items: [] }, streaming: true },
  { title: 'mindmap · Wärmepumpe', node: MINDMAP_SAMPLE },
  { title: 'mindmap · streaming', node: PARTIAL_MINDMAP, streaming: true },
  { title: 'mindmap · streaming (leer)', node: { type: 'mindmap', id: 'mm-empty', root: {} }, streaming: true },
];

export function GallerySectionD3({ onAction }: { onAction: HuiActionHandler }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.xl }}>
      <HText variant="title" style={{ marginTop: t.spacing.l }}>
        Lernen & Mindmap
      </HText>
      {SAMPLES.map((s, i) => (
        <View key={i} style={{ gap: t.spacing.s }} nativeID={`gallery-d3-${i}`}>
          <HText variant="caption" weight="600" color="subtle">
            {s.title}
          </HText>
          <HuiView node={s.node} streaming={!!s.streaming} onAction={onAction} />
        </View>
      ))}
    </View>
  );
}
