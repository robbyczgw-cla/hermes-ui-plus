// Scoring for the skill-language eval: is the visible text of the cards in the prompt's language, and does an
// underspecified request get a default card instead of a question in prose?
// No model, no dependencies. Short card strings ("Technik", "Carbonara für 4") have few function words, so besides
// function words the lexicons hold the everyday words cards are made of (aisles, packing groups, units, quiz and
// plan words). A word counts for every language whose lexicon has it; a word in the target lexicon never counts as
// foreign. Loanwords shared by these languages are neutral. The verdicts are a first pass: flagged strings are
// reviewed by hand in the report.

/** @typedef {'de'|'en'|'es'|'fr'} Lang */

const LEX = {
  de: `der den dem des das und oder für mit ohne von vom zum zur im ist sind nicht kein keine ein eine einen einem einer bei auf aus nach vor über unter bis je
    an stück stk packung packungen flasche flaschen etwa minuten stunde stunden tage woche wochen schritt schritte fertig weiter senden speichern abbrechen
    ja nein heute morgen abend abends mittags vormittags nachmittags frühstück mittagessen abendessen einkauf einkaufsliste liste packliste kleidung technik
    dokumente kühlregal kühlware backwaren trockenware getränke haushalt obst gemüse eier ei salz pfeffer zucker mehl milch käse brot zwiebel zwiebeln
    knoblauch nudeln sahne speck zug flugzeug reise fahrt flug dauer kosten preis günstig teuer bequem zeit personen portionen zutaten zubereitung frage fragen
    antwort richtig falsch hauptstadt hauptstädte welche welcher welches wie wo wann warum ich du dein deine mein meine wähle auswahl ladegerät kopfhörer
    zahnbürste reisepass ausweis schuhe jacke hemd socken unterwäsche sonnencreme regenschirm handtuch tasche koffer geld karte bahn erledigt aufgabe aufgaben
    übung übungen sätze wiederholungen aufwärmen dehnen rechnung trinkgeld teilen freunde samstag sonntag einkaufen kochen essen spülen putzen vorbereiten
    hygiene_de kosmetik waschbeutel badesachen sonstiges frisch gerieben geschnitten gehackt beutel glas becher dose_de kartoffel kartoffeln braten
    sonntagsbraten vorschlag freizeit geburtstag geburtstagsparty oberteile bargeld ladekabel medikamente krankenversicherungskarte`,
  en: `the and or for with without of to in on at is are not your you my me this that these those what which how when where why minutes hour hours day days
    week weeks step steps done next send save cancel yes no today tomorrow morning evening night breakfast lunch dinner shopping grocery groceries list packing
    clothes clothing electronics tech documents toiletries produce dairy bakery pantry drinks beverages household fruit vegetables eggs egg salt pepper sugar
    flour butter milk cheese bread onion onions garlic noodles cream bacon plane flight trip travel duration cost price cheap expensive comfortable time people
    servings ingredients question questions answer correct wrong capital capitals choose pick charger headphones toothbrush passport shoes jacket pants trousers
    shirt socks underwear sunscreen umbrella towel bag backpack suitcase money card task tasks workout exercise exercises reps bodyweight stretch each bill tip split
    friends saturday sunday mon tue wed thu fri sat sun cooking prep fresh grated chopped sliced pack packs bottle can jar pan pain few other misc rest_en`,
  es: `el la los las y o para con sin de del al en es son no un una unos unas tu tus mi mis qué cuál cuáles cómo cuándo dónde por minutos hora horas día días
    semana semanas paso pasos listo siguiente enviar guardar cancelar sí hoy mañana tarde noche desayuno almuerzo comida cena compra lista maleta ropa
    electrónica documentos documentación aseo higiene frutas verduras huevos huevo sal pimienta azúcar harina mantequilla leche queso pan cebolla cebollas ajo
    nata tren avión vuelo viaje duración coste costo precio barato caro rápido cómodo tiempo personas raciones ingredientes pregunta preguntas respuesta
    correcto correcta incorrecto capital capitales elige cargador auriculares cepillo pasaporte zapatos chaqueta pantalones camisa calcetines protector
    toalla bolsa mochila dinero tarjeta tarea tareas entrenamiento ejercicio ejercicios series repeticiones descanso calentamiento estiramiento cuenta propina
    dividir amigos sábado domingo arroz aceite tomate pimiento gambas paquete botella lata bebidas despensa lácteos panadería otros fresco rallado picado`,
  fr: `le la les et ou pour avec sans de du des au aux en est sont ne pas un une je tu il elle nous vous si ton ta tes mon ma mes votre vos on week quel quelle quels quelles comment quand où
    pourquoi minutes heure heures jour jours semaine semaines étape étapes terminé suivant envoyer enregistrer annuler oui non aujourd hui demain matin soir
    nuit déjeuner dîner courses liste bagages valise vêtements électronique documents toilette hygiène fruits légumes œufs oeufs œuf sel poivre sucre farine
    beurre lait fromage pain oignon oignons ail pâtes crème train avion vol voyage durée coût prix rapide confortable temps personnes portions ingrédients
    question questions réponse correct bonne capitale capitales choisis choisir chargeur écouteurs brosse passeport chaussures veste pantalon chemise
    chaussettes solaire serviette sac argent carte tâche tâches entraînement exercice exercices séries répétitions repos échauffement étirements addition
    pourboire partager amis samedi dimanche paquet bouteille boîte boissons épicerie produits laitiers boulangerie autres frais râpé haché`,
};
// Loanwords and words that are the same in several of these languages: never evidence for or against a language.
const NEUTRAL = new Set(`pasta pizza total gym cool sets set id ok online team app hotel taxi snack sandwich café cafe ticket tour start stop jeans laptop
  tablet smartphone shampoo deo spray timer quiz minute plan test sport bus name park film museum bar restaurant station route info material stress radio
  hand warm fit check burger salami mozzarella parmesan pecorino guanciale pancetta spaghetti tortilla paella gazpacho crêpes crepes gratin quiche chorizo
  fondue raclette butter spätzle käsespätzle tapas risotto lasagne tiramisu carbonara bolognese pesto kebab sushi tofu yoga cardio pilates hiit squats burpees
  plank planks lunges cv usb kindle powerbank tv wifi dj pc mac iphone android ios euro euros km kg g ml l h min cm max mini pro crème fraîche brûlée
  jalapeño jalapeños piñata açaí jamón ibérico manchego müsli müesli croûtons purée sauté entrée déjà vu à la al dente`.split(/\s+/).filter(Boolean));

/** word -> languages whose lexicon has it */
const WORD_LANGS = new Map();
for (const [lang, words] of Object.entries(LEX)) {
  for (const w of words.split(/\s+/)) {
    if (!w || /_/.test(w) || NEUTRAL.has(w)) continue; // `x_de` entries are placeholders for words that would collide
    const s = WORD_LANGS.get(w) ?? new Set();
    s.add(lang);
    WORD_LANGS.set(w, s);
  }
}
/** Letters only some of the four languages use; checked per word that is neither in a lexicon nor neutral. */
const LETTERS = [
  [/[äöüß]/u, 'de'],
  [/[ñ¿¡]/u, 'es'],
  [/[çœàâèêëîïôûù]/u, 'fr'],
];

export const LANGS = /** @type {const} */ (['de', 'en', 'es', 'fr']);

/**
 * Language evidence in one string.
 * @param {string} text
 * @returns {{hits: Record<string, number>, words: Array<{word: string, langs: string[]}>}}
 */
export function langHits(text) {
  const t = String(text ?? '').toLowerCase();
  /** @type {Record<string, number>} */
  const hits = {};
  const words = [];
  for (const w of t.match(/\p{L}+/gu) ?? []) {
    const langs = [...(WORD_LANGS.get(w) ?? (NEUTRAL.has(w) ? [] : LETTERS.filter(([re]) => re.test(w)).map(([, l]) => l)))];
    if (!langs.length) continue;
    words.push({ word: w, langs });
    for (const l of langs) hits[l] = (hits[l] ?? 0) + 1;
  }
  return { hits, words };
}

/**
 * @param {string} text
 * @param {Lang} target
 * @returns {{verdict: 'ok'|'neutral'|'foreign', target: number, foreign: number, foreignWords: string[]}}
 */
export function judgeString(text, target) {
  const { words } = langHits(text);
  let t = 0;
  const foreignWords = [];
  for (const w of words) {
    if (w.langs.includes(target)) t++;
    else foreignWords.push(w.word);
  }
  const f = foreignWords.length;
  const verdict = f > 0 && f > t ? 'foreign' : t > 0 ? 'ok' : f > 0 ? 'foreign' : 'neutral';
  return { verdict, target: t, foreign: f, foreignWords };
}

/** The most likely of the four languages for a longer text ('' when there is no evidence or a tie). */
export function guessLang(text) {
  const { hits } = langHits(text);
  const ranked = LANGS.map((l) => [l, hits[l] ?? 0]).sort((a, b) => b[1] - a[1]);
  if (!ranked[0][1] || ranked[0][1] === ranked[1][1]) return '';
  return ranked[0][0];
}

const FENCE = /```(hui-html|hui)[ \t]*\n([\s\S]*?)(?:\n```|$)/g;

/**
 * Split an answer into hui nodes, hui-html fragments and the prose around them.
 * @param {string} text
 */
export function extractBlocks(text) {
  const nodes = [];
  const html = [];
  const bad = [];
  const src = String(text ?? '');
  let prose = src;
  for (const m of src.matchAll(FENCE)) {
    prose = prose.replace(m[0], '\n');
    if (m[1] === 'hui-html') { html.push(m[2]); continue; }
    try { nodes.push(JSON.parse(m[2])); } catch { bad.push(m[2].slice(0, 80)); }
  }
  return { nodes, html, bad, prose: prose.replace(/```[\s\S]*?```/g, '').trim() };
}

// Keys whose string values are not shown as text (ids, enums, image search terms, URLs, expressions, dates).
const HIDDEN_KEYS = new Set(['type', 'id', 'kind', 'style', 'variant', 'icon', 'imageQuery', 'query', 'url', 'image', 'source', 'basis', 'lang', 'from',
  'to', 'layout', 'groupBy', 'status', 'tone', 'trend', 'format', 'name', 'expr', 'date', 'start', 'end', 'at', 'phone', 'email', 'website', 'address',
  'currency', 'mode', 'path', 'answer', 'condition', 'compare', 'ranked', 'include', 'seconds', 'sms', 'lat', 'lng', 'color']);
// Node types whose text is in another language on purpose.
const SKIP_TYPES = new Set(['translation', 'vocab', 'flashcards', 'code', 'diff', 'terminal', 'changes']);

/**
 * Visible strings of a node tree, with their JSON paths.
 * @param {unknown} node
 * @returns {Array<{path: string, text: string}>}
 */
export function visibleStrings(node, path = '$') {
  const out = [];
  const walk = (v, p, key) => {
    if (typeof v === 'string') { if (!HIDDEN_KEYS.has(key) && /\p{L}/u.test(v)) out.push({ path: p, text: v }); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`, key)); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.type === 'string' && SKIP_TYPES.has(v.type)) return;
    for (const [k, x] of Object.entries(v)) {
      if (k === 'action' && x && typeof x === 'object') { walk({ text: x.text, title: x.title, label: x.label }, `${p}.action`, k); continue; }
      walk(x, `${p}.${k}`, k);
    }
  };
  walk(node, path, '');
  return out;
}

/** Text a hui-html fragment shows (tags, styles and scripts removed). */
export function htmlText(fragment) {
  return String(fragment)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const INPUT_TYPES = new Set(['choice', 'form', 'slots', 'confirm', 'poll', 'rank', 'scale']);
const AUX_TYPES = new Set(['suggestions', 'buttons', 'sources', 'summary']);

/**
 * Score one answer.
 * @param {string} answer full assistant text
 * @param {Lang} target the prompt's language
 * @returns {{cards: string[], strings: number, foreign: Array<{path: string, text: string, words: string[]}>, langOk: boolean,
 *   proseLang: string, proseOk: boolean, shape: 'content-card'|'input-card'|'prose-question'|'prose', badJson: number}}
 */
export function scoreAnswer(answer, target) {
  const { nodes, html, bad, prose } = extractBlocks(answer);
  const strings = nodes.flatMap((n, i) => visibleStrings(n, `$${i}`));
  html.forEach((h, i) => { const t = htmlText(h); if (t) strings.push({ path: `html${i}`, text: t }); });
  const foreign = [];
  for (const s of strings) {
    const j = judgeString(s.text, target);
    if (j.verdict === 'foreign') foreign.push({ path: s.path, text: s.text.slice(0, 120), words: j.foreignWords });
  }
  const proseLang = guessLang(prose);
  const types = nodes.map((n) => (n && typeof n === 'object' && typeof n.type === 'string' ? n.type : '?'));
  const content = types.filter((t) => !INPUT_TYPES.has(t) && !AUX_TYPES.has(t));
  const shape = content.length || html.length ? 'content-card'
    : types.some((t) => INPUT_TYPES.has(t)) ? 'input-card'
      : /\?\s*$/m.test(prose) || /[?¿]/.test(prose.slice(-400)) ? 'prose-question' : 'prose';
  return {
    cards: [...types, ...html.map(() => 'hui-html')],
    strings: strings.length,
    foreign,
    langOk: foreign.length === 0,
    proseLang,
    proseOk: proseLang === '' || proseLang === target,
    shape,
    badJson: bad.length,
  };
}
