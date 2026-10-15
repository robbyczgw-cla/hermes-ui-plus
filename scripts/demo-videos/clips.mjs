// Clip scripts for the v4 feature demos ("Hermes Interactive UI+"). Each `run` drives the app like a person
// (tap, type, scroll; see lib.mjs) against the local mock (mock.mjs + scenarios.mjs – crafted, generic content).
// `file` = output base name, `caption`/`captionEn` = two-line title burned into the portrait video,
// `blurb`/`blurbEn` = gallery text, `music` = bed from music.mjs (TRACKS), `gif` = also export an animated preview.

/** scroll so the element's top sits at ~`band` of the viewport */
const show = (a, loc, band = 0.18) => a.scrollTo(loc, { band });

export const CLIPS = [
  {
    id: 'orte',
    file: '01-orte',
    title: 'Ortskarten',
    titleEn: 'Place cards',
    caption: 'Orte mit Fotos, Bewertung & Karte',
    captionEn: 'Places with photos, ratings and a map',
    blurb: 'Restaurants am Pantheon als Karten: blättern, merken, Details mit Öffnungszeiten, alle auf der Karte.',
    blurbEn: 'Restaurants near the Pantheon as cards: swipe, save, details with opening hours, all on a map.',
    music: 'bed-bright',
    gif: true,
    speed: 1.25,
    async run({ page, a, chat }) {
      await chat.send('Where can we eat in Rome tonight? We’re near the Pantheon.');
      await chat.done();
      await show(a, page.getByText('Dinner near the Pantheon'), 0.1);
      await a.mark('cards');
      await a.wait(900);
      // Start at the first card, browse forward, then return for the detail sheet.
      const next = page.getByRole('button', { name: 'Next', exact: true }).first();
      const prev = page.getByRole('button', { name: 'Previous', exact: true }).first();
      await a.tap(next, { after: 800 });
      await a.tap(next, { after: 1100 });
      await a.mark('browse');
      await a.tap(prev, { after: 700 });
      await a.tap(prev, { after: 900 });
      await a.tap(page.getByRole('button', { name: /^Green Lantern Kitchen/ }).first(), { after: 1600 });
      await a.mark('detail');
      await a.scroll(420, { y: 600 });
      await a.wait(1300);
      await a.mark('detail2');
      await a.tap(page.getByRole('button', { name: 'Close' }).last(), { after: 900 });
      await a.tap(page.getByRole('button', { name: 'Show all on map' }).first(), { after: 1200 });
      await show(a, page.getByRole('button', { name: 'Hide map' }).first(), 0.12);
      await a.wait(2800);
      await a.mark('map');
    },
  },
  {
    id: 'produkte',
    file: '02-produkte',
    title: 'Produkt-Ranking & Vergleich',
    titleEn: 'Product top 5 & compare',
    caption: 'Top 5 mit Bildern & Vergleich',
    captionEn: 'Ranked top 5 with images and compare',
    blurb: 'Kopfhörer-Rangliste mit Noten je Kategorie, zwei Modelle vergleichen, Details und „Das nehme ich“.',
    blurbEn: 'Headphone ranking with category scores, compare two models, details and “I’ll take this”.',
    music: 'bed-bright',
    gif: true,
    speed: 1.45,
    maxDuration: 34.5,
    async run({ page, a, chat }) {
      await chat.send('Best noise-canceling headphones under €350? Top 5, please!');
      await chat.done();
      await show(a, page.getByText('Top 5: noise-canceling headphones under €350'), 0.1);
      await a.wait(1000);
      await a.mark('top');
      await a.tap(page.getByRole('button', { name: 'Compare' }).first(), { after: 700 });
      await a.tap(page.getByRole('checkbox', { name: /Quiet Pro/ }).first(), { after: 600 });
      await show(a, page.getByRole('checkbox', { name: /Pulse 2/ }).first(), 0.45);
      await a.tap(page.getByRole('checkbox', { name: /Pulse 2/ }).first(), { after: 800 });
      await a.mark('picked');
      await show(a, page.getByText('Side by side').first(), 0.12);
      await a.wait(1500);
      await a.mark('table');
      await a.tap(page.getByRole('switch', { name: 'Only differences' }).first(), { after: 1500 });
      await a.mark('diff');
      await a.tap(page.getByRole('button', { name: /Send .*Quiet Pro as your pick|I'll take this/ }).first(), { after: 600 });
      await chat.done();
      await a.wait(500);
      await a.scroll(700);
      await a.wait(1600);
      await a.mark('reply');
    },
  },
  {
    id: 'anleitung',
    file: '03-anleitung',
    title: 'Schritt-für-Schritt-Anleitung',
    titleEn: 'Step-by-step guide',
    caption: 'Anleitung mit „Ich hänge fest“',
    captionEn: 'Step-by-step guide with “I’m stuck”',
    blurb: 'Fahrradschlauch wechseln: Schritte abhaken, bei Schritt 3 „Ich hänge hier fest“ – Hermes hilft gezielt.',
    blurbEn: 'Changing a bike tube: tick off steps; at step 3 tap “I’m stuck here” and Hermes helps with that step.',
    speed: 1.4,
    music: 'bed-calm',
    gif: true,
    async run({ page, a, chat }) {
      await chat.send('How do I change a bike inner tube?');
      await chat.done();
      await show(a, page.getByText('Change a bike inner tube').first(), 0.08);
      await a.wait(900);
      await a.mark('guide');
      const done = () => page.getByRole('checkbox', { name: 'Done', exact: true }).first();
      await show(a, done(), 0.7);
      await a.tap(done(), { after: 900 });
      await show(a, done(), 0.7);
      await a.tap(done(), { after: 900 });
      await show(a, page.getByText('Lift the tire off', { exact: true }).first(), 0.12);
      await a.wait(1200);
      await a.mark('step3');
      const stuck = page.getByRole('button', { name: /I’m stuck here/ }).first();
      await show(a, stuck, 0.62);
      await a.tap(stuck, { after: 900 });
      await a.mark('stuck');
      const field = page.getByPlaceholder('What isn’t working? (optional)').first();
      await a.tap(field, { after: 200 });
      await a.type('The tire is too tight');
      await a.wait(400);
      await a.tap(page.getByRole('button', { name: 'Send question' }).first(), { after: 400 });
      await chat.done();
      await a.wait(600);
      await a.scroll(900);
      await a.wait(1500);
      await a.mark('answer');
    },
  },
  {
    id: 'training',
    file: '04-training',
    title: 'Training mit Pausen-Timer',
    titleEn: 'Workout with rest timer',
    caption: 'Training: Sätze abhaken, Pause läuft',
    captionEn: 'Workout: tick off sets, rest timer runs',
    blurb: 'Ganzkörper-Session: Satz antippen startet die Pause mit Countdown, am Ende eine Zusammenfassung.',
    blurbEn: 'Full-body session: tapping a set starts the rest countdown; a summary at the end.',
    speed: 1.3,
    music: 'bed-bright',
    async run({ page, a, chat }) {
      await chat.send('Give me a quick workout for today, no equipment');
      await chat.done();
      await show(a, page.getByText('Full body in 20 minutes').first(), 0.08);
      await a.wait(1000);
      const set = (re) => page.getByRole('checkbox', { name: re }).first();
      await a.tap(page.getByRole('button', { name: /Start workout/ }).first(), { after: 900 });
      await a.mark('started');
      await show(a, set(/Set 1 of 3: 15/), 0.55);
      await a.tap(set(/Set 1 of 3: 15/), { after: 1700 });
      await a.mark('rest');
      await a.tap(page.getByRole('button', { name: '30 seconds more rest' }).first(), { after: 1100 }).catch(() => {});
      await a.tap(page.getByRole('button', { name: 'End rest' }).first(), { after: 600 }).catch(() => {});
      await a.tap(set(/Set 2 of 3: 15/), { after: 1000 });
      await a.tap(page.getByRole('button', { name: 'End rest' }).first(), { after: 500 }).catch(() => {});
      await a.tap(set(/Set 3 of 3: 15/), { after: 1000 });
      await a.mark('sets');
      const fin = page.getByRole('button', { name: 'Finish workout' }).first();
      await show(a, fin, 0.6);
      await a.tap(fin, { after: 1500 });
      await a.mark('summary');
      const send = page.getByRole('button', { name: 'Send summary' }).first();
      await show(a, send, 0.6);
      await a.tap(send, { after: 600 });
      await chat.done();
      await a.wait(1000);
    },
  },
  {
    id: 'vokabeln',
    file: '05-vokabeln',
    title: 'Vokabeltrainer',
    titleEn: 'Vocabulary trainer',
    caption: 'Vokabeln: Karten, Auswahl, Eintippen',
    captionEn: 'Vocab: flashcards, multiple choice, typing',
    blurb: 'Englisch → Spanisch: Karten umdrehen, Multiple Choice und tolerantes Eintippen mit Leitner-Boxen.',
    blurbEn: 'English to Spanish: flip cards, multiple choice and forgiving typing with Leitner boxes.',
    speed: 1.15,
    music: 'bed-calm',
    gif: true,
    async run({ page, a, chat, vocab }) {
      await chat.send('Teach me Spanish for my next adventure');
      await chat.done();
      await show(a, page.getByText('Spanish for your next adventure').first(), 0.1);
      await a.wait(800);
      await a.tap(page.getByRole('button', { name: 'Flip' }).first(), { after: 1300 });
      await a.mark('flipped');
      await a.tap(page.getByRole('button', { name: 'Knew it' }).first(), { after: 900 });
      await a.tap(page.getByRole('button', { name: 'Flip' }).first(), { after: 1200 });
      await a.tap(page.getByRole('button', { name: 'Didn’t know' }).first(), { after: 900 });
      await a.tap(page.getByRole('tab', { name: /Choice/ }).first(), { after: 1000 });
      await a.mark('quiz');
      for (let i = 0; i < 2; i++) {
        const term = await vocab.currentTerm();
        const answer = vocab.translation(term);
        await a.tap(page.getByRole('radio', { name: new RegExp('^' + answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first(), { after: 1100 });
        await a.mark(`quiz${i}`);
        const nx = page.getByRole('button', { name: /^Next$|^See results$/ }).first();
        if (await nx.isVisible().catch(() => false)) await a.tap(nx, { after: 700 });
      }
      await a.tap(page.getByRole('tab', { name: /Type/ }).first(), { after: 900 });
      const shown = await vocab.currentTranslation();
      await a.tap(page.getByPlaceholder('Type your answer').first(), { after: 200 });
      await a.type(vocab.term(shown));
      await a.wait(300);
      await a.tap(page.getByRole('button', { name: 'Check' }).first(), { after: 1600 });
      await a.mark('typed');
    },
  },
  {
    id: 'mindmap',
    file: '06-mindmap',
    title: 'Mindmap',
    titleEn: 'Mind map',
    caption: 'Mindmap: zoomen und vertiefen',
    captionEn: 'Mind map: zoom in and dig deeper',
    blurb: 'Wärmepumpe als Mindmap: hineinzoomen, verschieben, Knoten antippen und mit „Vertiefen“ nachfragen.',
    blurbEn: 'A heat pump as a mind map: zoom in, pan, tap a node and ask for more with “Dig deeper”.',
    speed: 1.1,
    music: 'bed-calm',
    gif: true,
    async run({ page, a, chat }) {
      await chat.send('Mind map: how does a heat pump work?');
      await chat.done();
      await show(a, page.getByText('Heat pump', { exact: true }).first(), 0.1);
      await a.wait(1000);
      await a.mark('map');
      const zoomIn = page.getByRole('button', { name: 'Zoom in' }).first();
      await a.tap(zoomIn, { after: 500 });
      await a.tap(zoomIn, { after: 900 });
      // a11y boxes of the SVG nodes ignore the zoom transform → aim at the visible label text
      const node = (label) => page.getByText(label, { exact: true }).filter({ visible: true }).last();
      await a.wait(700);
      await a.mark('zoomed');
      await a.tap(node('Ground'), { after: 1300 });
      await a.mark('sheet');
      await a.tap(page.getByRole('button', { name: 'Go deeper' }).first(), { after: 500 });
      await chat.done();
      await a.wait(800);
      await a.scroll(700);
      await a.wait(1400);
      await a.mark('answer');
    },
  },
  {
    id: 'umformen',
    file: '07-umformen',
    title: 'Antwort umformen',
    titleEn: 'Transform bar',
    caption: 'Ein Tipp: „Als Tabelle“',
    captionEn: 'One tap: “As a table”',
    blurb: 'Lange Antwort zum E-Bike-Pendeln – ein Tipp auf „Als Tabelle“ und Hermes formt sie um.',
    blurbEn: 'A long answer about e-bike commuting – one tap on “As a table” and Hermes reshapes it.',
    music: 'bed-bright',
    async run({ page, a, chat }) {
      await chat.send('Is an e-bike worth it for my 12 km commute?');
      await chat.done();
      await a.wait(1500);
      await a.mark('long');
      const chip = page.getByRole('button', { name: 'As a table' }).last();
      await show(a, chip, 0.7);
      await a.wait(600);
      await a.tap(chip, { after: 400 });
      await chat.done();
      await a.wait(700);
      await show(a, page.getByText('12 km commute: e-bike vs car').first(), 0.2);
      await a.wait(2600);
      await a.mark('table');
    },
  },
  {
    id: 'befehle',
    file: '08-befehle',
    title: 'Slash-Befehle',
    titleEn: 'Models & slash commands',
    caption: 'Deine Sessions, deine Modelle',
    captionEn: 'Your sessions, your models',
    blurb: '„/“ öffnet die Befehlspalette: Modell wählen, Denktiefe einstellen, alle Befehle im Überblick.',
    blurbEn: 'Type “/” for the command palette: pick the model for this chat, set reasoning effort, see every command.',
    music: 'bed-calm',
    async run({ page, a, chat }) {
      await chat.send('Hi!');
      await chat.done();
      await a.wait(500);
      await a.tap(chat.input, { after: 300 });
      await a.type('/', { min: 60, max: 80 });
      await a.wait(1500);
      await a.mark('palette');
      await a.type('mo', { min: 120, max: 160 });
      await a.wait(700);
      await page.keyboard.press('Enter');
      await a.wait(1200);
      await a.mark('models');
      await a.tap(page.getByText('hermes-4-70b', { exact: true }).first(), { after: 1300 });
      await a.mark('picked');
      await a.tap(chat.input, { after: 300 });
      await a.type('/reasoning ', { min: 50, max: 90 });
      await a.wait(900);
      await a.type('high', { min: 70, max: 100 });
      await a.wait(500);
      await page.keyboard.press('Enter');
      await a.wait(1600);
      await a.mark('reasoning');
      await a.wait(800);
    },
  },
  {
    id: 'freigabe',
    file: '09-freigabe',
    title: 'Freigaben',
    titleEn: 'Approvals',
    caption: 'Befehle vom Handy freigeben',
    captionEn: 'Approve commands from your phone',
    blurb: 'Hermes will alte Downloads löschen: Befehl, Risiko und Frist sehen, dann „Einmal erlauben“.',
    blurbEn: 'Hermes wants to delete old files: see the exact command, the risk and the deadline, then tap “Allow once” – from your phone.',
    music: 'bed-calm',
    gif: true,
    async run({ page, a, chat }) {
      await chat.send('Clean up Downloads: remove files older than 90 days');
      await page.getByText('Hermes wants to run something').first().waitFor({ timeout: 30000 });
      await a.wait(600);
      await show(a, page.getByText('Hermes wants to run something').first(), 0.2);
      await a.wait(2400);
      await a.mark('card');
      await a.tap(page.getByRole('button', { name: /Allow this command once|Allow once/ }).first(), { after: 500 });
      await chat.done();
      await a.wait(800);
      await a.scroll(800);
      await a.wait(1800);
      await a.mark('done');
    },
  },
  {
    id: 'rezept',
    file: '10-rezept',
    title: 'Rezept mit Timern & Einkaufsliste',
    titleEn: 'Recipe with timers & shopping list',
    caption: 'Rezept: Portionen, Timer, Einkaufsliste',
    captionEn: 'Recipe: servings, timers, shopping list',
    blurb: 'Shakshuka: Portionen umrechnen, Timer starten, Zutaten auf die Einkaufsliste setzen und abhaken.',
    blurbEn: 'Shakshuka: scale servings, start a timer, send ingredients to a shopping list and tick them off.',
    music: 'bed-bright',
    gif: true,
    speed: 1.25,
    async run({ page, a, chat }) {
      await chat.send('Shakshuka recipe, please!');
      await chat.done();
      await show(a, page.getByText('Shakshuka', { exact: true }).first(), 0.08);
      await a.wait(1200);
      const more = page.getByLabel('More servings').first();
      await show(a, more, 0.3);
      await a.tap(more, { after: 700 });
      await a.tap(more, { after: 1100 });
      await a.mark('servings');
      const timer = page.getByRole('button', { name: /Timer 6 min/ }).first();
      await show(a, timer, 0.5);
      await a.tap(timer, { after: 1800 });
      await a.mark('timer');
      const list = page.getByRole('button', { name: /Add (?:ingredients|\d+ ingredients?) to shopping list/ }).first();
      await show(a, list, 0.45);
      await a.tap(list, { after: 1200 });
      await a.mark('confirm');
      await a.tap(page.getByRole('button', { name: 'Confirm' }).last(), { after: 1600 });
      // the confirmed ingredients arrive as a new "Einkaufsliste" checklist at the end of the chat
      const egg = page.getByRole('checkbox', { name: /eggs/ }).first();
      await show(a, egg, 0.3);
      await a.wait(500);
      await a.tap(egg, { after: 600 });
      await a.tap(page.getByRole('checkbox', { name: /red pepper/ }).first(), { after: 600 });
      await a.tap(page.getByRole('checkbox', { name: /feta/ }).first(), { after: 1200 });
      await a.mark('ticked');
    },
  },
  {
    id: 'langtask',
    file: '12-langtask',
    title: 'Lange Aufgabe im Hintergrund',
    titleEn: 'Long task, answer waiting',
    caption: 'Chat verlassen – Hermes arbeitet weiter',
    captionEn: 'Leave the chat – Hermes keeps working',
    blurb: 'Recherche-Auftrag mit mehreren Werkzeug-Schritten: in einen anderen Chat wechseln, die App meldet die fertige Antwort mit Quellen und Zusammenfassung.',
    blurbEn: 'A research task with several tool steps: switch to another chat, Hermes keeps working, and the app tells you when the answer – summary and sources – is ready. (Web app: push notification; Android: keeps running in the background.)',
    music: 'bed-bright',
    gif: true,
    speed: 1.4,
    setup: { prefs: { toolDetails: 'verbose' } },
    async run({ page, a, chat }) {
      await chat.send('Research self-hosted RSS readers and tell me which ones are worth trying.');
      await page.getByText('Tools & activity').first().waitFor({ timeout: 30000 });
      await a.wait(5200);
      await a.mark('steps');
      // leave the chat: drawer (the chat shows "running") → a fresh chat; the research keeps running in the background
      await a.tapXY(24, 26, { after: 1400 });
      await a.mark('drawer');
      await a.wait(1200);
      await a.tap(page.getByText('New chat', { exact: true }).last(), { after: 1500 });
      await a.mark('away');
      // peek at the chat list while it works, then close the drawer again
      await a.wait(1300);
      await a.tapXY(24, 26, { after: 1300 });
      await a.mark('running');
      await a.wait(1800);
      await a.tapXY(350, 520, { after: 700 });
      await page.getByText(/Answer from Hermes is ready/).first().waitFor({ timeout: 60000 });
      await a.wait(900);
      await a.mark('ready');
      await a.wait(1400);
      await a.tap(page.getByRole('button', { name: 'Open', exact: true }).first(), { after: 1500 });
      await a.mark('back');
      await show(a, page.getByText('Summary:').first(), 0.12);
      await a.wait(2200);
      await a.mark('summary');
      await a.scroll(700);
      await a.wait(2200);
      await a.mark('sources');
    },
  },
  {
    id: 'toolsteps',
    file: '13-toolsteps',
    title: 'Werkzeug-Schritte live',
    titleEn: 'Live tool steps',
    caption: 'Jeden Werkzeug-Schritt live sehen',
    captionEn: 'See every tool step live',
    blurb: 'Server-Check: Terminal, Datei lesen, Websuche – die Zeitleiste „Werkzeuge & Ablauf“ zeigt jeden Schritt live, am Ende eine kompakte Tabelle.',
    blurbEn: 'A server check: terminal commands, a file read and a web search appear live in “Tools & activity” – then a compact table.',
    music: 'bed-calm',
    speed: 1.25,
    setup: { prefs: { toolDetails: 'verbose' } },
    async run({ page, a, chat }) {
      await chat.send('Check my server: how full is the disk and which logs are the biggest? Show a table.');
      await page.getByText('Tools & activity').first().waitFor({ timeout: 30000 });
      await a.wait(1200);
      await a.tap(page.getByRole('button', { name: /^Tools and activity/ }).first(), { after: 1500 });
      await a.mark('live');
      await a.wait(5000);
      await a.mark('steps');
      await chat.done();
      await a.wait(900);
      await a.mark('done');
      await show(a, page.getByText('Disk and logs (sample server)').first(), 0.2);
      await a.wait(2600);
      await a.mark('table');
    },
  },
  // ---- 2026-10-15: what is new since the consumer set (paths, blocks, steady product images, bots, ⚡, fluid streaming) ----
  {
    id: 'wege',
    file: '14-wege',
    title: 'Wege vergleichen',
    titleEn: 'Compare your options',
    caption: 'Vier Wege, ein Tipp: dein Favorit',
    captionEn: 'Four ways, one tap: your pick',
    blurb: 'Wo sollen die Familienfotos liegen? Vier Wege als Ketten mit Urteil, ein Tipp wählt – Hermes antwortet mit einem Plan.',
    blurbEn: 'Where should the family photos live? Four ways as chains with a verdict; one tap picks, and Hermes answers with a plan.',
    music: 'bed-bright',
    gif: true,
    speed: 1.2,
    async run({ page, a, chat }) {
      await chat.send('What is the safest way to back up my family photos?');
      await chat.done();
      await show(a, page.getByText('Where should your family photos live?').first(), 0.1);
      await a.wait(1300);
      await a.mark('rows');
      await a.scroll(300, { ms: 900 });
      await a.wait(1100);
      await a.tap(page.getByText('Encrypted cloud copy', { exact: true }).first(), { after: 700 });
      await a.mark('picked');
      await a.wait(1700);
      await chat.done();
      await a.wait(600);
      await show(a, page.getByText('Your backup plan').first(), 0.15);
      await a.wait(900);
      await a.tap(page.getByRole('checkbox', { name: /Turn on automatic upload/ }).first(), { after: 700 });
      await a.tap(page.getByRole('checkbox', { name: /Pick a cloud service/ }).first(), { after: 1200 });
      await a.mark('plan');
    },
  },
  {
    id: 'bausteine',
    file: '15-bausteine',
    title: 'Aufbau auf einen Blick',
    titleEn: 'Setup at a glance',
    caption: 'Ein Router oder Mesh? Als Bild',
    captionEn: 'One router or a mesh? As a picture',
    blurb: 'Eine Frage zum WLAN – die Antwort kommt als Bausteine-Diagramm: Spalten, Geräte, gemeinsame Basis.',
    blurbEn: 'A question about home Wi-Fi: the answer arrives as a building-blocks diagram with columns, devices and a shared base.',
    music: 'bed-calm',
    gif: true,
    speed: 1.2,
    async run({ page, a, chat }) {
      await chat.send('Do I need a mesh Wi-Fi at home?');
      await chat.done();
      await show(a, page.getByText('Wi-Fi at home: one router or a mesh?').first(), 0.1);
      await a.wait(2200);
      await a.mark('blocks');
      await a.scroll(260, { ms: 1000 });
      await a.wait(2400);
      await a.mark('caption');
    },
  },
  {
    id: 'bilder',
    file: '16-bilder',
    title: 'Produktkarten ohne Springen',
    titleEn: 'Product cards that stay put',
    caption: 'Bilder laden – nichts springt',
    captionEn: 'Photos load in – nothing jumps',
    blurb: 'Auch bei langsamem Netz behalten Produktkarten ihre Größe: Bilder blenden ein, der Text darunter bleibt, wo er ist – und beim Wiederöffnen sofort.',
    blurbEn: 'Even on a slow connection, product cards keep their size: photos fade in, the text below stays where it is, and reopening the chat is instant.',
    music: 'bed-bright',
    speed: 1.3,
    setup: { imageDelay: 1800 },
    async run({ page, a, chat }) {
      await chat.send('Best noise-canceling headphones under €350? Top 5, please!');
      await chat.done();
      await show(a, page.getByText('Top 5: noise-canceling headphones under €350'), 0.1);
      await a.mark('loading');
      await a.wait(3200);
      await a.mark('loaded');
      await a.scroll(520, { ms: 1100 });
      await a.wait(1500);
      await a.scroll(520, { ms: 1100 });
      await a.wait(1300);
      await a.mark('scrolled');
      // away and back: the cards come back at their size, no reflow
      await a.tapXY(24, 26, { after: 1100 });
      await a.tap(page.getByText('New chat', { exact: true }).last(), { after: 1400 });
      await a.mark('away');
      await a.tapXY(24, 26, { after: 1100 });
      await a.tap(page.getByText(/Best noise-canceling headphones/).first(), { after: 1500 });
      await a.mark('back');
      await a.wait(1800);
    },
  },
  {
    id: 'bots',
    file: '17-bots',
    title: 'Bots für jede Aufgabe',
    titleEn: 'A bot for every job',
    caption: 'Der Bot-Wechsel im Modell-Menü',
    captionEn: 'Switch bots in the model menu',
    blurb: 'Jeder Hermes-Bot hat sein eigenes Modell, Gedächtnis und Können. Im Modell-Menü wählst du ihn pro Chat – hier der Küchen-Bot.',
    blurbEn: 'Each Hermes bot has its own model, memory and skills. Pick one per chat in the model menu: here, the Kitchen bot.',
    music: 'bed-calm',
    gif: true,
    speed: 1.2,
    async run({ page, a, chat }) {
      await a.wait(600);
      await a.tap(page.getByRole('button', { name: /choose model/ }).first(), { after: 1300 });
      await a.mark('picker');
      await a.wait(900);
      await a.tap(page.getByRole('radio', { name: /^Kitchen/ }).first(), { after: 1500 });
      await a.mark('kitchen');
      await a.tap(page.getByRole('button', { name: 'Close' }).last(), { after: 1000 });
      await a.mark('closed');
      await chat.send('What can I cook with eggs and spinach?');
      await chat.done();
      await a.wait(1400);
      await a.mark('answer');
      await a.tapXY(24, 26, { after: 1300 });
      await a.mark('drawer');
      await a.wait(1500);
    },
  },
  {
    id: 'schnell',
    file: '18-schnellfrage',
    title: 'Schnellfrage ⚡',
    titleEn: 'Quick answers ⚡',
    caption: 'Antwort in Sekunden – oder weiter mit Hermes',
    captionEn: 'Answers in seconds, then hand off to Hermes',
    blurb: 'Das ⚡ im Eingabefeld: ein schnelles Modell antwortet in ein paar Sekunden. Braucht es echte Daten, geht es mit einem Tipp als normaler Hermes-Chat weiter.',
    blurbEn: 'The ⚡ in the composer: a fast model answers in a couple of seconds. When it needs real data, one tap continues as a normal Hermes chat.',
    music: 'bed-bright',
    gif: true,
    speed: 1.1,
    setup: { bindFetch: true },
    async run({ page, a }) {
      // the chat and the quick thread both keep a composer mounted → address them by placeholder
      const say = async (placeholder, text, { enter = false } = {}) => {
        const box = page.getByPlaceholder(placeholder).filter({ visible: true }).first();
        await a.tap(box, { after: 250 });
        await box.focus();
        await a.type(text);
        await a.wait(350);
        // right after the hand-off the "New Hermes chat" toast still covers the screen for taps → Enter sends
        if (enter) await page.keyboard.press('Enter');
        else await a.tap(page.getByLabel('Send', { exact: true }).filter({ visible: true }).first(), { after: 200 });
      };
      const idle = async () => {
        await page.getByLabel('Stop answer').filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await page.getByLabel('Stop answer').filter({ visible: true }).first().waitFor({ state: 'hidden', timeout: 60000 });
      };
      await a.wait(500);
      await a.tap(page.getByRole('button', { name: /^Ask a quick question/ }).first(), { after: 1500 });
      await a.mark('empty');
      await a.tap(page.getByRole('button', { name: /^Ask quickly: What is 72/ }).first(), { after: 300 });
      await page.getByText(/22\.2 °C/).first().waitFor({ timeout: 30000 });
      await idle();
      await a.wait(1300);
      await a.mark('answer1');
      await say('Ask a quick question …', 'Is it going to rain in Rome this weekend?');
      await page.getByText(/Continue with Hermes/).last().waitFor({ timeout: 30000 });
      await idle();
      await a.wait(1200);
      await a.mark('answer2');
      await a.tap(page.getByText(/Continue with Hermes/).last(), { after: 1600 });
      await a.mark('handoff');
      await say('Message Hermes', 'Yes, please check it for real', { enter: true });
      await a.wait(3500);
      await a.mark('agent');
      await idle();
      await a.wait(900);
      await show(a, page.getByText('Rome', { exact: true }).first(), 0.2).catch(() => {});
      await a.wait(1800);
      await a.mark('forecast');
    },
  },
  {
    id: 'fluessig',
    file: '19-fluessig',
    title: 'Streaming ohne Ruckeln',
    titleEn: 'Fluid streaming',
    caption: 'Lange Antwort, butterweich',
    captionEn: 'A long answer, perfectly smooth',
    blurb: 'Auch lange Antworten laufen flüssig mit 60 Bildern pro Sekunde: Text erscheint live, Karten blenden sanft ein.',
    blurbEn: 'Even long answers stream at a steady 60 frames per second: text appears live and cards fade in softly.',
    music: 'bed-bright',
    speed: 1.1,
    async run({ page, a, chat }) {
      await chat.send('Plan a relaxed long weekend in Lisbon for me.');
      await a.wait(3500);
      await a.mark('start');
      await chat.done(90000);
      await a.wait(900);
      await a.mark('done');
      await a.scroll(-900, { ms: 1400 });
      await a.wait(900);
      await a.scroll(700, { ms: 1400 });
      await a.wait(1200);
      await a.mark('scrolled');
    },
  },
  {
    id: 'sperre',
    file: '20-modellsperre',
    title: 'Modell pro Chat, gesichert',
    titleEn: 'A model per chat, locked in',
    caption: 'Modell wählen – der Chat merkt es sich',
    captionEn: 'Pick a model: the chat remembers it',
    blurb: 'Das gewählte Modell wird beim Hermes-Server für den Chat festgehalten; die Kopfzeile zeigt das Schloss.',
    blurbEn: 'The model you pick is locked on the Hermes session for that chat; the header shows a lock.',
    music: 'bed-calm',
    speed: 1.15,
    async run({ page, a, chat }) {
      await a.wait(500);
      await a.tap(page.getByRole('button', { name: /choose model/ }).first(), { after: 1300 });
      await a.mark('picker');
      await a.tap(page.getByRole('button', { name: /^Model hermes-4-70b/ }).first(), { after: 1400 });
      await a.mark('picked');
      await chat.send('Hi!');
      await chat.done();
      await a.wait(2200);
      await a.mark('locked');
      await a.wait(1200);
    },
  },
  {
    id: 'nichtgesendet',
    file: '21-nichtgesendet',
    title: 'Nichts geht verloren',
    titleEn: 'Nothing gets lost',
    caption: 'App beendet? „Erneut senden“',
    captionEn: 'App closed mid-send? “Send again”',
    blurb: 'Wird die App beendet, bevor der Server die Nachricht bestätigt hat, bleibt sie erhalten: „Nicht gesendet“ mit „Erneut senden“.',
    blurbEn: 'If the app closes before the server confirmed a message, it is kept: “Not sent”, with “Send again”.',
    music: 'bed-calm',
    speed: 1.1,
    async run({ page, a, chat }) {
      await chat.send('When does the bus timetable change this winter?');
      await a.wait(2600);
      await a.mark('sent');
      // the app is closed before the server answers
      await page.reload({ waitUntil: 'load' });
      await page.getByText(/Not sent/).first().waitFor({ timeout: 60000 });
      await a.wait(900);
      await a.mark('notsent');
      await a.wait(1500);
      await a.tap(page.getByText('Send again', { exact: true }).first(), { after: 800 });
      await a.mark('resent');
      await chat.done();
      await a.wait(1500);
      await a.mark('answer');
    },
  },
  {
    id: 'designs',
    file: '11-designs',
    title: 'Designs',
    titleEn: 'Themes',
    caption: 'Hell, dunkel & eigene Designs',
    captionEn: 'Light, dark and custom themes',
    blurb: 'Einstellungen → Darstellung: Standard, OLED-Schwarz, Papier, Nord – live umgeschaltet.',
    blurbEn: 'Settings → Appearance: Standard, OLED black, Paper, Nord – switched live.',
    music: 'bed-calm',
    speed: 1.1,
    async run({ page, a, chat }) {
      await chat.send('Where can we eat in Rome tonight? We’re near the Pantheon.', { typing: { min: 12, max: 28 } });
      await chat.done();
      await a.wait(500);
      await a.tapXY(24, 26, { after: 900 }); // drawer (hamburger)
      await a.tap(page.getByRole('button', { name: 'Settings', exact: true }).first(), { after: 1200 });
      await a.mark('settings');
      await show(a, page.getByLabel('Theme Paper').first(), 0.3);
      await a.mark('appearance');
      const mode = (name) => a.tap(page.getByRole('tab', { name, exact: true }).first(), { after: 500 });
      const theme = (name) => a.tap(page.getByLabel(`Theme ${name}`).first(), { after: 950 });
      await mode('Dark');
      await theme('OLED black');
      await mode('Light');
      await theme('Paper');
      await mode('Dark');
      await theme('Nord');
      await a.mark('nord');
      await a.tap(page.getByRole('button', { name: /Done|Close|Back/ }).first(), { after: 1800 });
      await a.mark('chat');
    },
  },
];
