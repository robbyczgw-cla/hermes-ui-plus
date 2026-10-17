// Cheap language guess for routing: does the heuristic (German / English / Spanish rules) understand this message?
// Counts frequent function words per language; no dictionary, no model, a few microseconds. Short or mixed messages
// return '' (unknown), which the router treats like a supported language.

/** Words that are frequent in one language and rare in the others (lower case, matched as whole words). */
const WORDS = {
  de: 'der die das und ist nicht ich du mir mich ein eine einen mit für auf wie was wo wann bitte kannst zeig mach gibt auch noch schon heute morgen',
  en: 'the and is are not you me my with for what where when how please can could show make give this that there today tomorrow i',
  es: 'el la los las y es no yo tú me mi mis con para por qué dónde cuándo cómo puedes muéstrame hazme dame esto hay hoy mañana una unos',
  fr: 'le les et est pas je tu moi mon ma mes avec pour quoi où quand comment peux montre fais donne ce cette il y aujourd demain une des du au',
  it: 'il lo gli e è non io tu mi mio mia con per che cosa dove quando come puoi mostrami fammi dammi questo questa oggi domani una dei della',
  pt: 'o os as e é não eu você me meu minha com para que onde quando como pode mostre faça dê isso esta hoje amanhã uma dos das ao',
  nl: 'de het en is niet ik jij je mij mijn met voor wat waar wanneer hoe kun kunt laat maak geef dit dat er vandaag morgen een',
  pl: 'i jest nie ja ty mi mnie mój moja z dla co gdzie kiedy jak możesz pokaż zrób daj to ten ta dziś jutro się na w',
  tr: 've bir bu şu ne nerede ne zaman nasıl için ile ben sen bana benim bugün yarın mı mi mu mü misin lütfen göster yap var',
};
const SETS = Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, new Set(w.split(' '))]));
/** Letters that only some languages use; each hit counts like a function word. */
const LETTERS = { pl: /[łąęśźżń]/gu, tr: /[ğışİ]/gu, pt: /[ãõ]/gu, fr: /[œèêëç]/gu, es: /[ñ¿¡]/gu, de: /[äöüß]/gu };

export const HEURISTIC_LANGUAGES = Object.freeze(['de', 'en', 'es']);

/**
 * @param {string} text
 * @returns {string} language code or '' when unsure (fewer than 2 hits or a tie)
 */
export function detectLanguage(text) {
  const t = String(text ?? '').toLowerCase().slice(0, 400);
  const words = t.match(/\p{L}+/gu) ?? [];
  /** @type {Record<string, number>} */
  const score = {};
  for (const w of words) for (const [l, s] of Object.entries(SETS)) if (s.has(w)) score[l] = (score[l] ?? 0) + 1;
  for (const [l, r] of Object.entries(LETTERS)) {
    const n = t.match(r)?.length ?? 0;
    if (n) score[l] = (score[l] ?? 0) + n;
  }
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 2 || ranked[1]?.[1] === ranked[0][1]) return '';
  return ranked[0][0];
}

/** True when the message is clearly in a language the heuristic has no rules for. */
export function isForeignToHeuristic(text) {
  const l = detectLanguage(text);
  return l !== '' && !HEURISTIC_LANGUAGES.includes(l);
}
