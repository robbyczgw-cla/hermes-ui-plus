// The "Answers you can act on" showcase of the offline demo: approval, checklist, choices, trip plan, product
// compare, recipe with timers, quiz, flashcards, an explanation to reshape, and the way out to a real Hermes.
// Every scenario is fully offline (no photos, map tiles or web lookups), fictional, and written in en/de/es.
import { brand } from '../../brand.ts';
import { FLAVOR } from '../../flavor.ts';
import { FACTS, type FactsId } from './facts.ts';
import { DAYS, L, hui, langOf, suggestions, tool, type DemoContext, type DemoLang, type DemoScenario } from './kit.ts';
import { prompt, type PromptKey } from './prompts.ts';

/** a `suggestions` node with the sample requests `keys` in the chat language */
export const chips = (ctx: Pick<DemoContext, 'lang'>, ...keys: PromptKey[]): string => suggestions(...keys.map((k) => prompt(k, langOf(ctx))));

/** prose answer of a `FACTS` entry: intro, numbered points, outro */
export function factsText(id: FactsId, lang: DemoLang): string {
  const f = FACTS[id];
  return `${f.intro[lang]}\n\n${f.points[lang].map(([label, detail], i) => `${i + 1}. **${label}.** ${detail}`).join('\n')}\n\n${f.outro[lang]}`;
}

// ── tour / fallback ────────────────────────────────────────────────────────────────────────────────────────────

const TOUR_CHIPS: PromptKey[] = ['liveList', 'approval', 'checklist', 'choice', 'products', 'webResearch', 'recipe', 'quiz', 'explain', 'status', 'paths', 'memoryWhat', 'connect'];

export const tour: DemoScenario = {
  format: 'text',
  steps: (ctx) => {
    const name = brand().displayName;
    return [
      {
        text: L(
          ctx,
          `Willkommen bei **${name}**! Das hier ist die **Demo**: alle Antworten sind vorbereitet und laufen komplett auf deinem Gerät – kein Server, kein Konto, nichts verlässt das Handy. Trotzdem fühlt es sich an wie echt: Antworten laufen ein, Werkzeuge arbeiten, und du kannst mit dem Ergebnis **etwas tun**.\n\nTipp auf eine Karte, um es zu sehen:\n\n`,
          `Welcome to **${name}**! This is the **demo**: every answer is prepared and plays entirely on your device – no server, no account, nothing leaves the phone. It still behaves like the real thing: answers stream in, tools run, and you can **act on** what you get.\n\nTap one to see it:\n\n`,
          `¡Bienvenido a **${name}**! Esta es la **demo**: todas las respuestas están preparadas y se ejecutan en tu dispositivo, sin servidor, sin cuenta y sin que nada salga del móvil. Aun así se comporta como lo real: las respuestas fluyen, las herramientas trabajan y puedes **actuar** sobre el resultado.\n\nToca una para verlo:\n\n`,
        ),
      },
      { text: chips(ctx, ...TOUR_CHIPS) },
      {
        text:
          '\n' +
          L(
            ctx,
            'Während eine Antwort läuft, kannst du sie mit dem **Stopp**-Knopf abbrechen. Unter längeren Antworten findest du Chips wie **Kürzer** oder **Als Tabelle**. Und wenn du bereit bist: **Hermes verbinden** oben im Chat.',
            'While an answer streams you can cut it off with the **Stop** button. Under longer answers you will find chips like **Shorter** or **As a table**. And when you are ready: **Connect Hermes** at the top of the chat.',
            'Mientras llega una respuesta puedes cortarla con el botón **Detener**. Bajo las respuestas largas verás chips como **Más corto** o **Como tabla**. Y cuando estés listo: **Conectar Hermes**, arriba en el chat.',
          ),
      },
    ];
  },
};

/** anything the demo has no script for: say so and offer the scripted requests (never a bare "demo answer") */
export const plain: DemoScenario = {
  format: 'text',
  steps: (ctx) => {
    const typed = ctx.userText.trim().slice(0, 100);
    return [
      {
        text: L(
          ctx,
          `Du hast geschrieben: „${typed}“.\n\nDas ist die **Offline-Demo** ohne Server: Sie kennt nur vorbereitete Anfragen, die aber voll interaktiv sind. Such dir eine aus:\n\n`,
          `You wrote: “${typed}”.\n\nThis is the **offline demo** without a server: it only knows prepared requests, which are fully interactive though. Pick one:\n\n`,
          `Has escrito: «${typed}».\n\nEsta es la **demo sin conexión** y sin servidor: solo conoce peticiones preparadas, aunque son totalmente interactivas. Elige una:\n\n`,
        ) +
          chips(ctx, ...TOUR_CHIPS) +
          '\n' +
          L(
            ctx,
            'Freie Fragen beantwortet dein eigenes Hermes: tippe oben auf **Hermes verbinden**.',
            'Your own Hermes answers free-form questions: tap **Connect Hermes** at the top.',
            'Tu propio Hermes responde a preguntas libres: toca **Conectar Hermes** arriba.',
          ) +
          // the official build only talks to Hermes: no "other provider" advice there
          ((ctx.flavor ?? FLAVOR) === 'personal'
            ? L(ctx, ' (Oder richte einen anderen Anbieter in den Einstellungen ein.)', ' (Or set up another provider in Settings.)', ' (O configura otro proveedor en Ajustes.)')
            : ''),
      },
    ];
  },
};

/** map / photo requests: those load from the internet, which the offline demo never does */
export const needsNet: DemoScenario = {
  format: 'text',
  steps: (ctx) => [
    {
      text: L(
        ctx,
        'Karten und Fotos werden aus dem Internet geladen – die Offline-Demo greift nie darauf zu, deshalb zeige ich sie hier nicht. Mit deinem eigenen Hermes erscheinen sie direkt in den Antworten.\n\nDiesen Ablauf kann ich dir stattdessen offline zeigen – mit Zeitplan:\n\n',
        'Maps and photos are loaded from the internet – the offline demo never goes online, so I do not show them here. With your own Hermes they appear right inside answers.\n\nHere is something I can show offline instead – a trip with a schedule:\n\n',
        'Los mapas y las fotos se cargan desde internet; la demo sin conexión nunca se conecta, así que no los muestro aquí. Con tu propio Hermes aparecen dentro de las respuestas.\n\nEn su lugar puedo enseñarte esto sin conexión: un viaje con horario:\n\n',
      ) + chips(ctx, 'tripRome', 'tripLisbon', 'tour'),
    },
  ],
};

// ── approval ───────────────────────────────────────────────────────────────────────────────────────────────────

const CACHE_DIR = '/tmp/hui-demo-cache';

export const approval: DemoScenario = {
  format: 'text',
  steps: (ctx) => [
    { reasoning: L(ctx, `Der Nutzer will den Cache unter ${CACHE_DIR} aufräumen. Erst nachsehen, wie groß er ist; löschen darf ich nur mit Freigabe.`, `The user wants the cache at ${CACHE_DIR} cleaned up. Check how big it is first; deleting needs approval.`, `El usuario quiere limpiar la caché de ${CACHE_DIR}. Primero ver cuánto ocupa; borrar requiere aprobación.`) },
    { text: L(ctx, 'Ich schaue zuerst, wie viel Platz der Cache belegt.', 'First I check how much space the cache uses.', 'Primero compruebo cuánto espacio ocupa la caché.') },
    tool.terminal(`du -sh ${CACHE_DIR}`, 800),
    {
      text: L(
        ctx,
        '\n\nEr belegt **1,2 GB** (fiktiver Wert). Zum Aufräumen müsste ich den Ordner löschen – das mache ich nicht ohne deine **Freigabe**:',
        '\n\nIt uses **1.2 GB** (made-up value). To clean it up I would have to delete the folder – I will not do that without your **approval**:',
        '\n\nOcupa **1,2 GB** (valor inventado). Para limpiarla tendría que borrar la carpeta, y no lo hago sin tu **aprobación**:',
      ),
    },
    {
      approval: {
        command: `rm -rf ${CACHE_DIR}`,
        description: L(ctx, 'Rekursives Löschen eines Ordners', 'Recursive delete of a folder', 'Borrado recursivo de una carpeta'),
        pattern_key: 'rm -rf',
        pattern_keys: ['rm -rf'],
        allow: [
          { text: L(ctx, '\n\nFreigabe erhalten – ich lösche den Cache.', '\n\nApproval received – deleting the cache.', '\n\nAprobación recibida: borro la caché.') },
          tool.terminal(`rm -rf ${CACHE_DIR}`, 1100),
          tool.terminal(`ls ${CACHE_DIR}`, 500),
          {
            text:
              L(
                ctx,
                '\n\n**Erledigt.** Der Ordner ist weg und 1,2 GB sind frei. (In der Demo wurde auf deinem Gerät natürlich nichts gelöscht – alles ist inszeniert.)\n\n',
                '\n\n**Done.** The folder is gone and 1.2 GB are free. (In the demo nothing was deleted on your device, of course – it is all staged.)\n\n',
                '\n\n**Hecho.** La carpeta ha desaparecido y hay 1,2 GB libres. (En la demo, por supuesto, no se borró nada en tu dispositivo: todo es una puesta en escena.)\n\n',
              ) +
              hui({ type: 'stats', items: [{ label: L(ctx, 'Frei geworden', 'Freed', 'Liberado'), value: L(ctx, '1,2 GB', '1.2 GB', '1,2 GB'), delta: L(ctx, '+1,2 GB', '+1.2 GB', '+1,2 GB'), trend: 'up' }] }) +
              '\n' +
              chips(ctx, 'checklist', 'products', 'tour'),
          },
        ],
        deny: [
          {
            text:
              L(
                ctx,
                '\n\nAlles klar, ich lasse den Cache **unverändert** – es wurde nichts gelöscht.\n\nWenn du vorher sehen willst, was darin liegt, zeige ich es dir gern, ohne etwas anzufassen.\n\n',
                '\n\nUnderstood, I leave the cache **untouched** – nothing was deleted.\n\nIf you want to see what is inside first, I am happy to show you without touching anything.\n\n',
                '\n\nEntendido, dejo la caché **intacta**: no se borró nada.\n\nSi antes quieres ver qué contiene, te lo enseño con gusto sin tocar nada.\n\n',
              ) + chips(ctx, 'cacheList', 'approval', 'tour'),
          },
        ],
      },
    },
  ],
};

export const cacheList: DemoScenario = {
  format: 'table',
  steps: (ctx) => [
    tool.terminal(`ls -lh ${CACHE_DIR}`, 700),
    { text: L(ctx, `Das liegt in \`${CACHE_DIR}\` (fiktive Dateien):\n\n`, `This is inside \`${CACHE_DIR}\` (made-up files):\n\n`, `Esto hay en \`${CACHE_DIR}\` (archivos inventados):\n\n`) },
    {
      text: hui({
        type: 'table',
        basis: 'illustrative',
        columns: [L(ctx, 'Name', 'Name', 'Nombre'), L(ctx, 'Größe', 'Size', 'Tamaño'), L(ctx, 'Zuletzt genutzt', 'Last used', 'Último uso')],
        rows: [
          ['thumbnails/', '640 MB', L(ctx, 'vor 3 Tagen', '3 days ago', 'hace 3 días')],
          ['downloads.part', '310 MB', L(ctx, 'vor 12 Tagen', '12 days ago', 'hace 12 días')],
          ['session-3f2a.tmp', '120 MB', L(ctx, 'vor 9 Tagen', '9 days ago', 'hace 9 días')],
          ['index.db', '85 MB', L(ctx, 'gestern', 'yesterday', 'ayer')],
          ['logs/', '45 MB', L(ctx, 'heute', 'today', 'hoy')],
        ],
      }),
    },
    {
      text:
        '\n' +
        L(
          ctx,
          'Es wurde nichts verändert. Zusammen sind es **1,2 GB**. Aufräumen geht erst mit deiner Freigabe:\n\n',
          'Nothing was changed. Together that is **1.2 GB**. Cleaning up only happens with your approval:\n\n',
          'No se cambió nada. En total son **1,2 GB**. Limpiar solo ocurre con tu aprobación:\n\n',
        ) +
        chips(ctx, 'approval', 'tour'),
    },
  ],
};

// ── checklist ──────────────────────────────────────────────────────────────────────────────────────────────────

/** items of the shopping list; `category` stays the German built-in key (the checklist localizes it) */
const SHOPPING: { id: string; text: [string, string, string]; qty: number; unit?: [string, string, string]; category: string; checked?: boolean }[] = [
  { id: 'spaghetti', text: ['Spaghetti', 'Spaghetti', 'Espaguetis'], qty: 500, unit: ['g', 'g', 'g'], category: 'Vorrat' },
  { id: 'pancetta', text: ['Pancetta', 'Pancetta', 'Panceta'], qty: 150, unit: ['g', 'g', 'g'], category: 'Fleisch & Fisch' },
  { id: 'eggs', text: ['Eier', 'Eggs', 'Huevos'], qty: 6, category: 'Kühlregal' },
  { id: 'pecorino', text: ['Pecorino', 'Pecorino', 'Pecorino'], qty: 100, unit: ['g', 'g', 'g'], category: 'Kühlregal' },
  { id: 'butter', text: ['Butter', 'Butter', 'Mantequilla'], qty: 250, unit: ['g', 'g', 'g'], category: 'Kühlregal', checked: true },
  { id: 'tomatoes', text: ['Tomaten', 'Tomatoes', 'Tomates'], qty: 6, category: 'Obst & Gemüse' },
  { id: 'basil', text: ['Basilikum', 'Basil', 'Albahaca'], qty: 1, unit: ['Topf', 'pot', 'maceta'], category: 'Obst & Gemüse' },
  { id: 'lemons', text: ['Zitronen', 'Lemons', 'Limones'], qty: 3, category: 'Obst & Gemüse' },
  { id: 'oil', text: ['Olivenöl', 'Olive oil', 'Aceite de oliva'], qty: 1, unit: ['Flasche', 'bottle', 'botella'], category: 'Vorrat' },
  { id: 'water', text: ['Sprudelwasser', 'Sparkling water', 'Agua con gas'], qty: 6, unit: ['Flaschen', 'bottles', 'botellas'], category: 'Getränke' },
];
const li = (ctx: Pick<DemoContext, 'lang'>) => (ctx.lang === 'en' ? 1 : ctx.lang === 'es' ? 2 : 0);

export const SHOPPING_ID = 'weekend-shopping';

export const checklist: DemoScenario = {
  format: 'interactive',
  steps: (ctx) => {
    const i = li(ctx);
    return [
      { reasoning: L(ctx, 'Wochenende, Gäste: eine Pasta-Zutatenliste nach Abteilungen sortieren, Butter ist schon im Haus.', 'Weekend with guests: a pasta ingredient list sorted by aisle; butter is already at home.', 'Fin de semana con invitados: lista de ingredientes de pasta por secciones; la mantequilla ya está en casa.') },
      { text: L(ctx, 'Hier ist deine Liste fürs Wochenende, nach Abteilungen sortiert. Tipp auf einen Eintrag, um ihn abzuhaken – Erledigtes wandert nach unten:\n\n', 'Here is your list for the weekend, sorted by aisle. Tap an item to tick it off – finished items move to the bottom:\n\n', 'Aquí tienes tu lista para el fin de semana, ordenada por secciones. Toca un elemento para marcarlo; lo hecho baja al final:\n\n') },
      {
        text: hui({
          type: 'checklist',
          id: SHOPPING_ID,
          title: L(ctx, 'Einkauf Samstag', 'Saturday shopping', 'Compra del sábado'),
          kind: 'shopping',
          groupBy: 'category',
          items: SHOPPING.map((s) => ({ text: s.text[i], qty: s.qty, ...(s.unit ? { unit: s.unit[i] } : {}), category: s.category, ...(s.checked ? { checked: true } : {}) })),
        }),
      },
      {
        text:
          '\n' +
          L(
            ctx,
            'Mit **Senden** bekomme ich den Stand – was abgehakt ist und was fehlt – und mache daraus den nächsten Schritt.',
            'Tap **Send** and I get the state – what is ticked and what is still missing – and turn it into the next step.',
            'Con **Enviar** recibo el estado (qué está marcado y qué falta) y lo convierto en el siguiente paso.',
          ),
      },
    ];
  },
};

// ── choose a destination → plan ────────────────────────────────────────────────────────────────────────────────

export const TRIP_CHOICE_ID = 'trip-destination';

export const choice: DemoScenario = {
  format: 'interactive',
  steps: (ctx) => [
    { text: L(ctx, 'Gern! Damit ich passend plane – wohin soll der Städtetrip gehen?\n\n', 'Happy to! So I can plan something fitting – where should the city break go?\n\n', '¡Con gusto! Para planificar algo adecuado, ¿adónde irá la escapada?\n\n') },
    {
      text: hui({
        type: 'choice',
        id: TRIP_CHOICE_ID,
        question: L(ctx, 'Wohin soll es gehen?', 'Where to?', '¿Adónde vamos?'),
        layout: 'grid',
        options: [
          { label: CITIES.rome.name[langOf(ctx)], description: L(ctx, 'Kultur & Pasta', 'Culture & pasta', 'Cultura y pasta'), icon: '\u{1F3DB}\u{FE0F}' },
          { label: CITIES.lisbon.name[langOf(ctx)], description: L(ctx, 'Meer & Hügel', 'Sea & hills', 'Mar y colinas'), icon: '\u{1F30A}' },
          { label: CITIES.vienna.name[langOf(ctx)], description: L(ctx, 'Kaffeehäuser', 'Coffee houses', 'Cafés históricos'), icon: '☕' },
          { label: CITIES.copenhagen.name[langOf(ctx)], description: L(ctx, 'Design & Rad', 'Design & bikes', 'Diseño y bicis'), icon: '\u{1F6B2}' },
        ],
        allowOther: true,
      }),
    },
  ],
};

type CityId = 'rome' | 'lisbon' | 'vienna' | 'copenhagen';
type Plan = [title: string, detail: string][];
const CITIES: Record<CityId, { name: Record<DemoLang, string>; rx: RegExp; intro: Record<DemoLang, string>; plan: Record<DemoLang, Plan>; tip: Record<DemoLang, string> }> = {
  rome: {
    name: { en: 'Rome', de: 'Rom', es: 'Roma' },
    rx: /\b(rome|rom|roma)\b/,
    intro: {
      en: 'Rome in two relaxed days – everything is within walking distance, with a long lunch in between.',
      de: 'Rom in zwei entspannten Tagen – alles ist zu Fuß erreichbar, dazwischen gibt es ein langes Mittagessen.',
      es: 'Roma en dos días tranquilos: todo se hace a pie, con una larga comida en medio.',
    },
    plan: {
      en: [['Colosseum & Forum', 'Book the combined ticket online'], ['Lunch in Monti', 'Try cacio e pepe'], ['Pantheon & Trevi Fountain', 'Do not forget the coin'], ['Aperitivo by the Spanish Steps', 'Golden hour'], ["St Peter's Basilica", 'Be early, the queue is short'], ['Trastevere', 'Stroll, then pizza al taglio']],
      de: [['Kolosseum & Forum Romanum', 'Kombiticket vorab online buchen'], ['Mittagessen in Monti', 'Cacio e pepe probieren'], ['Pantheon & Trevi-Brunnen', 'Münze nicht vergessen'], ['Aperitivo an der Spanischen Treppe', 'Goldene Stunde'], ['Petersdom', 'Früh da sein, dann ist die Schlange kurz'], ['Trastevere', 'Bummeln, dann Pizza al taglio']],
      es: [['Coliseo y Foro', 'Reserva la entrada combinada por internet'], ['Comida en Monti', 'Prueba la cacio e pepe'], ['Panteón y Fontana de Trevi', 'No olvides la moneda'], ['Aperitivo en la Plaza de España', 'Hora dorada'], ['Basílica de San Pedro', 'Ve temprano, la cola es corta'], ['Trastevere', 'Paseo y luego pizza al taglio']],
    },
    tip: { en: 'Carry a refillable bottle – the public fountains give good drinking water.', de: 'Nimm eine Trinkflasche mit – die öffentlichen Brunnen liefern gutes Trinkwasser.', es: 'Lleva una botella reutilizable: las fuentes públicas dan buena agua potable.' },
  },
  lisbon: {
    name: { en: 'Lisbon', de: 'Lissabon', es: 'Lisboa' },
    rx: /\b(lisbon|lissabon|lisboa)\b/,
    intro: {
      en: 'Lisbon in two days – steep streets, river views and a lot of custard tarts.',
      de: 'Lissabon in zwei Tagen – steile Gassen, Flussblicke und viele Pasteis de Nata.',
      es: 'Lisboa en dos días: calles empinadas, vistas al río y muchos pasteles de nata.',
    },
    plan: {
      en: [['Tram ride to Alfama', 'Start early, before the crowds'], ['Castle viewpoint', 'The best view over the red roofs'], ['Lunch at a tasca', 'Grilled sardines and a small glass of wine'], ['Belém tower & pastries', 'Take the riverside tram'], ['Fado dinner', 'Reserve a table in advance'], ['Viewpoint walk', 'Sunday coffee with a view']],
      de: [['Straßenbahnfahrt nach Alfama', 'Früh starten, vor dem Andrang'], ['Aussichtspunkt an der Burg', 'Der beste Blick über die roten Dächer'], ['Mittagessen in einer Tasca', 'Gegrillte Sardinen und ein kleines Glas Wein'], ['Torre de Belém & Gebäck', 'Mit der Bahn am Fluss entlang'], ['Fado-Abendessen', 'Tisch vorher reservieren'], ['Spaziergang zu den Aussichtspunkten', 'Sonntagskaffee mit Aussicht']],
      es: [['Tranvía a Alfama', 'Sal temprano, antes de las multitudes'], ['Mirador del castillo', 'La mejor vista de los tejados rojos'], ['Comida en una tasca', 'Sardinas a la parrilla y una copita de vino'], ['Torre de Belém y pasteles', 'Ve en el tranvía junto al río'], ['Cena con fado', 'Reserva mesa con antelación'], ['Paseo por los miradores', 'Café dominical con vistas']],
    },
    tip: { en: 'Wear shoes with grip – the cobbles are slippery when wet.', de: 'Trag Schuhe mit gutem Profil – das Kopfsteinpflaster ist bei Nässe glatt.', es: 'Lleva calzado con agarre: los adoquines resbalan cuando están mojados.' },
  },
  vienna: {
    name: { en: 'Vienna', de: 'Wien', es: 'Viena' },
    rx: /\b(vienna|wien|viena)\b/,
    intro: {
      en: 'Vienna in two days – coffee houses, old town and a wine tavern in the evening.',
      de: 'Wien in zwei Tagen – Kaffeehäuser, Altstadt und abends ein Heuriger.',
      es: 'Viena en dos días: cafés históricos, casco antiguo y por la noche una taberna de vino.',
    },
    plan: {
      en: [['Breakfast in a coffee house', 'Order a melange and take your time'], ['Old town walk', 'Cathedral, lanes and courtyards'], ['Lunch at the market', 'Many stalls, something for everyone'], ['Museum quarter', 'Pick one museum, not three'], ['Wine tavern evening', 'Young wine and a cold platter'], ['Palace gardens', 'Sunday walk under old trees']],
      de: [['Frühstück im Kaffeehaus', 'Eine Melange bestellen und sich Zeit lassen'], ['Spaziergang durch die Altstadt', 'Dom, Gassen und Innenhöfe'], ['Mittagessen am Markt', 'Viele Stände, für jeden etwas'], ['Museumsquartier', 'Ein Museum auswählen, nicht drei'], ['Abend beim Heurigen', 'Junger Wein und kalte Platte'], ['Schlossgarten', 'Sonntagsspaziergang unter alten Bäumen']],
      es: [['Desayuno en un café histórico', 'Pide un melange y tómate tu tiempo'], ['Paseo por el casco antiguo', 'Catedral, callejuelas y patios'], ['Comida en el mercado', 'Muchos puestos, algo para cada gusto'], ['Barrio de los museos', 'Elige un museo, no tres'], ['Noche en una taberna de vino', 'Vino joven y tabla fría'], ['Jardines del palacio', 'Paseo dominical bajo árboles viejos']],
    },
    tip: { en: 'A day ticket for public transport pays off after three rides.', de: 'Eine Tageskarte für die Öffis lohnt sich ab drei Fahrten.', es: 'Un billete de día para el transporte público compensa a partir de tres viajes.' },
  },
  copenhagen: {
    name: { en: 'Copenhagen', de: 'Kopenhagen', es: 'Copenhague' },
    rx: /\b(copenhagen|kopenhagen|copenhague)\b/,
    intro: {
      en: 'Copenhagen in two days – by bike, along the canals, with a lot of good bread.',
      de: 'Kopenhagen in zwei Tagen – mit dem Rad, an den Kanälen entlang, mit viel gutem Brot.',
      es: 'Copenhague en dos días: en bici, junto a los canales y con mucho pan bueno.',
    },
    plan: {
      en: [['Pastry and coffee', 'Start with a cinnamon roll'], ['Canal boat tour', 'Gives you the lay of the land in an hour'], ['Open sandwich lunch', 'Smørrebrød, the Danish classic'], ['Bike to the design museum', 'Rent a bike, the lanes are great'], ['Street food hall', 'Eat your way around the world'], ['Harbour swim', 'Sunday: a dip and a sauna']],
      de: [['Gebäck und Kaffee', 'Mit einer Zimtschnecke starten'], ['Kanalrundfahrt', 'In einer Stunde den Überblick gewinnen'], ['Mittagessen: belegtes Brot', 'Smørrebrød, der dänische Klassiker'], ['Mit dem Rad zum Designmuseum', 'Rad leihen, die Radwege sind klasse'], ['Streetfood-Halle', 'Einmal um die Welt essen'], ['Baden im Hafen', 'Sonntag: ein Sprung ins Wasser und Sauna']],
      es: [['Bollería y café', 'Empieza con un rollo de canela'], ['Paseo en barco por los canales', 'Te da una idea del lugar en una hora'], ['Comida: sándwich abierto', 'Smørrebrød, el clásico danés'], ['En bici al museo de diseño', 'Alquila una bici, los carriles son geniales'], ['Mercado de comida callejera', 'Da la vuelta al mundo comiendo'], ['Baño en el puerto', 'Domingo: un chapuzón y sauna']],
    },
    tip: { en: 'Bikes have right of way on their lanes – look over your shoulder before you step off a bus.', de: 'Radfahrer haben auf ihren Spuren Vorrang – vor dem Aussteigen aus dem Bus über die Schulter schauen.', es: 'Las bicis tienen prioridad en sus carriles: mira antes de bajar del autobús.' },
  },
};

const PLAN_TIMES = [[5, '09:00'], [5, '13:00'], [5, '16:00'], [5, '19:30'], [6, '09:30'], [6, '12:30']] as const;

export function detectCity(text: string): CityId | undefined {
  const t = text.toLowerCase();
  return (Object.keys(CITIES) as CityId[]).find((c) => CITIES[c].rx.test(t));
}

export const trip: DemoScenario = {
  format: 'timeline',
  steps: (ctx) => {
    const lang = langOf(ctx);
    const city = detectCity(ctx.userText);
    if (!city) {
      const other = /→\s*(?:Andere|Other|Otro):\s*(.+)$/i.exec(ctx.userText)?.[1]?.trim();
      return [
        {
          text:
            L(
              ctx,
              `${other ? `„${other.slice(0, 40)}“ klingt gut, aber ` : ''}in der Demo habe ich Pläne für vier Städte vorbereitet. Such dir eine aus:\n\n`,
              `${other ? `“${other.slice(0, 40)}” sounds great, but ` : ''}in the demo I only prepared plans for four cities. Pick one:\n\n`,
              `${other ? `«${other.slice(0, 40)}» suena bien, pero ` : ''}en la demo solo preparé planes para cuatro ciudades. Elige una:\n\n`,
            ) + chips(ctx, 'tripRome', 'tripLisbon', 'tripVienna', 'tripCopenhagen'),
        },
      ];
    }
    const c = CITIES[city];
    const others: PromptKey[] = (['tripRome', 'tripLisbon', 'tripVienna', 'tripCopenhagen'] as const).filter((_, i) => (Object.keys(CITIES) as CityId[])[i] !== city);
    return [
      { reasoning: L(ctx, `Wochenende in ${c.name[lang]}: Samstag Highlights, Sonntag ruhiger. Zeiten so legen, dass genug Pausen bleiben.`, `Weekend in ${c.name[lang]}: highlights on Saturday, calmer Sunday. Leave room for breaks.`, `Fin de semana en ${c.name[lang]}: lo principal el sábado, domingo más tranquilo. Dejar pausas.`) },
      tool.search(L(ctx, `${c.name[lang]} Wochenende Zeitplan`, `${c.name[lang]} weekend itinerary`, `${c.name[lang]} fin de semana itinerario`), 900),
      { text: `${c.intro[lang]}\n\n` },
      {
        text: hui({
          type: 'timeline',
          items: c.plan[lang].map(([title, detail], i) => ({ time: `${DAYS[lang][PLAN_TIMES[i][0]]} ${PLAN_TIMES[i][1]}`, title, detail })),
        }),
      },
      { text: `\n${c.tip[lang]}\n\n` + L(ctx, 'Andere Stadt?\n\n', 'A different city?\n\n', '¿Otra ciudad?\n\n') + suggestions(...others.map((k) => prompt(k, lang)), prompt('checklist', lang)) },
    ];
  },
};

// ── train or plane: weigh priorities → decision ────────────────────────────────────────────────────────────────

export const TRAVEL_CHOICE_ID = 'reise-prio';
const PRIOS = [
  { id: 'price', label: { en: 'Price', de: 'Preis', es: 'Precio' }, desc: { en: 'As cheap as possible', de: 'Möglichst günstig', es: 'Lo más barato posible' }, icon: '\u{1F4B6}' },
  { id: 'time', label: { en: 'Travel time', de: 'Reisezeit', es: 'Tiempo de viaje' }, desc: { en: 'Door to door', de: 'Tür zu Tür', es: 'De puerta a puerta' }, icon: '⏱️' },
  { id: 'climate', label: { en: 'Climate', de: 'Klima', es: 'Clima' }, desc: { en: 'Low CO₂', de: 'Wenig CO₂', es: 'Poco CO₂' }, icon: '\u{1F331}' },
  { id: 'work', label: { en: 'Working on the way', de: 'Arbeiten unterwegs', es: 'Trabajar en el camino' }, desc: { en: 'Laptop, Wi-Fi, a table', de: 'Laptop, WLAN, Tisch', es: 'Portátil, wifi, mesa' }, icon: '\u{1F4BB}' },
] as const;

export const reiseChoice: DemoScenario = {
  format: 'choice',
  steps: (ctx) => {
    const lang = langOf(ctx);
    return [
      { text: L(ctx, 'Hamburg → München geht gut mit beidem. Damit ich fair vergleiche: Was ist dir wichtig?\n\n', 'Hamburg → Munich works well either way. So I compare fairly: what matters to you?\n\n', 'Hamburgo → Múnich se puede hacer de ambas formas. Para comparar con justicia: ¿qué es importante para ti?\n\n') },
      {
        text: hui({
          type: 'choice',
          id: TRAVEL_CHOICE_ID,
          question: L(ctx, 'Was zählt für dich? (mehrere möglich)', 'What matters to you? (several allowed)', '¿Qué te importa? (puedes elegir varias)'),
          multiple: true,
          layout: 'list',
          submitLabel: L(ctx, 'Vergleichen', 'Compare', 'Comparar'),
          options: PRIOS.map((p) => ({ id: p.id, label: p.label[lang], icon: p.icon, description: p.desc[lang] })),
        }),
      },
    ];
  },
};

export const reiseDecision: DemoScenario = {
  format: 'decision',
  steps: (ctx) => {
    const lang = langOf(ctx);
    const t = ctx.userText.toLowerCase().replace(/^[^→]*→/, '');
    const picked = (id: (typeof PRIOS)[number]['id']) => t.includes(PRIOS.find((p) => p.id === id)!.label[lang].toLowerCase());
    const w = (id: (typeof PRIOS)[number]['id'], on: number, off: number) => (picked(id) ? on : off);
    const weights = { price: w('price', 8, 4), time: w('time', 8, 4), climate: w('climate', 9, 3), work: w('work', 7, 2), comfort: 5 };
    const options = [
      { id: 'train', label: L(ctx, '\u{1F686} Bahn', '\u{1F686} Train', '\u{1F686} Tren'), scores: { price: 7, time: 5, climate: 10, work: 9, comfort: 8 }, note: L(ctx, 'ca. 5½ h, Stadtmitte zu Stadtmitte', 'about 5½ h, city centre to city centre', 'unas 5½ h, de centro a centro') },
      { id: 'plane', label: L(ctx, '✈️ Flugzeug', '✈️ Plane', '✈️ Avión'), scores: { price: 5, time: 8, climate: 2, work: 3, comfort: 5 }, note: L(ctx, '1¼ h Flug + Anreise + Sicherheitskontrolle', '1¼ h flight + transfers + security', '1¼ h de vuelo + traslados + control de seguridad') },
      { id: 'car', label: L(ctx, '\u{1F697} Auto', '\u{1F697} Car', '\u{1F697} Coche'), scores: { price: 5, time: 2, climate: 4, work: 0, comfort: 6 }, note: L(ctx, 'ca. 8 h, Stau-Risiko', 'about 8 h, risk of traffic jams', 'unas 8 h, riesgo de atascos') },
    ];
    const total = (o: (typeof options)[number]) => Object.entries(weights).reduce((s, [k, wt]) => s + wt * o.scores[k as keyof typeof o.scores], 0);
    const best = options.reduce((a, b) => (total(b) > total(a) ? b : a));
    const bestName = best.label.replace(/^\S+\s/, '');
    return [
      tool.search(L(ctx, 'ICE Hamburg München Fahrzeit', 'ICE Hamburg Munich travel time', 'ICE Hamburgo Múnich duración'), 600),
      tool.search(L(ctx, 'Flug Hamburg München CO₂ pro Person', 'Flight Hamburg Munich CO₂ per person', 'Vuelo Hamburgo Múnich CO₂ por persona'), 500),
      { text: L(ctx, 'Ich habe deine Prioritäten als Gewichte übernommen. Schieb die Regler, wenn sich etwas anders anfühlt:\n\n', 'I turned your priorities into weights. Move the sliders if something feels different:\n\n', 'He convertido tus prioridades en pesos. Mueve los deslizadores si algo te parece distinto:\n\n') },
      {
        text: hui({
          type: 'decision',
          id: 'reise-hamburg-muenchen',
          title: 'Hamburg → ' + L(ctx, 'München', 'Munich', 'Múnich'),
          criteria: [
            { id: 'price', label: PRIOS[0].label[lang], weight: weights.price },
            { id: 'time', label: L(ctx, 'Reisezeit (Tür zu Tür)', 'Travel time (door to door)', 'Tiempo de viaje (puerta a puerta)'), weight: weights.time },
            { id: 'climate', label: PRIOS[2].label[lang], weight: weights.climate },
            { id: 'work', label: PRIOS[3].label[lang], weight: weights.work },
            { id: 'comfort', label: L(ctx, 'Komfort', 'Comfort', 'Comodidad'), weight: weights.comfort },
          ],
          options,
          note: L(ctx, 'Schätzwerte 0–10 für eine typische Reise unter der Woche.', 'Estimates 0–10 for a typical weekday trip.', 'Estimaciones 0–10 para un viaje normal entre semana.'),
        }),
      },
      {
        text:
          '\n' +
          L(ctx, `Mit deinen Gewichten liegt **${bestName}** vorn. Zieh an den Reglern, um zu sehen, wann sich das Ergebnis dreht.\n\n`, `With your weights **${bestName}** comes out ahead. Drag the sliders to see when the result flips.\n\n`, `Con tus pesos gana **${bestName}**. Mueve los deslizadores para ver cuándo cambia el resultado.\n\n`) +
          chips(ctx, 'paths', 'checklist', 'tour'),
      },
    ];
  },
};

// ── choose a path ──────────────────────────────────────────────────────────────────────────────────────────────

export const PATHS_ID = 'photo-backup';
type Hop = readonly [label: string, icon: string];
const BACKUP_ROUTES: readonly { id: 'phone' | 'cloud' | 'home'; title: Record<DemoLang, string>; badge: Record<DemoLang, string>; tone: 'bad' | 'neutral' | 'good'; note: Record<DemoLang, string>; path: Record<DemoLang, readonly Hop[]> }[] = [
  {
    id: 'phone',
    title: { en: 'Only on the phone', de: 'Nur auf dem Handy', es: 'Solo en el móvil' },
    badge: { en: 'Risky', de: 'Riskant', es: 'Arriesgado' },
    tone: 'bad',
    note: { en: 'Nothing to set up, but one lost phone loses every photo.', de: 'Nichts einzurichten, aber ein verlorenes Handy bedeutet: alle Fotos weg.', es: 'No hay nada que configurar, pero perder el móvil es perder todas las fotos.' },
    path: { en: [['Phone', 'phone'], ['Internal storage', 'disk']], de: [['Handy', 'phone'], ['Interner Speicher', 'disk']], es: [['Móvil', 'phone'], ['Almacenamiento interno', 'disk']] },
  },
  {
    id: 'cloud',
    title: { en: 'Cloud sync', de: 'Cloud-Sync', es: 'Sincronizar con la nube' },
    badge: { en: 'Easy', de: 'Einfach', es: 'Fácil' },
    tone: 'neutral',
    note: { en: 'Automatic and off-site; a monthly fee, and the provider holds your photos.', de: 'Automatisch und an anderem Ort gesichert; kostet monatlich, und der Anbieter hält deine Fotos.', es: 'Automático y fuera de casa; cuesta una cuota mensual y el proveedor guarda tus fotos.' },
    path: { en: [['Phone', 'phone'], ['Internet', 'globe'], ['Cloud storage', 'cloud']], de: [['Handy', 'phone'], ['Internet', 'globe'], ['Cloud-Speicher', 'cloud']], es: [['Móvil', 'phone'], ['Internet', 'globe'], ['Almacenamiento en la nube', 'cloud']] },
  },
  {
    id: 'home',
    title: { en: 'Home server', de: 'Heimserver', es: 'Servidor doméstico' },
    badge: { en: 'Most private', de: 'Am privatesten', es: 'El más privado' },
    tone: 'good',
    note: { en: 'Photos stay in your home; you maintain it and keep a second copy on an external disk.', de: 'Die Fotos bleiben bei dir zu Hause; du pflegst es selbst und hältst eine zweite Kopie auf einer externen Platte.', es: 'Las fotos se quedan en casa; lo mantienes tú y guardas una segunda copia en un disco externo.' },
    path: { en: [['Phone', 'phone'], ['Home Wi-Fi', 'network'], ['Home server', 'server'], ['External disk', 'disk']], de: [['Handy', 'phone'], ['Heim-WLAN', 'network'], ['Heimserver', 'server'], ['Externe Platte', 'disk']], es: [['Móvil', 'phone'], ['Wifi de casa', 'network'], ['Servidor doméstico', 'server'], ['Disco externo', 'disk']] },
  },
];

export const paths: DemoScenario = {
  format: 'paths',
  steps: (ctx) => {
    const lang = langOf(ctx);
    return [
      { wait: 300 },
      { text: L(ctx, 'Es gibt drei typische Wege, deine Fotos zu sichern – der mittlere ist am bequemsten, der letzte am privatesten. Wähle einen aus:\n\n', 'There are three typical ways to back up your photos – the middle one is the easiest, the last one the most private. Choose one:\n\n', 'Hay tres formas típicas de respaldar tus fotos: la del medio es la más cómoda y la última la más privada. Elige una:\n\n') },
      {
        text: hui({
          type: 'paths',
          id: PATHS_ID,
          title: L(ctx, 'Wohin mit den Fotos?', 'Where should the photos go?', '¿Dónde van las fotos?'),
          select: true,
          items: BACKUP_ROUTES.map((r) => ({ id: r.id, title: r.title[lang], badge: { text: r.badge[lang], tone: r.tone }, path: r.path[lang].map(([label, icon]) => ({ label, icon })), note: r.note[lang] })),
        }),
      },
    ];
  },
};

/** which backup route a `[paths:photo-backup] <title>` reply picked (title in any language) */
export function pickedRoute(text: string): 'phone' | 'cloud' | 'home' | undefined {
  const t = text.toLowerCase();
  return BACKUP_ROUTES.find((r) => (['en', 'de', 'es'] as const).some((l) => t.includes(r.title[l].toLowerCase())))?.id;
}

export const BACKUP_STEPS: Record<'phone' | 'cloud' | 'home', Record<DemoLang, { intro: string; steps: [string, string][]; note: string }>> = {
  phone: {
    en: { intro: 'You picked **only on the phone**. That is the quickest, so here is how to make it less risky:', steps: [['Turn on automatic export', 'Once a week, copy new photos to a computer.'], ['Keep one copy somewhere else', 'A USB stick in a drawer is enough.'], ['Check it twice a year', 'Open a few old photos from the copy.']], note: 'If you ever want it fully automatic, the home server route below is the next step.' },
    de: { intro: 'Du hast **nur auf dem Handy** gewählt. Das ist am schnellsten – so wird es weniger riskant:', steps: [['Regelmäßig exportieren', 'Einmal pro Woche neue Fotos auf einen Computer kopieren.'], ['Eine Kopie woanders aufbewahren', 'Ein USB-Stick in der Schublade reicht.'], ['Zweimal im Jahr prüfen', 'Ein paar alte Fotos aus der Kopie öffnen.']], note: 'Wenn du es irgendwann vollautomatisch willst, ist der Heimserver der nächste Schritt.' },
    es: { intro: 'Elegiste **solo en el móvil**. Es lo más rápido; así lo haces menos arriesgado:', steps: [['Exporta con regularidad', 'Una vez por semana, copia las fotos nuevas a un ordenador.'], ['Guarda una copia en otro sitio', 'Un USB en un cajón es suficiente.'], ['Compruébalo dos veces al año', 'Abre unas fotos antiguas de la copia.']], note: 'Si algún día lo quieres totalmente automático, el servidor doméstico es el siguiente paso.' },
  },
  cloud: {
    en: { intro: 'You picked **cloud sync**. The easy way – set it up like this:', steps: [['Pick a provider', 'Compare price per month, storage and where the data is kept.'], ['Switch on photo upload', 'Choose Wi-Fi only, so mobile data is spared.'], ['Add a second copy', 'Download a full archive to a disk once a year.']], note: 'The provider can technically see your photos – pick one you trust.' },
    de: { intro: 'Du hast **Cloud-Sync** gewählt. Der bequeme Weg – so richtest du ihn ein:', steps: [['Anbieter wählen', 'Preis pro Monat, Speicher und Datenstandort vergleichen.'], ['Foto-Upload einschalten', 'Nur im WLAN hochladen, das schont das mobile Datenvolumen.'], ['Zweite Kopie anlegen', 'Einmal im Jahr ein komplettes Archiv auf eine Platte laden.']], note: 'Der Anbieter kann deine Fotos technisch sehen – nimm einen, dem du vertraust.' },
    es: { intro: 'Elegiste **sincronizar con la nube**. El camino cómodo; configúralo así:', steps: [['Elige un proveedor', 'Compara precio mensual, espacio y dónde se guardan los datos.'], ['Activa la subida de fotos', 'Solo con wifi, para no gastar datos móviles.'], ['Añade una segunda copia', 'Descarga un archivo completo a un disco una vez al año.']], note: 'El proveedor técnicamente puede ver tus fotos; elige uno de confianza.' },
  },
  home: {
    en: { intro: 'You picked **home server**. The most private route – here is the plan:', steps: [['Set up the server', 'A small always-on computer with a disk, on your home network.'], ['Let the phone sync to it', 'Photo upload over your home Wi-Fi, and over a private VPN when away.'], ['Mirror to an external disk', 'A nightly copy to a disk you keep elsewhere.']], note: 'Hermes can help with each step once you connect your own server.' },
    de: { intro: 'Du hast **Heimserver** gewählt. Der privateste Weg – so sieht der Plan aus:', steps: [['Server einrichten', 'Ein kleiner Rechner mit Platte, der immer läuft, in deinem Heimnetz.'], ['Handy damit synchronisieren', 'Foto-Upload über das Heim-WLAN, unterwegs über ein privates VPN.'], ['Auf externe Platte spiegeln', 'Nachts eine Kopie auf eine Platte, die du woanders aufbewahrst.']], note: 'Hermes kann dir bei jedem Schritt helfen, sobald du deinen eigenen Server verbunden hast.' },
    es: { intro: 'Elegiste **servidor doméstico**. La ruta más privada; este es el plan:', steps: [['Monta el servidor', 'Un equipo pequeño siempre encendido, con disco, en tu red doméstica.'], ['Sincroniza el móvil con él', 'Subida de fotos por la wifi de casa y, fuera, por una VPN privada.'], ['Replica en un disco externo', 'Una copia nocturna a un disco que guardes en otro lugar.']], note: 'Hermes puede ayudarte en cada paso cuando conectes tu propio servidor.' },
  },
};

// ── product compare → "I'll take this" ─────────────────────────────────────────────────────────────────────────

export const PRODUCTS_ID = 'demo-headphones';
type P = { id: string; name: string; brand: string; price: number; rating: number; reviews: number; scores: [number, number, number]; battery: number; weight: number };
const HEADPHONES: P[] = [
  { id: 'aurel', name: 'Quiet One', brand: 'Aurel Demo', price: 329, rating: 4.7, reviews: 1840, scores: [9.4, 9.0, 8.6], battery: 32, weight: 252 },
  { id: 'fjord', name: 'Calm 5', brand: 'Fjord Demo', price: 279, rating: 4.6, reviews: 1205, scores: [8.8, 8.5, 9.5], battery: 30, weight: 228 },
  { id: 'lumo', name: 'Pulse 2', brand: 'Lumo Demo', price: 199, rating: 4.4, reviews: 2310, scores: [8.3, 8.2, 8.5], battery: 45, weight: 245 },
];
const HP_TEXT = {
  aurel: {
    badge: { en: 'Overall winner', de: 'Gesamtsieger', es: 'Mejor global' },
    verdict: { en: 'Strongest noise cancelling in the field and clear calls. The all-rounder.', de: 'Stärkste Ruhe im Testfeld und klare Anrufe. Der Allrounder.', es: 'La mejor cancelación de ruido del grupo y llamadas nítidas. El todoterreno.' },
    pros: { en: ['Very good noise cancelling', 'Clear calls'], de: ['Sehr gutes ANC', 'Klare Anrufe'], es: ['Muy buena cancelación', 'Llamadas nítidas'] },
    cons: { en: ['Highest price'], de: ['Höchster Preis'], es: ['El más caro'] },
  },
  fjord: {
    badge: { en: 'Most comfortable', de: 'Am bequemsten', es: 'El más cómodo' },
    verdict: { en: 'Featherlight – the nicest choice for long flights.', de: 'Federleicht – für lange Flüge die angenehmste Wahl.', es: 'Ligerísimo: la opción más agradable para vuelos largos.' },
    pros: { en: ['Very light', 'Soft ear cushions'], de: ['Sehr leicht', 'Weiche Polster'], es: ['Muy ligeros', 'Almohadillas suaves'] },
    cons: { en: ['Sound a bit reserved'], de: ['Klang etwas zurückhaltend'], es: ['Sonido algo contenido'] },
  },
  lumo: {
    badge: { en: 'Best value', de: 'Preis-Tipp', es: 'Mejor precio' },
    verdict: { en: 'Almost as good as number two, but a lot cheaper.', de: 'Fast so gut wie Platz zwei, aber deutlich günstiger.', es: 'Casi tan buenos como los segundos, pero mucho más baratos.' },
    pros: { en: ['Huge battery', 'Fair price'], de: ['Riesen-Akku', 'Guter Preis'], es: ['Batería enorme', 'Buen precio'] },
    cons: { en: ['Basic codec only'], de: ['Nur Standard-Codec'], es: ['Solo códec básico'] },
  },
} as const;

export const products: DemoScenario = {
  format: 'products',
  steps: (ctx) => {
    const lang = langOf(ctx);
    const scoreLabels = [L(ctx, 'Geräuschunterdrückung', 'Noise cancelling', 'Cancelación'), L(ctx, 'Klang', 'Sound', 'Sonido'), L(ctx, 'Komfort', 'Comfort', 'Comodidad')];
    return [
      tool.search(L(ctx, 'Kopfhörer Geräuschunterdrückung Vergleich', 'noise cancelling headphones comparison', 'auriculares cancelación de ruido comparativa'), 800),
      { text: L(ctx, 'Drei fiktive Kopfhörer unter 350 €, nach Gesamtnote sortiert. Tipp auf **Vergleichen**, um zwei oder drei nebeneinanderzustellen:\n\n', 'Three fictional headphones under €350, sorted by overall score. Tap **Compare** to put two or three side by side:\n\n', 'Tres auriculares ficticios por menos de 350 €, ordenados por nota global. Toca **Comparar** para ver dos o tres lado a lado:\n\n') },
      {
        text: hui({
          type: 'products',
          id: PRODUCTS_ID,
          title: L(ctx, 'Top 3: Kopfhörer mit Geräuschunterdrückung', 'Top 3: noise cancelling headphones', 'Top 3: auriculares con cancelación de ruido'),
          ranked: true,
          compare: true,
          basis: 'illustrative',
          products: HEADPHONES.map((p) => {
            const tx = HP_TEXT[p.id as keyof typeof HP_TEXT];
            return {
              id: p.id,
              name: p.name,
              brand: p.brand,
              price: p.price,
              currency: 'EUR',
              rating: p.rating,
              reviews: p.reviews,
              badge: tx.badge[lang],
              verdict: tx.verdict[lang],
              scores: p.scores.map((value, i) => ({ label: scoreLabels[i], value })),
              specs: [
                { label: L(ctx, 'Akku', 'Battery', 'Batería'), value: `${p.battery} h` },
                { label: L(ctx, 'Gewicht', 'Weight', 'Peso'), value: `${p.weight} g` },
                { label: 'Multipoint', value: L(ctx, 'Ja', 'Yes', 'Sí') },
              ],
              pros: tx.pros[lang],
              cons: tx.cons[lang],
              offers: [{ merchant: 'Example Shop', price: p.price, url: `https://example.com/shop/${p.id}` }],
            };
          }),
        }),
      },
      { text: L(ctx, '\nWer vor allem lange Akkulaufzeit braucht, greift zum **Pulse 2**. Wenn du dich entschieden hast: **Das nehme ich**.', '\nIf battery life matters most, go for the **Pulse 2**. When you have decided, tap **I\'ll take this**.', '\nSi lo que más importa es la batería, elige los **Pulse 2**. Cuando te decidas, toca **Me quedo con este**.') },
    ];
  },
};

export const productTake: DemoScenario = {
  format: 'text',
  steps: (ctx) => {
    const lang = langOf(ctx);
    const t = ctx.userText.toLowerCase();
    const p = HEADPHONES.find((h) => t.includes(h.name.toLowerCase()) || t.includes(h.id)) ?? HEADPHONES[0];
    const cheapest = Math.min(...HEADPHONES.map((h) => h.price));
    const eur = (n: number) => (lang === 'en' ? `€${n}` : `${n} €`);
    return [
      { reasoning: L(ctx, `Der Nutzer hat ${p.brand} ${p.name} gewählt. Preis, Alternativen und einen sinnvollen nächsten Schritt zusammenfassen – ohne etwas zu kaufen.`, `The user picked ${p.brand} ${p.name}. Summarise price, alternatives and a sensible next step – without buying anything.`, `El usuario eligió ${p.brand} ${p.name}. Resumir precio, alternativas y un siguiente paso razonable, sin comprar nada.`) },
      {
        text:
          L(
            ctx,
            `Gute Wahl: **${p.name}** von ${p.brand} für ${eur(p.price)}. Gekauft habe ich nichts – das bleibt deine Entscheidung. Das habe ich festgehalten:\n\n`,
            `Good choice: the **${p.name}** by ${p.brand} for ${eur(p.price)}. I bought nothing – that stays your call. This is what I noted:\n\n`,
            `Buena elección: los **${p.name}** de ${p.brand} por ${eur(p.price)}. No he comprado nada: eso sigue siendo cosa tuya. Esto es lo que he anotado:\n\n`,
          ) +
          hui({
            type: 'stats',
            items: [
              { label: L(ctx, 'Dein Favorit', 'Your pick', 'Tu elección'), value: p.name },
              { label: L(ctx, 'Preis', 'Price', 'Precio'), value: eur(p.price), delta: p.price === cheapest ? L(ctx, 'günstigster', 'cheapest', 'el más barato') : `+${eur(p.price - cheapest)}`, trend: p.price === cheapest ? 'flat' : 'up' },
              { label: L(ctx, 'Akku', 'Battery', 'Batería'), value: `${p.battery} h` },
            ],
          }),
      },
      {
        text:
          '\n' +
          hui({
            type: 'buttons',
            items: [
              { label: L(ctx, 'Zum Beispiel-Shop', 'Open the example shop', 'Abrir la tienda de ejemplo'), style: 'primary', action: { type: 'open_url', url: `https://example.com/shop/${p.id}` } },
              { label: L(ctx, 'Name kopieren', 'Copy the name', 'Copiar el nombre'), style: 'secondary', action: { type: 'copy', text: `${p.brand} ${p.name}` } },
            ],
          }) +
          '\n' +
          L(ctx, 'Mit deinem eigenen Hermes könnte ich jetzt Preise beobachten oder den Kauf in deine Liste legen. Weiter in der Demo:\n\n', 'With your own Hermes I could now watch the price or put the purchase on your list. Next in the demo:\n\n', 'Con tu propio Hermes podría vigilar el precio o añadir la compra a tu lista. Siguiente en la demo:\n\n') +
          chips(ctx, 'checklist', 'recipe', 'tour'),
      },
    ];
  },
};

// ── recipe with timers ─────────────────────────────────────────────────────────────────────────────────────────

export const recipe: DemoScenario = {
  format: 'recipe',
  steps: (ctx) => {
    const i = li(ctx);
    const s3 = (de: string, en: string, es: string) => [de, en, es][i];
    return [
      { wait: 500 },
      { text: L(ctx, 'Gern – die echte römische Carbonara, ganz ohne Sahne. Tipp bei einem Schritt auf den **Timer**, dann zähle ich die Zeit für dich:\n\n', 'Gladly – the real Roman carbonara, no cream at all. Tap the **timer** on a step and I count the time for you:\n\n', 'Con gusto: la auténtica carbonara romana, sin nata. Toca el **temporizador** de un paso y cuento el tiempo por ti:\n\n') },
      {
        text: hui({
          type: 'recipe',
          id: 'carbonara',
          title: s3('Spaghetti Carbonara', 'Spaghetti carbonara', 'Espaguetis a la carbonara'),
          servings: 2,
          time: { prep: 10, cook: 15, total: 25 },
          ingredients: [
            { qty: 200, unit: 'g', item: s3('Spaghetti', 'spaghetti', 'espaguetis') },
            { qty: 100, unit: 'g', item: s3('Guanciale (oder Pancetta)', 'guanciale (or pancetta)', 'guanciale (o panceta)') },
            { qty: 3, item: s3('Eigelb', 'egg yolks', 'yemas de huevo') },
            { qty: 1, item: s3('Ei', 'whole egg', 'huevo entero') },
            { qty: 50, unit: 'g', item: s3('Pecorino Romano, fein gerieben', 'Pecorino Romano, finely grated', 'Pecorino Romano, rallado fino') },
            { unit: s3('reichlich', 'plenty', 'abundante'), item: s3('schwarzer Pfeffer, frisch gemahlen', 'black pepper, freshly ground', 'pimienta negra recién molida') },
          ],
          steps: [
            { text: s3('Reichlich Wasser aufsetzen und salzen – etwas weniger als sonst, Guanciale und Pecorino sind salzig.', 'Boil plenty of water and salt it – a little less than usual, the guanciale and pecorino are salty.', 'Pon a hervir abundante agua y sálala, algo menos de lo normal: el guanciale y el pecorino ya son salados.') },
            { text: s3('Guanciale in Streifen schneiden und in der Pfanne ohne Öl langsam knusprig auslassen.', 'Cut the guanciale into strips and render it slowly in a dry pan until crisp.', 'Corta el guanciale en tiras y dóralo despacio en una sartén sin aceite hasta que quede crujiente.'), timerSeconds: 300 },
            { text: s3('Spaghetti al dente kochen, eine Tasse Nudelwasser aufheben.', 'Cook the spaghetti al dente and keep a cup of the pasta water.', 'Cuece los espaguetis al dente y reserva una taza del agua de cocción.'), timerSeconds: 540 },
            { text: s3('Eigelb, Ei, Pecorino und Pfeffer zu einer dicken Creme verrühren.', 'Whisk yolks, egg, pecorino and pepper into a thick cream.', 'Bate las yemas, el huevo, el pecorino y la pimienta hasta obtener una crema espesa.') },
            { text: s3('Pfanne vom Herd nehmen, Spaghetti hinein, Eiercreme und einen Schuss Nudelwasser unterschwenken, bis es glänzt.', 'Take the pan off the heat, add the spaghetti, toss in the egg cream and a splash of pasta water until glossy.', 'Retira la sartén del fuego, añade los espaguetis y mezcla la crema de huevo con un chorrito de agua de cocción hasta que brille.') },
          ],
          tips: [
            s3('Die Pfanne darf nicht mehr auf der heißen Platte stehen – sonst stockt das Ei.', 'The pan must be off the hot plate – otherwise the egg scrambles.', 'La sartén no debe seguir sobre el fuego, o el huevo cuaja.'),
            s3('Keine Sahne: die Cremigkeit kommt vom Ei und vom Nudelwasser.', 'No cream: the silkiness comes from the egg and the pasta water.', 'Sin nata: la cremosidad viene del huevo y del agua de cocción.'),
          ],
        }),
      },
      { text: L(ctx, '\nBuon appetito! Mit dem Portionsregler rechne ich die Mengen um. Die Zutaten stehen auch auf deiner Einkaufsliste:\n\n', '\nBuon appetito! The servings stepper rescales the amounts. The ingredients are also on your shopping list:\n\n', '\n¡Buon appetito! Con el selector de raciones recalculo las cantidades. Los ingredientes también están en tu lista de la compra:\n\n') + chips(ctx, 'checklist', 'quiz', 'tour') },
    ];
  },
};

// ── quiz / flashcards ──────────────────────────────────────────────────────────────────────────────────────────

export const QUIZ_ID = 'capitals-quiz';

export const quiz: DemoScenario = {
  format: 'interactive',
  steps: (ctx) => {
    const i = li(ctx);
    const s3 = (de: string, en: string, es: string) => [de, en, es][i];
    return [
      { text: L(ctx, 'Kleines Quiz – drei Fragen. Am Ende kannst du mir dein Ergebnis schicken:\n\n', 'A small quiz – three questions. At the end you can send me your score:\n\n', 'Un quiz corto: tres preguntas. Al final puedes enviarme tu resultado:\n\n') },
      {
        text: hui({
          type: 'quiz',
          id: QUIZ_ID,
          title: s3('Hauptstädte Europas', 'Capitals of Europe', 'Capitales de Europa'),
          questions: [
            { q: s3('Was ist die Hauptstadt von Portugal?', 'What is the capital of Portugal?', '¿Cuál es la capital de Portugal?'), options: s3('Porto|Lissabon|Coimbra', 'Porto|Lisbon|Coimbra', 'Oporto|Lisboa|Coímbra').split('|'), answer: 1, explanation: s3('Lissabon ist seit dem 13. Jahrhundert Hauptstadt.', 'Lisbon has been the capital since the 13th century.', 'Lisboa es la capital desde el siglo XIII.') },
            { q: s3('Welche Stadt liegt an der Donau?', 'Which city lies on the Danube?', '¿Qué ciudad está a orillas del Danubio?'), options: s3('Wien|Prag|Zürich|München', 'Vienna|Prague|Zurich|Munich', 'Viena|Praga|Zúrich|Múnich').split('|'), answer: 0, explanation: s3('Wien, Bratislava, Budapest und Belgrad liegen an der Donau.', 'Vienna, Bratislava, Budapest and Belgrade lie on the Danube.', 'Viena, Bratislava, Budapest y Belgrado están a orillas del Danubio.') },
            { q: s3('Welche dieser Städte sind Hauptstädte? (zwei Antworten)', 'Which of these are capitals? (two answers)', '¿Cuáles de estas ciudades son capitales? (dos respuestas)'), options: s3('Bern|Genf|Oslo|Mailand', 'Bern|Geneva|Oslo|Milan', 'Berna|Ginebra|Oslo|Milán').split('|'), answer: [0, 2], explanation: s3('Bern (Schweiz) und Oslo (Norwegen).', 'Bern (Switzerland) and Oslo (Norway).', 'Berna (Suiza) y Oslo (Noruega).') },
          ],
        }),
      },
    ];
  },
};

export const FLASHCARDS_ID = 'spanish-words';
const WORDS: [es: string, en: string, de: string][] = [
  ['la casa', 'the house', 'das Haus'],
  ['el agua', 'the water', 'das Wasser'],
  ['gracias', 'thank you', 'danke'],
  ['buenos días', 'good morning', 'guten Morgen'],
  ['la cuenta, por favor', 'the bill, please', 'die Rechnung, bitte'],
  ['¿dónde está…?', 'where is…?', 'wo ist …?'],
];

export const flashcards: DemoScenario = {
  format: 'interactive',
  steps: (ctx) => {
    const lang = langOf(ctx);
    return [
      { text: L(ctx, 'Sechs Karten mit spanischen Wörtern. Tipp eine Karte an, um sie umzudrehen:\n\n', 'Six cards with Spanish words. Tap a card to flip it:\n\n', 'Seis tarjetas con palabras en inglés. Toca una tarjeta para darle la vuelta:\n\n') },
      {
        text: hui({
          type: 'flashcards',
          id: FLASHCARDS_ID,
          title: L(ctx, 'Spanisch: Basics', 'Spanish basics', 'Inglés básico'),
          cards: WORDS.map(([esW, en, de]) => (lang === 'es' ? { front: esW, back: en } : { front: esW, back: lang === 'de' ? de : en })),
        }),
      },
      { text: '\n' + L(ctx, 'Der Fortschritt bleibt auf diesem Gerät. Als Nächstes vielleicht ein Quiz?\n\n', 'Your progress stays on this device. A quiz next, maybe?\n\n', 'Tu progreso se queda en este dispositivo. ¿Quizá un quiz ahora?\n\n') + chips(ctx, 'quiz', 'recipe', 'tour') },
    ];
  },
};

// ── explain (reshape me), project status, connect ─────────────────────────────────────────────────────────────

export const explain: DemoScenario = {
  format: 'text',
  steps: (ctx) => {
    const lang = langOf(ctx);
    return [
      { reasoning: L(ctx, 'Wärmepumpe: den Kreislauf in vier Schritten erklären, ohne Fachbegriffe zu überladen, und eine Faustregel zur Effizienz nennen.', 'Heat pump: explain the cycle in four steps without piling on jargon, and give a rule of thumb for efficiency.', 'Bomba de calor: explicar el ciclo en cuatro pasos sin sobrecargar de jerga y dar una regla práctica de eficiencia.') },
      tool.search(L(ctx, 'Wärmepumpe Funktionsprinzip Leistungszahl', 'heat pump working principle COP', 'bomba de calor principio de funcionamiento COP'), 900),
      { text: factsText('explain', lang) },
      { text: '\n\n' + L(ctx, 'Darunter findest du Chips wie **Kürzer**, **Als Tabelle** oder **Übersetzen**. Probier sie aus – ich forme diese Antwort jeweils um.', 'Below you will find chips like **Shorter**, **As a table** or **Translate**. Try them – I reshape this answer each time.', 'Debajo verás chips como **Más corto**, **Como tabla** o **Traducir**. Pruébalos: reformo esta respuesta cada vez.') },
    ];
  },
};

export const werkzeuge: DemoScenario = {
  format: 'text',
  steps: (ctx) => [
    { reasoning: L(ctx, 'Der Nutzer will den Stand des Projekts. Ich prüfe System, Changelog, Notizen und Tests.', 'The user wants the project status. I check the system, the changelog, the notes and the tests.', 'El usuario quiere el estado del proyecto. Reviso el sistema, el registro de cambios, las notas y las pruebas.') },
    { text: L(ctx, 'Ich prüfe das in mehreren Schritten.', 'I check this in several steps.', 'Lo reviso en varios pasos.') },
    tool.terminal('uname -a && uptime', 700),
    tool.search(L(ctx, 'Hermes Agent Release Notes', 'Hermes Agent release notes', 'Hermes Agent notas de la versión'), 1400),
    { status: { kind: 'lifecycle', text: L(ctx, 'Warte auf Provider (Wiederholung 1/3) …', 'Waiting for provider (retry 1/3) …', 'Esperando al proveedor (reintento 1/3) …') } },
    { wait: 900 },
    tool.file('~/notes/project.md', 500),
    tool.browser('https://example.com/changelog', 1100),
    tool.terminal('pytest -q tests/test_api.py', 2500),
    { reasoning: L(ctx, ' Alle Daten sind da, ich fasse zusammen.', ' I have all the data, time to summarise.', ' Tengo todos los datos, ahora resumo.') },
    { status: { kind: 'compacted', text: L(ctx, 'Kontext komprimiert (48k → 12k Tokens)', 'Context compacted (48k → 12k tokens)', 'Contexto comprimido (48k → 12k tokens)') } },
    { text: '\n\n' + factsText('status', langOf(ctx)) },
    { text: '\n\n' + L(ctx, 'Tipp: Tippe auf **Werkzeuge & Ablauf**, um die Schritte oben aufzuklappen.', 'Tip: tap **Tools & activity** to unfold the steps above.', 'Consejo: toca **Herramientas y actividad** para desplegar los pasos de arriba.') },
  ],
};

/** long answer that takes a while to stream: the stage for the Stop button and the way out to a real Hermes */
export const connect: DemoScenario = {
  format: 'text',
  steps: (ctx) => {
    const lang = langOf(ctx);
    return [
      { reasoning: L(ctx, 'Der Nutzer will sein eigenes Hermes verbinden. Ich erkläre den Weg Schritt für Schritt: Server, Erreichbarkeit, Kopplung, Einwilligung. Dabei nichts über bestimmte Hosts oder Adressen annehmen, nur den allgemeinen Ablauf beschreiben und auf die Einrichtungshilfe in der App verweisen.', 'The user wants to connect their own Hermes. I explain the way step by step: server, reachability, pairing, consent. I assume nothing about specific hosts or addresses, describe only the general flow and point to the in-app setup help.', 'El usuario quiere conectar su propio Hermes. Explico el camino paso a paso: servidor, accesibilidad, emparejamiento, consentimiento. No asumo nada sobre hosts o direcciones concretos, solo describo el flujo general y remito a la ayuda de configuración de la app.') },
      tool.search(L(ctx, 'Hermes Agent Kopplung Einrichtung', 'Hermes Agent pairing setup', 'Hermes Agent emparejamiento configuración'), 1200),
      tool.file('docs/setup.md', 900),
      { text: factsText('connect', lang) },
      { text: '\n\n' + L(ctx, 'Zum Ausprobieren: Tippe, solange diese Antwort läuft, auf **Stopp** – dann bleibt sie genau dort stehen.', 'To try it: tap **Stop** while this answer is running – it stays exactly where it stopped.', 'Para probarlo: toca **Detener** mientras esta respuesta se está generando; se queda justo donde la cortaste.') },
    ];
  },
};

export const CORE: Record<string, DemoScenario> = {
  tour,
  plain,
  needsNet,
  approval,
  cacheList,
  checklist,
  choice,
  trip,
  reiseChoice,
  reiseDecision,
  paths,
  products,
  productTake,
  recipe,
  quiz,
  flashcards,
  explain,
  werkzeuge,
  connect,
};
