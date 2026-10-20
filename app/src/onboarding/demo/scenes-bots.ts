// Canned answers of the demo's bots (onboarding/demo/bots.ts): every role answers its own starters (bots/create
// "Für den Anfang", botCreate.templates.<id>.s1–s3) and the typical follow-ups in de/en/es, typos included, and says
// plainly what only a real Hermes does (routines, memory, running commands). Anything else gets the bot's short
// introduction with its own suggestions, never the general demo tour. Offline, fictional (example.com, sample data).
import { L, hui, suggestions, tool, type DemoBotRole, type DemoContext, type DemoLang, type DemoScenario, type DemoStep } from './kit.ts';
import { parseReply, readableReply } from './replies.ts';
import { chips } from './scenes-core.ts';

type Role = DemoBotRole['template'];
type Tri = Record<DemoLang, string>;
const tri = (de: string, en: string, es: string): Tri => ({ de, en, es });

/** the follow-up requests each role offers as chips (and that a test routes back to their scene) */
export const ROLE_PROMPTS: Record<Role, Record<string, Tri>> = {
  deals: {
    history: tri('Zeig mir den Preisverlauf', 'Show me the price history', 'Muéstrame el historial de precios'),
    compare: tri('Vergleiche drei Kopfhörer bis 300 €', 'Compare three headphones up to €300', 'Compara tres auriculares hasta 300 €'),
    weekly: tri('Jeden Freitag die besten Angebote der Woche', 'Every Friday the best deals of the week', 'Cada viernes las mejores ofertas de la semana'),
  },
  travel: {
    packing: tri('Packliste für das Wochenende', 'Packing list for the weekend', 'Lista de equipaje para el fin de semana'),
    saturday: tri('Was kann ich am Samstag in Wien machen?', 'What can I do in Vienna on Saturday?', '¿Qué puedo hacer el sábado en Viena?'),
    weekend: tri('Plan mir ein Wochenende in Wien mit der Bahn', 'Plan a weekend in Vienna by train', 'Planéame un fin de semana en Viena en tren'),
  },
  briefing: {
    today: tri('Was steht heute an?', 'What is on today?', '¿Qué tengo hoy?'),
    weather: tri('Brauche ich heute einen Schirm?', 'Do I need an umbrella today?', '¿Necesito paraguas hoy?'),
    fewer: tri('Weniger Nachrichten, mehr Termine', 'Less news, more appointments', 'Menos noticias, más citas'),
  },
  research: {
    news: tri('Was gibt es Neues bei Wärmepumpen?', 'What is new with heat pumps?', '¿Qué hay de nuevo en bombas de calor?'),
    summary: tri('Fass mir den Stand zu Akkus in E-Autos zusammen', 'Sum up where electric car batteries stand', 'Resúmeme cómo están las baterías de los coches eléctricos'),
    sources: tri('Welche Quellen hast du genutzt?', 'Which sources did you use?', '¿Qué fuentes has usado?'),
  },
  code: {
    traceback: tri('Erklär mir, was mir ein Python-Traceback sagt', 'Explain what a Python traceback tells me', 'Explícame qué me dice un traceback de Python'),
    script: tri('Schreib ein Skript, das Fotos nach Datum sortiert', 'Write a script that sorts photos by date', 'Escribe un script que ordene fotos por fecha'),
    cleanup: tri('Räum meinen Download-Ordner auf', 'Tidy up my downloads folder', 'Ordena mi carpeta de descargas'),
  },
  own: {},
  blank: {},
};

/** what every bot understands, whatever its role */
export const COMMON_PROMPTS: Record<string, Tri> = {
  who: tri('Was kannst du?', 'What can you do?', '¿Qué puedes hacer?'),
  remember: tri('Merk dir, dass ich Gangplätze mag', 'Remember that I like aisle seats', 'Recuerda que me gustan los asientos de pasillo'),
};

const chipsOf = (ctx: DemoContext, role: Role, ...keys: string[]) =>
  suggestions(...keys.map((k) => (ROLE_PROMPTS[role][k] ?? COMMON_PROMPTS[k])[ctx.lang ?? 'de']));

/** the role's own chips (two of its prompts), or the common ones for an own role */
function roleChips(ctx: DemoContext, role: Role, skip?: string): string {
  const own = Object.keys(ROLE_PROMPTS[role]).filter((k) => k !== skip).slice(0, 2);
  return chipsOf(ctx, role, ...(own.length ? own : ['who', 'remember']));
}

const nameOf = (ctx: DemoContext) => ctx.role?.name ?? 'Bot';
const DEMO_NOTE = (ctx: DemoContext) =>
  L(
    ctx,
    `In der Demo antwortet ${nameOf(ctx)} mit vorbereiteten Beispieltexten. Mit Hermes arbeitet er auf deinem Server, mit eigenem Chat und eigenem Gedächtnis.`,
    `In the demo ${nameOf(ctx)} answers with prepared sample texts. With Hermes it works on your server, with its own chat and its own memory.`,
    `En la demo ${nameOf(ctx)} responde con textos de ejemplo preparados. Con Hermes trabaja en tu servidor, con su propio chat y su propia memoria.`,
  );

/** honest answer to "do this regularly": what Hermes would set up, and that the demo does not */
function routineText(ctx: DemoContext, what: Tri, when: Tri, role: Role): string {
  return (
    L(
      ctx,
      `Mit Hermes würde ich jetzt die Routine **${what.de}** anlegen, ${when.de}, und jedes Ergebnis käme hier in diesen Chat, auf Wunsch auch als Mitteilung. Läuft eine Prüfung ohne Neuigkeit, melde ich mich gar nicht.\n\n`,
      `With Hermes I would now create the routine **${what.en}**, ${when.en}, and every result would arrive here in this chat, as a notification too if you like. A check without news stays silent.\n\n`,
      `Con Hermes crearía ahora la rutina **${what.es}**, ${when.es}, y cada resultado llegaría a este chat, también como notificación si quieres. Una comprobación sin novedades no avisa.\n\n`,
    ) +
    hui({
      type: 'callout',
      tone: 'info',
      title: L(ctx, 'Demo: keine echte Routine', 'Demo: no real routine', 'Demo: sin rutina real'),
      // with Routines off on this device (Settings → Chat → "Routinen") "Über <Name>" has no routines part to point at
      text:
        ctx.routines === false
          ? L(
              ctx,
              'In der Demo läuft nichts im Hintergrund. Routinen laufen auf deinem Hermes-Server.',
              'Nothing runs in the background in the demo. Routines run on your Hermes server.',
              'En la demo no se ejecuta nada en segundo plano. Las rutinas se ejecutan en tu servidor Hermes.',
            )
          : L(
              ctx,
              `In der Demo läuft nichts im Hintergrund. Routinen laufen auf deinem Hermes-Server; unter „Über ${nameOf(ctx)}“ siehst du dann, was ${nameOf(ctx)} regelmäßig macht.`,
              `Nothing runs in the background in the demo. Routines run on your Hermes server; “About ${nameOf(ctx)}” then shows what ${nameOf(ctx)} does regularly.`,
              `En la demo no se ejecuta nada en segundo plano. Las rutinas se ejecutan en tu servidor Hermes; en «Acerca de ${nameOf(ctx)}» verás lo que ${nameOf(ctx)} hace con regularidad.`,
            ),
    }) +
    roleChips(ctx, role)
  );
}
const routineSteps = (ctx: DemoContext, what: Tri, when: Tri, role: Role): DemoStep[] => [{ text: routineText(ctx, what, when, role) }];

// ── deals ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const deals: Record<string, DemoScenario> = {
  'bot:deals:alert': {
    format: 'text',
    steps: (ctx) => {
      const price = /(\d{2,5})\s*(?:€|eur|euro)|€\s*(\d{2,5})/i.exec(ctx.userText);
      const limit = price ? (price[1] ?? price[2]) : '300';
      return [
        tool.search(L(ctx, 'Preis heute, drei Shops', 'price today, three shops', 'precio hoy, tres tiendas'), 900),
        {
          text:
            L(
              ctx,
              `Notiert: Grenze **${limit} €**. Heute liegt das günstigste Angebot bei 329 € (Example Shop A, Beispieldaten), also noch darüber.\n\n`,
              `Noted: limit **€${limit}**. Today the cheapest offer is €329 (Example Shop A, sample data), so still above it.\n\n`,
              `Anotado: límite **${limit} €**. Hoy la oferta más barata es de 329 € (Example Shop A, datos de ejemplo), así que aún está por encima.\n\n`,
            ) + routineText(ctx, tri('Preis-Check', 'Price check', 'Control de precio'), tri('jeden Morgen um 7:30', 'every morning at 7:30', 'cada mañana a las 7:30'), 'deals'),
        },
      ];
    },
  },
  'bot:deals:compare': {
    format: 'table',
    steps: (ctx) => {
      const vac = /saug|vacuum|aspirador/i.test(ctx.userText);
      const rows = vac
        ? [
            ['Example Robo S2', '349 €', L(ctx, 'saugt und wischt', 'vacuums and mops', 'aspira y friega'), '4,4'],
            ['Example Clean 7', '389 €', L(ctx, 'leise, gute Karte', 'quiet, good map', 'silencioso, buen mapa'), '4,6'],
            ['Example Mini', '279 €', L(ctx, 'klein, kürzerer Akku', 'small, shorter battery', 'pequeño, batería más corta'), '4,1'],
          ]
        : [
            ['Fjord Demo Calm 5', '239 €', L(ctx, 'leicht, Top-ANC', 'light, top ANC', 'ligeros, ANC top'), '4,6'],
            ['Lumo Demo Pulse 2', '199 €', L(ctx, 'langer Akku', 'long battery', 'batería larga'), '4,4'],
            ['Aurel Demo Quiet One', '329 €', L(ctx, 'bester Klang', 'best sound', 'mejor sonido'), '4,7'],
          ];
      return [
        tool.search(vac ? L(ctx, 'Saugroboter bis 400 € Test', 'robot vacuum up to €400 review', 'robot aspirador hasta 400 € análisis') : L(ctx, 'Kopfhörer bis 300 € Test', 'headphones up to €300 review', 'auriculares hasta 300 € análisis'), 1000),
        { text: L(ctx, 'Drei Kandidaten, Preise mit Shop und Datum von heute (Beispieldaten):\n\n', 'Three candidates, prices with shop and today’s date (sample data):\n\n', 'Tres candidatos, precios con tienda y fecha de hoy (datos de ejemplo):\n\n') },
        {
          text:
            hui({
              type: 'table',
              caption: L(ctx, 'Vergleich, Stand heute', 'Comparison, as of today', 'Comparación, a día de hoy'),
              source: L(ctx, 'Beispieldaten', 'Sample data', 'Datos de ejemplo'),
              basis: 'illustrative',
              columns: [L(ctx, 'Modell', 'Model', 'Modelo'), L(ctx, 'Preis', 'Price', 'Precio'), L(ctx, 'Stärke', 'Strength', 'Punto fuerte'), L(ctx, 'Bewertung', 'Rating', 'Valoración')],
              rows,
            }) +
            L(ctx, '\nPreis-Leistung: das erste. Kaufen musst du selbst, ich bestelle nichts.\n\n', '\nBest value: the first one. You do the buying yourself, I never order anything.\n\n', '\nMejor relación calidad-precio: el primero. La compra la haces tú, yo no pido nada.\n\n') +
            roleChips(ctx, 'deals', 'compare'),
        },
      ];
    },
  },
  'bot:deals:history': {
    format: 'chart',
    steps: (ctx) => [
      {
        text:
          L(ctx, 'Der Preis der Fjord Calm 5 in den letzten zwei Wochen (Beispieldaten):\n\n', 'The price of the Fjord Calm 5 over the last two weeks (sample data):\n\n', 'El precio de los Fjord Calm 5 en las últimas dos semanas (datos de ejemplo):\n\n') +
          hui({
            type: 'chart',
            kind: 'line',
            title: L(ctx, 'Fjord Calm 5, günstigstes Angebot (€)', 'Fjord Calm 5, cheapest offer (€)', 'Fjord Calm 5, oferta más barata (€)'),
            unit: '€',
            basis: 'illustrative',
            series: [{ name: L(ctx, 'Preis', 'Price', 'Precio'), data: [289, 289, 285, 279, 279, 282, 279, 279, 275, 279, 269, 279, 279, 239].map((y, i) => ({ x: `${i - 13}`, y })) }],
          }) +
          L(ctx, '\nDer Sprung auf 239 € kam heute über Nacht. Solche Tiefs halten oft nur ein, zwei Tage.\n\n', '\nThe drop to €239 came overnight. Lows like this often last only a day or two.\n\n', '\nLa bajada a 239 € llegó esta noche. Estos mínimos suelen durar uno o dos días.\n\n') +
          roleChips(ctx, 'deals', 'history'),
      },
    ],
  },
  'bot:deals:shops': {
    format: 'table',
    steps: (ctx) => [
      {
        text:
          L(ctx, 'Die Fjord Calm 5 heute, günstigstes zuerst (Beispieldaten):\n\n', 'The Fjord Calm 5 today, cheapest first (sample data):\n\n', 'Los Fjord Calm 5 hoy, el más barato primero (datos de ejemplo):\n\n') +
          hui({
            type: 'table',
            caption: L(ctx, 'Fjord Calm 5, Stand heute', 'Fjord Calm 5, as of today', 'Fjord Calm 5, a día de hoy'),
            source: L(ctx, 'Beispieldaten', 'Sample data', 'Datos de ejemplo'),
            basis: 'illustrative',
            columns: [L(ctx, 'Shop', 'Shop', 'Tienda'), L(ctx, 'Preis', 'Price', 'Precio'), L(ctx, 'Lieferung', 'Delivery', 'Entrega')],
            rows: [
              ['Example Shop B', '239 €', L(ctx, '2 Tage', '2 days', '2 días')],
              ['Example Shop A', '269 €', L(ctx, 'morgen', 'tomorrow', 'mañana')],
              ['Example Shop C', '275 €', L(ctx, '3 Tage', '3 days', '3 días')],
            ],
          }) +
          '\n' +
          roleChips(ctx, 'deals'),
      },
    ],
  },
  'bot:deals:weekly': {
    format: 'text',
    steps: (ctx) => routineSteps(ctx, tri('Angebote der Woche', 'Deals of the week', 'Ofertas de la semana'), tri('freitags um 9:00', 'Fridays at 9:00', 'los viernes a las 9:00'), 'deals'),
  },
  'bot:deals:buy': {
    format: 'text',
    steps: (ctx) => [
      {
        text:
          L(ctx, 'Kaufen und bestellen machst du selbst, das gilt für mich immer. Hier ist das Angebot:\n\n', 'Buying and ordering is yours to do, that always holds for me. Here is the offer:\n\n', 'Comprar y pedir lo haces tú, eso vale siempre para mí. Aquí está la oferta:\n\n') +
          hui({
            type: 'callout',
            tone: 'info',
            title: L(ctx, 'Das machst du selbst', 'You do this yourself', 'Esto lo haces tú'),
            text: L(ctx, 'Fjord Calm 5 für 239 € bei Example Shop B: https://example.com/shop-b/fjord-calm-5', 'Fjord Calm 5 for €239 at Example Shop B: https://example.com/shop-b/fjord-calm-5', 'Fjord Calm 5 por 239 € en Example Shop B: https://example.com/shop-b/fjord-calm-5'),
          }) +
          roleChips(ctx, 'deals'),
      },
    ],
  },
};

// ── travel ────────────────────────────────────────────────────────────────────────────────────────────────────────

const travel: Record<string, DemoScenario> = {
  'bot:travel:weekend': {
    format: 'table',
    steps: (ctx) => [
      tool.search(L(ctx, 'Zug Wien Wochenende', 'train Vienna weekend', 'tren Viena fin de semana'), 1000),
      { text: L(ctx, 'Zwei Varianten, beide mit der Bahn (Beispieldaten):\n\n', 'Two options, both by train (sample data):\n\n', 'Dos opciones, ambas en tren (datos de ejemplo):\n\n') },
      {
        text:
          hui({
            type: 'table',
            caption: L(ctx, 'Wochenende in Wien', 'Weekend in Vienna', 'Fin de semana en Viena'),
            source: L(ctx, 'Beispieldaten', 'Sample data', 'Datos de ejemplo'),
            basis: 'illustrative',
            columns: [L(ctx, 'Variante', 'Option', 'Opción'), L(ctx, 'Hin', 'Out', 'Ida'), L(ctx, 'Zurück', 'Back', 'Vuelta'), L(ctx, 'Preis', 'Price', 'Precio')],
            rows: [
              [L(ctx, 'Früh los', 'Early start', 'Salida temprana'), L(ctx, 'Fr 8:12 → 12:20', 'Fri 8:12 → 12:20', 'Vie 8:12 → 12:20'), L(ctx, 'So 16:44 → 20:52', 'Sun 16:44 → 20:52', 'Dom 16:44 → 20:52'), '118 €'],
              [L(ctx, 'Nach der Arbeit', 'After work', 'Después del trabajo'), L(ctx, 'Fr 17:12 → 21:20', 'Fri 17:12 → 21:20', 'Vie 17:12 → 21:20'), L(ctx, 'So 18:44 → 22:52', 'Sun 18:44 → 22:52', 'Dom 18:44 → 22:52'), '96 €'],
            ],
          }) +
          L(ctx, '\nGebucht ist noch nichts: Das machst du, oder du sagst mir, welche Variante, dann bereite ich alles vor.\n\n', '\nNothing is booked yet: you do that, or tell me which option and I prepare everything.\n\n', '\nTodavía no hay nada reservado: eso lo haces tú, o dime qué opción y lo preparo todo.\n\n') +
          roleChips(ctx, 'travel', 'weekend'),
      },
    ],
  },
  'bot:travel:packing': {
    format: 'interactive',
    steps: (ctx) => {
      const hike = /wander|hik|sender/i.test(ctx.userText);
      const items = hike
        ? [L(ctx, 'Wanderschuhe', 'Hiking boots', 'Botas de montaña'), L(ctx, 'Regenjacke', 'Rain jacket', 'Chubasquero'), L(ctx, 'Fleece', 'Fleece', 'Forro polar'), L(ctx, 'Stirnlampe', 'Head torch', 'Linterna frontal'), L(ctx, 'Erste-Hilfe-Set', 'First aid kit', 'Botiquín'), L(ctx, 'Trinkflasche', 'Water bottle', 'Botella de agua')]
        : [L(ctx, 'Schirm', 'Umbrella', 'Paraguas'), L(ctx, 'Ladekabel', 'Charging cable', 'Cable de carga'), L(ctx, 'Bequeme Schuhe', 'Comfortable shoes', 'Zapatos cómodos'), L(ctx, 'Pullover für den Abend', 'Jumper for the evening', 'Jersey para la noche'), L(ctx, 'Zugticket in der App', 'Train ticket in the app', 'Billete de tren en la app')];
      return [
        {
          text:
            L(ctx, 'Kurz und passend zum Wetter (14 °C, Schauer):\n\n', 'Short and matched to the weather (14 °C, showers):\n\n', 'Breve y según el tiempo (14 °C, chubascos):\n\n') +
            hui({ type: 'checklist', id: hike ? 'demo-bot-pack-hike' : 'demo-bot-pack-vienna', title: L(ctx, 'Packliste', 'Packing list', 'Lista de equipaje'), items: items.map((text) => ({ text })) }) +
            '\n' +
            roleChips(ctx, 'travel', 'packing'),
        },
      ];
    },
  },
  'bot:travel:saturday': {
    format: 'timeline',
    steps: (ctx) => [
      {
        text:
          L(ctx, 'Ein ruhiger Samstag, der Regen kommt erst am Nachmittag:\n\n', 'A relaxed Saturday, the rain only comes in the afternoon:\n\n', 'Un sábado tranquilo, la lluvia llega por la tarde:\n\n') +
          hui({
            type: 'timeline',
            items: [
              { time: '9:30', title: L(ctx, 'Frühstück im Kaffeehaus', 'Breakfast at a coffee house', 'Desayuno en un café'), detail: L(ctx, 'früh, bevor es voll wird', 'early, before it gets busy', 'temprano, antes de que se llene') },
              { time: '11:00', title: L(ctx, 'Markt und Altstadt zu Fuß', 'Market and old town on foot', 'Mercado y casco antiguo a pie'), detail: L(ctx, 'trocken bis etwa 15 Uhr', 'dry until about 3 pm', 'seco hasta las 15 h') },
              { time: '15:00', title: L(ctx, 'Museum, falls es regnet', 'Museum if it rains', 'Museo si llueve'), detail: L(ctx, 'Tickets vor Ort', 'tickets on site', 'entradas en taquilla') },
            ],
          }) +
          '\n' +
          roleChips(ctx, 'travel', 'saturday'),
      },
    ],
  },
  'bot:travel:remind': {
    format: 'text',
    steps: (ctx) => routineSteps(ctx, tri('Erinnerung vor der Abfahrt', 'Reminder before departure', 'Recordatorio antes de la salida'), tri('24 Stunden vor jeder Abfahrt', '24 hours before every departure', '24 horas antes de cada salida'), 'travel'),
  },
  'bot:travel:train': {
    format: 'text',
    steps: (ctx) => [
      {
        text:
          L(
            ctx,
            'Dein Zug morgen: **8:12 ab Gleis 7**, Wagen 24, Platz 61. In der Demo sehe ich keine echten Fahrpläne; mit Hermes und einer Fahrplan-Suche prüfe ich das kurz vor der Abfahrt noch einmal.\n\n',
            'Your train tomorrow: **8:12 from platform 7**, coach 24, seat 61. In the demo I see no real timetables; with Hermes and a timetable search I check it again shortly before departure.\n\n',
            'Tu tren de mañana: **8:12 desde el andén 7**, coche 24, asiento 61. En la demo no veo horarios reales; con Hermes y una búsqueda de horarios lo compruebo otra vez poco antes de la salida.\n\n',
          ) + roleChips(ctx, 'travel'),
      },
    ],
  },
};

// ── briefing ──────────────────────────────────────────────────────────────────────────────────────────────────────

const briefing: Record<string, DemoScenario> = {
  'bot:briefing:schedule': {
    format: 'text',
    steps: (ctx) => routineSteps(ctx, tri('Morgenbriefing', 'Morning briefing', 'Resumen matutino'), tri('werktags um 7:00', 'on weekdays at 7:00', 'los días laborables a las 7:00'), 'briefing'),
  },
  'bot:briefing:today': {
    format: 'agenda',
    steps: (ctx) => [
      {
        text:
          L(ctx, 'Heute, Termine zuerst (Beispieltag):\n\n', 'Today, appointments first (sample day):\n\n', 'Hoy, las citas primero (día de ejemplo):\n\n') +
          hui({
            type: 'timeline',
            items: [
              { time: '9:30', title: L(ctx, 'Zahnarzt', 'Dentist', 'Dentista'), detail: L(ctx, 'Praxis am Markt', 'practice at the market square', 'consulta junto al mercado') },
              { time: '13:00', title: L(ctx, 'Mittagessen mit Alice', 'Lunch with Alice', 'Comida con Alice') },
              { time: '18:00', title: L(ctx, 'Kurs am Donnerstag zu- oder absagen', 'Confirm or cancel Thursday’s class', 'Confirmar o cancelar la clase del jueves') },
            ],
          }) +
          L(ctx, '\nWetter: 12 °C, ab 16 Uhr Regen.\n\n', '\nWeather: 12 °C, rain from 4 pm.\n\n', '\nTiempo: 12 °C, lluvia desde las 16 h.\n\n') +
          roleChips(ctx, 'briefing', 'today'),
      },
    ],
  },
  'bot:briefing:weather': {
    format: 'text',
    steps: (ctx) => [
      {
        text:
          L(ctx, 'Ja, für den Heimweg: Bis 16 Uhr bleibt es trocken, danach regnet es bis in den Abend (Beispielwetter).\n\n', 'Yes, for the way home: it stays dry until 4 pm, then it rains into the evening (sample weather).\n\n', 'Sí, para la vuelta: seco hasta las 16 h, después llueve hasta la noche (tiempo de ejemplo).\n\n') +
          roleChips(ctx, 'briefing', 'weather'),
      },
    ],
  },
  'bot:briefing:fewer': {
    format: 'text',
    steps: (ctx) => [
      {
        text:
          L(
            ctx,
            'Verstanden: höchstens eine Meldung, dafür alle Termine des Tages. Mit Hermes merke ich mir das in meinem eigenen Gedächtnis und baue das nächste Briefing danach. In der Demo merke ich mir nichts.\n\n',
            'Got it: one news item at most, all of the day’s appointments instead. With Hermes I keep that in my own memory and shape the next briefing by it. In the demo I remember nothing.\n\n',
            'Entendido: como mucho una noticia y, a cambio, todas las citas del día. Con Hermes lo guardo en mi propia memoria y preparo así el próximo resumen. En la demo no recuerdo nada.\n\n',
          ) + roleChips(ctx, 'briefing', 'fewer'),
      },
    ],
  },
  'bot:briefing:course': {
    format: 'text',
    steps: (ctx) => [
      {
        text:
          L(
            ctx,
            'Zu- oder absagen machst du selbst, ich schicke nichts in deinem Namen. Sag mir danach kurz Bescheid, dann taucht der Kurs im Briefing nicht mehr auf.\n\n',
            'Confirming or cancelling is up to you, I send nothing in your name. Tell me afterwards and the class leaves the briefing.\n\n',
            'Confirmar o cancelar lo haces tú, yo no envío nada en tu nombre. Avísame después y la clase deja de salir en el resumen.\n\n',
          ) + roleChips(ctx, 'briefing'),
      },
    ],
  },
};

// ── research ──────────────────────────────────────────────────────────────────────────────────────────────────────

const SOURCES = (ctx: DemoContext) =>
  hui({
    type: 'sources',
    items: [
      { title: L(ctx, 'Übersichtsartikel (Beispiel)', 'Overview article (sample)', 'Artículo de resumen (ejemplo)'), url: 'https://example.com/overview', siteName: 'example.com', snippet: L(ctx, 'Beispielquelle mit Datum', 'Sample source with a date', 'Fuente de ejemplo con fecha') },
      { title: L(ctx, 'Messreihe 2026 (Beispiel)', 'Measurements 2026 (sample)', 'Serie de mediciones 2026 (ejemplo)'), url: 'https://example.org/measurements', siteName: 'example.org', snippet: L(ctx, 'Beispieldaten, keine echte Studie', 'Sample data, not a real study', 'Datos de ejemplo, no es un estudio real') },
    ],
  });

const research: Record<string, DemoScenario> = {
  'bot:research:news': {
    format: 'text',
    steps: (ctx) => [
      tool.search(L(ctx, 'Neuigkeiten, letzte 30 Tage', 'news, last 30 days', 'novedades, últimos 30 días'), 1100),
      {
        text:
          L(
            ctx,
            'Kurz zuerst (Beispieltexte, Stand heute):\n\n1. **Belegt:** Neue Geräte arbeiten bei Kälte effizienter als vor drei Jahren.\n2. **Belegt:** Mehrere Hersteller setzen auf leisere Außengeräte.\n3. **Vermutung:** Die Preise sinken im Frühjahr weiter.\n\n',
            'Short first (sample texts, as of today):\n\n1. **Backed:** new units work more efficiently in the cold than three years ago.\n2. **Backed:** several makers move to quieter outdoor units.\n3. **Guess:** prices keep falling in spring.\n\n',
            'Lo breve primero (textos de ejemplo, a día de hoy):\n\n1. **Comprobado:** los equipos nuevos rinden mejor con frío que hace tres años.\n2. **Comprobado:** varios fabricantes apuestan por unidades exteriores más silenciosas.\n3. **Suposición:** los precios seguirán bajando en primavera.\n\n',
          ) +
          SOURCES(ctx) +
          roleChips(ctx, 'research', 'news'),
      },
    ],
  },
  'bot:research:summary': {
    format: 'text',
    steps: (ctx) => [
      tool.search(L(ctx, 'Stand der Forschung, Übersicht', 'state of research, overview', 'estado de la investigación, resumen'), 1100),
      {
        text:
          L(
            ctx,
            'Der Stand in drei Sätzen (Beispieltexte): Reichweiten wachsen langsam, Ladezeiten schneller. Haltbarkeit ist besser als befürchtet. Offen bleibt, wie schnell neue Zellchemien in Serie gehen.\n\n',
            'Where it stands in three sentences (sample texts): range grows slowly, charging times faster. Durability is better than feared. Open: how fast new cell chemistries reach series production.\n\n',
            'El estado en tres frases (textos de ejemplo): la autonomía crece despacio, los tiempos de carga más deprisa. La durabilidad es mejor de lo temido. Queda abierto cuándo llegarán a serie las nuevas químicas.\n\n',
          ) +
          SOURCES(ctx) +
          roleChips(ctx, 'research', 'summary'),
      },
    ],
  },
  'bot:research:sources': {
    format: 'text',
    steps: (ctx) => [
      {
        text:
          L(ctx, 'Diese beiden, jeweils mit Datum. In der Demo sind es Beispielquellen auf example.com:\n\n', 'These two, each with a date. In the demo they are sample sources on example.com:\n\n', 'Estas dos, cada una con fecha. En la demo son fuentes de ejemplo en example.com:\n\n') +
          SOURCES(ctx) +
          roleChips(ctx, 'research', 'sources'),
      },
    ],
  },
  'bot:research:weekly': {
    format: 'text',
    steps: (ctx) => routineSteps(ctx, tri('Neue Studien', 'New studies', 'Estudios nuevos'), tri('montags um 8:00', 'Mondays at 8:00', 'los lunes a las 8:00'), 'research'),
  },
};

// ── code ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const code: Record<string, DemoScenario> = {
  'bot:code:traceback': {
    format: 'text',
    steps: (ctx) => [
      {
        text:
          L(ctx, 'Ein Traceback liest du von unten nach oben:\n\n', 'You read a traceback from the bottom up:\n\n', 'Un traceback se lee de abajo arriba:\n\n') +
          '```text\nTraceback (most recent call last):\n  File "sort.py", line 12, in <module>\n    main()\n  File "sort.py", line 8, in main\n    print(photos[3])\nIndexError: list index out of range\n```\n' +
          L(
            ctx,
            '\n1. **Letzte Zeile:** was schiefging (`IndexError`, die Liste hat weniger als 4 Einträge).\n2. **Darüber:** wo es passierte (`sort.py`, Zeile 8).\n3. **Oben:** wie das Programm dorthin kam.\n\nSchick mir deinen, dann erkläre ich genau den.\n\n',
            '\n1. **Last line:** what went wrong (`IndexError`, the list has fewer than 4 entries).\n2. **Above it:** where it happened (`sort.py`, line 8).\n3. **Top:** how the program got there.\n\nSend me yours and I explain exactly that one.\n\n',
            '\n1. **Última línea:** qué falló (`IndexError`, la lista tiene menos de 4 elementos).\n2. **Encima:** dónde pasó (`sort.py`, línea 8).\n3. **Arriba:** cómo llegó el programa hasta ahí.\n\nMándame el tuyo y te explico justo ese.\n\n',
          ) +
          roleChips(ctx, 'code', 'traceback'),
      },
    ],
  },
  'bot:code:script': {
    format: 'text',
    steps: (ctx) => [
      {
        text:
          L(ctx, 'Erst die Erklärung: Das Skript liest das Datum jeder Datei und verschiebt sie in Ordner `JJJJ-MM`. Es löscht nichts.\n\n', 'Explanation first: the script reads each file’s date and moves it into `YYYY-MM` folders. It deletes nothing.\n\n', 'Primero la explicación: el script lee la fecha de cada archivo y lo mueve a carpetas `AAAA-MM`. No borra nada.\n\n') +
          '```python\nfrom datetime import datetime\nfrom pathlib import Path\n\nsrc = Path("~/Pictures/inbox").expanduser()\nfor f in sorted(src.glob("*.jpg")):\n    d = datetime.fromtimestamp(f.stat().st_mtime)\n    dest = src / f"{d:%Y-%m}"\n    dest.mkdir(exist_ok=True)\n    f.rename(dest / f.name)\n```\n' +
          L(ctx, '\nProbier es zuerst mit einer Kopie des Ordners.\n\n', '\nTry it on a copy of the folder first.\n\n', '\nPruébalo primero con una copia de la carpeta.\n\n') +
          roleChips(ctx, 'code', 'script'),
      },
    ],
  },
  'bot:code:cleanup': {
    format: 'text',
    steps: (ctx) => [
      tool.terminal('ls ~/Downloads', 600),
      {
        text: L(
          ctx,
          'In deinem Download-Ordner liegen 41 Dateien, 12 davon sind Installer älter als 90 Tage. Die würde ich löschen; vorher frage ich dich:\n\n',
          'Your downloads folder has 41 files, 12 of them installers older than 90 days. I would delete those; I ask you first:\n\n',
          'Tu carpeta de descargas tiene 41 archivos, 12 de ellos instaladores de más de 90 días. Los borraría; antes te pregunto:\n\n',
        ),
      },
      {
        approval: {
          command: 'find ~/Downloads -name "*.dmg" -mtime +90 -delete',
          description: L(ctx, 'Dateien löschen', 'delete files', 'borrar archivos'),
          pattern_key: 'delete',
          pattern_keys: ['delete'],
          allow: [
            { tool: { name: 'terminal', label: 'find ~/Downloads -name "*.dmg" -mtime +90 -delete', emoji: '\u{1F4BB}', ms: 800 } },
            {
              text:
                L(
                  ctx,
                  'Erledigt: 12 alte Installer weg. In der Demo wurde nichts gelöscht; mit Hermes läuft der Befehl auf deinem Server, nur nach deiner Freigabe.\n\n',
                  'Done: 12 old installers gone. Nothing was deleted in the demo; with Hermes the command runs on your server, only after you approve it.\n\n',
                  'Hecho: 12 instaladores antiguos eliminados. En la demo no se borró nada; con Hermes el comando se ejecuta en tu servidor, solo tras tu aprobación.\n\n',
                ) + roleChips(ctx, 'code', 'cleanup'),
            },
          ],
          deny: [{ text: L(ctx, 'Okay, ich lasse alles, wie es ist.\n\n', 'Okay, I leave everything as it is.\n\n', 'De acuerdo, lo dejo todo como está.\n\n') + roleChips(ctx, 'code', 'cleanup') }],
        },
      },
    ],
  },
};

// ── every role ────────────────────────────────────────────────────────────────────────────────────────────────────

/** "als Tabelle?" / a reshape chip in a bot chat: prepared answers stay as they are */
const reshapeNote = (ctx: DemoContext) =>
  L(
    ctx,
    `Umformen (kürzer, als Tabelle, als Liste) zeigt die Demo im Chat mit Hermes. ${nameOf(ctx)}s Antworten hier sind vorbereitet und bleiben, wie sie sind; mit Hermes formt ${nameOf(ctx)} jede Antwort um.\n\n`,
    `The demo shows reshaping (shorter, as a table, as a list) in the chat with Hermes. ${nameOf(ctx)}’s answers here are prepared and stay as they are; with Hermes ${nameOf(ctx)} reshapes any answer.\n\n`,
    `La demo muestra la reformulación (más corto, como tabla, como lista) en el chat con Hermes. Las respuestas de ${nameOf(ctx)} aquí están preparadas y no cambian; con Hermes ${nameOf(ctx)} reformula cualquier respuesta.\n\n`,
  );

function intro(ctx: DemoContext, role: Role): string {
  return (
    L(ctx, `Ich bin **${nameOf(ctx)}**. Meine Aufgabe: ${ctx.role?.job ?? ''}.\n\n`, `I am **${nameOf(ctx)}**. My job: ${ctx.role?.job ?? ''}.\n\n`, `Soy **${nameOf(ctx)}**. Mi tarea: ${ctx.role?.job ?? ''}.\n\n`) +
    DEMO_NOTE(ctx) +
    '\n\n' +
    roleChips(ctx, role)
  );
}

const common = (role: Role): Record<string, DemoScenario> => ({
  'bot:who': { format: 'text', steps: (ctx) => [{ text: intro(ctx, role) }] },
  'bot:remember': {
    format: 'text',
    steps: (ctx) => [
      {
        text:
          L(
            ctx,
            `Mit Hermes käme das in ${nameOf(ctx)}s eigenes Gedächtnis: Ich wüsste es in jedem Gespräch, Hermes und die anderen Bots nicht. In der Demo merke ich mir nichts.\n\n`,
            `With Hermes this would go into ${nameOf(ctx)}’s own memory: I would know it in every conversation, Hermes and the other bots would not. In the demo I remember nothing.\n\n`,
            `Con Hermes esto iría a la memoria propia de ${nameOf(ctx)}: lo sabría en cada conversación, Hermes y los otros bots no. En la demo no recuerdo nada.\n\n`,
          ) + roleChips(ctx, role),
      },
    ],
  },
  'bot:routine': {
    format: 'text',
    steps: (ctx) => routineSteps(ctx, tri('Regelmäßige Prüfung', 'Regular check', 'Comprobación periódica'), tri('zu dem Zeitpunkt, den du nennst', 'at the time you name', 'a la hora que digas'), role),
  },
  'bot:know': {
    format: 'text',
    steps: (ctx) => [
      {
        text:
          L(
            ctx,
            `In der Demo weiß ${nameOf(ctx)} nichts über dich. Mit Hermes stünde hier, was ich mir gemerkt habe, und zwar nur in meinem eigenen Gedächtnis, nicht in dem von Hermes oder der anderen Bots.\n\n`,
            `In the demo ${nameOf(ctx)} knows nothing about you. With Hermes you would see here what I have remembered, in my own memory only, not in Hermes’ or the other bots’.\n\n`,
            `En la demo ${nameOf(ctx)} no sabe nada de ti. Con Hermes verías aquí lo que he recordado, solo en mi propia memoria, no en la de Hermes ni en la de los otros bots.\n\n`,
          ) + roleChips(ctx, role),
      },
    ],
  },
  'bot:last': {
    format: 'text',
    steps: (ctx) => [
      {
        text:
          L(
            ctx,
            `Noch nichts: ${nameOf(ctx)} ist neu, und in der Demo läuft nichts im Hintergrund. Mit Hermes stehen hier die Ergebnisse meiner Aufträge und Routinen.\n\n`,
            `Nothing yet: ${nameOf(ctx)} is new, and nothing runs in the background in the demo. With Hermes the results of my tasks and routines show up here.\n\n`,
            `Nada todavía: ${nameOf(ctx)} es nuevo y en la demo no se ejecuta nada en segundo plano. Con Hermes aquí aparecen los resultados de mis encargos y rutinas.\n\n`,
          ) + roleChips(ctx, role),
      },
    ],
  },
  'bot:photos': {
    format: 'text',
    steps: (ctx) => [
      {
        text:
          L(
            ctx,
            'Fotos zeigt die Demo nicht, sie ist offline. Mit Hermes und einer Bildersuche auf deinem Server kämen hier Bilder mit Quelle.\n\n',
            'The demo shows no photos, it is offline. With Hermes and an image search on your server, pictures with their source would appear here.\n\n',
            'La demo no muestra fotos, funciona sin conexión. Con Hermes y una búsqueda de imágenes en tu servidor aparecerían aquí imágenes con su fuente.\n\n',
          ) + roleChips(ctx, role),
      },
    ],
  },
  'bot:more': {
    format: 'text',
    steps: (ctx) => [
      {
        text:
          L(
            ctx,
            `Mehr Einzelheiten hat ${nameOf(ctx)} in der Demo nicht: Die Antworten sind vorbereitet. Mit Hermes geht ${nameOf(ctx)} so tief, wie du willst.\n\n`,
            `${nameOf(ctx)} has no more detail in the demo: the answers are prepared. With Hermes ${nameOf(ctx)} goes as deep as you like.\n\n`,
            `${nameOf(ctx)} no tiene más detalle en la demo: las respuestas están preparadas. Con Hermes ${nameOf(ctx)} profundiza tanto como quieras.\n\n`,
          ) + roleChips(ctx, role),
      },
    ],
  },
  'bot:table': {
    format: 'text',
    steps: (ctx) => [{ text: reshapeNote(ctx) + roleChips(ctx, role) }],
  },
  'bot:reply': {
    format: 'text',
    steps: (ctx) => {
      const p = parseReply(ctx.userText);
      const head =
        p?.kind === 'reformat'
          ? reshapeNote(ctx)
          : L(ctx, `Angekommen: **${readableReply(ctx.userText) || '–'}**. Mit Hermes baut ${nameOf(ctx)} die nächste Antwort darauf auf.\n\n`, `Got it: **${readableReply(ctx.userText) || '–'}**. With Hermes ${nameOf(ctx)} builds the next answer on it.\n\n`, `Recibido: **${readableReply(ctx.userText) || '–'}**. Con Hermes, ${nameOf(ctx)} basa la siguiente respuesta en ello.\n\n`);
      return [{ text: head + roleChips(ctx, role) }];
    },
  },
  'bot:fallback': {
    format: 'text',
    steps: (ctx) => {
      const typed = ctx.userText.trim().slice(0, 80);
      return [{ text: L(ctx, `Du hast geschrieben: „${typed}“.\n\n`, `You wrote: “${typed}”.\n\n`, `Has escrito: «${typed}».\n\n`) + intro(ctx, role) }];
    },
  },
});

const ROLE_SCENES: Record<Role, Record<string, DemoScenario>> = { deals, travel, briefing, research, code, own: {}, blank: {} };

/** keyword routes per role, in priority order (de/en/es, common typos) */
const ROLE_ROUTES: Record<Role, [string, RegExp][]> = {
  deals: [
    ['bot:deals:buy', /\b(?:kauf\w*|bestell\w*|buy|order|purchase|c[oó]mpra\w*|p[ií]de\w*)\b|warenkorb|\bcart\b|carrito/],
    ['bot:deals:history', /preisverl|verlauf|preisentwickl|history|histor|\btrend|evoluci[oó]n|diagramm|\bchart|gr[aá]fic/],
    ['bot:deals:weekly', /angebote? der woche|deals? of the week|ofertas? de la semana|(?:jede[nrs]?|every|cada) (?:freitag|friday|viernes|woche|week|semana)/],
    ['bot:deals:compare', /vergl|verlgei|compar|\bvs\.?\b|saug ?robot|robot ?vacc?uum|aspirador|besser|better|mejor/],
    ['bot:deals:shops', /tabelle|\btable|tabla|g[üu]nstig|cheap|barat|\bshops?\b|tienda|\bladen\b|\bwo\b|where|d[oó]nde/],
    ['bot:deals:alert', /bescheid|benachrichtig|melde? dich|tell me when|let me know|notif|alert|av[ií]s|alarma|unter \d|below|under|por debajo|baj[ae]n? de|f[äa]llt|fallen|drops?\b/],
  ],
  travel: [
    ['bot:travel:packing', /pac?k|koffer|maleta|equipaje|mitnehm|\bbring\b|llevar/],
    ['bot:travel:remind', /erinn?er|\brem(?:in|ni|n)d|recu[eé]rd|abfahrt|departure|salida/],
    ['bot:travel:weekend', /woche?n?ende|week ?end|fin de semana|st[äa]dtetrip|city ?break|escapada|reise nach|trip to|viaje a|plan\w*/],
    ['bot:travel:saturday', /samstag|saturday|s[aá]bado|unternehm|machen|to do|hacer|sehensw|sights|visitar/],
    ['bot:travel:train', /versp[äa]t|delay|retras|sitz|seat|asiento|gleis|platform|and[eé]n|\bzug|train|tren|bahn/],
  ],
  briefing: [
    ['bot:briefing:schedule', /werktag|weekday|laborable|(?:\bum|\bat|a las) \d|jeden morgen|every morning|cada ma[ñn]ana/],
    ['bot:briefing:fewer', /weniger|\bless\b|fewer|menos/],
    ['bot:briefing:weather', /wetter|weather|tiempo|clima|regen|\brain|lluvia|schirm|umbrella|paraguas/],
    ['bot:briefing:course', /\bkurs|\bclass|clase|zusag|absag|confirm|cancel/],
    ['bot:briefing:today', /h(?:eu|ue)te|\bto?da?y\b|what'?s on\b|\bhoy\b|steht.{0,12}an|agenda|termin|appointment|citas?\b|was hab/],
  ],
  research: [
    ['bot:research:weekly', /(?:jede[nrs]?|every|cada) (?:montag|monday|lunes|woche|week|semana)|neue studien|new studies|estudios nuevos/],
    ['bot:research:sources', /quell|source|fuente|beleg|evidence|\blinks?\b/],
    ['bot:research:summary', /fass|zusammen|sum ?up|summar|res[uú]m|\bstand\b|where .{0,30}stand|c[oó]mo est[aá]n/],
    ['bot:research:news', /\bneu|what'?s new|what is new|\bnews|novedad|\bnuev|aktuell|latest|[uú]ltim/],
  ],
  code: [
    ['bot:code:cleanup', /aufr[äa]um|r[äa]um\w* .{0,30}auf|clean|tidy|limpia|ordena (?:mi|la|el)|downloads?\b|descargas/],
    ['bot:code:traceback', /trace ?ba?c?k|stack ?trace|fehler|error|exception|ausnahme|excepci[oó]n/],
    ['bot:code:script', /skript|script|programm|program|schreib|\bwrite|escrib/],
  ],
  own: [],
  blank: [],
};

/** what every bot understands before its role's keywords ("Merk dir: Gangplätze" is not a seat question) */
const COMMON_FIRST: [string, RegExp][] = [
  ['bot:know', /(?:wei(?:ß|ss|s)t|\bknow|\bsabes).{0,20}(?:über mich|ueber mich|about me|de m[ií](?![a-z])|sobre m[ií](?![a-z]))/],
  ['bot:last', /zuletzt|what did you last|did you last|last (?:thing )?you did|[uú]ltima vez|[uú]ltimamente/],
  ['bot:who', /wer bist du|who are you|qui[eé]n eres|was kannst du|what can you|qu[eé] (?:puedes|sabes)|\bhilfe\b|\bhelp\b|ayuda|^(?:hi|hallo|hello|hey|hola)\b/],
  ['bot:remember', /merke? dir|remember (?:that|this)|rem[a-z]{0,2}ber that|recuerda que|no olvides/],
];

const COMMON_ROUTES: [string, RegExp][] = [
  ['bot:photos', /\bfotos?\b|\bbilder?\b|\bphotos?\b|pictures?|im[aá]gen/],
  ['bot:routine', /(?:jede[nrsm]?|every|cada|t[äa]glich|daily|w[öo]chentlich|weekly|diario|semanal)\b/],
  ['bot:table', /tabelle|\btable\b|tabla|als liste|as a list|como lista|k[üu]rzer|shorter|m[aá]s corto/],
  ['bot:more', /mehr details|genauer|more details?|in detail|m[aá]s detalles?|detalle/],
];

/** `[kind:id] …` replies of interactive blocks and chips (chat/reformat.ts, ui/components/modules/a/replies.ts) */
const PROTOCOL = /^\[[a-z]+(?::[^\]\n]*)?\]/;

/**
 * The scenario a demo bot answers with: protocol replies → `bot:reply`, then its role's routes, then what every bot
 * understands, else its introduction (`bot:fallback`). Never the general demo: a bot stays in its role.
 */
export function pickBotScenario(userText: string, role: DemoBotRole): { name: string; scenario: DemoScenario } {
  const t = userText.trim().toLowerCase();
  const scenes = { ...ROLE_SCENES[role.template], ...common(role.template) };
  let name = 'bot:fallback';
  if (PROTOCOL.test(t)) name = 'bot:reply';
  else name = [...COMMON_FIRST, ...ROLE_ROUTES[role.template], ...COMMON_ROUTES].find(([, re]) => re.test(t))?.[0] ?? 'bot:fallback';
  return { name, scenario: scenes[name] };
}

/** every scenario name a role can answer with (tests) */
export function roleScenarioNames(role: Role): string[] {
  return [...Object.keys(ROLE_SCENES[role]), ...Object.keys(common(role))];
}

// ── Hermes' own Bot Chat in the demo ─────────────────────────────────────────────────────────────────────────────

/** "Was hast du zuletzt für mich erledigt?" (a starter of the default bot's Bot Chat): nothing yet, honestly */
export const lastDone: DemoScenario = {
  format: 'text',
  steps: (ctx) => [
    {
      text:
        L(
          ctx,
          'In der Demo habe ich noch nichts für dich erledigt: Es gibt keinen Server und keinen Verlauf. Mit Hermes stehen hier deine letzten Aufträge und die Ergebnisse deiner Routinen.\n\nDie Beispiel-Bots im Bots-Tab zeigen, wie das aussieht: Scout hat einen Preis gefunden, Atlas an eine Abfahrt erinnert, Lumi das Morgenbriefing geschickt.\n\n',
          'In the demo I have not done anything for you yet: there is no server and no history. With Hermes your recent tasks and your routines’ results are listed here.\n\nThe example bots in the Bots tab show what that looks like: Scout found a price, Atlas reminded you of a departure, Lumi sent the morning briefing.\n\n',
          'En la demo todavía no he hecho nada por ti: no hay servidor ni historial. Con Hermes aquí aparecen tus últimos encargos y los resultados de tus rutinas.\n\nLos bots de ejemplo de la pestaña Bots muestran cómo se ve: Scout encontró un precio, Atlas te recordó una salida y Lumi envió el resumen matutino.\n\n',
        ) + chips(ctx, 'tour', 'memoryWhat'),
    },
  ],
};
