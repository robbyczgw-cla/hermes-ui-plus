// Realistic multi-turn conversations for the live conversation test (run.mjs): the journeys of the QA rounds
// (reports of 0.1.4 and 0.2, docs/CHAT-REGRESSION.md), with the testers' own prompts: dictation typos, short
// follow-ups that only make sense in context. Each turn goes to the bridge exactly like the app sends it (the app's
// buildRequest: only the new user message plus the app's system lines; the session continues server-side).
//
// A turn is either
//   { text, expect? }          a typed message; `expect`: node types of which one should appear (soft, models vary)
//   { tap: [labels], expect? } taps on the PREVIOUS answer as drawn by the app (testkit/answerView.ts), in order; the
//                              message the app sends for it (checklist progress, a choice) is the next user turn.
//                              No such control in the answer is a soft agent-content finding, not a failure.
// `lang` is the app's UI language for drawing and checking the answers.
export const SCENARIOS = [
  {
    id: 'j01-salzburg-map',
    lang: 'de',
    findings: ['F04', 'R2-05', 'R2-08'],
    turns: [
      { text: 'Wir fahren Samstag und Sonntag nach Salzburg, zu zweit ohne Auto. Plane ein entspanntes Wochenende mit drei schönen Orten und einer Karte. Budget 200 Euro ohne Hotel.', expect: ['map', 'places', 'agenda', 'tabs', 'timeline'] },
      { text: 'Was machen wir wenns regnet? Bitte mit konkreten Adressen.' },
      { text: 'Zeig die drei wichtigsten Orte bitte nochmal auf der Karte, wir laufen lieber weniger.', expect: ['map', 'places'] },
    ],
  },
  {
    id: 'j02-recipe-shopping',
    lang: 'de',
    findings: ['F03', 'R2-09', 'N-01'],
    turns: [
      { text: 'Ich möchte heute für vier eine schnelle Pasta mit Hähnchen kochen. Ein Rezept mit Mengen und Zeiten bitte.', expect: ['recipe'] },
      { text: 'Mach das bitte vegetarisch, kein Fleisch und kein Fisch.', expect: ['recipe'] },
      { text: 'Jetzt die Einkaufslsite zum Abhaken bitte. Salz und Öl haben wir schon.', expect: ['checklist'] },
      { tap: [/Pasta|Penne|Spaghetti|Nudeln|Fusilli/, 'Senden'] },
    ],
  },
  {
    id: 'j03-phones-photos-table',
    lang: 'de',
    findings: ['F08', 'F09', 'R2-04'],
    turns: [
      { text: 'Ich überlege zwischen iPhone 16 und Pixel 9. Vergleiche Kamera, Akku und Preis verständlich, ich fotografiere oft meine Katze.' },
      { text: 'Fotos? Ich möchte beide Handys sehen.', expect: ['gallery', 'image', 'products'] },
      { text: 'Und die Unterschiede nochmal als Tabelle bitte.', expect: ['table', 'compare'] },
    ],
  },
  {
    id: 'j04-weather',
    lang: 'de',
    findings: ['LIMIT'],
    turns: [
      { text: 'Wie wird das Wetter am kommenden Wochenende in Wien? Wir möchten picknicken.' },
      { text: 'Samstag oder Sonntag besser? Zeig Temperaturen und Regen als Diagramm.' },
      { text: 'Also soll ich einen Regenschirm mitnehmen? Bitte kurz.' },
    ],
  },
  {
    id: 'j05-vocab-quiz',
    lang: 'de',
    findings: ['F05', 'R2-07'],
    turns: [
      { text: 'Ich lerne Englisch. Gib mir fünf Wörter rund ums Reisen und danach ein kleines Quiz zum Antippen.', expect: ['vocab', 'quiz', 'flashcards'] },
      { text: 'Was bedeutet departure nochmal? Erklärs mir mit einem einfachen Beispielsatz.' },
      { text: 'Noch eine Frage bitte, etwas schwerer und mit drei Antworten zum Auswählen.', expect: ['quiz', 'choice'] },
    ],
  },
  {
    id: 'j06-workout-week',
    lang: 'de',
    findings: ['F02', 'R2-08'],
    turns: [
      { text: 'Mach mir einen einfachen Trainingsplan für zuhause: 20 Minuten, ohne Geräte, für Anfänger. Ich möchte direkt mitmachen.', expect: ['workout'] },
      { text: 'Liegestütze sind mir zu schwer. Kannst du die austauschen?', expect: ['workout'] },
      { text: 'Und für die ganze Woche als übersichtlichen Plan bitte, nur Montag Mittwoch Freitag.', expect: ['agenda', 'timeline', 'tabs', 'table', 'checklist'] },
    ],
  },
  {
    id: 'j07-heatpump-diagram',
    lang: 'de',
    findings: [],
    turns: [
      { text: 'Erklär mir wie eine Wärmepumpe funktioniert, ich kenne mich mit Technik nicht aus.' },
      { text: 'Einfacher bitte, so dass ein Kind es versteht.' },
      { text: 'Jetzt als Diagramm mit den wichtigsten Stationen bitte.', expect: ['diagram', 'steps', 'timeline', 'html'] },
    ],
  },
  {
    id: 'j08-train-car-weights',
    lang: 'de',
    findings: ['F02', 'R2-06', 'R3-03'],
    turns: [
      { text: 'Ich schwanke fürs Wochenende zwischen Zug und Auto von Wien nach Graz. Wir sind zwei Personen. Lass mich Kosten, Zeit und Umwelt selbst gewichten.', expect: ['decision', 'calc', 'compare'] },
      { text: 'Kosten sind mir 50 Prozent wichtig, Zeit 20 und Umwelt 30. Ich will die Gewichte selbst verschieben können.', expect: ['decision', 'calc'] },
      { text: 'Ich nehme den Zug. Lass mich bitte morgens oder nachmittags als zwei Optionen antippen.', expect: ['choice', 'buttons'] },
      { tap: [/^Morgens/] },
    ],
  },
  {
    id: 'j09-code-diff',
    lang: 'de',
    findings: ['F10'],
    turns: [
      { text: 'Ich lerne JavaScript. Warum kommt bei function add(a, b) { return a + b; } mit add("2", 3) der Wert "23" heraus?' },
      { text: 'Wie repariere ich das? Zeig die Änderung als Diff, ich bin Anfänger.', expect: ['diff'] },
      { text: 'Und was passiert bei add("hallo", 3)? Bitte abfangen und einfach erklären.' },
    ],
  },
  {
    id: 'j10-translation',
    lang: 'de',
    findings: ['F06'],
    turns: [
      { text: 'Übersetze diese Nachricht ins Englische: Hallo, leider schaffe ich es morgen erst um halb vier. Können wir unseren Termin verschieben? Danke für dein Verständnis!' },
      { text: 'Etwas höflicher bitte, an eine Kollegin.' },
      { text: 'Jetzt kürzer für WhatsApp, aber immer noch freundlich.' },
    ],
  },
  {
    id: 'j11-tea-timer-reminder',
    lang: 'de',
    findings: ['F01', 'F07', 'R2-03'],
    turns: [
      { text: 'Stell mir bitte einen Timer für zwei Minuten, mein Tee zieht gerade.', expect: ['timer'] },
      { text: 'Mach bitte drei Minuten daraus, ich habe mich vertippt.', expect: ['timer'] },
      { text: 'Und erinnere mich morgen um 9 Uhr daran, Tee zu kaufen.' },
    ],
  },
  {
    id: 'j12-picnic-en',
    lang: 'en',
    findings: ['F02', 'F03'],
    turns: [
      { text: 'Help me choose a simple picnic lunch: sandwiches or pasta salad. Give me two options I can tap. We are four people.', expect: ['choice', 'buttons'] },
      { tap: [/^Pasta salad/i] },
      { text: 'please make it vegetarian, with amounts.', expect: ['recipe'] },
      { text: 'Now a shopping list I can tick off please. We already have pasta and olive oil.', expect: ['checklist'] },
      { text: 'I spent 6 euros on vegetables, 4 on cheese and 3 on pasta. Show those costs as a chart please.', expect: ['chart'] },
    ],
  },
  {
    id: 'n01-shopping-followups',
    lang: 'de',
    findings: ['R2-01', 'R3-02', 'N-01'],
    turns: [
      { text: 'Einkaufslsite für Samstag: Milch, Brot und Tomaten. Eier haben wir schon. Zum Abhaken bitte.', expect: ['checklist'] },
      { text: 'Noch Hafermilch und Äpfel dazu bitte, normale Milch streichen.', expect: ['checklist'] },
      { tap: ['Brot', 'Senden'] },
      { text: 'als Tabelle?', expect: ['table'] },
      { text: 'Fotos?', expect: ['gallery', 'image', 'products'] },
      { text: 'mehr Details' },
    ],
  },
  {
    id: 'n04-reminders',
    lang: 'de',
    findings: ['F01', 'R2-03'],
    turns: [
      { text: 'erinner mich morgen um 9, Tee zu kaufen' },
      { text: 'doch lieber um 10' },
      { text: 'Ist die Erinnerung jetzt wirklich eingerichtet?' },
    ],
  },
  {
    id: 'n04-reminders-en',
    lang: 'en',
    findings: ['F01'],
    turns: [
      { text: 'Remind me tomorrow at 9 to buy tea.' },
      { text: 'and every monday at 9 too' },
    ],
  },
  {
    id: 'n05-memory',
    lang: 'de',
    findings: ['R2-memory'],
    turns: [
      { text: 'Merke dir bitte für künftige Gespräche: Samstags frühstücke ich gern Tomatenbrot.' },
      { text: 'vergiss das' },
    ],
  },
  {
    id: 'handheld-photos',
    lang: 'de',
    findings: ['F08'],
    note: 'bug report 2026-10-19: product comparison with typos, then "Fotos?" rendered as an empty gap',
    turns: [
      { text: 'Trim ui hammer vs RG 3gxx plus für GBA', expect: ['products', 'compare', 'table'] },
      { text: 'Fotos?', expect: ['gallery', 'image', 'products'] },
      { text: 'als Tabelle?', expect: ['table'] },
      { text: 'mehr Details?' },
    ],
  },
  {
    id: 'es-lista',
    lang: 'es',
    findings: [],
    turns: [
      { text: 'Hazme una lista de la compra para una paella para cuatro, para marcar.', expect: ['checklist'] },
      { text: '¿fotos?', expect: ['gallery', 'image', 'products'] },
      { text: '¿como tabla?', expect: ['table'] },
    ],
  },
  {
    id: 'phones-de',
    lang: 'de',
    findings: ['R4-sources'],
    note: 'QA round 4 (0.2.0): exact prompts; the table invented specs with "Quelle: Herstellerangaben" without any web tool',
    turns: [
      { text: 'Vergleiche bitte iPhone 16 und Pixel 9. Kamera und Akku sind mir wichtig.', expect: ['products', 'compare', 'table'] },
      { text: 'Fotos?' },
      { text: 'as a table?', expect: ['table'] },
    ],
  },
  {
    id: 'phones-de-typos',
    lang: 'de',
    findings: ['R4-sources'],
    note: 'same journey with dictation typos and a "where is that from" follow-up',
    turns: [
      { text: 'iphone 16 oder pixle 9 für katzenfotos, was ist besser', expect: ['products', 'compare', 'table'] },
      { text: 'als tabelle bitte mit allen kamera daten', expect: ['table'] },
      { text: 'woher hast du die zahlen?' },
    ],
  },
  {
    id: 'phones-en',
    lang: 'en',
    findings: ['R4-sources'],
    note: 'English version of the journey',
    turns: [
      { text: 'compare iphone 16 and pixel 9 pls, camera and battery matter most', expect: ['products', 'compare', 'table'] },
      { text: 'photos?' },
      { text: 'as a table?', expect: ['table'] },
      { text: 'where are those numbers from?' },
    ],
  },
  // 0.3 skill 0.8.0: weekdays from the real date (0.2.1 QA R4-06 "Freitag 24." in October 2026) and the app's reply
  // quote (`[hui:quote …]` block in front of the typed text, chat-reading): read it, answer about that part, never echo it
  {
    id: 'trip-weekday-quote-de',
    lang: 'de',
    findings: ['R4-06', 'chat-reading'],
    turns: [
      { text: 'Plane mir 3 Tage Wien ab nächstem Freitag, pro Tag ein Tab mit Wochentag und Datum.', expect: ['tabs', 'agenda', 'timeline'] },
      { text: '[hui:quote from=assistant]\n> Samstag: Schloss Schönbrunn am Vormittag, danach Naschmarkt\n[/hui:quote]\n\nGeht das mit weniger laufen? meine Mutter kommt mit' },
    ],
  },
  {
    id: 'trip-weekday-quote-en',
    lang: 'en',
    findings: ['R4-06', 'chat-reading'],
    turns: [
      { text: 'plan a 4 day lisbon trip starting next thursday, one tab per day with weekday and date', expect: ['tabs', 'agenda', 'timeline'] },
      { text: '[hui:quote from=assistant]\n> Day 2: Belém, Jerónimos Monastery and the tower\n[/hui:quote]\n\ncan we swap this day with the last one?' },
    ],
  },
  {
    id: 'quote-own-message-de',
    lang: 'de',
    findings: ['chat-reading'],
    turns: [
      { text: 'Ich suche ein Geschenk für meine Schwester, sie mag Yoga und Tee. Budget 40 Euro. Ideen?' },
      { text: '[hui:quote from=user]\n> Budget 40 Euro\n[/hui:quote]\n\nsorry, eher 25' },
    ],
  },
];
