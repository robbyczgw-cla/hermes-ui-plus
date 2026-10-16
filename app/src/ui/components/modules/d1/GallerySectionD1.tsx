/**
 * Dev-gallery section "Orte & Produkte" (modules-d1). Mounted in ui/Gallery.tsx.
 * Actions go to the gallery's onAction logger ("LETZTE AKTION").
 */
import { View } from 'react-native';
import { useTheme } from '../../../theme';
import { HText } from '../../../primitives/basics';
import { HuiView } from '../../../HuiView';
import type { HuiActionHandler } from '../../../primitives/context';

export const ROME_PLACES = {
  type: 'places',
  id: 'rom-essen',
  title: 'Essen in Rom – nahe Pantheon',
  basis: 'sourced',
  source: 'Google Maps',
  places: [
    {
      id: 'roscioli',
      name: 'Roscioli Salumeria con Cucina',
      category: 'Weinbar & Trattoria',
      address: 'Via dei Giubbonari 21, 00186 Roma',
      lat: 41.8937,
      lng: 12.4729,
      rating: 4.5,
      reviews: 9812,
      price: '€€€',
      openNow: true,
      hoursToday: '12:30–16:00, 19:00–23:30',
      hours: ['Mo–Sa 12:30–16:00, 19:00–23:30', 'So geschlossen'],
      phone: '+39 06 687 5287',
      website: 'https://www.salumeriaroscioli.com',
      imageQuery: 'Salumeria Roscioli Rome',
      distance: '650 m',
      note: 'Legendäre Carbonara und Burrata – abends unbedingt reservieren.',
      tags: ['Reservierung empfohlen', 'Große Weinkarte', 'Feinkostladen'],
    },
    {
      id: 'enzo',
      name: 'Da Enzo al 29',
      category: 'Trattoria',
      address: 'Via dei Vascellari 29, 00153 Roma',
      lat: 41.8883,
      lng: 12.4776,
      rating: 4.6,
      reviews: 6140,
      price: '€€',
      openNow: false,
      hoursToday: '12:30–15:00, 19:30–23:00',
      hours: ['Mo–Sa 12:30–15:00, 19:30–23:00', 'So geschlossen'],
      phone: '+39 06 581 2260',
      website: 'https://www.daenzoal29.com',
      imageQuery: 'Trastevere Rome street',
      distance: '1,2 km',
      note: 'Kleine Familien-Trattoria in Trastevere, Cacio e pepe wie bei Nonna. Früh kommen.',
      tags: ['Keine Reservierung', 'Terrasse'],
    },
    {
      id: 'armando',
      name: 'Armando al Pantheon',
      category: 'Römische Küche',
      address: 'Salita dei Crescenzi 31, 00186 Roma',
      lat: 41.8991,
      lng: 12.4759,
      rating: 4.5,
      reviews: 3954,
      price: '€€€',
      openNow: true,
      hoursToday: '12:30–15:00, 19:00–23:00',
      hours: ['Mo–Fr 12:30–15:00, 19:00–23:00', 'Sa 12:30–15:00', 'So geschlossen'],
      phone: '+39 06 6880 3034',
      website: 'armandoalpantheon.it',
      imageQuery: 'Pantheon Rome',
      distance: '120 m',
      note: 'Seit 1961 in Familienhand, Klassiker wie Abbacchio und Coda alla vaccinara.',
    },
    {
      id: 'remo',
      name: 'Pizzeria da Remo',
      category: 'Pizzeria',
      address: 'Piazza di S. Maria Liberatrice 44, 00153 Roma',
      lat: 41.8807,
      lng: 12.4757,
      rating: 4.4,
      reviews: 5233,
      price: '€',
      openNow: false,
      hoursToday: 'öffnet 19:00',
      hours: ['Mo–Sa 19:00–01:00', 'So geschlossen'],
      phone: '+39 06 574 6270',
      imageQuery: 'Testaccio Rome',
      distance: '2,1 km',
      note: 'Dünne, knusprige Pizza romana – laut, schnell, günstig.',
    },
  ],
};

export const HEADPHONES = {
  type: 'products',
  id: 'kopfhoerer',
  title: 'Noise-Cancelling-Kopfhörer im Vergleich',
  basis: 'sourced',
  source: 'https://www.rtings.com/headphones',
  compare: true,
  products: [
    {
      id: 'xm6',
      name: 'WH-1000XM6',
      brand: 'Sony',
      imageQuery: 'Sony WH-1000XM6 headphones',
      price: 449,
      currency: 'EUR',
      priceNote: 'UVP',
      rating: 4.7,
      reviews: 1203,
      badge: 'Testsieger',
      specs: [
        { label: 'ANC', value: 'Exzellent' },
        { label: 'Akku', value: '30 h' },
        { label: 'Gewicht', value: '254 g' },
        { label: 'Codecs', value: 'LDAC, AAC, SBC' },
        { label: 'Multipoint', value: 'Ja' },
      ],
      pros: ['Bestes ANC seiner Klasse', 'Sehr klare Telefonate', 'Faltbar mit Etui'],
      cons: ['Teuer', 'Kein aptX'],
      offers: [
        { merchant: 'Sony Store', price: 449, url: 'https://www.sony.de' },
        { merchant: 'MediaMarkt', price: 429, url: 'https://www.mediamarkt.de' },
      ],
    },
    {
      id: 'qcu',
      name: 'QuietComfort Ultra Headphones',
      brand: 'Bose',
      imageQuery: 'Bose QuietComfort headphones',
      currency: 'EUR',
      rating: 4.5,
      reviews: 2876,
      badge: 'Bester Preis',
      specs: [
        { label: 'ANC', value: 'Exzellent' },
        { label: 'Akku', value: '24 h' },
        { label: 'Gewicht', value: '250 g' },
        { label: 'Codecs', value: 'aptX Adaptive, AAC' },
        { label: 'Multipoint', value: 'Ja' },
      ],
      pros: ['Extrem bequem', 'Immersive Audio'],
      cons: ['Akku kürzer als bei Sony', 'Etui recht groß'],
      offers: [
        { merchant: 'Amazon', price: 349.99, url: 'https://www.amazon.de' },
        { merchant: 'Otto', price: 379, url: 'https://www.otto.de' },
        { merchant: 'Bose', price: 449.95, url: 'https://www.bose.de' },
      ],
    },
    {
      id: 'apm',
      name: 'AirPods Max',
      brand: 'Apple',
      imageQuery: 'AirPods Max',
      price: 579,
      currency: 'EUR',
      rating: 4.4,
      reviews: 980,
      specs: [
        { label: 'ANC', value: 'Sehr gut' },
        { label: 'Akku', value: '20 h' },
        { label: 'Gewicht', value: '385 g' },
        { label: 'Codecs', value: 'AAC' },
      ],
      pros: ['Hochwertige Verarbeitung', 'Nahtlos mit iPhone'],
      cons: ['Schwer', 'Kein Multipoint', 'Kein Klinkeneingang'],
      url: 'https://www.apple.com/de/airpods-max/',
    },
  ],
};

const h = (name: string, brand: string, price: number, rating: number, reviews: number, verdict: string, scores: [number, number, number, number], pros: string[], cons: string[], badge?: string) => ({
  id: `${brand}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  name,
  brand,
  imageQuery: `${brand} ${name}`,
  price,
  currency: 'EUR',
  rating,
  reviews,
  verdict,
  scores: [
    { label: 'Ergonomie', value: scores[0] },
    { label: '2D', value: scores[1] },
    { label: '3D/PS2', value: scores[2] },
    { label: 'Akku', value: scores[3] },
  ],
  pros,
  cons,
  ...(badge ? { badge } : {}),
  specs: [
    { label: 'Ergonomie', value: `${scores[0]}/10` },
    { label: 'Preis', value: `${price} €` },
  ],
});

export const RETRO_HANDHELDS = {
  type: 'products',
  id: 'retro-handhelds',
  title: 'Die 10 komfortabelsten Retro-Handhelds',
  ranked: true,
  compare: true,
  basis: 'sourced',
  source: 'Tests von RetroDodo, The Verge, Reddit r/SBCGaming · Stand Okt. 2026',
  products: [
    h('Pocket 5', 'Retroid', 229, 4.7, 1840, 'Bester Allrounder: griffiges Gehäuse, starkes OLED', [9, 10, 8, 8], ['Sehr bequemer Griff', 'OLED-Display'], ['Kein Hall-Effekt-D-Pad'], 'Testsieger'),
    h('Odin 2 Portal', 'AYN', 359, 4.6, 920, 'Am komfortabelsten für lange Sessions, dazu viel Leistung', [10, 9, 10, 9], ['Ausgeprägte Griffe', 'Läuft auch PS2/Switch'], ['Teuer']),
    h('RG406H', 'Anbernic', 189, 4.5, 1310, 'Horizontales Layout mit vollen Griffen, sehr gutes Preis-Leistungs-Verhältnis', [9, 9, 7, 8], ['Hall-Sticks', 'Solide Verarbeitung'], ['4:3-Display bei Widescreen-Spielen'], 'Preis-Tipp'),
    h('Pocket Classic', 'Retroid', 139, 4.4, 760, 'Game-Boy-Form, überraschend angenehm in der Hand', [8, 10, 6, 9], ['Leicht', 'Tolles 2D'], ['Für 3D zu klein']),
    h('RG557', 'Anbernic', 249, 4.4, 540, 'Großes AMOLED und gute Griffe, etwas schwer', [8, 9, 9, 7], ['AMOLED 5,48″', 'Aktive Kühlung'], ['250 g+']),
    h('Steam Deck OLED', 'Valve', 569, 4.8, 15200, 'Bequemste Griffe überhaupt, aber groß und schwer für unterwegs', [10, 9, 10, 6], ['Trackpads', 'Riesige Bibliothek'], ['Groß & schwer']),
    h('Mini Plus', 'Miyoo', 69, 4.3, 6100, 'Hosentaschen-Klassiker für 8- und 16-Bit', [6, 9, 3, 8], ['Sehr günstig', 'Riesige Community'], ['Kleine Tasten']),
    h('RG35XX H', 'Anbernic', 79, 4.2, 2200, 'Horizontal, leicht, ideal für Einsteiger', [7, 9, 3, 8], ['Günstig', 'HDMI-Ausgang'], ['Keine Griffe']),
    h('RGB30', 'Powkiddy', 89, 4.1, 980, '1:1-Display für Game Boy & Co., kompakt', [7, 9, 4, 8], ['Quadratisches Display'], ['Schultertasten klein']),
    h('Pocket Micro', 'AYANEO', 199, 4.0, 410, 'Wunderschön verarbeitet, aber für große Hände eng', [6, 9, 7, 7], ['Premium-Gehäuse'], ['Eng für große Hände', 'Teuer für die Größe']),
  ],
};

const LIST_SAMPLE = {
  type: 'places',
  id: 'cafes-liste',
  title: 'Cafés in der Nähe',
  layout: 'list',
  basis: 'sourced',
  places: [
    { id: 'c1', name: 'Sant’Eustachio Il Caffè', category: 'Café', rating: 4.3, reviews: 11870, price: '€', openNow: true, hoursToday: '7:30–1:00', distance: '200 m', imageQuery: 'Sant Eustachio Il Caffè Rome', phone: '+39 06 6880 2048', lat: 41.8982, lng: 12.4751 },
    // model-written image URL on an unknown host → tap-to-load (trust policy)
    { id: 'c2', name: 'Giolitti', category: 'Gelateria', rating: 4.2, reviews: 23410, price: '€€', hoursToday: '7:00–24:00', distance: '350 m', image: 'https://images.example-gelato.it/giolitti.jpg' },
  ],
};

const SAMPLES: { title: string; node: unknown; streaming?: boolean }[] = [
  { title: 'places · Karussell (Rom, 4 Restaurants)', node: ROME_PLACES },
  { title: 'products · Karussell + Vergleichen', node: HEADPHONES },
  { title: 'places · Liste (Bild von unbekannter Seite)', node: LIST_SAMPLE },
  { title: 'products · grid', node: { ...HEADPHONES, id: 'kh-grid', title: undefined, layout: 'grid', compare: false, products: HEADPHONES.products.slice(0, 2) } },
  { title: 'places · streaming (teilweise)', node: { ...ROME_PLACES, id: 'rom-teil', places: [ROME_PLACES.places[0], { name: 'Da Enzo' }] }, streaming: true },
  { title: 'products · streaming (noch leer)', node: { type: 'products', id: 'leer', products: [] }, streaming: true },
  { title: 'products · ranked (Top 10, Pros/Cons, Scores)', node: RETRO_HANDHELDS },
  { title: 'products · ranked streaming (teilweise)', node: { ...RETRO_HANDHELDS, id: 'retro-teil', products: [...RETRO_HANDHELDS.products.slice(0, 2), { name: 'RG4' }] }, streaming: true },
];

export function GallerySectionD1({ onAction }: { onAction: HuiActionHandler }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.xl }} nativeID="gallery-d1">
      <HText variant="title" style={{ marginTop: t.spacing.l }}>
        Orte & Produkte
      </HText>
      {SAMPLES.map((s, i) => (
        <View key={i} style={{ gap: t.spacing.s }} nativeID={`gallery-d1-${i}`}>
          <HText variant="caption" weight="600" color="subtle">
            {s.title}
          </HText>
          <HuiView node={s.node} streaming={!!s.streaming} onAction={onAction} />
        </View>
      ))}
    </View>
  );
}
