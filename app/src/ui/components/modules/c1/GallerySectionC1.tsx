/**
 * Dev-gallery section "Übersetzung & Abstimmung" (modules-c1). Mounted once in ui/Gallery.tsx.
 * Poll replies go to the gallery's onAction logger ("LETZTE AKTION").
 */
import { View } from 'react-native';
import { useTheme } from '../../../theme';
import { HText } from '../../../primitives/basics';
import { HuiView } from '../../../HuiView';
import type { HuiActionHandler } from '../../../primitives/context';

export const TRANSLATION_SAMPLE = {
  type: 'translation',
  id: 'tr-oma',
  source: { lang: 'de', text: 'Kommst du am Sonntag zum Mittagessen? Oma kocht Paella.' },
  targets: [{ lang: 'es', text: '¿Vienes el domingo a comer? La abuela cocina paella.' }],
  note: '„Comer“ ist in Spanien das Mittagessen; in Lateinamerika eher „almorzar“.',
};

export const TRANSLATION_MULTI_SAMPLE = {
  type: 'translation',
  id: 'tr-danke',
  source: { lang: 'de', text: 'Vielen Dank!' },
  targets: [
    { lang: 'es', text: '¡Muchas gracias!' },
    { lang: 'ja', text: 'どうもありがとうございます', romanization: 'Dōmo arigatō gozaimasu' },
    { lang: 'ar', text: 'شكراً جزيلاً', romanization: 'Shukran jazīlan' },
  ],
};

export const TRANSLATION_LONG_SAMPLE = {
  type: 'translation',
  id: 'tr-brief',
  source: {
    lang: 'es',
    text:
      'Querida familia: llegamos bien a Valencia. El vuelo fue tranquilo y los niños durmieron casi todo el tiempo. Mañana vamos a la playa por la mañana y por la tarde visitamos a los tíos. ¡Os echamos de menos! Mandad fotos del perro, por favor. Un abrazo muy fuerte de todos nosotros.',
  },
  targets: [
    {
      lang: 'de',
      text:
        'Liebe Familie, wir sind gut in Valencia angekommen. Der Flug war ruhig und die Kinder haben fast die ganze Zeit geschlafen. Morgen gehen wir vormittags an den Strand und nachmittags besuchen wir Onkel und Tante. Wir vermissen euch! Schickt bitte Fotos vom Hund. Eine ganz feste Umarmung von uns allen.',
    },
  ],
};

export const POLL_FAMILY_SAMPLE = {
  type: 'poll',
  id: 'abendessen',
  question: 'Was essen wir am Samstag?',
  options: [
    { label: 'Pizza', emoji: '🍕' },
    { label: 'Sushi', emoji: '🍣' },
    { label: 'Paella', emoji: '🥘' },
  ],
  voters: ['Alice', 'Lucía', 'Mateo', 'Oma'],
  allowAdd: true,
};

export const POLL_BALLOT_SAMPLE = {
  type: 'poll',
  id: 'ausflug',
  question: 'Wohin geht der Ausflug? (mehrere möglich)',
  options: [
    { label: 'Zoo', emoji: '🦒' },
    { label: 'Schwimmbad', emoji: '🏊' },
    { label: 'Wandern', emoji: '🥾' },
    { label: 'Museum', emoji: '🏛️' },
  ],
  multiple: true,
  allowAdd: true,
};

export const POLL_ANON_SAMPLE = {
  type: 'poll',
  id: 'film',
  question: 'Welcher Film heute Abend?',
  options: [{ label: 'Coco' }, { label: 'Encanto' }],
  voters: ['Anna', 'Ben'],
  anonymous: true,
};

const PARTIAL_TRANSLATION = { type: 'translation', source: { lang: 'de', text: 'Wo ist der Bahnhof?' }, targets: [] };
const PARTIAL_POLL = { type: 'poll', id: 'teil', question: 'Wann treffen wir uns?', options: [{ label: 'Freitag', emoji: '📅' }] };

const SAMPLES: { title: string; node: unknown; streaming?: boolean }[] = [
  { title: 'translation · de → es + Hinweis', node: TRANSLATION_SAMPLE },
  { title: 'translation · mehrere Ziele, Umschrift, RTL', node: TRANSLATION_MULTI_SAMPLE },
  { title: 'translation · langer Text (einklappbar)', node: TRANSLATION_LONG_SAMPLE },
  { title: 'translation · streaming (Ziel fehlt noch)', node: PARTIAL_TRANSLATION, streaming: true },
  { title: 'translation · streaming (leer)', node: { type: 'translation' }, streaming: true },
  { title: 'poll · Handy weitergeben (voters, allowAdd)', node: POLL_FAMILY_SAMPLE },
  { title: 'poll · Stimmzettel, Mehrfachauswahl', node: POLL_BALLOT_SAMPLE },
  { title: 'poll · anonym mit Namen', node: POLL_ANON_SAMPLE },
  { title: 'poll · streaming', node: PARTIAL_POLL, streaming: true },
];

export function GallerySectionC1({ onAction }: { onAction: HuiActionHandler }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.xl }}>
      <HText variant="title" style={{ marginTop: t.spacing.l }}>
        Übersetzung & Abstimmung
      </HText>
      {SAMPLES.map((s, i) => (
        <View key={i} style={{ gap: t.spacing.s }} nativeID={`gallery-c1-${i}`}>
          <HText variant="caption" weight="600" color="subtle">
            {s.title}
          </HText>
          <HuiView node={s.node} streaming={!!s.streaming} onAction={onAction} />
        </View>
      ))}
    </View>
  );
}
