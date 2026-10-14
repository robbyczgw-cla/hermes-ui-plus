import type { GallerySample } from '../../../galleryData';

/** Realistic samples for the Gallery "Interaktiv" section (modules-a + provenance). */
export const INTERACTIVE_SAMPLES: GallerySample[] = [
  {
    title: 'Auswahl · Chips, sofort senden (choice)',
    route: 'form',
    node: {
      type: 'choice',
      id: 'wochenplan-fokus',
      question: 'Worauf soll ich beim Wochenplan achten?',
      options: [
        { id: 'schnell', label: 'Schnell', icon: '⏱️' },
        { id: 'guenstig', label: 'Günstig', icon: '💶' },
        { id: 'gesund', label: 'Gesund', icon: '🥗' },
        { id: 'familie', label: 'Kinderfreundlich', icon: '🧒' },
      ],
      allowOther: true,
    },
  },
  {
    title: 'Auswahl · Liste mit Beschreibung (choice)',
    route: 'form',
    node: {
      type: 'choice',
      id: 'tarif',
      question: 'Welcher Stromtarif passt zu euch?',
      layout: 'list',
      options: [
        { id: 'fix', label: 'Festpreis 24 Monate', description: '32,9 ct/kWh · Preisgarantie, 12 € Grundgebühr' },
        { id: 'dyn', label: 'Dynamischer Tarif', description: 'Börsenpreis stündlich · lohnt sich mit E-Auto oder Wärmepumpe' },
        { id: 'oeko', label: 'Ökostrom Plus', description: '34,5 ct/kWh · 100 % Wasserkraft, monatlich kündbar' },
      ],
    },
  },
  {
    title: 'Auswahl · Mehrfach mit Bildern (choice grid)',
    route: 'form',
    node: {
      type: 'choice',
      id: 'rom-ziele',
      question: 'Was möchtest du in Rom sehen? (max. 3)',
      multiple: true,
      min: 1,
      max: 3,
      submitLabel: 'Route planen',
      options: [
        { id: 'kolosseum', label: 'Kolosseum', imageQuery: 'Kolosseum' },
        { id: 'trevi', label: 'Trevi-Brunnen', imageQuery: 'Trevi-Brunnen' },
        { id: 'pantheon', label: 'Pantheon', imageQuery: 'Pantheon (Rom)' },
        { id: 'peter', label: 'Petersdom', imageQuery: 'Petersdom' },
      ],
    },
  },
  {
    title: 'Einkaufsliste (checklist · shopping)',
    route: 'interactive',
    node: {
      type: 'checklist',
      id: 'einkauf-we',
      title: 'Einkauf fürs Wochenende',
      kind: 'shopping',
      items: [
        { text: 'Tomaten', qty: 500, unit: 'g' },
        { text: 'Basilikum', qty: 1, unit: 'Bund' },
        { text: 'Spaghetti', qty: 2, unit: 'Pck.' },
        { text: 'Parmesan', qty: 100, unit: 'g', note: 'am Stück' },
        { text: 'Milch', qty: 2, unit: 'l', checked: true },
        { text: 'Vollkornbrot' },
        { text: 'Olivenöl' },
        { text: 'Spülmittel' },
        { text: 'Mineralwasser', qty: 6, unit: 'Flaschen' },
      ],
    },
  },
  {
    title: 'Packliste mit Kategorien (checklist · packing)',
    route: 'interactive',
    node: {
      type: 'checklist',
      id: 'packliste-hamburg',
      title: 'Packliste Hamburg (3 Tage)',
      kind: 'packing',
      groupBy: 'category',
      items: [
        { text: 'Personalausweis', category: 'Dokumente', checked: true },
        { text: 'Bahnticket (App)', category: 'Dokumente' },
        { text: 'Regenjacke', category: 'Kleidung', note: 'Vorhersage: Schauer' },
        { text: 'Wechselschuhe', category: 'Kleidung' },
        { text: 'Ladekabel + Powerbank', category: 'Technik' },
        { text: 'Zahnbürste', category: 'Bad' },
      ],
    },
  },
  {
    title: 'Terminwahl (slots)',
    route: 'form',
    node: {
      type: 'slots',
      id: 'friseur',
      title: 'Wann passt dir der Friseurtermin?',
      timezone: 'Europe/Berlin',
      slots: [
        { id: 'a', start: '2026-10-13T09:30', end: '2026-10-13T10:15' },
        { id: 'b', start: '2026-10-13T17:00', end: '2026-10-13T17:45', note: 'letzter Termin des Tages' },
        { id: 'c', start: '2026-10-15T12:00', end: '2026-10-15T12:45', label: 'Mittagspause' },
      ],
    },
  },
  {
    title: 'Bestätigung · gefährlich (confirm)',
    route: 'form',
    node: {
      type: 'confirm',
      id: 'fotos-loeschen',
      title: '23 Fotos aus „Urlaub 2019“ löschen?',
      text: 'Die Dateien landen 30 Tage im Papierkorb und können so lange wiederhergestellt werden.',
      confirmLabel: 'Löschen',
      cancelLabel: 'Behalten',
      tone: 'danger',
    },
  },
  {
    title: 'Bestätigung · neutral (confirm)',
    route: 'form',
    node: {
      type: 'confirm',
      id: 'newsletter',
      title: 'Soll ich die Zusammenfassung jeden Montag schicken?',
      text: 'Du kannst das jederzeit wieder abbestellen.',
      confirmLabel: 'Ja, montags',
      cancelLabel: 'Nein danke',
    },
  },
  {
    title: 'Quiz',
    route: 'interactive',
    node: {
      type: 'quiz',
      id: 'quiz-planeten',
      title: 'Sonnensystem-Quiz',
      questions: [
        { q: 'Welcher Planet ist der Sonne am nächsten?', options: ['Venus', 'Merkur', 'Mars'], answer: 1, explanation: 'Merkur umkreist die Sonne in nur 88 Tagen.' },
        { q: 'Welche Planeten haben Ringe?', options: ['Jupiter', 'Saturn', 'Erde', 'Uranus'], answer: [0, 1, 3], explanation: 'Alle vier Gasriesen haben Ringe – beim Saturn sind sie nur am auffälligsten.' },
        { q: 'Wie lange braucht Sonnenlicht ungefähr bis zur Erde?', options: ['8 Sekunden', '8 Minuten', '8 Stunden'], answer: 1 },
        { q: 'Welcher ist der größte Planet?', options: ['Saturn', 'Neptun', 'Jupiter'], answer: 2 },
      ],
    },
  },
  {
    title: 'Karteikarten (flashcards)',
    route: 'interactive',
    node: {
      type: 'flashcards',
      id: 'spanisch-a1',
      title: 'Spanisch · Im Restaurant',
      cards: [
        { front: 'die Rechnung', back: 'la cuenta' },
        { front: 'das Trinkgeld', back: 'la propina' },
        { front: 'Ich hätte gern …', back: 'Quisiera …' },
        { front: 'vegetarisch', back: 'vegetariano / vegetariana' },
        { front: 'Ist hier noch frei?', back: '¿Está libre?' },
      ],
    },
  },
  {
    title: 'Tabs (tabs)',
    route: 'compare',
    node: {
      type: 'tabs',
      tabs: [
        {
          label: 'Zug',
          children: [
            { type: 'stats', items: [{ label: 'Fahrzeit', value: '4 h 10 min' }, { label: 'Preis', value: 'ab 39,90 €' }] },
            { type: 'text', text: 'ICE direkt ab **Berlin Hbf**, WLAN und Steckdosen am Platz.' },
          ],
        },
        {
          label: 'Auto',
          children: [
            { type: 'stats', items: [{ label: 'Fahrzeit', value: '≈ 5 h' }, { label: 'Kosten', value: '≈ 85 €' }], basis: 'estimate' },
            { type: 'text', text: 'Bei Stau auf der A9 deutlich länger. Kosten für Benzin und Maut geschätzt.' },
          ],
        },
        {
          label: 'Flug',
          children: [{ type: 'callout', tone: 'warning', title: 'Kein Direktflug', text: 'Mit Umstieg in Frankfurt dauert es inkl. Anreise länger als der Zug.' }],
        },
      ],
    },
  },
  {
    title: 'Akkordeon (accordion)',
    route: 'steps',
    node: {
      type: 'accordion',
      open: 0,
      items: [
        { title: 'Wie lange dauert die Lieferung?', children: [{ type: 'text', text: 'In der Regel **2–3 Werktage**, Expressversand am nächsten Tag.' }] },
        { title: 'Kann ich kostenlos zurückschicken?', children: [{ type: 'text', text: 'Ja, innerhalb von 30 Tagen mit dem beiliegenden Etikett.' }] },
        {
          title: 'Welche Zahlungsarten gibt es?',
          children: [{ type: 'list', style: 'check', items: [{ title: 'PayPal' }, { title: 'Kreditkarte' }, { title: 'Rechnung (ab 2. Bestellung)' }] }],
        },
      ],
    },
  },
  {
    title: 'Quellen (sources)',
    route: 'text',
    node: {
      type: 'sources',
      items: [
        { title: 'Mindestlohn steigt 2026 auf 13,90 Euro', url: 'https://www.tagesschau.de/wirtschaft/mindestlohn-2026-100.html', siteName: 'tagesschau.de', snippet: 'Die Mindestlohnkommission hat eine Erhöhung in zwei Stufen beschlossen …' },
        { title: 'Mindestlohn – Fragen und Antworten', url: 'https://www.bmas.de/DE/Arbeit/Arbeitsrecht/Mindestlohn/mindestlohn.html', siteName: 'BMAS' },
        { title: 'Mindestlohn in Deutschland', url: 'https://de.wikipedia.org/wiki/Mindestlohn_in_Deutschland', snippet: 'Seit dem 1. Januar 2015 gilt in Deutschland ein allgemeiner gesetzlicher Mindestlohn.' },
        { title: 'Statistischer Bericht Verdienste', url: 'https://www.destatis.de/DE/Themen/Arbeit/Verdienste/_inhalt.html' },
      ],
    },
  },
  {
    title: 'Timer',
    route: 'interactive',
    node: { type: 'timer', id: 'nudeln', label: 'Nudeln kochen', seconds: 540 },
  },
  {
    title: 'Herkunft · Beispielwerte (table + basis)',
    route: 'table',
    node: {
      type: 'table',
      caption: 'Monatsbudget (Beispiel)',
      basis: 'illustrative',
      columns: ['Posten', 'Betrag'],
      rows: [
        ['Miete', '850 €'],
        ['Lebensmittel', '420 €'],
        ['Mobilität', '120 €'],
      ],
    },
  },
  {
    title: 'Herkunft · Schätzung mit Quelle (stats + basis/source)',
    route: 'stats',
    node: {
      type: 'stats',
      basis: 'estimate',
      source: 'Statistisches Bundesamt',
      items: [
        { label: 'Ø Haushaltsnettoeinkommen', value: '≈ 4.000 €' },
        { label: 'Ø Konsumausgaben', value: '≈ 2.900 €' },
      ],
    },
  },
];

/** Partial (streaming = true) snapshots for skeleton checks. */
export const INTERACTIVE_PARTIAL_SAMPLES: GallerySample[] = [
  { title: 'choice – Optionen kommen noch', route: 'form', node: { type: 'choice', id: 'p1', question: 'Welche Farbe soll das Sofa haben?', options: [{ label: 'Salbeigrün' }, { label: 'Sand' }] } },
  { title: 'checklist – nur Titel', route: 'interactive', node: { type: 'checklist', id: 'p2', title: 'Einkaufsliste', kind: 'shopping', items: [{ text: 'Äpfel' }] } },
  { title: 'quiz – noch keine Frage', route: 'interactive', node: { type: 'quiz', id: 'p3', title: 'Hauptstädte' } },
  { title: 'tabs – zweiter Tab streamt', route: 'compare', node: { type: 'tabs', tabs: [{ label: 'Vorteile', children: [{ type: 'text', text: 'Leise und sparsam.' }] }, { label: 'Nachteile', children: [] }] } },
  { title: 'slots – leer', route: 'form', node: { type: 'slots', id: 'p4' } },
  { title: 'timer – Dauer fehlt', route: 'interactive', node: { type: 'timer', id: 'p5', label: 'Pizza' } },
  { title: 'flashcards – leer', route: 'interactive', node: { type: 'flashcards', id: 'p6' } },
  { title: 'confirm – Titel fehlt', route: 'form', node: { type: 'confirm', id: 'p7' } },
  { title: 'sources – leer', route: 'text', node: { type: 'sources' } },
  { title: 'accordion – leer', route: 'steps', node: { type: 'accordion' } },
  { title: 'Typ unvollständig ("chec")', route: 'interactive', node: { type: 'chec' } },
];
