// Demo scenarios: scripted answers replayed locally (no network). Ported from mock-server/scenarios.mjs
// (same step format and keyword picker) plus scenarios for the v2 modules (choice, checklist, calc,
// recipe, map, quiz, images). Pure data – tested in demo.test.ts.
import { brand } from '../../brand.ts';
import { FLAVOR, type Flavor } from '../../flavor.ts';
import { CALCULATOR_HTML, LOAN_HTML } from './html.ts';

export type DemoTool = { name: string; label: string; emoji: string; ms: number };
export type DemoApproval = { command: string; description: string; pattern_key: string; pattern_keys: string[] };
export type DemoStep =
  | { text: string }
  | { reasoning: string }
  | { tool: DemoTool }
  | { status: { kind: string; text: string } }
  | { wait: number }
  | { approval: DemoApproval }
  | { fail: 'error' | 'drop' };

/** `lang`: UI language of the chat (the scripted answers of the onboarding starters and the demo chrome follow it). */
export type DemoLang = 'de' | 'en' | 'es';
export type DemoContext = { userText: string; turn: number; sessionId: string; now: Date; lang?: DemoLang; flavor?: Flavor };

/** pick the text for the demo language (German when unknown) */
export const L = (ctx: Pick<DemoContext, 'lang'>, de: string, en: string, es: string): string => (ctx.lang === 'en' ? en : ctx.lang === 'es' ? es : de);
/** `format` = RouteFormat emitted as `hermes.ui.route` (as the UI bridge would). */
export type DemoScenario = { format: string; steps: (ctx: DemoContext) => DemoStep[] };

const hui = (node: unknown) => '```hui\n' + JSON.stringify(node, null, 2) + '\n```\n';
const xy = (pairs: [string, number][]) => pairs.map(([x, y]) => ({ x, y }));
const DAYS: Record<DemoLang, string[]> = { de: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], es: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] };
/** weekday labels of the demo language paired with values */
const days = (ctx: Pick<DemoContext, 'lang'>, ys: number[]): [string, number][] => ys.map((y, i) => [DAYS[ctx.lang ?? 'de'][i], y]);

/** Keywords listed by the fallback answer (and hit by the onboarding demo starters). */
export const DEMO_KEYWORDS = [
  'diagramm', 'tabelle', 'kennzahlen', 'vergleich', 'formular', 'schritte', 'timeline', 'buttons', 'rechner', 'kredit',
  'bericht', 'auswahl', 'einkaufsliste', 'zinsrechner', 'rezept', 'karte', 'quiz', 'bilder', 'werkzeuge', 'freigabe', 'fehler', 'lang',
  'pfade', 'architektur',
];

export const scenarios: Record<string, DemoScenario> = {
  plain: {
    format: 'text',
    steps: (ctx) => {
      const personal = (ctx.flavor ?? FLAVOR) === 'personal';
      const sample = L(ctx, 'Zeig mir ein Diagramm', 'Show me a chart', 'Muéstrame un gráfico');
      return [
        {
          text:
            L(
              ctx,
              `Hallo! Das ist der **Demo-Modus** – die Antworten sind vorbereitet und laufen komplett auf deinem Gerät. Du hast geschrieben: „${ctx.userText.slice(0, 120)}“.\n\nProbier eines dieser Stichwörter, um zu sehen, was ${brand().shortName} darstellen kann:\n\n`,
              `Hello! This is **demo mode** – the answers are prepared and run entirely on your device. You wrote: “${ctx.userText.slice(0, 120)}”.\n\nTry one of these keywords to see what ${brand().shortName} can show:\n\n`,
              `¡Hola! Este es el **modo demo**: las respuestas están preparadas y se ejecutan por completo en tu dispositivo. Has escrito: «${ctx.userText.slice(0, 120)}».\n\nPrueba una de estas palabras clave para ver qué puede mostrar ${brand().shortName}:\n\n`,
            ) +
            hui({ type: 'suggestions', items: [sample, 'Rezept für Pasta', 'Karte von Wien', 'Quiz zur Geografie', 'Bilder von Rom', 'Einkaufsliste'] }) +
            '\n' + L(ctx, 'Weitere: ', 'More (German keywords): ', 'Más (palabras clave en alemán): ') + DEMO_KEYWORDS.map((k) => `„${k}“`).join(', ') + '.\n\n' +
            // the official build only talks to Hermes: no "other provider" advice there
            (personal
              ? L(ctx, 'Für echte Antworten richte in den Einstellungen eine Verbindung zu deinem Hermes (oder einem anderen Anbieter) ein.', 'For real answers, set up a connection to your Hermes (or another provider) in Settings.', 'Para respuestas reales, configura en Ajustes una conexión con tu Hermes (u otro proveedor).')
              : L(ctx, 'Für echte Antworten richte in den Einstellungen eine Verbindung zu deinem Hermes ein.', 'For real answers, set up a connection to your Hermes in Settings.', 'Para respuestas reales, configura en Ajustes una conexión con tu Hermes.')),
        },
      ];
    },
  },

  tool: {
    format: 'text',
    steps: (ctx) => [
      { text: 'Ich schaue kurz nach der Uhrzeit.' },
      { reasoning: 'Der Nutzer fragt nach der Zeit; ein Terminal-Aufruf genügt.' },
      { tool: { name: 'terminal', label: 'date', emoji: '\u{1F4BB}', ms: 900 } },
      { text: `\n\nEs ist jetzt **${ctx.now.toLocaleString('de-AT', { dateStyle: 'full', timeStyle: 'short' })}**.` },
    ],
  },

  tools2: {
    format: 'text',
    steps: () => [
      { text: 'Ich recherchiere das parallel.' },
      { tool: { name: 'web_search', label: 'Wetter Wien morgen', emoji: '\u{1F50D}', ms: 1200 } },
      { tool: { name: 'read_file', label: '~/notes/todo.md', emoji: '\u{1F4C4}', ms: 600 } },
      { status: { kind: 'lifecycle', text: 'Warte auf Provider (Wiederholung 1/3)…' } },
      { wait: 1200 },
      { text: '\n\nFertig: Morgen wird es mild, die Notizen enthalten 3 offene Punkte.' },
    ],
  },

  werkzeuge: {
    format: 'text',
    steps: () => [
      { reasoning: 'Der Nutzer will den Stand des Projekts. Ich prüfe System, Notizen und das Changelog.' },
      { text: 'Ich prüfe das in mehreren Schritten.' },
      { tool: { name: 'terminal', label: 'uname -a && uptime', emoji: '\u{1F4BB}', ms: 700 } },
      { tool: { name: 'web_search', label: 'Hermes Agent Release Notes', emoji: '\u{1F50D}', ms: 1400 } },
      { status: { kind: 'lifecycle', text: 'Warte auf Provider (Wiederholung 1/3)…' } },
      { wait: 900 },
      { tool: { name: 'read_file', label: '~/notes/projekt.md', emoji: '\u{1F4C4}', ms: 500 } },
      { tool: { name: 'browser', label: 'https://example.com/changelog', emoji: '\u{1F310}', ms: 1100 } },
      { tool: { name: 'terminal', label: 'pytest -q tests/test_api.py', emoji: '\u{1F4BB}', ms: 2500 } },
      { reasoning: ' Alle Daten sind da, ich fasse zusammen.' },
      { status: { kind: 'compacted', text: 'Kontext komprimiert (48k → 12k Tokens)' } },
      {
        text:
          '\n\n**Stand:** System läuft seit 12 Tagen, die Notizen nennen 3 offene Punkte, das Changelog listet eine neue Version, und alle 42 API-Tests sind grün.',
      },
    ],
  },

  chart: {
    format: 'chart',
    steps: (ctx) => [
      { text: L(ctx, 'Hier der Verlauf der Temperaturen und der Niederschlagsmenge:\n\n', 'Here is the course of temperatures and precipitation:\n\n', 'Aquí tienes la evolución de las temperaturas y las precipitaciones:\n\n') },
      {
        text: hui({
          type: 'chart',
          kind: 'line',
          title: L(ctx, 'Temperatur Wien (°C)', 'Temperature Vienna (°C)', 'Temperatura Viena (°C)'),
          unit: '°C',
          xLabel: L(ctx, 'Tag', 'Day', 'Día'),
          yLabel: L(ctx, 'Temperatur', 'Temperature', 'Temperatura'),
          basis: 'illustrative',
          series: [
            { name: 'Max', data: xy(days(ctx, [18, 21, 19, 24, 22, 17, 15])) },
            { name: 'Min', data: xy(days(ctx, [9, 11, 10, 13, 12, 8, 7])) },
          ],
        }),
      },
      {
        text:
          L(ctx, '\nUnd als Balken:\n\n', '\nAnd as bars:\n\n', '\nY en barras:\n\n') +
          hui({ type: 'chart', kind: 'bar', title: L(ctx, 'Niederschlag (mm)', 'Precipitation (mm)', 'Precipitación (mm)'), series: [{ name: 'mm', data: xy(days(ctx, [0, 2, 8, 1, 0, 12, 5])) }] }) +
          L(ctx, '\nTendenz: Wochenende nass und kühler.', '\nTrend: a wetter, cooler weekend.', '\nTendencia: fin de semana más húmedo y fresco.'),
      },
    ],
  },

  table: {
    format: 'table',
    steps: () => [
      { text: 'Die größten Städte im deutschsprachigen Raum:\n\n' },
      {
        text: hui({
          type: 'table',
          caption: 'Einwohner (Mio.)',
          source: 'Beispieldaten',
          basis: 'illustrative',
          columns: ['Stadt', 'Land', 'Einwohner', 'Fläche km²'],
          rows: [
            ['Berlin', 'DE', 3.7, 892],
            ['Wien', 'AT', 2.0, 415],
            ['Hamburg', 'DE', 1.9, 755],
            ['München', 'DE', 1.5, 311],
            ['Zürich', 'CH', 0.44, 92],
            ['Graz', 'AT', 0.3, 127],
          ],
        }),
      },
      { text: '\nBerlin ist mit Abstand die größte.' },
    ],
  },

  wideTable: {
    format: 'table',
    steps: () => [
      { text: 'Drei Alltagsgeräte im Überblick – mit langen Einträgen, wie sie in echten Antworten vorkommen:\n\n' },
      {
        text: hui({
          type: 'table',
          caption: 'Geräte für den Arbeitsalltag',
          source: 'Beispieldaten',
          basis: 'illustrative',
          columns: ['Gerät', 'Einsatz', 'Akku', 'Gewicht', 'Besonderheit', 'Fazit'],
          rows: [
            ['Beispiel Phone Mini', 'Telefonieren, Nachrichten und kurze Notizen zwischendurch', 'bis zu 18 Stunden bei gemischter Nutzung', '162 Gramm', 'Sehr kompakt, passt in jede Hosentasche', 'Für Wenignutzer völlig ausreichend'],
            ['Beispiel Tablet Studio', 'Zeichnen, Lesen und Präsentationen unterwegs', 'rund 11 Stunden bei voller Helligkeit', '682 Gramm', 'Stift liegt bei und haftet magnetisch am Rand', 'Stark für kreative Arbeit ohne Schreibtisch'],
            ['Beispiel Notebook Lang', 'Schreiben, Tabellen und Videokonferenzen den ganzen Tag', 'bis zu 21 Stunden im Energiesparmodus', '1,29 Kilogramm', 'Lüfterlos und damit im Alltag praktisch lautlos', 'Die sichere Wahl für lange Arbeitstage'],
          ],
        }),
      },
      { text: '\nAuf dem Handy wird jede Zeile zu einer Karte – ohne seitliches Scrollen.' },
    ],
  },

  // native-layout regression (Android): a 3-column text table with long cells must wrap to the phone width
  // (or become cards), never run off the right edge; long German words must not break mid-word
  gameTable: {
    format: 'table',
    steps: () => [
      { text: 'Acht bekannte PS2-Spiele auf einem Mittelklasse-Handy (Beispieldaten):\n\n' },
      {
        text: hui({
          type: 'table',
          caption: 'Snapdragon 865, Emulator, meist 1×–2×',
          basis: 'sourced',
          source: 'Community-Kompatibilitätslisten, Forenberichte und Videotests (Stand Sept. 2026), https://www.example.com/ps2-kompatibilitaet',
          columns: ['Spiel', 'Was ruckelt', 'Bericht'],
          rows: [
            ['Final Fantasy X', 'Kaum', '865, bis 3×, Dips nur in großen Zwischensequenzen'],
            ['GTA San Andreas', 'Kaum', '865, 60 bei 2×, gelegentlich Nachladeruckler beim schnellen Fahren'],
            ['Devil May Cry 3', 'Leicht', '865, 50–60, kurze Einbrüche bei vielen Gegnern'],
            ['Kingdom Hearts II', 'Leicht', '865, 50–60, nach dem Aufwärmen stabiler'],
            ['God of War 2', 'Manchmal', '865, ein Bericht: mit Hintergrundbeleuchtungseffekten deutlich langsamer'],
            ['Gran Turismo 4', 'Ja', '865, 45–60, Lastspitzen in Rennen mit vollem Starterfeld'],
            ['Shadow of the Colossus', 'Ja', '865, 30–45, auch nativ instabil, Bloom kostet viel'],
            ['NFS Most Wanted', 'Ja', '865, 40–55, Wärmeentwicklung nach 20 Minuten spürbar'],
          ],
        }),
      },
      { text: '\nDie leichten Klassiker laufen glatt, die schweren Titel ruckeln.' },
    ],
  },

  longWords: {
    format: 'compare',
    steps: () => [
      { text: 'OLED oder LCD – die Unterschiede:\n\n' },
      {
        text: hui({
          type: 'compare',
          basis: 'sourced',
          source: 'Herstellerangaben, Display-Datenblätter und Testberichte 2025–2026 (Stand Sept. 2026), https://www.example.com/oled-lcd',
          columns: [
            { title: 'OLED', badge: 'Kontrast', items: ['Pixel leuchtet selbst, kein Backlight', 'Aus = echtes Schwarz, praktisch unendlicher Kontrast', 'Schnell, weite Blickwinkel, sehr dünn'], cons: ['Einbrennen bei statischen Elementen möglich', 'Teurer, Vollflächen-Helligkeit oft niedriger'] },
            { title: 'LCD', badge: 'Helligkeit', items: ['Kristalle filtern eine Hintergrundbeleuchtung', 'Schwarz bleibt dunkelgrau, Licht kann durchscheinen', 'Backlight läuft immer, Strom eher konstant'], pros: ['Kein permanentes Einbrennen', 'Günstiger, gut bei Dauerbild'] },
          ],
        }),
      },
      { text: '\nFilme und dunkle Räume: OLED. Büro und Sonne: LCD.' },
    ],
  },

  weather: {
    format: 'weather',
    steps: (ctx) => {
      const iso = (plus: number) => {
        const d = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate() + plus);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };
      return [
        { tool: { name: 'web_search', label: 'Wetter Beispielstadt', emoji: '\u{1F50D}', ms: 800 } },
        { text: L(ctx, 'So wird das Wetter in der Beispielstadt:\n\n', 'Here is the weather for Example City:\n\n', 'Así estará el tiempo en Ciudad Ejemplo:\n\n') },
        {
          text: hui({
            type: 'weather',
            location: 'Beispielstadt',
            unit: 'C',
            basis: 'illustrative',
            current: { temp: 17, condition: 'partly', feelsLike: 16, wind: 14, humidity: 58, precip: 20 },
            hourly: [
              { time: '12:00', temp: 15, condition: 'cloudy' },
              { time: '13:00', temp: 16, condition: 'partly' },
              { time: '14:00', temp: 17, condition: 'partly' },
              { time: '15:00', temp: 18, condition: 'sunny' },
              { time: '16:00', temp: 18, condition: 'sunny' },
              { time: '17:00', temp: 16, condition: 'cloudy', precip: 10 },
              { time: '18:00', temp: 15, condition: 'showers', precip: 55 },
              { time: '19:00', temp: 13, condition: 'rain', precip: 70 },
              { time: '20:00', temp: 12, condition: 'cloudy' },
              { time: '21:00', temp: 11, condition: 'clear' },
            ],
            daily: [
              { date: iso(0), min: 11, max: 19, condition: 'showers', precip: 60 },
              { date: iso(1), min: 10, max: 17, condition: 'rain', precip: 80 },
              { date: iso(2), min: 9, max: 16, condition: 'cloudy', precip: 20 },
              { date: iso(3), min: 8, max: 18, condition: 'partly' },
              { date: iso(4), min: 10, max: 21, condition: 'sunny' },
            ],
          }),
        },
        { text: L(ctx, '\nAbends wird es nass – die Jacke lohnt sich.', '\nRain moves in during the evening – bring a jacket.', '\nPor la noche lloverá: vale la pena llevar chaqueta.') },
      ];
    },
  },

  places: {
    format: 'places',
    steps: () => [
      { tool: { name: 'web_search', label: 'Restaurants Beispielstadt', emoji: '\u{1F50D}', ms: 800 } },
      { text: 'Drei fiktive Lokale in Laufnähe:\n\n' },
      {
        text: hui({
          type: 'places',
          id: 'demo-places',
          title: 'Essen in der Beispielstadt',
          basis: 'illustrative',
          places: [
            {
              id: 'garten',
              name: 'Gartenküche Beispiel',
              category: 'Regionale Küche',
              address: 'Beispielgasse 18, Beispielstadt',
              rating: 4.7,
              reviews: 1284,
              price: '€€',
              openNow: true,
              hoursToday: '12:00–23:30',
              website: 'https://example.com/gartenkueche',
              imageQuery: 'Gartenküche Beispiel Pasta',
              distance: '450 m',
              note: 'Kleiner Hof, ruhige Tische, abends am besten reservieren.',
              tags: ['Innenhof', 'Vegetarische Auswahl'],
            },
            {
              id: 'fluss',
              name: 'Flussgabel Beispiel',
              category: 'Italienisch',
              address: 'Beispielweg 7, Beispielstadt',
              rating: 4.5,
              reviews: 862,
              price: '€€',
              openNow: true,
              hoursToday: '18:30–23:00',
              website: 'https://example.com/flussgabel',
              imageQuery: 'Flussgabel Beispiel Pasta',
              distance: '900 m',
              note: 'Terrasse mit Blick aufs Wasser, hausgemachte Pasta.',
              tags: ['Terrasse'],
            },
            {
              id: 'ofen',
              name: 'Knusperofen Beispiel',
              category: 'Pizza',
              address: 'Beispielstraße 31, Beispielstadt',
              rating: 4.4,
              reviews: 2140,
              price: '€',
              openNow: false,
              hoursToday: 'öffnet um 19:00',
              imageQuery: 'Knusperofen Beispiel Pizza',
              distance: '1,3 km',
              note: 'Dünne Pizza aus dem Holzofen, schnell und günstig.',
              tags: ['Holzofen', 'Ohne Reservierung'],
            },
          ],
        }),
      },
      { text: '\nMein Tipp: die **Gartenküche** – im Hof ist es abends am ruhigsten.' },
    ],
  },

  products: {
    format: 'products',
    steps: () => [
      { tool: { name: 'web_search', label: 'Kopfhörer Beispielvergleich', emoji: '\u{1F50D}', ms: 800 } },
      { text: 'Drei fiktive Kopfhörer unter 350 €, nach Gesamtnote sortiert:\n\n' },
      {
        text: hui({
          type: 'products',
          id: 'demo-kopfhoerer',
          title: 'Top 3: Kopfhörer mit Geräuschunterdrückung',
          ranked: true,
          compare: true,
          basis: 'illustrative',
          products: [
            {
              id: 'aurel',
              name: 'Quiet Pro',
              brand: 'Aurel Beispiel',
              imageQuery: 'Aurel Beispiel Quiet Pro',
              price: 329,
              currency: 'EUR',
              rating: 4.7,
              reviews: 1840,
              badge: 'Gesamtsieger',
              verdict: 'Stärkste Ruhe im Testfeld und klare Anrufe. Der Allrounder.',
              scores: [
                { label: 'ANC', value: 9.4 },
                { label: 'Klang', value: 9.0 },
                { label: 'Komfort', value: 8.6 },
              ],
              specs: [
                { label: 'Akku', value: '32 h' },
                { label: 'Gewicht', value: '252 g' },
                { label: 'Multipoint', value: 'Ja' },
              ],
              pros: ['Sehr gutes ANC', 'Klare Anrufe'],
              cons: ['Höchster Preis'],
              offers: [{ merchant: 'Beispiel Shop', price: 329, url: 'https://example.com/shop/aurel' }],
            },
            {
              id: 'nordwell',
              name: 'ANC 5',
              brand: 'Nordwell Beispiel',
              imageQuery: 'Nordwell Beispiel ANC 5',
              price: 279,
              currency: 'EUR',
              rating: 4.6,
              reviews: 1205,
              badge: 'Am bequemsten',
              verdict: 'Federleicht – für lange Flüge die angenehmste Wahl.',
              scores: [
                { label: 'ANC', value: 8.8 },
                { label: 'Klang', value: 8.5 },
                { label: 'Komfort', value: 9.5 },
              ],
              specs: [
                { label: 'Akku', value: '30 h' },
                { label: 'Gewicht', value: '228 g' },
                { label: 'Multipoint', value: 'Ja' },
              ],
              pros: ['Sehr leicht', 'Weiche Polster'],
              cons: ['Klang etwas zurückhaltend'],
              offers: [{ merchant: 'Beispiel Shop', price: 279, url: 'https://example.com/shop/nordwell' }],
            },
            {
              id: 'kiro',
              name: 'Pulse 2',
              brand: 'Kiro Beispiel',
              imageQuery: 'Kiro Beispiel Pulse 2',
              price: 199,
              currency: 'EUR',
              rating: 4.4,
              reviews: 2310,
              badge: 'Preis-Tipp',
              verdict: 'Fast so gut wie Platz zwei, aber deutlich günstiger.',
              scores: [
                { label: 'ANC', value: 8.3 },
                { label: 'Klang', value: 8.2 },
                { label: 'Komfort', value: 8.5 },
              ],
              specs: [
                { label: 'Akku', value: '45 h' },
                { label: 'Gewicht', value: '245 g' },
                { label: 'Multipoint', value: 'Ja' },
              ],
              pros: ['Riesen-Akku', 'Guter Preis'],
              cons: ['Nur AAC'],
              offers: [{ merchant: 'Beispiel Shop', price: 199, url: 'https://example.com/shop/kiro' }],
            },
          ],
        }),
      },
      { text: '\nWer vor allem lange Akkulaufzeit braucht, greift zum **Pulse 2**.' },
    ],
  },

  stats: {
    format: 'stats',
    steps: () => [
      { text: 'Deine Kennzahlen diese Woche:\n\n' },
      {
        text: hui({
          type: 'stats',
          items: [
            { label: 'Schritte', value: '8.421', delta: '+12 %', trend: 'up' },
            { label: 'Schlaf', value: '6,8 h', delta: '-0,4 h', trend: 'down' },
            { label: 'Puls (Ruhe)', value: '58', delta: '±0', trend: 'flat' },
          ],
        }),
      },
      {
        text:
          '\n' +
          hui({ type: 'callout', tone: 'warning', title: 'Schlaf', text: 'Du schläfst unter deinem Ziel von 7,5 h.' }) +
          hui({ type: 'progress', label: 'Wochenziel Schritte', value: 52, max: 70 }),
      },
    ],
  },

  compare: {
    format: 'compare',
    steps: (ctx) => [
      { text: L(ctx, 'Vergleich der drei Tarife:\n\n', 'Comparison of the three plans:\n\n', 'Comparación de las tres tarifas:\n\n') },
      {
        text: hui({
          type: 'compare',
          columns: [
            { title: 'Basic', items: ['5 GB', L(ctx, '9 € / Monat', '€9 / month', '9 € / mes'), L(ctx, 'Kündigung 1 Monat', '1 month notice', 'Baja con 1 mes de aviso')], cons: [L(ctx, 'Kein 5G', 'No 5G', 'Sin 5G')] },
            { title: 'Plus', badge: L(ctx, 'Empfohlen', 'Recommended', 'Recomendado'), highlight: true, items: ['50 GB', L(ctx, '15 € / Monat', '€15 / month', '15 € / mes'), L(ctx, 'Kündigung 1 Monat', '1 month notice', 'Baja con 1 mes de aviso')], pros: [L(ctx, '5G inklusive', '5G included', '5G incluido')] },
            { title: 'Max', items: [L(ctx, 'Unlimitiert', 'Unlimited', 'Ilimitado'), L(ctx, '29 € / Monat', '€29 / month', '29 € / mes'), L(ctx, 'EU-Roaming', 'EU roaming', 'Roaming UE')], pros: [L(ctx, '5G inklusive', '5G included', '5G incluido')], cons: [L(ctx, 'Klar teurer', 'More expensive', 'Más caro')] },
          ],
        }),
      },
      { text: L(ctx, '\nFür die meisten passt **Plus** am besten.', '\n**Plus** fits most people best.', '\n**Plus** es lo que mejor encaja con la mayoría.') },
    ],
  },

  form: {
    format: 'form',
    steps: () => [
      { text: 'Gib die Eckdaten ein, dann rechne ich den Kredit durch:\n\n' },
      {
        text: hui({
          type: 'form',
          id: 'kredit',
          title: 'Kreditanfrage',
          fields: [
            { name: 'betrag', label: 'Betrag', kind: 'number', unit: '€', min: 1000, max: 100000, default: 20000 },
            { name: 'laufzeit', label: 'Laufzeit (Jahre)', kind: 'slider', min: 1, max: 15, step: 1, default: 5 },
            { name: 'typ', label: 'Zinsbindung', kind: 'select', options: ['fix', 'variabel'], default: 'fix' },
            { name: 'sondertilgung', label: 'Sondertilgung', kind: 'toggle', default: false },
            { name: 'start', label: 'Start', kind: 'date' },
          ],
          submit: { label: 'Berechnen' },
        }),
      },
    ],
  },

  formResult: {
    format: 'text',
    steps: (ctx) => [{ text: `Danke, ich habe deine Eingaben erhalten:\n\n\`\`\`json\n${ctx.userText.replace(/^\[form:[^\]]*\]\s*/, '')}\n\`\`\`\n\nMonatliche Rate: **ca. 372 €** (Demo-Wert).` }],
  },

  paths: {
    format: 'paths',
    steps: (ctx) => [
      { wait: 300 },
      {
        text: L(
          ctx,
          'Für Dateien einer Linux-VM auf dem Mac gibt es drei typische Wege – der geteilte Ordner ist meist der beste Kompromiss:\n\n',
          'There are three typical places for the files of a Linux VM on a Mac – the shared folder is usually the best compromise:\n\n',
          'Hay tres sitios típicos para los archivos de una VM Linux en un Mac; la carpeta compartida suele ser el mejor compromiso:\n\n',
        ),
      },
      {
        text: hui({
          type: 'paths',
          id: 'demo-dateien',
          title: L(ctx, 'Wo liegen die Dateien?', 'Where do the files live?', '¿Dónde están los archivos?'),
          items: [
            {
              id: 'nativ',
              title: L(ctx, 'Nativ in macOS', 'Native in macOS', 'Nativo en macOS'),
              badge: { text: L(ctx, 'Ausgangsbasis', 'Baseline', 'Punto de partida'), tone: 'neutral' },
              path: [{ label: 'macOS', icon: 'laptop' }, { label: 'APFS', icon: 'disk' }, { label: L(ctx, 'interne SSD', 'internal SSD', 'SSD interno'), icon: 'disk' }],
              note: L(ctx, 'Schnellster Zugriff, Time Machine sichert alles mit.', 'Fastest access, Time Machine backs it all up.', 'Acceso más rápido; Time Machine lo respalda todo.'),
            },
            {
              id: 'vm-disk',
              title: L(ctx, 'In der VM-Disk', 'Inside the VM disk', 'Dentro del disco de la VM'),
              badge: { text: L(ctx, 'Vermeiden', 'Avoid', 'Evitar'), tone: 'bad' },
              path: [{ label: 'macOS', icon: 'laptop' }, { label: 'Linux-VM', icon: 'vm' }, { label: L(ctx, 'ext4-Image', 'ext4 image', 'imagen ext4'), icon: 'file' }],
              note: L(ctx, 'Alles steckt in einer Image-Datei – Backup und Zugriff aus macOS sind umständlich.', 'Everything sits in one image file – backup and access from macOS are awkward.', 'Todo queda en un archivo de imagen: copias y acceso desde macOS son incómodos.'),
            },
            {
              id: 'geteilt',
              title: L(ctx, 'Geteilter Ordner', 'Shared folder', 'Carpeta compartida'),
              badge: { text: L(ctx, 'Interessant', 'Interesting', 'Interesante'), tone: 'good' },
              path: [{ label: 'Linux-VM', icon: 'vm' }, { label: 'virtiofs', icon: 'folder' }, { label: L(ctx, 'macOS-Ordner', 'macOS folder', 'carpeta de macOS'), icon: 'folder' }],
              note: L(ctx, 'Linux-Werkzeuge in der VM, die Dateien bleiben in macOS gesichert.', 'Linux tools in the VM, the files stay backed up in macOS.', 'Herramientas Linux en la VM; los archivos siguen respaldados en macOS.'),
            },
          ],
        }),
      },
    ],
  },

  blocks: {
    format: 'blocks',
    steps: (ctx) => {
      const agents = (framed: boolean) =>
        [1, 2, 3, 4].map((n) => ({ label: `Agent ${n}`, icon: framed ? 'vm' : 'container', ...(framed ? { sub: `Kernel ${n}`, style: 'framed' } : {}) }));
      return [
        { wait: 300 },
        {
          text: L(
            ctx,
            'OrbStack lässt alle Agenten auf einem gemeinsamen Linux-Kernel laufen, klassische VMs (VMPal, Parallels) starten für jeden Agenten einen eigenen:\n\n',
            'OrbStack runs every agent on one shared Linux kernel, classic VMs (VMPal, Parallels) boot a kernel of their own for each agent:\n\n',
            'OrbStack ejecuta todos los agentes sobre un único kernel Linux compartido; las VM clásicas (VMPal, Parallels) arrancan un kernel propio por agente:\n\n',
          ),
        },
        {
          text: hui({
            type: 'blocks',
            id: 'demo-architektur',
            title: L(ctx, 'Agenten auf dem Mac: geteilter Kernel oder eigene VMs', 'Agents on a Mac: shared kernel or separate VMs', 'Agentes en el Mac: kernel compartido o VM propias'),
            columns: [
              { title: 'OrbStack', grid: 2, items: agents(false), base: { label: L(ctx, '1 Linux-Kernel', '1 Linux kernel', '1 kernel Linux'), sub: L(ctx, 'Gemeinsam genutzt', 'Shared', 'Compartido'), icon: 'terminal' } },
              { title: 'VMPal / Parallels', grid: 2, items: agents(true) },
            ],
            caption: L(
              ctx,
              'Vereinfachtes Architekturmodell – OrbStack teilt einen Kernel, klassische VMs bringen je einen eigenen mit.',
              'Simplified architecture – OrbStack shares one kernel, classic VMs bring one each.',
              'Modelo de arquitectura simplificado: OrbStack comparte un kernel, las VM clásicas traen uno cada una.',
            ),
          }),
        },
        {
          text: L(
            ctx,
            '\nDer geteilte Kernel spart Speicher und startet schneller; eigene Kernel isolieren die Agenten stärker voneinander.',
            '\nThe shared kernel saves memory and starts faster; separate kernels isolate the agents more strongly.',
            '\nEl kernel compartido ahorra memoria y arranca más rápido; los kernels propios aíslan más a los agentes.',
          ),
        },
      ];
    },
  },

  interaction: {
    format: 'text',
    steps: (ctx) => [
      {
        text:
          `Angekommen: \`${ctx.userText.slice(0, 160)}\`\n\n` +
          'So landen Antworten aus interaktiven Bausteinen (Auswahl, Checkliste, Rechner, Quiz) bei Hermes – als normale Nachricht mit einem Kennzeichen, damit der Agent weiß, worauf sie sich bezieht.',
      },
    ],
  },

  steps: {
    format: 'steps',
    steps: () => [
      { text: 'So installierst du es:\n\n' },
      {
        text: hui({
          type: 'steps',
          current: 1,
          items: [
            { title: 'Paket laden', detail: 'Lade das Archiv von der Projektseite.' },
            { title: 'Entpacken', detail: 'Mit `tar -xf paket.tar.gz`.' },
            { title: 'Konfigurieren' },
            { title: 'Starten', detail: 'Mit `./run`.' },
          ],
        }),
      },
      { text: '\nSag Bescheid, wenn du bei Schritt 2 hängst.' },
    ],
  },

  timeline: {
    format: 'timeline',
    steps: () => [
      { text: 'Der Ablauf deiner Reise:\n\n' },
      {
        text: hui({
          type: 'timeline',
          items: [
            { time: '07:10', title: 'Abflug Wien', detail: 'Terminal 3, Gate C12' },
            { time: '09:05', title: 'Ankunft Lissabon', imageQuery: 'Lissabon' },
            { time: '11:00', title: 'Check-in Hotel', detail: 'Rua Augusta 12' },
            { time: '19:30', title: 'Abendessen', detail: 'Reservierung auf „Silva“' },
          ],
        }),
      },
    ],
  },

  buttons: {
    format: 'text',
    steps: () => [
      { text: 'Was möchtest du als Nächstes tun?\n\n' },
      {
        text: hui({
          type: 'buttons',
          items: [
            { label: 'Details anzeigen', style: 'primary', action: { type: 'send', text: 'Zeig mir die Details' } },
            { label: 'Link öffnen', style: 'secondary', action: { type: 'open_url', url: 'https://example.com' } },
            { label: 'Kopieren', style: 'secondary', action: { type: 'copy', text: 'Hallo aus der Demo' } },
          ],
        }),
      },
      { text: '\n' + hui({ type: 'suggestions', items: ['Zeig mir ein Diagramm', 'Vergleiche drei Tarife', 'Öffne den Rechner'] }) },
    ],
  },

  calculator: {
    format: 'calculator',
    steps: () => [
      { text: 'Hier ist ein einfacher Taschenrechner (generiertes HTML in einer Sandbox):\n\n' },
      { text: '```hui-html\n' + CALCULATOR_HTML + '\n```\n' },
      { text: '\nTipp: Probiere `12*7=`.' },
    ],
  },

  loan: {
    format: 'calculator',
    steps: (ctx) => [
      { text: L(ctx, 'Hier ist ein interaktiver Kreditrechner. Die Startwerte sind **20.000 €** bei 6,5 % Sollzins und 5 Jahren Laufzeit:\n\n', 'Here is an interactive loan calculator. The starting values are **€20,000** at 6.5 % interest over 5 years (the calculator itself is shown in German):\n\n', 'Aquí tienes una calculadora de préstamos interactiva. Valores iniciales: **20.000 €** al 6,5 % de interés a 5 años (la calculadora se muestra en alemán):\n\n') },
      { text: '```hui-html\n' + LOAN_HTML + '\n```\n' },
      { text: L(ctx, '\nMit den Schiebereglern kannst du Betrag, Zins und Laufzeit ändern. Die Rate wird nach der Annuitätenformel berechnet.', '\nUse the sliders to change amount, interest and term. The instalment uses the annuity formula.', '\nCon los deslizadores cambias importe, interés y plazo. La cuota se calcula con la fórmula de anualidad.') },
    ],
  },

  mixed: {
    format: 'interactive',
    steps: (ctx) => [
      { text: L(ctx, '# Wochenbericht\n\nIch habe die Daten ausgewertet und alles zusammengefasst.\n\n', '# Weekly report\n\nI analysed the data and summarised everything.\n\n', '# Informe semanal\n\nHe analizado los datos y lo he resumido todo.\n\n') },
      { tool: { name: 'read_file', label: '~/data/week.csv', emoji: '\u{1F4C4}', ms: 700 } },
      { text: L(ctx, '## Überblick\n\n', '## Overview\n\n', '## Resumen\n\n') },
      {
        text: hui({
          type: 'stats',
          items: [
            { label: L(ctx, 'Umsatz', 'Revenue', 'Ingresos'), value: L(ctx, '12.480 €', '€12,480', '12.480 €'), delta: L(ctx, '+4,2 %', '+4.2 %', '+4,2 %'), trend: 'up' },
            { label: L(ctx, 'Kunden', 'Customers', 'Clientes'), value: '318', delta: '+9', trend: 'up' },
            { label: L(ctx, 'Retouren', 'Returns', 'Devoluciones'), value: L(ctx, '2,1 %', '2.1 %', '2,1 %'), delta: L(ctx, '-0,3 pp', '-0.3 pp', '-0,3 pp'), trend: 'down' },
          ],
        }),
      },
      { text: L(ctx, '\n## Verlauf\n\nDer Umsatz stieg über die Woche fast durchgehend:\n\n', '\n## Trend\n\nRevenue rose almost every day of the week:\n\n', '\n## Evolución\n\nLos ingresos subieron casi cada día de la semana:\n\n') },
      {
        text: hui({
          type: 'chart',
          kind: 'area',
          title: L(ctx, 'Umsatz pro Tag (€)', 'Revenue per day (€)', 'Ingresos por día (€)'),
          series: [{ name: L(ctx, 'Umsatz', 'Revenue', 'Ingresos'), data: [1450, 1620, 1580, 1910, 2230, 2010, 1680].map((y, i) => ({ x: DAYS[ctx.lang ?? 'de'][i], y })) }],
        }),
      },
      { text: L(ctx, '\n## Details\n\n', '\n## Details\n\n', '\n## Detalles\n\n') },
      {
        text: hui({
          type: 'table',
          columns: [L(ctx, 'Kategorie', 'Category', 'Categoría'), L(ctx, 'Umsatz', 'Revenue', 'Ingresos'), L(ctx, 'Anteil', 'Share', 'Cuota')],
          rows: [['Hardware', L(ctx, '6.100 €', '€6,100', '6.100 €'), '49 %'], ['Software', L(ctx, '4.300 €', '€4,300', '4.300 €'), '34 %'], ['Service', L(ctx, '2.080 €', '€2,080', '2.080 €'), '17 %']],
        }),
      },
      {
        text:
          L(
            ctx,
            '\n**Fazit:** Gute Woche. Mögliche nächste Schritte:\n\n1. Retouren im Bereich Hardware prüfen\n2. Wochenende stärker bewerben\n3. Preisänderung simulieren\n\n',
            '\n**Summary:** a good week. Possible next steps:\n\n1. Check hardware returns\n2. Promote the weekend more\n3. Simulate a price change\n\n',
            '\n**Conclusión:** buena semana. Posibles próximos pasos:\n\n1. Revisar las devoluciones de hardware\n2. Promocionar más el fin de semana\n3. Simular un cambio de precio\n\n',
          ) + hui({ type: 'suggestions', items: ['Zinsrechner', 'Einkaufsliste', 'Quiz zur Geografie'] }),
      },
    ],
  },

  // ── v2 modules ──────────────────────────────────────────────────────────────────────────────────
  choice: {
    format: 'interactive',
    steps: () => [
      { text: 'Gern! Damit ich passend planen kann – wohin soll der Wochenendtrip gehen?\n\n' },
      {
        text: hui({
          type: 'choice',
          id: 'reiseziel',
          question: 'Wähle ein Ziel',
          layout: 'grid',
          options: [
            { label: 'Rom', description: 'Kultur & Pasta', icon: '\u{1F3DB}\u{FE0F}', imageQuery: 'Kolosseum' },
            { label: 'Lissabon', description: 'Meer & Hügel', icon: '\u{1F30A}', imageQuery: 'Lissabon' },
            { label: 'Wien', description: 'Kaffeehäuser', icon: '☕', imageQuery: 'Wiener Staatsoper' },
            { label: 'Kopenhagen', description: 'Design & Rad', icon: '\u{1F6B2}', imageQuery: 'Nyhavn' },
          ],
          allowOther: true,
        }),
      },
    ],
  },

  checklist: {
    format: 'interactive',
    steps: () => [
      { text: 'Hier ist deine Einkaufsliste für das Wochenende, nach Abteilungen sortiert:\n\n' },
      {
        text: hui({
          type: 'checklist',
          id: 'einkauf',
          title: 'Einkauf Samstag',
          kind: 'shopping',
          groupBy: 'category',
          items: [
            { text: 'Tomaten', qty: 6, category: 'Obst & Gemüse' },
            { text: 'Basilikum', qty: 1, unit: 'Topf', category: 'Obst & Gemüse' },
            { text: 'Zitronen', qty: 3, category: 'Obst & Gemüse' },
            { text: 'Mozzarella', qty: 2, category: 'Kühlregal' },
            { text: 'Butter', qty: 250, unit: 'g', category: 'Kühlregal', checked: true },
            { text: 'Spaghetti', qty: 500, unit: 'g', category: 'Vorrat' },
            { text: 'Olivenöl', qty: 1, unit: 'Flasche', category: 'Vorrat' },
          ],
        }),
      },
      { text: '\nAbgehakte Einträge wandern nach unten; mit „An Hermes senden“ bekommt der Agent den Stand.' },
    ],
  },

  calc: {
    format: 'calculator',
    steps: () => [
      { text: 'Ein Zinseszins-Rechner – nativ berechnet, ohne generierten Code:\n\n' },
      {
        text: hui({
          type: 'calc',
          id: 'sparplan',
          title: 'Sparplan mit Zinseszins',
          basis: 'calculated',
          inputs: [
            { name: 'start', label: 'Startkapital', kind: 'number', min: 0, max: 1000000, step: 500, default: 5000, unit: '€' },
            { name: 'rate', label: 'Monatliche Sparrate', kind: 'slider', min: 0, max: 2000, step: 25, default: 200, unit: '€' },
            { name: 'zins', label: 'Zinssatz p. a.', kind: 'slider', min: 0, max: 10, step: 0.25, default: 4, unit: '%' },
            { name: 'jahre', label: 'Laufzeit', kind: 'slider', min: 1, max: 40, step: 1, default: 15, unit: 'Jahre' },
          ],
          outputs: [
            { name: 'q', label: 'Monatszins', expr: 'zins / 100 / 12', format: 'percent', decimals: 3 },
            { name: 'n', label: 'Monate', expr: 'jahre * 12', format: 'integer' },
            { name: 'end', label: 'Endkapital', expr: 'q == 0 ? start + rate * n : start * pow(1 + q, n) + rate * (pow(1 + q, n) - 1) / q', format: 'currency', emphasis: true },
            { label: 'Eingezahlt', expr: 'start + rate * n', format: 'currency' },
            { label: 'Zinserträge', expr: 'end - start - rate * n', format: 'currency' },
          ],
          chart: { kind: 'line', sweep: { input: 'jahre', from: 1, to: 40, steps: 40 }, y: 'zins == 0 ? start + rate * jahre * 12 : start * pow(1 + zins / 1200, jahre * 12) + rate * (pow(1 + zins / 1200, jahre * 12) - 1) / (zins / 1200)', label: 'Endkapital nach Laufzeit' },
          note: 'Vereinfachte Rechnung ohne Steuern und Inflation.',
        }),
      },
    ],
  },

  recipe: {
    format: 'interactive',
    steps: () => [
      { text: 'Ein schneller Klassiker:\n\n' },
      {
        text: hui({
          type: 'recipe',
          id: 'pasta-pomodoro',
          title: 'Spaghetti al Pomodoro',
          imageQuery: 'Spaghetti al pomodoro',
          servings: 2,
          time: { prep: 10, cook: 15, total: 25 },
          ingredients: [
            { qty: 200, unit: 'g', item: 'Spaghetti' },
            { qty: 400, unit: 'g', item: 'Tomaten (Dose, gehackt)' },
            { qty: 2, item: 'Knoblauchzehen' },
            { qty: 3, unit: 'EL', item: 'Olivenöl' },
            { unit: 'eine Handvoll', item: 'Basilikum' },
            { unit: 'nach Geschmack', item: 'Salz, Pfeffer' },
          ],
          steps: [
            { text: 'Nudelwasser aufsetzen und kräftig salzen.' },
            { text: 'Knoblauch in Olivenöl sanft anschwitzen, Tomaten dazugeben und köcheln lassen.', timerSeconds: 600 },
            { text: 'Spaghetti al dente kochen.', timerSeconds: 540 },
            { text: 'Nudeln mit der Sauce mischen, Basilikum darüber zupfen.' },
          ],
          tips: ['Ein Schluck Nudelwasser macht die Sauce sämiger.'],
        }),
      },
    ],
  },

  map: {
    format: 'map',
    steps: () => [
      { text: 'Ein Spaziergang durch die Wiener Innenstadt in fünf Stationen:\n\n' },
      {
        text: hui({
          type: 'map',
          id: 'wien-spaziergang',
          title: 'Spaziergang Innere Stadt',
          route: true,
          animate: true,
          basis: 'illustrative',
          markers: [
            { lat: 48.2033, lng: 16.3689, title: 'Staatsoper', number: 1, imageQuery: 'Wiener Staatsoper' },
            { lat: 48.2049, lng: 16.3699, title: 'Albertina', number: 2 },
            { lat: 48.2069, lng: 16.3655, title: 'Hofburg', number: 3, imageQuery: 'Hofburg' },
            { lat: 48.2085, lng: 16.3721, title: 'Stephansdom', number: 4, imageQuery: 'Stephansdom' },
            { lat: 48.2109, lng: 16.3777, title: 'Schwedenplatz', number: 5, description: 'Eis am Donaukanal' },
          ],
        }),
      },
      { text: '\nDie Strecke ist eine Skizze, keine Navigation (Kartendaten: OpenStreetMap).' },
    ],
  },

  quiz: {
    format: 'interactive',
    steps: () => [
      { text: 'Kleines Geografie-Quiz – drei Fragen:\n\n' },
      {
        text: hui({
          type: 'quiz',
          id: 'geo-quiz',
          title: 'Hauptstädte Europas',
          questions: [
            { q: 'Was ist die Hauptstadt von Portugal?', options: ['Porto', 'Lissabon', 'Coimbra'], answer: 1, explanation: 'Lissabon ist seit dem 13. Jahrhundert Hauptstadt.' },
            { q: 'Welche Stadt liegt an der Donau?', options: ['Wien', 'Prag', 'Zürich', 'München'], answer: 0, explanation: 'Wien, Bratislava, Budapest und Belgrad liegen an der Donau.' },
            { q: 'Welche dieser Städte sind Hauptstädte?', options: ['Bern', 'Genf', 'Oslo', 'Mailand'], answer: [0, 2], explanation: 'Bern (Schweiz) und Oslo (Norwegen).' },
          ],
        }),
      },
    ],
  },

  images: {
    format: 'image',
    steps: () => [
      { text: 'Ein paar Eindrücke aus Rom (Fotos von Wikimedia Commons, über den Namen gesucht):\n\n' },
      { text: hui({ type: 'image', query: 'Kolosseum', caption: 'Das Kolosseum' }) },
      {
        text:
          '\n' +
          hui({
            type: 'gallery',
            items: [{ query: 'Trevi-Brunnen', caption: 'Trevi-Brunnen' }, { query: 'Pantheon (Rom)', caption: 'Pantheon' }, { query: 'Petersdom', caption: 'Petersdom' }, { query: 'Spanische Treppe', caption: 'Spanische Treppe' }],
          }),
      },
      { text: '\nBilder werden nie erfunden: das Modell nennt nur das Motiv, die App sucht das passende freie Foto.' },
    ],
  },

  // ── showcase scenarios (also used by scripts/demo-videos) ─────────────────────────────────────
  carbonara: {
    format: 'recipe',
    steps: () => [
      { wait: 700 },
      { text: 'Gern – die echte römische Carbonara, ganz ohne Sahne:\n\n' },
      {
        text: hui({
          type: 'recipe',
          id: 'carbonara',
          title: 'Spaghetti Carbonara',
          imageQuery: 'Spaghetti alla carbonara',
          servings: 2,
          time: { prep: 10, cook: 15, total: 25 },
          ingredients: [
            { qty: 200, unit: 'g', item: 'Spaghetti' },
            { qty: 100, unit: 'g', item: 'Guanciale (oder Pancetta)' },
            { qty: 3, item: 'Eigelb' },
            { qty: 1, item: 'Ei' },
            { qty: 50, unit: 'g', item: 'Pecorino Romano, fein gerieben' },
            { unit: 'reichlich', item: 'schwarzer Pfeffer, frisch gemahlen' },
          ],
          steps: [
            { text: 'Reichlich Wasser aufsetzen und salzen – etwas weniger als sonst, Guanciale und Pecorino sind salzig.' },
            { text: 'Guanciale in Streifen schneiden und in der Pfanne ohne Öl langsam knusprig auslassen.', timerSeconds: 300 },
            { text: 'Spaghetti al dente kochen, eine Tasse Nudelwasser aufheben.', timerSeconds: 540 },
            { text: 'Eigelb, Ei, Pecorino und Pfeffer zu einer dicken Creme verrühren.' },
            { text: 'Pfanne vom Herd nehmen, Spaghetti hinein, Eiercreme und einen Schuss Nudelwasser unterschwenken, bis es glänzt.' },
          ],
          tips: ['Die Pfanne darf nicht mehr auf der heißen Platte stehen – sonst stockt das Ei.', 'Keine Sahne: die Cremigkeit kommt vom Ei und vom Nudelwasser.'],
        }),
      },
      { text: '\nBuon appetito! Mit dem Portionsregler rechne ich die Mengen um.' },
    ],
  },

  romTrip: {
    format: 'map',
    steps: () => [
      { reasoning: 'Wochenende in Rom: Sehenswürdigkeiten zu Fuß gruppieren, Samstag Antike, Sonntag Vatikan.' },
      { tool: { name: 'web_search', label: 'Rom Sehenswürdigkeiten Wochenende Route', emoji: '\u{1F50D}', ms: 900 } },
      { text: 'Hier ist dein Wochenende in Rom – alles gut zu Fuß erreichbar:\n\n' },
      {
        text: hui({
          type: 'map',
          id: 'rom-wochenende',
          title: 'Rom an zwei Tagen',
          route: true,
          animate: true,
          basis: 'illustrative',
          markers: [
            { lat: 41.8902, lng: 12.4922, title: 'Kolosseum', number: 1, imageQuery: 'Kolosseum' },
            { lat: 41.8925, lng: 12.4853, title: 'Forum Romanum', number: 2, imageQuery: 'Forum Romanum' },
            { lat: 41.8986, lng: 12.4769, title: 'Pantheon', number: 3, imageQuery: 'Pantheon (Rom)' },
            { lat: 41.9009, lng: 12.4833, title: 'Trevi-Brunnen', number: 4, imageQuery: 'Trevi-Brunnen' },
            { lat: 41.906, lng: 12.4828, title: 'Spanische Treppe', number: 5, imageQuery: 'Spanische Treppe' },
            { lat: 41.9022, lng: 12.4539, title: 'Petersdom', number: 6, imageQuery: 'Petersdom' },
          ],
        }),
      },
      {
        text:
          '\n' +
          hui({
            type: 'gallery',
            items: [{ query: 'Kolosseum', caption: 'Kolosseum' }, { query: 'Pantheon (Rom)', caption: 'Pantheon' }, { query: 'Trevi-Brunnen', caption: 'Trevi-Brunnen' }, { query: 'Petersdom', caption: 'Petersdom' }],
          }),
      },
      {
        text:
          '\n**Ablauf**\n\n' +
          hui({
            type: 'timeline',
            items: [
              { time: 'Sa 09:00', title: 'Kolosseum & Forum Romanum', detail: 'Kombiticket vorab online buchen' },
              { time: 'Sa 13:00', title: 'Mittagessen in Monti', detail: 'Cacio e pepe probieren' },
              { time: 'Sa 16:00', title: 'Pantheon & Trevi-Brunnen', detail: 'Münze werfen nicht vergessen' },
              { time: 'Sa 19:30', title: 'Aperitivo an der Spanischen Treppe' },
              { time: 'So 08:30', title: 'Petersdom', detail: 'Früh da sein, dann ist die Schlange kurz' },
              { time: 'So 12:00', title: 'Trastevere', detail: 'Bummeln und Pizza al taglio' },
            ],
          }),
      },
      { text: '\nDie Linie auf der Karte ist eine Orientierung, keine Wegbeschreibung.' },
    ],
  },

  reiseChoice: {
    format: 'choice',
    steps: () => [
      { text: 'Berlin → München lässt sich gut mit beidem machen. Damit ich fair vergleiche: Was ist dir wichtig?\n\n' },
      {
        text: hui({
          type: 'choice',
          id: 'reise-prio',
          question: 'Was zählt für dich? (mehrere möglich)',
          multiple: true,
          layout: 'list',
          submitLabel: 'Vergleichen',
          options: [
            { id: 'preis', label: 'Preis', icon: '\u{1F4B6}', description: 'Möglichst günstig' },
            { id: 'zeit', label: 'Reisezeit', icon: '⏱️', description: 'Tür zu Tür' },
            { id: 'klima', label: 'Klima', icon: '\u{1F331}', description: 'Wenig CO₂' },
            { id: 'arbeiten', label: 'Arbeiten unterwegs', icon: '\u{1F4BB}', description: 'Laptop, WLAN, Tisch' },
          ],
        }),
      },
    ],
  },

  reiseDecision: {
    format: 'decision',
    steps: (ctx) => {
      const t = ctx.userText.toLowerCase();
      const w = (key: string, on: number, off: number) => (t.includes(key) ? on : off);
      return [
        { tool: { name: 'web_search', label: 'ICE Berlin München Fahrzeit', emoji: '\u{1F50D}', ms: 600 } },
        { tool: { name: 'web_search', label: 'Flug Berlin München CO₂ pro Person', emoji: '\u{1F50D}', ms: 500 } },
        { text: 'Ich habe deine Prioritäten als Gewichte übernommen. Schieb die Regler, wenn sich etwas anders anfühlt:\n\n' },
        {
          text: hui({
            type: 'decision',
            id: 'reise-berlin-muenchen',
            title: 'Berlin → München',
            criteria: [
              { id: 'preis', label: 'Preis', weight: w('preis', 8, 4) },
              { id: 'zeit', label: 'Reisezeit (Tür zu Tür)', weight: w('reisezeit', 8, 4) },
              { id: 'klima', label: 'Klima', weight: w('klima', 9, 3) },
              { id: 'arbeiten', label: 'Arbeiten unterwegs', weight: w('arbeiten', 7, 2) },
              { id: 'komfort', label: 'Komfort', weight: 5 },
            ],
            options: [
              { id: 'bahn', label: '\u{1F686} Bahn (ICE Sprinter)', scores: { preis: 7, zeit: 7, klima: 10, arbeiten: 9, komfort: 8 }, note: 'ca. 4 h, Stadtmitte zu Stadtmitte' },
              { id: 'flug', label: '✈️ Flugzeug', scores: { preis: 5, zeit: 8, klima: 2, arbeiten: 3, komfort: 5 }, note: '1 h Flug + Anreise + Sicherheitskontrolle' },
              { id: 'auto', label: '\u{1F697} Auto', scores: { preis: 5, zeit: 4, klima: 4, arbeiten: 0, komfort: 6 }, note: 'ca. 6 h, Stau-Risiko' },
            ],
            note: 'Schätzwerte 0–10 für eine typische Reise unter der Woche.',
          }),
        },
        { text: '\nMit deinen Gewichten liegt die **Bahn** vorn – vor allem wegen Klima und Arbeitszeit unterwegs.' },
      ];
    },
  },

  kreditCalc: {
    format: 'calc',
    steps: () => [
      { wait: 400 },
      { text: 'Hier ist dein Kreditrechner – Betrag, Zins und Laufzeit lassen sich mit den Reglern ändern:\n\n' },
      {
        text: hui({
          type: 'calc',
          id: 'autokredit',
          title: 'Autokredit',
          basis: 'calculated',
          inputs: [
            { name: 'betrag', label: 'Kreditsumme', kind: 'slider', min: 5000, max: 60000, step: 500, default: 25000, unit: '€' },
            { name: 'zins', label: 'Sollzins p. a.', kind: 'slider', min: 0.5, max: 12, step: 0.1, default: 5.9, unit: '%' },
            { name: 'jahre', label: 'Laufzeit', kind: 'slider', min: 1, max: 10, step: 1, default: 5, unit: 'Jahre' },
          ],
          outputs: [
            { name: 'q', label: 'Monatszins', expr: 'zins / 100 / 12', format: 'percent', decimals: 3 },
            { name: 'n', label: 'Raten', expr: 'jahre * 12', format: 'integer' },
            { name: 'rate', label: 'Monatliche Rate', expr: 'q == 0 ? betrag / n : betrag * q / (1 - pow(1 + q, -n))', format: 'currency', emphasis: true },
            { label: 'Zinskosten gesamt', expr: 'rate * n - betrag', format: 'currency' },
            { label: 'Gesamtbetrag', expr: 'rate * n', format: 'currency' },
          ],
          chart: { kind: 'bar', sweep: { input: 'jahre', from: 1, to: 10, steps: 10 }, y: 'zins == 0 ? betrag / (jahre * 12) : betrag * (zins / 1200) / (1 - pow(1 + zins / 1200, -jahre * 12))', label: 'Monatliche Rate nach Laufzeit' },
          note: 'Annuitätendarlehen mit festem Zins, ohne Gebühren.',
        }),
      },
    ],
  },

  poll: {
    format: 'poll',
    steps: () => [
      { wait: 500 },
      { text: 'Gute Idee! Gebt das Handy einfach reihum weiter – jede Person tippt ihren Namen und stimmt ab:\n\n' },
      {
        text: hui({
          type: 'poll',
          id: 'familie-samstag',
          question: 'Was kochen wir am Samstag?',
          options: [
            { id: 'pizza', label: 'Pizza', emoji: '\u{1F355}' },
            { id: 'paella', label: 'Paella', emoji: '\u{1F958}' },
          ],
          voters: ['Mama', 'Papa', 'Lena', 'Oma'],
          allowAdd: true,
        }),
      },
    ],
  },

  translation: {
    format: 'translation',
    steps: () => [
      { wait: 400 },
      {
        text: hui({
          type: 'translation',
          id: 'tr-sonntag',
          source: { lang: 'de', text: 'Kommst du am Sonntag zum Mittagessen? Oma kocht Paella und wir sitzen im Garten.' },
          targets: [{ lang: 'es', text: '¿Vienes el domingo a comer? La abuela cocina paella y nos sentamos en el jardín.' }],
          note: '„Comer“ heißt in Spanien auch „zu Mittag essen“; in Lateinamerika sagt man eher „almorzar“.',
        }),
      },
      { text: '\nMit 🔊 hörst du die Aussprache, mit „Tauschen“ drehst du die Richtung um.' },
    ],
  },

  charts3: {
    format: 'chart',
    steps: () => [
      { text: 'Drei Diagramme, drei Fragen:\n\n**1. Strompreis für Haushalte**\n\n' },
      {
        text: hui({
          type: 'chart',
          kind: 'line',
          title: 'Strompreis Haushalte (ct/kWh)',
          unit: 'ct',
          basis: 'illustrative',
          series: [
            { name: 'Durchschnitt', data: xy([['2019', 30.5], ['2020', 31.8], ['2021', 32.2], ['2022', 37.1], ['2023', 45.2], ['2024', 41.4], ['2025', 39.6]]) },
            { name: 'Neukunden', data: xy([['2019', 28.9], ['2020', 29.4], ['2021', 31.0], ['2022', 52.4], ['2023', 36.8], ['2024', 33.1], ['2025', 31.9]]) },
          ],
        }),
      },
      { text: '\n**2. Zwei Handys im Vergleich**\n\n' },
      {
        text: hui({
          type: 'chart',
          kind: 'radar',
          title: 'Handy A vs. Handy B',
          max: 10,
          basis: 'estimate',
          series: [
            { name: 'Handy A', data: xy([['Kamera', 8.5], ['Akku', 8], ['Display', 7.5], ['Leistung', 7], ['Preis', 9.5], ['Updates', 9.5]]) },
            { name: 'Handy B', data: xy([['Kamera', 9], ['Akku', 7], ['Display', 9.4], ['Leistung', 9.3], ['Preis', 6], ['Updates', 8.5]]) },
          ],
        }),
      },
      { text: '\n**3. Dein Monatsbudget**\n\n' },
      {
        text: hui({
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
        }),
      },
      { text: '\nTipp: Tippe auf einen Punkt oder Balken, um die genauen Werte zu sehen.' },
    ],
  },

  agenda: {
    format: 'agenda',
    steps: (ctx) => {
      const d = new Date(ctx.now);
      d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return [
        { wait: 500 },
        { text: 'Hier ist ein entspannter Plan für deinen Samstag. Blöcke kannst du verschieben oder direkt in den Kalender übernehmen:\n\n' },
        {
          text: hui({
            type: 'agenda',
            id: 'samstag',
            date,
            title: 'Samstag',
            blocks: [
              { id: 'fruehstueck', start: '08:30', end: '09:15', title: 'Frühstück', kind: 'meal' },
              { id: 'laufen', start: '09:30', end: '10:30', title: 'Laufen im Park', kind: 'sport', location: 'Stadtpark' },
              { id: 'markt', start: '11:00', end: '12:00', title: 'Wochenmarkt', kind: 'free', note: 'Tomaten, Basilikum, Käse' },
              { id: 'mittag', start: '12:30', end: '13:30', title: 'Mittagessen mit Oma', kind: 'meal' },
              { id: 'rad', start: '14:30', end: '15:30', title: 'Fahrrad reparieren', kind: 'focus' },
              { id: 'kaffee', start: '16:00', end: '17:00', title: 'Kaffee mit Jana', kind: 'event', location: 'Café am Eck' },
              { id: 'kino', start: '19:30', end: '21:30', title: 'Kino', kind: 'event' },
            ],
          }),
        },
      ];
    },
  },

  webSuche: {
    format: 'text',
    steps: () => [
      { reasoning: 'Jetlag nach einem Ostflug: Ich suche belastbare Tipps zu Licht, Schlaf und Melatonin und fasse sie kurz zusammen.' },
      { text: 'Ich recherchiere kurz.' },
      { tool: { name: 'web_search', label: 'Jetlag Tipps Flug nach Osten', emoji: '\u{1F50D}', ms: 1300 } },
      { tool: { name: 'browser', label: 'de.wikipedia.org/wiki/Jetlag', emoji: '\u{1F310}', ms: 1100 } },
      { tool: { name: 'web_search', label: 'Tageslicht Melatonin innere Uhr', emoji: '\u{1F50D}', ms: 1000 } },
      { reasoning: ' Die Quellen sind sich einig: Licht ist der wichtigste Taktgeber.' },
      {
        text:
          '\n\n**So kommst du schneller in die neue Zeitzone:**\n\n' +
          '1. **Schon vorher verschieben:** 2–3 Tage vor dem Flug jeden Abend eine Stunde früher ins Bett.\n' +
          '2. **Morgens Tageslicht:** Am Ziel vormittags raus ins Helle – das stellt die innere Uhr am stärksten um.\n' +
          '3. **Abends wenig Licht:** Bildschirme dimmen, kein grelles Licht vor dem Schlafen.\n' +
          '4. **Kurzer Mittagsschlaf:** Höchstens 20 Minuten, sonst wird die erste Nacht schwer.\n\n' +
          hui({ type: 'sources', items: [{ title: 'Jetlag', url: 'https://de.wikipedia.org/wiki/Jetlag', siteName: 'Wikipedia', snippet: 'Störung des Schlaf-Wach-Rhythmus nach schnellem Wechsel mehrerer Zeitzonen.' }] }),
      },
    ],
  },

  error: {
    format: 'text',
    steps: (ctx) => [
      { text: L(ctx, 'Ich beginne mit der Auswertung und lade die Daten …', 'I am starting the analysis and loading the data …', 'Empiezo el análisis y cargo los datos …') },
      { tool: { name: 'terminal', label: 'python analyze.py', emoji: '\u{1F4BB}', ms: 700 } },
      { text: L(ctx, '\n\nJetzt wird es kritisch, ich berechne das Ergebnis', '\n\nThis is the critical part, I am computing the result', '\n\nAhora viene lo crítico, calculo el resultado') },
      { fail: 'error' },
    ],
  },

  approval: {
    format: 'text',
    steps: (ctx) => [
      { text: L(ctx, 'Ich möchte ein temporäres Verzeichnis aufräumen.', 'I would like to clean up a temporary directory.', 'Quisiera limpiar un directorio temporal.') },
      { approval: { command: 'rm -rf /tmp/hermes-ui-cache', description: 'recursive delete', pattern_key: 'rm -rf', pattern_keys: ['rm -rf'] } },
    ],
  },

  long: {
    format: 'text',
    steps: () => {
      const para =
        'Dies ist ein langer Absatz zum Testen von Scrolling und Streaming. Er enthält **fetten Text**, *kursiven Text*, `Inline-Code` und einen [Link](https://example.com). Die App soll flüssig bleiben, auch wenn die Antwort mehrere Bildschirmseiten lang wird. ';
      const out: DemoStep[] = [];
      for (let i = 1; i <= 8; i++) out.push({ text: `## Abschnitt ${i}\n\n${para}${para}\n\n` });
      out.push({ text: '```ts\nfunction fib(n: number): number {\n  return n < 2 ? n : fib(n - 1) + fib(n - 2);\n}\n```\n\nEnde.' });
      return out;
    },
  },
};

/** Pick a scenario from the user's message (same order as the mock server, plus the v2 keywords). */
export function pickScenario(userText: string): { name: string; scenario: DemoScenario } {
  const t = userText.toLowerCase();
  const has = (re: RegExp) => re.test(t);
  let name = 'plain';
  if (/^\[form:/.test(t)) name = 'formResult';
  else if (/^\[choice:reise-prio\]/.test(t)) name = 'reiseDecision';
  else if (/^\[(choice|checklist|calc|quiz|confirm|slots|poll|decision|agenda|rank|scale|paths):/.test(t)) name = 'interaction';
  else if (has(/fehler|error|crash/)) name = 'error';
  else if (has(/freigabe|approval|genehmig/)) name = 'approval';
  else if (has(/schieberegler/)) name = 'kreditCalc';
  else if (has(/ps2|spieletabelle|game table/)) name = 'gameTable';
  else if (has(/oled|lcd/)) name = 'longWords';
  else if (has(/\bpfade\b|\bpaths\b|wo liegen (die |meine )?dateien|where do (the |my )?files live|d[oó]nde (est[aá]n|viven) (los |mis )?archivos/)) name = 'paths';
  else if (has(/architektur|architecture|arquitectura|\bblocks\b|bausteine|building blocks/)) name = 'blocks';
  else if (has(/flugzeug oder bahn|bahn oder flug/)) name = 'reiseChoice';
  else if (has(/abstimm|umfrage|pizza oder paella/)) name = 'poll';
  else if (has(/übersetz|auf spanisch|ins spanische/)) name = 'translation';
  else if (has(/strompreis/)) name = 'charts3';
  else if (has(/tagesplan|plan .*samstag|samstag planen/)) name = 'agenda';
  else if (has(/jetlag/)) name = 'webSuche';
  else if (has(/wochenende in rom|rom-wochenende|rom wochenende/)) name = 'romTrip';
  else if (has(/carbonara/)) name = 'carbonara';
  else if (has(/zinseszins|sparplan|zinsrechner|\bcalc\b/)) name = 'calc';
  else if (has(/kredit|darlehen|\bloan|pr[eé]stamo/)) name = 'loan';
  else if (has(/rechner|calculator|calculadora/)) name = 'calculator';
  else if (has(/gemischt|mixed|bericht|report|informe/)) name = 'mixed';
  else if (has(/rezept|recipe|kochen|pasta/)) name = 'recipe';
  else if (has(/einkauf|checkliste|checklist|packliste|shopping/)) name = 'checklist';
  else if (has(/restaurant|essen gehen|lokale|orte in der nähe|places|restaurantes/)) name = 'places';
  else if (has(/karte|\bmap\b|spaziergang|route/)) name = 'map';
  else if (has(/quiz|teste mich/)) name = 'quiz';
  else if (has(/bilder|bild\b|fotos?\b|images?|galerie/)) name = 'images';
  else if (has(/auswahl|choice|wähle|reiseziel|wochenendtrip/)) name = 'choice';
  else if (has(/\blang\b|lange|long/)) name = 'long';
  else if (has(/chart|diagramm|verlauf|gr[aá]fico/)) name = 'chart';
  else if (has(/breite tabelle|wide table/)) name = 'wideTable';
  else if (has(/wetter|weather|tiempo|clima/)) name = 'weather';
  else if (has(/kopfhörer|headphones|auriculares/)) name = 'products';
  else if (has(/tabelle|table/)) name = 'table';
  else if (has(/kennzahl|stats|kpi/)) name = 'stats';
  else if (has(/vergleich|compare|compar/)) name = 'compare';
  else if (has(/formular|form\b/)) name = 'form';
  else if (has(/schritt|steps|anleitung/)) name = 'steps';
  else if (has(/werkzeug|nerd|was kannst du/)) name = 'werkzeuge';
  else if (has(/timeline|zeitleiste|ablauf/)) name = 'timeline';
  else if (has(/button|vorschl|suggest/)) name = 'buttons';
  else if (has(/tools|parallel|recherch/)) name = 'tools2';
  else if (has(/tool|uhr|zeit|datum|spät/)) name = 'tool';
  return { name, scenario: scenarios[name] };
}
