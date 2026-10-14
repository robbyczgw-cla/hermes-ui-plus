/** Gallery / test sample nodes for studyplan, vocab, mindmap (modules-d3). Pure data. */

export const STUDYPLAN_SAMPLE = {
  type: 'studyplan',
  id: 'es-a1-4w',
  title: 'Spanisch A1 in 4 Wochen',
  goal: 'Alltagsgespräche mit der Familie führen: vorstellen, einkaufen, nach dem Weg fragen.',
  weeks: [
    {
      label: 'Woche 1: Grundlagen',
      days: [
        { label: 'Mo', tasks: [{ text: 'Aussprache & Alphabet', minutes: 20, kind: 'learn' }, { text: 'Begrüßungen: hola, buenos días, ¿qué tal?', minutes: 15, kind: 'practice' }] },
        { label: 'Mi', tasks: [{ text: 'Zahlen 0–20', minutes: 20, kind: 'learn' }, { text: 'Vokabeln Familie (12 Wörter)', minutes: 15, kind: 'practice' }] },
        { label: 'Fr', tasks: [{ text: 'ser vs. estar – Einführung', minutes: 25, kind: 'learn' }, { text: 'Wiederholung Woche 1', minutes: 15, kind: 'review' }] },
        { label: 'Sa', tasks: [{ text: 'Mini-Test: Begrüßen & Vorstellen', minutes: 10, kind: 'test' }] },
      ],
    },
    {
      label: 'Woche 2: Alltag',
      days: [
        { label: 'Mo', tasks: [{ text: 'Regelmäßige Verben auf -ar im Präsens', minutes: 25, kind: 'learn' }, { text: 'Lückentext hablar, trabajar, comprar', minutes: 15, kind: 'practice' }] },
        { label: 'Mi', tasks: [{ text: 'Uhrzeit & Wochentage', minutes: 20, kind: 'learn' }, { text: 'Tagesablauf beschreiben (5 Sätze)', minutes: 20, kind: 'practice' }] },
        { label: 'Fr', tasks: [{ text: 'Verben auf -er / -ir', minutes: 25, kind: 'learn' }, { text: 'Karteikarten Woche 1–2', minutes: 10, kind: 'review' }] },
        { label: 'Sa', tasks: [{ text: 'Gespräch mit Sam: Mein Tag (10 min)', minutes: 10, kind: 'practice' }] },
      ],
    },
    {
      label: 'Woche 3: Unterwegs',
      days: [
        { label: 'Mo', tasks: [{ text: 'Essen & Trinken bestellen', minutes: 20, kind: 'learn' }, { text: 'Rollenspiel im Restaurant', minutes: 15, kind: 'practice' }] },
        { label: 'Mi', tasks: [{ text: 'Nach dem Weg fragen: ¿dónde está…?', minutes: 20, kind: 'learn' }, { text: 'Hörverständnis: Wegbeschreibung', minutes: 15, kind: 'practice' }] },
        { label: 'Fr', tasks: [{ text: 'ir + a + Infinitiv (Zukunft)', minutes: 20, kind: 'learn' }, { text: 'Wiederholung Verben', minutes: 15, kind: 'review' }] },
        { label: 'Sa', tasks: [{ text: 'Mini-Test: Unterwegs', minutes: 15, kind: 'test' }] },
      ],
    },
    {
      label: 'Woche 4: Festigen',
      days: [
        { label: 'Mo', tasks: [{ text: 'Einkaufen: Preise, Mengen, Farben', minutes: 20, kind: 'learn' }, { text: 'Einkaufsliste auf Spanisch', minutes: 10, kind: 'practice' }] },
        { label: 'Mi', tasks: [{ text: 'Alle Vokabeln (Leitner-Box 1–2)', minutes: 20, kind: 'review' }, { text: 'Kurze Nachricht an die Familie schreiben', minutes: 15, kind: 'practice' }] },
        { label: 'Fr', tasks: [{ text: 'Fehler-Liste durchgehen', minutes: 15, kind: 'review' }] },
        { label: 'Sa', tasks: [{ text: 'Abschlusstest A1 (Lesen, Hören, Schreiben)', minutes: 45, kind: 'test' }, { text: '15 min freies Gespräch mit Sam', minutes: 15, kind: 'practice' }] },
      ],
    },
  ],
};

export const VOCAB_SAMPLE = {
  type: 'vocab',
  id: 'es-a1-familia',
  title: 'Spanisch A1 · Familie & Alltag',
  from: 'es',
  to: 'de',
  items: [
    { term: 'la familia', translation: 'die Familie', example: 'Mi familia es grande.' },
    { term: 'la madre', translation: 'die Mutter', example: 'Mi madre se llama Ana.' },
    { term: 'el padre', translation: 'der Vater' },
    { term: 'el hermano', translation: 'der Bruder', note: 'la hermana = die Schwester' },
    { term: 'la abuela', translation: 'die Großmutter / die Oma', example: 'La abuela cocina paella.' },
    { term: 'la casa', translation: 'das Haus', example: 'Estamos en casa.' },
    { term: 'comer', translation: 'essen', note: 'In Spanien auch: zu Mittag essen' },
    { term: 'el desayuno', translation: 'das Frühstück' },
    { term: 'la manzana', translation: 'der Apfel' },
    { term: 'el año', translation: 'das Jahr', note: 'ñ nicht vergessen: „ano“ ist etwas anderes!' },
    { term: 'mañana', translation: 'morgen', example: 'Hasta mañana.' },
    { term: '¿Qué tal?', translation: 'Wie geht’s?' },
  ],
};

export const MINDMAP_SAMPLE = {
  type: 'mindmap',
  id: 'waermepumpe',
  title: 'Wärmepumpe',
  root: {
    label: 'Wärmepumpe',
    note: 'Nutzt Umweltwärme (Luft, Erde, Wasser) und hebt sie mit Strom auf Heiztemperatur.',
    children: [
      {
        label: 'Funktionsprinzip',
        note: 'Kältekreislauf wie ein umgekehrter Kühlschrank.',
        children: [
          { label: 'Verdampfer', note: 'Kältemittel nimmt Umweltwärme auf und verdampft.' },
          { label: 'Verdichter', note: 'Verdichtet das Gas – dabei steigt die Temperatur.' },
          { label: 'Verflüssiger', note: 'Gibt die Wärme an den Heizkreis ab.' },
          { label: 'Expansionsventil', note: 'Entspannt das Kältemittel, der Kreislauf beginnt neu.' },
        ],
      },
      {
        label: 'Wärmequellen',
        children: [
          { label: 'Luft', note: 'Günstig in der Anschaffung, etwas geringere Effizienz im Winter.' },
          { label: 'Erdreich', note: 'Sonden oder Kollektoren; sehr effizient, Bohrung nötig.' },
          { label: 'Grundwasser', note: 'Hohe Effizienz, Genehmigung erforderlich.' },
        ],
      },
      {
        label: 'Effizienz',
        children: [
          { label: 'JAZ ≥ 3,5', note: 'Jahresarbeitszahl: Wärme pro kWh Strom übers Jahr.' },
          { label: 'Niedrige Vorlauftemperatur', note: 'Fußbodenheizung oder große Heizkörper helfen.' },
        ],
      },
      {
        label: 'Kosten & Förderung',
        children: [
          { label: 'Anschaffung', note: 'Luft-WP ca. 12–20 k€, Erd-WP deutlich mehr.' },
          { label: 'Förderung', note: 'Je nach Land und Programm bis zu 70 % (Stand prüfen).' },
          { label: 'Wärmepumpen-Stromtarif' },
        ],
      },
      {
        label: 'Altbau-Eignung',
        note: 'Oft möglich – vorher Heizlast berechnen.',
        children: [{ label: 'Dämmung' }, { label: 'Heizkörper prüfen' }],
      },
    ],
  },
};
