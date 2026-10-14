import type { RouteFormat } from './types';

// Realistic German sample nodes for the Gallery (static + simulated streaming).

export type GallerySample = { title: string; route: RouteFormat; node: unknown };

export const GALLERY_SAMPLES: GallerySample[] = [
  {
    title: 'Kennzahlen (stats)',
    route: 'stats',
    node: {
      type: 'stats',
      items: [
        { label: 'Umsatz Q3', value: '1,24 Mio. €', delta: '+12,4 %', trend: 'up' },
        { label: 'Neukunden', value: '3.482', delta: '+8,1 %', trend: 'up' },
        { label: 'Kündigungsrate', value: '2,1 %', delta: '−0,4 pp', trend: 'down' },
        { label: 'Ø Warenkorb', value: '68,90 €', delta: '±0 %', trend: 'flat' },
      ],
    },
  },
  {
    title: 'Balkendiagramm (chart · bar)',
    route: 'chart',
    node: {
      type: 'chart',
      kind: 'bar',
      title: 'Stromverbrauch pro Monat',
      unit: 'kWh',
      series: [
        { name: '2025', data: [{ x: 'Jan', y: 312 }, { x: 'Feb', y: 288 }, { x: 'Mär', y: 251 }, { x: 'Apr', y: 214 }, { x: 'Mai', y: 190 }, { x: 'Jun', y: 176 }] },
        { name: '2026', data: [{ x: 'Jan', y: 296 }, { x: 'Feb', y: 270 }, { x: 'Mär', y: 238 }, { x: 'Apr', y: 201 }, { x: 'Mai', y: 172 }, { x: 'Jun', y: 158 }] },
      ],
    },
  },
  {
    title: 'Liniendiagramm (chart · line)',
    route: 'chart',
    node: {
      type: 'chart',
      kind: 'line',
      title: 'Temperatur Berlin – nächste 7 Tage',
      unit: '°C',
      series: [
        { name: 'Höchstwert', data: [{ x: 'Sa', y: 17 }, { x: 'So', y: 19 }, { x: 'Mo', y: 15 }, { x: 'Di', y: 13 }, { x: 'Mi', y: 14 }, { x: 'Do', y: 18 }, { x: 'Fr', y: 20 }] },
        { name: 'Tiefstwert', data: [{ x: 'Sa', y: 8 }, { x: 'So', y: 10 }, { x: 'Mo', y: 7 }, { x: 'Di', y: 4 }, { x: 'Mi', y: 5 }, { x: 'Do', y: 9 }, { x: 'Fr', y: 11 }] },
      ],
    },
  },
  {
    title: 'Flächendiagramm (chart · area)',
    route: 'chart',
    node: {
      type: 'chart',
      kind: 'area',
      title: 'Aktive Nutzer pro Woche',
      xLabel: 'Kalenderwoche',
      series: [
        {
          name: 'Aktive Nutzer',
          data: [
            { x: 'KW 28', y: 12400 }, { x: 'KW 29', y: 13100 }, { x: 'KW 30', y: 12850 }, { x: 'KW 31', y: 14200 },
            { x: 'KW 32', y: 15900 }, { x: 'KW 33', y: 15100 }, { x: 'KW 34', y: 16800 }, { x: 'KW 35', y: 18250 },
            { x: 'KW 36', y: 17900 }, { x: 'KW 37', y: 19400 }, { x: 'KW 38', y: 21100 }, { x: 'KW 39', y: 22650 },
          ],
        },
      ],
    },
  },
  {
    title: 'Ringdiagramm (chart · donut)',
    route: 'chart',
    node: {
      type: 'chart',
      kind: 'donut',
      title: 'Monatliche Ausgaben nach Kategorie',
      unit: '€',
      series: [
        {
          name: 'Ausgaben',
          data: [
            { x: 'Miete', y: 1150 }, { x: 'Lebensmittel', y: 420 }, { x: 'Freizeit', y: 240 },
            { x: 'Mobilität', y: 180 }, { x: 'Versicherungen', y: 130 }, { x: 'Sonstiges', y: 95 },
          ],
        },
      ],
    },
  },
  {
    title: 'Kreisdiagramm (chart · pie)',
    route: 'chart',
    node: {
      type: 'chart',
      kind: 'pie',
      title: 'Strommix Deutschland 2025',
      unit: '%',
      series: [
        {
          name: 'Anteil',
          data: [
            { x: 'Wind', y: 33 }, { x: 'Solar', y: 15 }, { x: 'Braunkohle', y: 15 }, { x: 'Erdgas', y: 13 },
            { x: 'Biomasse', y: 8 }, { x: 'Steinkohle', y: 6 }, { x: 'Wasserkraft', y: 4 }, { x: 'Sonstige', y: 6 },
          ],
        },
      ],
    },
  },
  {
    title: 'Tabelle (table)',
    route: 'table',
    node: {
      type: 'table',
      caption: 'Die zehn größten Städte Deutschlands',
      columns: ['Stadt', 'Bundesland', 'Einwohner', 'Fläche (km²)', 'Dichte (/km²)'],
      rows: [
        ['Berlin', 'Berlin', '3.878.100', '891,1', '4.352'],
        ['Hamburg', 'Hamburg', '1.910.160', '755,2', '2.529'],
        ['München', 'Bayern', '1.510.378', '310,7', '4.861'],
        ['Köln', 'Nordrhein-Westfalen', '1.087.353', '405,0', '2.685'],
        ['Frankfurt am Main', 'Hessen', '775.790', '248,3', '3.124'],
        ['Stuttgart', 'Baden-Württemberg', '633.484', '207,3', '3.056'],
        ['Düsseldorf', 'Nordrhein-Westfalen', '631.217', '217,4', '2.903'],
        ['Leipzig', 'Sachsen', '628.718', '297,8', '2.111'],
        ['Dortmund', 'Nordrhein-Westfalen', '595.471', '280,7', '2.121'],
        ['Essen', 'Nordrhein-Westfalen', '584.580', '210,3', '2.780'],
      ],
      source: 'Destatis, Stand 31.12.2024',
    },
  },
  {
    title: 'Vergleich (compare)',
    route: 'compare',
    node: {
      type: 'compare',
      columns: [
        { title: 'ICE', badge: 'Empfehlung', highlight: true, items: ['4 h 05 min Fahrzeit', 'ab 37,90 € (Sparpreis)', 'Arbeiten unterwegs möglich', '≈ 1,5 kg CO₂'] },
        { title: 'Auto', items: ['5 h 50 min ohne Stau', '≈ 95 € Sprit + Maut', 'Flexibel vor Ort', '≈ 110 kg CO₂'] },
        { title: 'Flugzeug', badge: 'Schnellste Reisezeit', items: ['1 h 10 min Flug', 'ab 89 €', '+ 2 h Anreise & Sicherheit', '≈ 95 kg CO₂'] },
      ],
    },
  },
  {
    title: 'Schritte (steps)',
    route: 'steps',
    node: {
      type: 'steps',
      current: 2,
      items: [
        { title: 'Termin im Bürgeramt buchen', detail: 'Online über service.berlin.de – meist 2–3 Wochen Vorlauf.' },
        { title: 'Biometrisches Passfoto machen', detail: 'Nicht älter als 6 Monate, 35 × 45 mm.' },
        { title: 'Unterlagen mitbringen', detail: 'Personalausweis, alter Reisepass, **Passfoto**, 70 € Gebühr.' },
        { title: 'Antrag vor Ort stellen', detail: 'Fingerabdrücke werden digital erfasst.' },
        { title: 'Reisepass abholen', detail: 'Nach ca. 3–4 Wochen; Express gegen Aufpreis in 3 Werktagen.' },
      ],
    },
  },
  {
    title: 'Zeitleiste (timeline)',
    route: 'timeline',
    node: {
      type: 'timeline',
      items: [
        { time: 'Heute, 09:30', title: 'Kick-off mit dem Team', detail: 'Ziele für Q4 festgelegt.' },
        { time: 'Mo, 14. Okt.', title: 'Prototyp Chat-App', detail: 'Erste native Komponenten auf Android getestet.' },
        { time: 'Fr, 25. Okt.', title: 'Beta für Familie & Freunde' },
        { time: 'Nov. 2026', title: 'Release 1.0', detail: 'Veröffentlichung im Play Store und App Store.' },
      ],
    },
  },
  {
    title: 'Liste (list · Icons + trailing)',
    route: 'text',
    node: {
      type: 'list',
      items: [
        { icon: '🥾', title: 'Wanderschuhe', subtitle: 'Eingelaufen, wasserdicht', trailing: '1,2 kg' },
        { icon: '🧥', title: 'Regenjacke', subtitle: 'Für den Gipfel am Nachmittag', trailing: '380 g' },
        { icon: '💧', title: 'Trinkflasche', subtitle: 'Mind. 1,5 l pro Person', trailing: '1,6 kg' },
        { icon: '🗺️', title: 'Offline-Karte', subtitle: 'Kein Netz ab der Mittelstation', trailing: '—' },
      ],
    },
  },
  {
    title: 'Liste (list · check / number)',
    route: 'text',
    node: {
      type: 'stack',
      gap: 'l',
      children: [
        { type: 'list', style: 'check', items: [{ title: 'Strom- und Gaszähler abgelesen' }, { title: 'Nachsendeauftrag bei der Post' }, { title: 'Ummeldung innerhalb von **14 Tagen**' }] },
        { type: 'list', style: 'number', items: [{ title: 'Ofen auf 220 °C vorheizen' }, { title: 'Teig 10 Minuten kneten' }, { title: 'Brot 35–40 Minuten backen' }] },
      ],
    },
  },
  {
    title: 'Hinweise (callout)',
    route: 'text',
    node: {
      type: 'stack',
      gap: 's',
      children: [
        { type: 'callout', tone: 'info', title: 'Gut zu wissen', text: 'Das Deutschlandticket gilt auch in **RE- und RB-Zügen**, aber nicht im ICE.' },
        { type: 'callout', tone: 'success', text: 'Deine Überweisung über 250,00 € wurde ausgeführt.' },
        { type: 'callout', tone: 'warning', title: 'Unwetterwarnung', text: 'Für Sonntag sind Sturmböen bis 90 km/h angekündigt.' },
        { type: 'callout', tone: 'danger', title: 'Frist läuft ab', text: 'Die Steuererklärung 2025 muss bis zum `31.07.2026` abgegeben werden.' },
      ],
    },
  },
  {
    title: 'Fortschritt (progress)',
    route: 'stats',
    node: {
      type: 'stack',
      gap: 'm',
      children: [
        { type: 'progress', label: 'Sparziel Sommerurlaub', value: 1850, max: 2500 },
        { type: 'progress', label: 'Marathon-Training', value: 64 },
        { type: 'progress', label: 'Umzugskartons gepackt', value: 24, max: 24 },
      ],
    },
  },
  {
    title: 'Karte mit Inhalt (card)',
    route: 'text',
    node: {
      type: 'card',
      title: 'Wochenende in München',
      subtitle: 'Sa, 17. – So, 18. Okt.',
      children: [
        { type: 'text', text: 'Am Samstag wird es **sonnig und mild** – ideal für den Englischen Garten. Am Sonntag zieht ab Mittag Regen auf.' },
        {
          type: 'stats',
          items: [
            { label: 'Samstag', value: '19 °C', delta: 'Sonnig' },
            { label: 'Sonntag', value: '14 °C', delta: '80 % Regen', trend: 'down' },
          ],
        },
        { type: 'text', variant: 'caption', text: 'Quelle: [Deutscher Wetterdienst](https://www.dwd.de)' },
      ],
    },
  },
  {
    title: 'Text-Varianten (text)',
    route: 'text',
    node: {
      type: 'stack',
      gap: 's',
      children: [
        { type: 'text', variant: 'title', text: 'Zusammenfassung' },
        { type: 'text', text: 'Normaler Text mit **fett**, *kursiv*, ~~durchgestrichen~~, `inline code` und einem [Link](https://example.com).' },
        { type: 'text', variant: 'caption', text: 'Bildunterschrift oder Quelle in gedämpfter Farbe.' },
        { type: 'text', variant: 'mono', text: 'IBAN: DE89 3704 0044 0532 0130 00' },
      ],
    },
  },
  {
    title: 'Code (code)',
    route: 'text',
    node: {
      type: 'code',
      language: 'typescript',
      code: "// Mittelwert der letzten 7 Tage\nfunction mittelwert(werte: number[]): number {\n  if (werte.length === 0) return 0;\n  const summe = werte.reduce((a, b) => a + b, 0);\n  return summe / werte.length;\n}\n\nconsole.log(mittelwert([17, 19, 15, 13, 14, 18, 20]));",
    },
  },
  {
    title: 'Bild (image)',
    route: 'image',
    node: { type: 'image', url: 'https://picsum.photos/seed/hermes-alpen/960/540', alt: 'Berglandschaft', caption: 'Beispielbild (picsum.photos)', aspect: 16 / 9 },
  },
  {
    title: 'Bild per Suche (image · query → Wikipedia)',
    route: 'image',
    node: { type: 'image', query: 'Trevi-Brunnen', caption: 'Trevi-Brunnen – Münze über die Schulter werfen' },
  },
  {
    title: 'Galerie (gallery)',
    route: 'image',
    node: {
      type: 'gallery',
      items: [
        { query: 'Kolosseum', caption: 'Kolosseum' },
        { query: 'Pantheon (Rom)', caption: 'Pantheon' },
        { query: 'Petersdom', caption: 'Petersdom' },
        { query: 'Spanische Treppe', caption: 'Spanische Treppe' },
        { query: 'Engelsburg', caption: 'Engelsburg' },
      ],
    },
  },
  {
    title: 'Zeitleiste mit Fotos (timeline · imageQuery)',
    route: 'timeline',
    node: {
      type: 'card',
      title: 'Samstag in Rom',
      subtitle: 'Antike & Altstadt zu Fuß',
      imageQuery: 'Rom',
      children: [
        {
          type: 'timeline',
          items: [
            { time: '09:00', title: 'Kolosseum', detail: 'Zeitfenster-Ticket vorab buchen, ca. 2 h', imageQuery: 'Kolosseum' },
            { time: '11:30', title: 'Forum Romanum', detail: 'Im Kolosseum-Ticket enthalten', imageQuery: 'Forum Romanum' },
            { time: '14:00', title: 'Pantheon', detail: 'Eintritt ca. 5 €', imageQuery: 'Pantheon (Rom)' },
            { time: '16:00', title: 'Trevi-Brunnen', detail: 'Früh oder spät ist es leerer', imageQuery: 'Trevi-Brunnen' },
          ],
        },
      ],
    },
  },
  {
    title: 'Liste mit Fotos (list · imageQuery)',
    route: 'text',
    node: {
      type: 'list',
      items: [
        { title: 'Tiramisu', subtitle: 'Löffelbiskuit, Mascarpone, Espresso', trailing: '6 €', imageQuery: 'Tiramisu' },
        { title: 'Spaghetti carbonara', subtitle: 'Guanciale, Pecorino, Eigelb', trailing: '14 €', imageQuery: 'Spaghetti carbonara' },
        { title: 'Supplì', subtitle: 'Frittierte Reisbällchen mit Mozzarella', trailing: '3 €', imageQuery: 'Supplì' },
      ],
    },
  },
  {
    title: 'Vergleich mit Produktfotos (compare · imageQuery)',
    route: 'compare',
    node: {
      type: 'compare',
      columns: [
        { title: 'iPhone 17', imageQuery: 'iPhone 17', items: ['6,3″ 120 Hz', 'A19', 'ab ca. 949 €'] },
        { title: 'Pixel 10', badge: 'Empfehlung', highlight: true, imageQuery: 'Pixel 10', items: ['6,3″ 120 Hz', 'Tensor G5', 'ab ca. 899 €'] },
      ],
    },
  },
  {
    title: 'Bild nicht gefunden (wird ausgelassen / Platzhalter)',
    route: 'image',
    node: {
      type: 'stack',
      children: [
        { type: 'image', query: 'Xyzzy Nichtexistierendes Bauwerk 4711' },
        { type: 'list', items: [{ title: 'Unbekanntes Café', subtitle: 'Kein Foto gefunden → Platzhalter', imageQuery: 'Xyzzy Café Nirgendwo 4711' }, { title: 'Petersdom', subtitle: 'Foto gefunden', imageQuery: 'Petersdom' }] },
      ],
    },
  },
  {
    title: 'Aktionen (buttons)',
    route: 'text',
    node: {
      type: 'buttons',
      items: [
        { label: 'Route öffnen', style: 'primary', action: { type: 'open_url', url: 'https://maps.google.com/?q=Marienplatz+München' } },
        { label: 'Als Text senden', style: 'secondary', action: { type: 'send', text: 'Schick mir die Route als Text.' } },
        { label: 'Adresse kopieren', style: 'secondary', action: { type: 'copy', text: 'Marienplatz 1, 80331 München' } },
      ],
    },
  },
  {
    title: 'Vorschläge (suggestions)',
    route: 'text',
    node: { type: 'suggestions', items: ['Wie wird das Wetter am Wochenende?', 'Zeig mir günstigere Alternativen', 'Erstelle eine Packliste'] },
  },
  {
    title: 'Formular (form)',
    route: 'form',
    node: {
      type: 'form',
      id: 'reiseplanung',
      title: 'Reise planen',
      fields: [
        { name: 'ziel', label: 'Reiseziel', kind: 'text', placeholder: 'z. B. Lissabon' },
        { name: 'personen', label: 'Reisende', kind: 'number', min: 1, max: 9, default: 2 },
        { name: 'budget', label: 'Budget pro Person', kind: 'slider', min: 200, max: 5000, step: 50, unit: '€', default: 1200 },
        { name: 'unterkunft', label: 'Unterkunft', kind: 'select', options: ['Hotel', 'Ferienwohnung', 'Camping'], default: 'Hotel' },
        { name: 'anreise', label: 'Anreise', kind: 'select', options: ['Bahn', 'Auto', 'Flugzeug', 'Fernbus', 'Fahrrad', 'Fähre', 'Mitfahrgelegenheit'], placeholder: 'Verkehrsmittel wählen' },
        { name: 'abreise', label: 'Abreisedatum', kind: 'date' },
        { name: 'klasse', label: 'Reiseklasse', kind: 'select', options: ['Economy', 'Premium Economy', 'Business', 'First'] },
        { name: 'haustiere', label: 'Mit Haustier', kind: 'toggle', default: false },
      ],
      submit: { label: 'Vorschläge erhalten' },
    },
  },
  {
    title: 'Horizontaler Stack (stack)',
    route: 'stats',
    node: {
      type: 'stack',
      direction: 'horizontal',
      gap: 's',
      children: [
        { type: 'card', title: 'Girokonto', children: [{ type: 'text', variant: 'title', text: '2.481,17 €' }, { type: 'text', variant: 'caption', text: 'Verfügbar' }] },
        { type: 'card', title: 'Tagesgeld', children: [{ type: 'text', variant: 'title', text: '12.300,00 €' }, { type: 'text', variant: 'caption', text: '3,1 % p. a.' }] },
      ],
    },
  },
  {
    title: 'Unbekannter Typ (Fallback)',
    route: 'map',
    node: { type: 'map', center: { lat: 48.137, lng: 11.575 }, zoom: 13, markers: [{ label: 'Marienplatz' }] },
  },
];

/** Hand-made partial nodes (what a stream looks like mid-way) for the static "Teilweise geladen" section. */
export const PARTIAL_SAMPLES: GallerySample[] = [
  { title: 'Chart ohne Daten', route: 'chart', node: { type: 'chart', kind: 'line', title: 'Kursverlauf DAX', series: [] } },
  { title: 'Tabelle, 2 Zeilen da', route: 'table', node: { type: 'table', columns: ['Produkt', 'Preis', 'Bewertung'], rows: [['Kaffeemaschine X1', '249 €', '4,6'], ['Barista Pro']] } },
  { title: 'Stats, erster Eintrag', route: 'stats', node: { type: 'stats', items: [{ label: 'Schritte heute', value: '8.412' }, { label: 'Kalor' }] } },
  { title: 'Nur Typ bekannt', route: 'steps', node: { type: 'steps' } },
  { title: 'Typ noch unvollständig', route: 'form', node: { type: 'fo' } },
  { title: 'Galerie, letztes Bild noch im Stream', route: 'image', node: { type: 'gallery', items: [{ query: 'Eiffelturm', caption: 'Eiffelturm' }, { query: 'Louv' }] } },
];
