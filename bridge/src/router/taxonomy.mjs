// Presentation taxonomy shared by every router backend, the prompt, the hint and the eval.
// RouteFormat / RouteDecision mirror app/src/protocol/types.ts (SPEC "UI Router").

/** @typedef {'text'|'table'|'chart'|'stats'|'compare'|'steps'|'timeline'|'form'|'diagram'|'calculator'|'map'|'interactive'|'image'|'choice'|'checklist'|'recipe'|'quiz'|'calc'|'timer'|'translation'|'poll'|'agenda'|'weather'|'decision'|'rank'|'scale'|'places'|'products'|'guide'|'workout'|'studyplan'|'vocab'|'mindmap'|'paths'|'blocks'|'diff'|'terminal'|'changes'} RouteFormat */
/**
 * @typedef {object} RouteDecision
 * @property {RouteFormat} format
 * @property {string} [component]
 * @property {number} confidence
 * @property {string} reason
 * @property {string} model
 * @property {number} ms
 */

/** @type {readonly RouteFormat[]} */
export const ROUTE_FORMATS = Object.freeze([
  'text', 'table', 'chart', 'stats', 'compare', 'steps', 'timeline', 'form',
  'diagram', 'calculator', 'map', 'interactive', 'image',
  // v2 (native interactive nodes)
  'choice', 'checklist', 'recipe', 'quiz', 'calc', 'timer',
  // v3 (native modules, docs/SPEC-modules-v3.md)
  'translation', 'poll', 'agenda', 'weather', 'decision', 'rank', 'scale',
  // v4 (native modules, docs/SPEC-modules-v4.md)
  'places', 'products', 'guide', 'workout', 'studyplan', 'vocab', 'mindmap',
  // v5 (native answer modules)
  'paths', 'blocks',
  // v5 coding (display-only answer nodes, hermes-skill/hermes-ui/references/coding.md)
  'diff', 'terminal', 'changes',
]);

/** Renderer per format (SPEC mapping). */
export const RENDERER = Object.freeze({
  text: 'markdown',
  table: 'hui', chart: 'hui', stats: 'hui', compare: 'hui', steps: 'hui', timeline: 'hui', form: 'hui',
  image: 'hui',
  // v2: map is the native `map` node now (built-in Leaflet template), not model HTML.
  map: 'hui', choice: 'hui', checklist: 'hui', recipe: 'hui', quiz: 'hui', calc: 'hui', timer: 'hui',
  translation: 'hui', poll: 'hui', agenda: 'hui', weather: 'hui', decision: 'hui', rank: 'hui', scale: 'hui',
  places: 'hui', products: 'hui', guide: 'hui', workout: 'hui', studyplan: 'hui', vocab: 'hui', mindmap: 'hui',
  paths: 'hui', blocks: 'hui', diff: 'hui', terminal: 'hui', changes: 'hui',
  diagram: 'hui-html', calculator: 'hui-html', interactive: 'hui-html',
});

/**
 * Definitions used verbatim in the router prompt (and as Jev criteria).
 * Keep them short, mutually exclusive, and phrased as "choose when".
 */
export const DEFINITIONS = Object.freeze({
  text: 'Plain Markdown prose. Direct facts, short answers, explanations without structured data, opinions, advice, writing/editing, long translations (letters, documents), code and programming help without running commands or showing changes (writing, explaining, reviewing or debugging code, snippets, regex, SQL, how a command works), chit-chat, personal or emotional topics, agent actions (reminders, messages, files), and clarifying questions when needed data is missing.',
  table: 'Exact values or records in rows x columns: lists of items with several attributes, specs, schedules with many fields, rankings that need exact numbers. Use when the user wants to look things up, not see a shape.',
  chart: 'Numeric data where the shape matters: trend over time (line/area), magnitude comparison across categories (bar), ranking (hbar), parts of one total (pie/donut), composition per category (stacked), correlation of two numbers (scatter), multi-criteria profile of 1-3 entities (radar), one KPI against a target (gauge), activity per day (heatmap), money/budget flow with increases and decreases (waterfall).',
  stats: 'A few (2-6) headline numbers / KPIs with optional change, e.g. a status overview, dashboard summary, current figures of one subject.',
  compare: '2-4 options side by side with qualitative features, pros/cons, trade-offs and possibly a recommendation: concepts, plans, technologies, services, places, life choices. Named buyable products (devices, appliances, cars) are products (component "compare").',
  steps: 'A short ordered reference list of a procedure: software installation, setup, configuration, administrative how-to (apply for an ID card), troubleshooting sequence. Hands-on procedures the user performs while reading (repair, assembly, replacing a part) are guide; NOT cooking recipes (recipe).',
  timeline: 'Events anchored in dates/times in chronological order: history, biography, project milestones, a history or project timeline. A day or week plan with clock times is agenda.',
  form: 'The assistant needs several (3+) structured inputs from the user before it can act (booking details, preferences for a plan, a questionnaire). Not for one decision or one simple clarifying question (choice).',
  diagram: 'Structure or flow drawn as boxes and arrows: flowchart, decision tree, process, architecture, sequence, org chart, state machine, cycle. A mind map or concept overview is mindmap; the parts of a setup at a glance (boxes, no arrows) is blocks.',
  calculator: 'ONLY a clearly custom or visual calculator-like tool that the native calc cannot express (animated or drawn visualisation of the result, bespoke graphics). Ordinary calculators, converters and what-if sliders are calc.',
  map: 'Real geographic places shown on a native map: locations, points of interest, trip plans, itineraries and routes where geography matters (also "plan a day/weekend in <city>").',
  interactive: 'A custom interactive widget that is neither a calculator nor a chart: simulation, explorable explanation with controls, game, 3D model. Scatter plots are chart (scatter). NOT quizzes (quiz).',
  image: 'The user wants a picture: generate/draw an image or illustration, or show photos of something.',
  choice: 'The assistant needs ONE decision or preference from the user and can offer 2-6 concrete options: "help me decide", "I cannot choose", picking a gift/destination/dish, or proposing appointment times (component "slots") or a yes/no proposal (component "confirm"). Only the asking user decides: when several people vote (poll), options are weighed by criteria (decision), items are ordered (rank) or a rating is asked (scale) use those. Not when the user already names the options to compare (compare) and not for 3+ inputs (form).',
  checklist: 'A list the user ticks off or keeps: shopping list, packing list, to-do list, ingredients to buy. Items are short; quantities optional.',
  recipe: 'A cooking or baking recipe (ingredients with quantities, steps, servings, cooking times). Not a generic how-to (steps) and not a fact about food (text).',
  quiz: 'Learning and self-testing: the user wants to be quizzed (multiple-choice quiz) or practise definitions/facts with flashcards. Language vocabulary drills are vocab.',
  calc: 'A small native calculator with adjustable inputs and computed outputs: loan or savings rate, tip and bill split, VAT or discount, BMI/calorie needs, unit conversion, what-if with sliders. Preferred over the custom calculator format.',
  translation: 'Translating a short phrase or sentence into 1-4 languages, or \"how do you say / what does X mean in <language>\" (Übersetze, translate, ¿cómo se dice, traduce). Side-by-side cards with pronunciation. Long texts, letters and documents to translate or rewrite are text.',
  poll: 'A vote among several people (family, friends, team, colleagues): "Abstimmung", "Umfrage unter uns", "we cannot agree where to eat", a poll, una votación familiar. Not when only the asking user must decide (choice) and not a questionnaire for the assistant (form).',
  agenda: 'Planning a day or week with clock times as an editable schedule: "plane meinen Samstag", "Tagesplan mit Terminen", "organize my day", planificar mi día. Not history or milestones (timeline) and not a place itinerary (map).',
  weather: 'Weather forecast or current conditions for a place or time ("wie wird das Wetter morgen in Ulm", "do I need an umbrella", "Regen am Wochenende?"). The assistant must fetch real weather data first. Not climate facts (text).',
  decision: 'A weighted multi-criteria decision between 2-6 options the user names or describes ("Entscheidungsmatrix", "Pro/Contra mit Gewichtung", "welche Wohnung/welches Auto nach Preis, Lage und Größe", decision matrix). With only qualitative pros/cons and no weighting wish: compare.',
  rank: 'The user should put 2-10 items into their own preference or priority order ("sortiere meine Prioritäten", "bring in order what matters", "ordena por importancia"). Not a ranking of facts (table/chart hbar).',
  scale: 'ONE rating or intensity question answered on a scale ("wie gut war ...", "bewerte auf einer Skala von 1 bis 5", "rate from 1 to 10 how much"). Several ratings are a form.',
  timer: 'A timer, stopwatch or countdown: "stell einen Timer auf 7 Minuten", "set a 25 minute timer", "Countdown bis zum Anpfiff", "Erinnere mich in 10 Minuten" (a reminder after a DURATION is a timer), several timers at once. Reminders at a clock time or date and alarms ("um 8 Uhr", "morgen") are text (the app proposes an action button).',
  places: 'Real local places the assistant must look up with tools: restaurants, cafés, shops, pharmacies, hotels, gyms near a location or "in der Nähe", with ratings, opening hours, phone, route ("Restaurants in der Nähe", "Café in Ulm mit WLAN", "Öffnungszeiten von ...", "cafetería cerca de mí"). Sights, itineraries and trip plans on a map are map; one short fact about one place is text.',
  products: 'Shopping help for concrete products: "welche Kopfhörer soll ich kaufen", "bestes Handy unter 500 €", "Vergleich von 4 Staubsaugern mit Preisen", "best laptop under 800". Prices, ratings and shops come from web search; show cards with price, rating, specs, pros/cons. Named buyable products compared ("iPhone 17 vs Pixel 11", "Sony XM6 vs Bose QC") are products with component "compare".',
  guide: 'A hands-on procedure the user performs while reading and may get stuck on: repair, replacement, assembly, device setup, "Schritt für Schritt", "Anleitung", "wie wechsle ich einen Reifen", "paso a paso". One step at a time with tips, warnings and optional timers. Software installation lists and administrative steps are steps; cooking is recipe.',
  workout: 'A training session or workout plan with exercises, sets, reps and rest: "Trainingsplan für Brust und Schultern", "Workout für zuhause", "HIIT in 20 Minuten", "rutina de piernas". Questions about fitness theory or nutrition are text.',
  studyplan: 'A multi-week or multi-day learning plan with daily tasks: "Lernplan für die Matheklausur", "Spanisch in 4 Wochen lernen", "study plan for the exam", "plan de estudio". Not a one-off quiz (quiz) and not a single-day schedule (agenda).',
  vocab: 'A language vocabulary drill: "Vokabeln für Italienisch", "vocabulario para el viaje", "teach me 20 Spanish words about food" (cards, multiple choice, typing). One phrase to translate is translation; general knowledge flashcards are quiz.',
  mindmap: 'A mind map / concept map as a pan-and-zoom tree: "Mindmap zur Photosynthese", "Übersicht der Zusammenhänge", "mapa mental", organise a topic into branches. A process or architecture with arrows is diagram.',
  paths: 'Ways / variants / architectures (2-6) that differ in how something flows or where it lives, each a chain "A → B → C" with a verdict: where files live (Mac vs VM disk vs shared folder), how a request travels, Docker vs VM vs bare metal, backup / sync / deploy routes. Pros/cons per option: compare.',
  blocks: 'An architecture / setup at a glance without arrows: 1-3 variants or tiers side by side, each a few boxes (parts) and an optional shared base layer: "wie unterscheiden sich OrbStack und Parallels im Aufbau" (one shared kernel vs one kernel per VM), "aus welchen Bausteinen besteht mein Setup", "setup at a glance", frontend / backend / database. A flow with arrows or a sequence is diagram; ways with a verdict are paths.',
  diff: 'The user wants to SEE a code change: a patch, a git diff, "what would change in this file", a before/after of code or config, reviewing or proposing an edit as lines added / removed (also a ```diff fence). Writing a new snippet without a change, or explaining code, is text; the files of a whole agent turn are changes.',
  terminal: 'The user asks to RUN a shell command, the tests or a build and to see its output, or asks for the output / log of a command ("run the tests", "zeig mir die Ausgabe von npm test", "ejecuta git status"). The output must come from really running it. How a command works, or a command for the user to run themselves, is text.',
  changes: 'An overview of the SEVERAL files changed after an agent coding task: "what did you change", "welche Dateien hast du geändert", "git status", "qué archivos cambiaste" (files with +/- counts, tap opens the diff). One file\'s code change is diff; running a command is terminal.',
});

/** Allowed component hints per format. `null` = no component for this format. */
export const COMPONENTS = Object.freeze({
  text: null,
  table: null,
  chart: ['line', 'bar', 'area', 'pie', 'donut', 'hbar', 'stacked', 'scatter', 'radar', 'gauge', 'heatmap', 'waterfall'],
  stats: null,
  compare: null,
  steps: null,
  timeline: null,
  form: null,
  diagram: ['flowchart', 'sequence', 'architecture', 'tree', 'cycle', 'state', 'org'],
  calculator: null, // free-form short slug allowed, e.g. "loan"
  map: ['markers', 'route'],
  interactive: ['simulation', 'game', 'explorer', '3d'],
  image: ['generate', 'photo'],
  choice: ['slots', 'confirm', 'multiple'],
  checklist: ['shopping', 'packing', 'todo'],
  recipe: null,
  quiz: ['quiz', 'flashcards'],
  calc: null, // free-form short slug allowed, e.g. "loan", "tip", "vat"
  timer: null,
  translation: null,
  poll: null,
  agenda: null,
  weather: null,
  decision: null,
  rank: null,
  scale: null,
  places: null,
  products: ['compare'],
  guide: null,
  workout: null,
  studyplan: null,
  vocab: null,
  mindmap: null,
  paths: null,
  blocks: null,
  diff: null,
  terminal: null,
  changes: null,
});

const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** @param {unknown} f @returns {f is RouteFormat} */
export function isRouteFormat(f) {
  return typeof f === 'string' && /** @type {readonly string[]} */ (ROUTE_FORMATS).includes(f);
}

/**
 * Normalise a component hint for a format: drop unknown values instead of failing the turn.
 * @param {RouteFormat} format @param {unknown} component @returns {string|undefined}
 */
export function normalizeComponent(format, component) {
  if (typeof component !== 'string') return undefined;
  const c = component.trim().toLowerCase();
  if (!c || c === 'none' || c === 'null') return undefined;
  const allowed = COMPONENTS[format];
  if (format === 'calculator' || format === 'calc') return SLUG.test(c) ? c : undefined;
  if (!allowed) return undefined;
  if (allowed.includes(c)) return c;
  // Common synonyms a model may produce.
  const syn = {
    chart: { pie_chart: 'pie', 'pie-chart': 'pie', doughnut: 'donut', bar_chart: 'bar', 'bar-chart': 'bar', column: 'bar', histogram: 'bar', horizontal: 'hbar', 'horizontal-bar': 'hbar', ranking: 'hbar', stack: 'stacked', 'stacked-bar': 'stacked', stacked_bar: 'stacked', scatterplot: 'scatter', scatter_plot: 'scatter', 'spider': 'radar', netz: 'radar', speedometer: 'gauge', tacho: 'gauge', calendar: 'heatmap', 'heat-map': 'heatmap', 'water-fall': 'waterfall', line_chart: 'line', 'line-chart': 'line', trend: 'line' },
    diagram: { flow: 'flowchart', 'flow-chart': 'flowchart', process: 'flowchart', 'decision-tree': 'tree', organigram: 'org', 'org-chart': 'org' },
    map: { route_map: 'route', itinerary: 'route', marker: 'markers', places: 'markers' },
    checklist: { shopping_list: 'shopping', einkauf: 'shopping', packing_list: 'packing', pack: 'packing', 'to-do': 'todo', todos: 'todo', tasks: 'todo' },
    quiz: { flashcard: 'flashcards', cards: 'flashcards', vocab: 'flashcards', multiple_choice: 'quiz', mc: 'quiz' },
    interactive: { scatter: undefined, simulate: 'simulation', physics: 'simulation', '3d-model': '3d' },
    products: { comparison: 'compare', vs: 'compare', versus: 'compare', table: 'compare' },
    choice: { slot: 'slots', time: 'slots', appointment: 'slots', yesno: 'confirm', 'yes-no': 'confirm', multi: 'multiple', multiselect: 'multiple' },
  };
  const s = /** @type {Record<string, Record<string,string>>} */ (syn)[format]?.[c];
  return s;
}

/**
 * Validate and normalise a raw decision object from any backend. Throws on invalid format.
 * @param {any} raw @param {{model: string, ms: number}} meta @returns {RouteDecision}
 */
export function normalizeDecision(raw, meta) {
  if (!raw || typeof raw !== 'object') throw new Error('decision is not an object');
  const format = typeof raw.format === 'string' ? raw.format.trim().toLowerCase() : raw.format;
  if (!isRouteFormat(format)) throw new Error(`invalid format: ${String(raw.format).slice(0, 40)}`);
  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.min(1, Math.max(0, confidence));
  const reason = typeof raw.reason === 'string' ? raw.reason.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
  /** @type {RouteDecision} */
  const d = { format, confidence: Math.round(confidence * 100) / 100, reason, model: meta.model, ms: Math.round(meta.ms) };
  const component = normalizeComponent(format, raw.component);
  if (component) d.component = component;
  // A diagram/mindmap hint from older prompts or models is the native mindmap since v4.
  if (format === 'diagram' && typeof raw.component === 'string' && /mind[ _-]?map/i.test(raw.component)) { d.format = 'mindmap'; delete d.component; }
  // Scatter plots are a native chart kind since v3 (were interactive:scatter).
  if (format === 'interactive' && typeof raw.component === 'string' && /scatter|streu/i.test(raw.component)) { d.format = 'chart'; d.component = 'scatter'; }
  return d;
}

/** Neutral decision used when nothing could be decided (no hint is injected for it). */
export function neutralDecision(model, ms, reason) {
  return { format: /** @type {RouteFormat} */ ('text'), confidence: 0, reason, model, ms: Math.round(ms) };
}
