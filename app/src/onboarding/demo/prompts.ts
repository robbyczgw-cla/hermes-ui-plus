// The sample requests of the offline demo, one text per chat language. They are the single source for
//  - the suggestion chips at the end of the scripted answers and the tour,
//  - the start-screen starters that the demo cards send (onboarding/starters.ts uses the same texts via i18n),
//  - the routing tests (demo.test.ts: every prompt in every language must land in its scenario).
// Pure data. The router (scenarios.ts `pickScenario`) knows the keywords of these texts in all three languages.
import type { DemoLang } from './kit.ts';

export type DemoPrompt = Record<DemoLang, string>;

export const PROMPTS = {
  tour: { en: 'What can you do?', de: 'Was kannst du alles?', es: '¿Qué sabes hacer?' },
  chart: { en: 'Show me a chart of the temperature trend.', de: 'Zeig mir ein Diagramm zum Temperaturverlauf.', es: 'Muéstrame un gráfico de la evolución de la temperatura.' },
  approval: { en: 'Clean up the cache, with approval', de: 'Räum den Cache auf, mit Freigabe', es: 'Limpia la caché, con aprobación' },
  cacheList: { en: 'Show me what is in the cache', de: 'Zeig mir, was im Cache liegt', es: 'Muéstrame qué hay en la caché' },
  checklist: { en: 'Make me a shopping list for the weekend', de: 'Mach mir eine Einkaufsliste fürs Wochenende', es: 'Hazme una lista de la compra para el fin de semana' },
  choice: { en: 'Help me pick a destination for a city break', de: 'Hilf mir, ein Ziel für einen Städtetrip zu wählen', es: 'Ayúdame a elegir un destino para una escapada' },
  tripRome: { en: 'Plan a relaxed weekend in Rome, with a schedule and a map.', de: 'Plane mir ein entspanntes Wochenende in Rom, mit Zeitplan und Karte.', es: 'Planéame un fin de semana tranquilo en Roma, con horario y mapa.' },
  tripLisbon: { en: 'Plan a weekend in Lisbon', de: 'Plane mir ein Wochenende in Lissabon', es: 'Planéame un fin de semana en Lisboa' },
  tripVienna: { en: 'Plan a weekend in Vienna', de: 'Plane mir ein Wochenende in Wien', es: 'Planéame un fin de semana en Viena' },
  tripCopenhagen: { en: 'Plan a weekend in Copenhagen', de: 'Plane mir ein Wochenende in Kopenhagen', es: 'Planéame un fin de semana en Copenhague' },
  travel: {
    en: 'Help me decide: train or plane from Hamburg to Munich? Ask me first what matters to me.',
    de: 'Hilf mir zu entscheiden: Bahn oder Flug von Hamburg nach München? Frag mich zuerst, was mir wichtig ist.',
    es: 'Ayúdame a decidir: ¿tren o avión de Hamburgo a Múnich? Pregúntame primero qué es importante para mí.',
  },
  paths: { en: 'Show me ways to back up my photos', de: 'Zeig mir Wege, meine Fotos zu sichern', es: 'Muéstrame formas de hacer copia de mis fotos' },
  products: { en: 'Compare noise cancelling headphones', de: 'Vergleiche Kopfhörer mit Geräuschunterdrückung', es: 'Compara auriculares con cancelación de ruido' },
  recipe: { en: 'Cook spaghetti carbonara with me – step by step, with timers.', de: 'Koch mit mir Spaghetti Carbonara – Schritt für Schritt, mit Timern.', es: 'Cocina conmigo espaguetis a la carbonara, paso a paso y con temporizadores.' },
  quiz: { en: 'Quiz me on European capitals', de: 'Teste mich mit einem Quiz zu Hauptstädten', es: 'Hazme un quiz de capitales europeas' },
  flashcards: { en: 'Make me flashcards to learn Spanish words', de: 'Mach mir Karteikarten zum Spanischlernen', es: 'Hazme tarjetas para aprender palabras en inglés' },
  explain: { en: 'Explain step by step how a heat pump works.', de: 'Erkläre mir Schritt für Schritt, wie eine Wärmepumpe funktioniert.', es: 'Explícame paso a paso cómo funciona una bomba de calor.' },
  prices: {
    en: 'Show me how household electricity prices in Germany have developed since 2015 – as a chart.',
    de: 'Zeig mir, wie sich der Strompreis für Haushalte in Deutschland seit 2015 entwickelt hat – als Diagramm.',
    es: 'Muéstrame cómo ha evolucionado el precio de la luz para hogares en Alemania desde 2015, en un gráfico.',
  },
  webResearch: {
    en: 'Research jet lag tips for a flight east, with sources.',
    de: 'Recherchiere Jetlag-Tipps für einen Flug nach Osten, mit Quellen.',
    es: 'Investiga consejos contra el jet lag para un vuelo hacia el este, con fuentes.',
  },
  status: { en: 'What is the project status?', de: 'Wie ist der Stand des Projekts?', es: '¿Cuál es el estado del proyecto?' },
  mixed: { en: 'Create a mixed report for this week.', de: 'Erstelle einen gemischten Bericht für diese Woche.', es: 'Crea un informe mixto de esta semana.' },
  compare: { en: 'Compare two plans.', de: 'Mach einen Vergleich von zwei Tarifen.', es: 'Compara dos tarifas.' },
  loan: { en: 'Build me a loan calculator.', de: 'Bau mir einen Kreditrechner.', es: 'Constrúyeme una calculadora de préstamos.' },
  multi: {
    en: 'Should I rent a van or hire a moving company for my move?',
    de: 'Soll ich für meinen Umzug einen Transporter mieten oder eine Umzugsfirma nehmen?',
    es: '¿Alquilo una furgoneta o contrato una empresa de mudanzas para mi mudanza?',
  },
  connect: { en: 'How do I connect my own Hermes?', de: 'Wie verbinde ich mein eigenes Hermes?', es: '¿Cómo conecto mi propio Hermes?' },
  liveList: { en: "Keep a shopping list for Saturday's barbecue", de: 'Führ mir eine Einkaufsliste fürs Grillen am Samstag', es: 'Llévame una lista de la compra para la barbacoa del sábado' },
  liveAdd: { en: 'Add charcoal and halloumi, we already have tomatoes', de: 'Setz noch Grillkohle und Halloumi drauf, Tomaten haben wir schon', es: 'Añade carbón y halloumi, tomates ya tenemos' },
  memoryWhat: { en: 'What do you remember about me?', de: 'Was weißt du über mich?', es: '¿Qué recuerdas de mí?' },
  // the default bot's Bot Chat starters (i18n bots.chat.starterLast)
  lastDone: { en: 'What did you last do for me?', de: 'Was hast du zuletzt für mich erledigt?', es: '¿Qué hiciste por mí la última vez?' },
  memoryForget: { en: 'Forget that I dislike coriander', de: 'Vergiss, dass ich keinen Koriander mag', es: 'Olvida que no me gusta el cilantro' },
  skillsList: { en: 'Which skills do you have?', de: 'Welche Skills hast du?', es: '¿Qué skills tienes?' },
  skillDoc: { en: 'Load the skill meal-planner and explain it', de: 'Lade den Skill meal-planner und erkläre ihn', es: 'Carga el skill meal-planner y explícalo' },
} as const satisfies Record<string, DemoPrompt>;

export type PromptKey = keyof typeof PROMPTS;

/** text of a sample request in the chat language */
export const prompt = (key: PromptKey, lang: DemoLang = 'de'): string => PROMPTS[key][lang];

/** the scenario each sample request has to reach (checked by demo.test.ts for every language) */
export const PROMPT_SCENARIO: Record<PromptKey, string> = {
  tour: 'tour',
  chart: 'chart',
  approval: 'approval',
  cacheList: 'cacheList',
  checklist: 'checklist',
  choice: 'choice',
  tripRome: 'trip',
  tripLisbon: 'trip',
  tripVienna: 'trip',
  tripCopenhagen: 'trip',
  travel: 'reiseChoice',
  paths: 'paths',
  products: 'products',
  recipe: 'recipe',
  quiz: 'quiz',
  flashcards: 'flashcards',
  explain: 'explain',
  prices: 'charts3',
  webResearch: 'webSuche',
  status: 'werkzeuge',
  mixed: 'mixed',
  compare: 'compare',
  loan: 'loan',
  multi: 'multi',
  connect: 'connect',
  liveList: 'liveList',
  liveAdd: 'liveAdd',
  memoryWhat: 'memoryWhat',
  lastDone: 'lastDone',
  memoryForget: 'memoryForget',
  skillsList: 'skillsList',
  skillDoc: 'skillDoc',
};
