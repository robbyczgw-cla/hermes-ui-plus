// Prompts for the skill-language eval: the main card types in English, Spanish, French and German.
// `under`: the request leaves out a detail the card needs (dish, guests, amount). The skill asks for a sensible
// default card plus an offer to adjust, not a question in prose (fresh-user test 0.1.1, items #2 and #7).
// `expect`: card types that fit (informative only; the score is about language and shape, not the exact type).

/** @type {Array<{id: string, lang: 'de'|'en'|'es'|'fr', prompt: string, expect: string[], under?: boolean}>} */
export const CASES = [
  // English: the three fresh-user prompts first
  { id: 'en-pack', lang: 'en', prompt: 'Make me a short packing checklist for a weekend city trip that I can tick off.', expect: ['checklist'] },
  { id: 'en-shop-under', lang: 'en', prompt: "I'm cooking for four tonight. Make me a shopping list I can tick off.", expect: ['checklist'], under: true },
  { id: 'en-choice', lang: 'en', prompt: 'Train or plane from Vienna to Berlin for a weekend? Let me pick.', expect: ['choice', 'compare'] },
  { id: 'en-recipe', lang: 'en', prompt: 'Give me a recipe for spaghetti carbonara for 4.', expect: ['recipe'] },
  { id: 'en-quiz', lang: 'en', prompt: 'Quiz me on European capitals, 4 questions.', expect: ['quiz'] },
  { id: 'en-timer', lang: 'en', prompt: 'Timers for a Sunday roast: roast 90 min, potatoes 25 min, vegetables 7 min.', expect: ['timer'] },
  { id: 'en-agenda', lang: 'en', prompt: 'Plan my Saturday: gym in the morning, groceries, dinner with friends at 7 pm.', expect: ['agenda'] },
  { id: 'en-workout', lang: 'en', prompt: 'Make me a 30-minute beginner full-body workout I can follow.', expect: ['workout'] },
  { id: 'en-calc-under', lang: 'en', prompt: 'Help me split the restaurant bill with a tip.', expect: ['calc'], under: true },
  { id: 'en-party-under', lang: 'en', prompt: 'I want to throw a birthday party. Give me a to-do list.', expect: ['checklist'], under: true },
  // Spanish
  { id: 'es-shop', lang: 'es', prompt: 'Hazme una lista de la compra para una paella para 6 que pueda ir marcando.', expect: ['checklist'] },
  { id: 'es-pack', lang: 'es', prompt: 'Me voy a la playa el fin de semana. Hazme una lista de equipaje para marcar.', expect: ['checklist'] },
  { id: 'es-choice', lang: 'es', prompt: '¿Tren o avión de Madrid a Barcelona para un fin de semana? Déjame elegir.', expect: ['choice', 'compare'] },
  { id: 'es-recipe', lang: 'es', prompt: 'Dame una receta de tortilla de patatas para 4 personas.', expect: ['recipe'] },
  { id: 'es-quiz', lang: 'es', prompt: 'Hazme un test de 4 preguntas sobre capitales de Sudamérica.', expect: ['quiz'] },
  { id: 'es-dinner-under', lang: 'es', prompt: 'Quiero organizar una cena con amigos el sábado. Hazme una lista de tareas.', expect: ['checklist', 'agenda'], under: true },
  { id: 'es-calc-under', lang: 'es', prompt: 'Hazme una calculadora para la cuota mensual de un préstamo de coche.', expect: ['calc'], under: true },
  { id: 'es-compare', lang: 'es', prompt: 'Alquilar o comprar piso: compárame pros y contras.', expect: ['compare'] },
  // French
  { id: 'fr-shop', lang: 'fr', prompt: 'Fais-moi une liste de courses à cocher pour un gratin dauphinois pour 4.', expect: ['checklist'] },
  { id: 'fr-pack', lang: 'fr', prompt: 'Liste de bagages à cocher pour un week-end au ski, s’il te plaît.', expect: ['checklist'] },
  { id: 'fr-choice', lang: 'fr', prompt: 'Train ou avion de Paris à Nice pour un week-end ? Laisse-moi choisir.', expect: ['choice', 'compare'] },
  { id: 'fr-recipe', lang: 'fr', prompt: 'Donne-moi la recette des crêpes pour 4 personnes.', expect: ['recipe'] },
  { id: 'fr-quiz', lang: 'fr', prompt: 'Fais-moi un quiz de 4 questions sur les fleuves de France.', expect: ['quiz'] },
  { id: 'fr-party-under', lang: 'fr', prompt: "J'organise l'anniversaire de ma fille. Fais-moi une checklist.", expect: ['checklist'], under: true },
  { id: 'fr-timer', lang: 'fr', prompt: 'Lance un minuteur de 10 minutes pour les pâtes.', expect: ['timer'] },
  { id: 'fr-workout', lang: 'fr', prompt: 'Une séance de sport de 20 minutes à la maison sans matériel, à suivre.', expect: ['workout'] },
  // German: the quality must stay
  { id: 'de-pack', lang: 'de', prompt: 'Mach mir eine Packliste zum Abhaken für ein Wochenende in Rom.', expect: ['checklist'] },
  { id: 'de-shop-under', lang: 'de', prompt: 'Ich koche heute für vier. Mach mir eine Einkaufsliste zum Abhaken.', expect: ['checklist'], under: true },
  { id: 'de-choice', lang: 'de', prompt: 'Zug oder Flugzeug von Wien nach Berlin fürs Wochenende? Lass mich wählen.', expect: ['choice', 'compare'] },
  { id: 'de-recipe', lang: 'de', prompt: 'Rezept für Käsespätzle für 4 Personen, bitte.', expect: ['recipe'] },
  { id: 'de-quiz', lang: 'de', prompt: 'Frag mich mit 4 Fragen zu europäischen Hauptstädten ab.', expect: ['quiz'] },
  { id: 'de-agenda', lang: 'de', prompt: 'Plane meinen Samstag: vormittags Sport, dann einkaufen, um 19 Uhr Essen mit Freunden.', expect: ['agenda'] },
  { id: 'de-calc-under', lang: 'de', prompt: 'Hilf mir, die Rechnung im Restaurant mit Trinkgeld zu teilen.', expect: ['calc'], under: true },
];
