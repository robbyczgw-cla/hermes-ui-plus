/**
 * Dev-gallery section "Rechner, Rezept, Karte" (modules-b). Mounted at the end of ui/Gallery.tsx.
 * Actions (send, add_to_list, maps) go to the gallery's onAction logger ("LETZTE AKTION").
 */
import { View } from 'react-native';
import { useTheme } from '../../../theme';
import { HText } from '../../../primitives/basics';
import { HuiView } from '../../../HuiView';
import type { HuiActionHandler } from '../../../primitives/context';

export const CALC_LOAN_SAMPLE = {
  type: 'calc',
  id: 'kredit',
  title: 'Kreditrechner',
  basis: 'calculated',
  inputs: [
    { name: 'kredit', label: 'Kreditsumme', kind: 'slider', min: 1000, max: 100000, step: 500, default: 20000, unit: '€' },
    { name: 'zins', label: 'Zins p. a.', kind: 'slider', min: 0, max: 12, step: 0.1, default: 4.5, unit: '%' },
    { name: 'monate', label: 'Laufzeit', kind: 'slider', min: 6, max: 120, step: 6, default: 60, unit: 'Monate' },
  ],
  outputs: [
    { name: 'r', label: 'Monatszins', expr: 'zins / 100 / 12', format: 'percent', decimals: 3 },
    { name: 'rate', label: 'Monatliche Rate', expr: 'r == 0 ? kredit / monate : kredit * r / (1 - (1 + r) ^ -monate)', format: 'currency', emphasis: true },
    { name: 'gesamt', label: 'Gesamtkosten', expr: 'rate * monate', format: 'currency' },
    { label: 'Zinsen gesamt', expr: 'gesamt - kredit', format: 'currency' },
  ],
  chart: { kind: 'line', sweep: { input: 'monate', from: 12, to: 120, steps: 10 }, y: 'rate', label: 'Rate je Laufzeit' },
  note: 'Annuitätendarlehen mit festem Zins, ohne Gebühren und Sondertilgungen.',
};

export const CALC_SPLIT_SAMPLE = {
  type: 'calc',
  id: 'rechnung',
  title: 'Rechnung teilen',
  inputs: [
    { name: 'betrag', label: 'Rechnungsbetrag', kind: 'number', min: 0, max: 10000, step: 1, default: 86.4, unit: '€' },
    { name: 'personen', label: 'Personen', kind: 'number', min: 1, max: 30, step: 1, default: 4 },
    {
      name: 'tip',
      label: 'Trinkgeld',
      kind: 'select',
      default: 10,
      options: [
        { label: 'Kein', value: 0 },
        { label: '5 %', value: 5 },
        { label: '10 %', value: 10 },
        { label: '15 %', value: 15 },
      ],
    },
    { name: 'runden', label: 'Pro Person auf volle Euro aufrunden', kind: 'toggle', default: false },
  ],
  outputs: [
    { name: 'gesamt', label: 'Gesamt mit Trinkgeld', expr: 'betrag * (1 + tip / 100)', format: 'currency' },
    { name: 'pp', label: 'Pro Person', expr: 'runden ? ceil(gesamt / personen) : gesamt / personen', format: 'currency', emphasis: true },
    { label: 'Trinkgeld', expr: 'gesamt - betrag', format: 'currency' },
  ],
};

export const RECIPE_SAMPLE = {
  type: 'recipe',
  id: 'pfannkuchen',
  title: 'Pfannkuchen',
  imageQuery: 'Pfannkuchen',
  servings: 4,
  time: { prep: 10, cook: 20 },
  ingredients: [
    { qty: 250, unit: 'g', item: 'Mehl', group: 'Teig' },
    { qty: 500, unit: 'ml', item: 'Milch', group: 'Teig' },
    { qty: 3, item: 'Eier', group: 'Teig' },
    { qty: 1, unit: 'EL', item: 'Zucker', group: 'Teig' },
    { qty: 1, unit: 'Prise', item: 'Salz', group: 'Teig' },
    { qty: 2, unit: 'EL', item: 'Butter zum Braten', group: 'Pfanne' },
    { item: 'Apfelmus oder Zimtzucker', group: 'Zum Servieren' },
  ],
  steps: [
    { text: 'Mehl, Zucker und Salz mischen. Milch und Eier dazugeben und zu einem glatten Teig verrühren.' },
    { text: 'Teig **ruhen lassen**, damit das Mehl quillt.', timerSeconds: 600 },
    { text: 'Etwas Butter in einer Pfanne bei mittlerer Hitze schmelzen, eine Kelle Teig hineingeben und dünn verteilen.' },
    { text: 'Pfannkuchen goldbraun backen, wenden und die zweite Seite fertig backen.', timerSeconds: 90 },
  ],
  tips: ['Für fluffigere Pfannkuchen das Eiweiß steif schlagen und zuletzt unterheben.'],
};

export const MAP_ROME_SAMPLE = {
  type: 'map',
  id: 'rom',
  title: 'Ein Tag in Rom',
  basis: 'illustrative',
  route: true,
  animate: true,
  markers: [
    { lat: 41.8902, lng: 12.4922, title: 'Kolosseum', description: 'Früh hingehen, Tickets vorab buchen.', imageQuery: 'Kolosseum' },
    { lat: 41.8925, lng: 12.4853, title: 'Forum Romanum', description: 'Gleiches Ticket wie das Kolosseum.', imageQuery: 'Forum Romanum' },
    { lat: 41.9009, lng: 12.4833, title: 'Trevi-Brunnen', description: 'Münzwurf über die Schulter.', imageQuery: 'Trevi-Brunnen' },
    { lat: 41.8986, lng: 12.4769, title: 'Pantheon', imageQuery: 'Pantheon (Rom)' },
    { lat: 41.8992, lng: 12.4731, title: 'Piazza Navona', description: 'Abendessen in den Seitenstraßen.', imageQuery: 'Piazza Navona' },
  ],
};

export const MAP_SINGLE_SAMPLE = {
  type: 'map',
  id: 'brandenburger',
  title: 'Treffpunkt',
  markers: [{ lat: 52.5163, lng: 13.3777, title: 'Brandenburger Tor', description: 'Pariser Platz, Seite Unter den Linden' }],
};

const PARTIAL_CALC = { type: 'calc', id: 'teil', title: 'Sparplan', inputs: [{ name: 'rate', label: 'Monatliche Rate', kind: 'slider', min: 25, max: 1000, step: 25, default: 200, unit: '€' }], outputs: [{ label: 'End' }] };
const PARTIAL_RECIPE = { type: 'recipe', id: 'teil-r', title: 'Tomatensuppe', servings: 2, ingredients: [{ qty: 800, unit: 'g', item: 'Tomaten' }, { qty: 1, item: 'Zwie' }] };
const PARTIAL_MAP = { type: 'map', id: 'teil-m', title: 'Hamburg', markers: [{ lat: 53.5413, lng: 9.9841, title: 'Elbphilharmonie' }, { lat: 53.54 }] };

export const MODULES_B_SAMPLES: { title: string; node: unknown; streaming?: boolean }[] = [
  { title: 'calc · Kredit mit Verlauf', node: CALC_LOAN_SAMPLE },
  { title: 'calc · Rechnung teilen (Auswahl, Schalter, Zahl)', node: CALC_SPLIT_SAMPLE },
  { title: 'recipe · Portionen, Timer, Kochmodus', node: RECIPE_SAMPLE },
  { title: 'map · Route mit Animation', node: MAP_ROME_SAMPLE },
  { title: 'map · einzelner Ort', node: MAP_SINGLE_SAMPLE },
  { title: 'calc · streamt noch', node: PARTIAL_CALC, streaming: true },
  { title: 'recipe · streamt noch', node: PARTIAL_RECIPE, streaming: true },
  { title: 'map · streamt noch', node: PARTIAL_MAP, streaming: true },
];

export function GallerySectionB({ onAction }: { onAction: HuiActionHandler }) {
  const t = useTheme();
  return (
      <View style={{ gap: t.spacing.xl }}>
        <HText variant="title" style={{ marginTop: t.spacing.l }}>
          Rechner, Rezept, Karte
        </HText>
        {MODULES_B_SAMPLES.map((s, i) => (
          <View key={i} style={{ gap: t.spacing.s }} nativeID={`gallery-b-${i}`}>
            <HText variant="caption" weight="600" color="subtle">
              {s.title}
            </HText>
            <HuiView node={s.node} streaming={!!s.streaming} onAction={onAction} />
          </View>
        ))}
      </View>
  );
}
