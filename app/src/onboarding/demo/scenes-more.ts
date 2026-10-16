// The remaining demo scenarios (charts, tables, forms, calculators, weather, places, …): one per block type of the
// hui protocol, fully offline (no photos or maps), fictional data, written in en/de/es.
// Layout regression fixtures for the Android layout checks stay German-only (see `gameTable`, `longWords`).
import { calculatorHtml, loanHtml } from './html.ts';
import { DAYS, L, days, hui, isoDay, langOf, tool, xy, type DemoLang, type DemoScenario, type DemoStep } from './kit.ts';
import { prompt } from './prompts.ts';
import { chips } from './scenes-core.ts';

const LOCALE: Record<DemoLang, string> = { de: 'de-DE', en: 'en-GB', es: 'es-ES' };

export const chart: DemoScenario = {
  format: 'chart',
  steps: (ctx) => [
    { text: L(ctx, 'Hier der Verlauf der Temperaturen und der Niederschlagsmenge:\n\n', 'Here is the course of temperatures and precipitation:\n\n', 'Aquí tienes la evolución de las temperaturas y las precipitaciones:\n\n') },
    {
      text: hui({
        type: 'chart',
        kind: 'line',
        title: L(ctx, 'Temperatur in der Beispielstadt (°C)', 'Temperature in Example City (°C)', 'Temperatura en Ciudad Ejemplo (°C)'),
        unit: '°C',
        xLabel: L(ctx, 'Tag', 'Day', 'Día'),
        yLabel: L(ctx, 'Temperatur', 'Temperature', 'Temperatura'),
        basis: 'illustrative',
        series: [
          { name: 'Max', data: xy(days(ctx, [18, 21, 19, 24, 22, 17, 15])) },
          { name: 'Min', data: xy(days(ctx, [9, 11, 10, 13, 12, 8, 7])) },
        ],
      }),
    },
    {
      text:
        L(ctx, '\nUnd als Balken:\n\n', '\nAnd as bars:\n\n', '\nY en barras:\n\n') +
        hui({ type: 'chart', kind: 'bar', title: L(ctx, 'Niederschlag (mm)', 'Precipitation (mm)', 'Precipitación (mm)'), basis: 'illustrative', series: [{ name: 'mm', data: xy(days(ctx, [0, 2, 8, 1, 0, 12, 5])) }] }) +
        L(ctx, '\nTendenz: Wochenende nass und kühler.\n\n', '\nTrend: a wetter, cooler weekend.\n\n', '\nTendencia: fin de semana más húmedo y fresco.\n\n') +
        chips(ctx, 'prices', 'mixed', 'tour'),
    },
  ],
};

export const table: DemoScenario = {
  format: 'table',
  steps: (ctx) => [
    { text: L(ctx, 'Die größten Städte im deutschsprachigen Raum:\n\n', 'The largest cities in the German-speaking world:\n\n', 'Las ciudades más grandes del ámbito germanohablante:\n\n') },
    {
      text: hui({
        type: 'table',
        caption: L(ctx, 'Einwohner (Mio.)', 'Inhabitants (millions)', 'Habitantes (millones)'),
        source: L(ctx, 'Beispieldaten', 'Sample data', 'Datos de ejemplo'),
        basis: 'illustrative',
        columns: [L(ctx, 'Stadt', 'City', 'Ciudad'), L(ctx, 'Land', 'Country', 'País'), L(ctx, 'Einwohner', 'Inhabitants', 'Habitantes'), L(ctx, 'Fläche km²', 'Area km²', 'Superficie km²')],
        rows: [
          ['Berlin', 'DE', 3.7, 892],
          [L(ctx, 'Wien', 'Vienna', 'Viena'), 'AT', 2.0, 415],
          ['Hamburg', 'DE', 1.9, 755],
          [L(ctx, 'München', 'Munich', 'Múnich'), 'DE', 1.5, 311],
          [L(ctx, 'Zürich', 'Zurich', 'Zúrich'), 'CH', 0.44, 92],
          ['Graz', 'AT', 0.3, 127],
        ],
      }),
    },
    { text: L(ctx, '\nBerlin ist mit Abstand die größte.', '\nBerlin is by far the largest.', '\nBerlín es, con diferencia, la mayor.') },
  ],
};

export const wideTable: DemoScenario = {
  format: 'table',
  steps: (ctx) => [
    { text: L(ctx, 'Drei Alltagsgeräte im Überblick – mit langen Einträgen, wie sie in echten Antworten vorkommen:\n\n', 'Three everyday devices at a glance – with long entries, as they appear in real answers:\n\n', 'Tres dispositivos cotidianos de un vistazo, con entradas largas como las de las respuestas reales:\n\n') },
    {
      text: hui({
        type: 'table',
        caption: L(ctx, 'Geräte für den Arbeitsalltag', 'Devices for the working day', 'Dispositivos para el día a día'),
        source: L(ctx, 'Beispieldaten', 'Sample data', 'Datos de ejemplo'),
        basis: 'illustrative',
        columns: [L(ctx, 'Gerät', 'Device', 'Dispositivo'), L(ctx, 'Einsatz', 'Use', 'Uso'), L(ctx, 'Akku', 'Battery', 'Batería'), L(ctx, 'Gewicht', 'Weight', 'Peso'), L(ctx, 'Besonderheit', 'Special feature', 'Particularidad'), L(ctx, 'Fazit', 'Verdict', 'Conclusión')],
        rows: [
          [L(ctx, 'Beispiel Phone Mini', 'Example Phone Mini', 'Teléfono Mini de ejemplo'), L(ctx, 'Telefonieren, Nachrichten und kurze Notizen zwischendurch', 'Calls, messages and quick notes in between', 'Llamadas, mensajes y notas rápidas entre medias'), L(ctx, 'bis zu 18 Stunden bei gemischter Nutzung', 'up to 18 hours of mixed use', 'hasta 18 horas de uso mixto'), L(ctx, '162 Gramm', '162 grams', '162 gramos'), L(ctx, 'Sehr kompakt, passt in jede Hosentasche', 'Very compact, fits any pocket', 'Muy compacto, cabe en cualquier bolsillo'), L(ctx, 'Für Wenignutzer völlig ausreichend', 'Perfectly enough for light users', 'Más que suficiente para uso ligero')],
          [L(ctx, 'Beispiel Tablet Studio', 'Example Tablet Studio', 'Tableta Studio de ejemplo'), L(ctx, 'Zeichnen, Lesen und Präsentationen unterwegs', 'Drawing, reading and presentations on the go', 'Dibujar, leer y dar presentaciones en movimiento'), L(ctx, 'rund 11 Stunden bei voller Helligkeit', 'around 11 hours at full brightness', 'unas 11 horas a brillo máximo'), L(ctx, '682 Gramm', '682 grams', '682 gramos'), L(ctx, 'Stift liegt bei und haftet magnetisch am Rand', 'Pen included and held magnetically on the edge', 'Incluye lápiz que se sujeta magnéticamente al borde'), L(ctx, 'Stark für kreative Arbeit ohne Schreibtisch', 'Strong for creative work away from a desk', 'Genial para trabajo creativo sin escritorio')],
          [L(ctx, 'Beispiel Notebook Lang', 'Example Notebook Long', 'Portátil Largo de ejemplo'), L(ctx, 'Schreiben, Tabellen und Videokonferenzen den ganzen Tag', 'Writing, spreadsheets and video calls all day', 'Escribir, hojas de cálculo y videollamadas todo el día'), L(ctx, 'bis zu 21 Stunden im Energiesparmodus', 'up to 21 hours in power-saving mode', 'hasta 21 horas en modo ahorro'), L(ctx, '1,29 Kilogramm', '1.29 kilograms', '1,29 kilogramos'), L(ctx, 'Lüfterlos und damit im Alltag praktisch lautlos', 'Fanless and so practically silent day to day', 'Sin ventilador y, por tanto, casi silencioso'), L(ctx, 'Die sichere Wahl für lange Arbeitstage', 'The safe choice for long working days', 'La elección segura para jornadas largas')],
        ],
      }),
    },
    { text: L(ctx, '\nAuf dem Handy wird jede Zeile zu einer Karte – ohne seitliches Scrollen.', '\nOn a phone every row becomes a card – no sideways scrolling.', '\nEn el móvil cada fila se convierte en una tarjeta, sin desplazamiento lateral.') },
  ],
};

// native-layout regression fixtures (Android; documented in scripts/ux-check/README.md): German-only on purpose,
// fictional titles. A 3-column text table with long cells must wrap to the phone width, long German words must not
// break mid-word.
export const gameTable: DemoScenario = {
  format: 'table',
  steps: () => [
    { text: 'Acht fiktive Spiele auf einem Mittelklasse-Handy (Beispieldaten):\n\n' },
    {
      text: hui({
        type: 'table',
        caption: 'Beispiel-Chip, Emulator, meist 1×–2×',
        basis: 'sourced',
        source: 'Erfundene Kompatibilitätslisten und Forenberichte (Stand Sept. 2026), https://www.example.com/kompatibilitaet',
        columns: ['Spiel', 'Was ruckelt', 'Bericht'],
        rows: [
          ['Sternjäger Zero', 'Kaum', 'Bis 3×, Dips nur in großen Zwischensequenzen'],
          ['Küstenrennen Deluxe', 'Kaum', '60 Bilder bei 2×, gelegentlich Nachladeruckler beim schnellen Fahren'],
          ['Drachenpfad', 'Stellenweise', 'Läuft rund, nur in Städten mit vielen Figuren gibt es kurze Einbrüche'],
          ['Turmwächter Chronik', 'Ja', 'Nur 1×, Schatten und Nebel kosten viel Leistung, Texturen flackern ab und zu'],
          ['Nachtschicht Racer', 'Kaum', 'Stabil bei 2×, Musik setzt in seltenen Fällen kurz aus'],
          ['Wolkenburg', 'Ja', 'Nur mit Kompromissen spielbar, Kameraschwenks ruckeln deutlich'],
          ['Pixelgeist', 'Nein', 'Läuft auf dem Handy ohne Einschränkungen in doppelter Auflösung'],
          ['Eisenfaust Arena', 'Stellenweise', 'Gute Bildrate, aber Effekte bei Spezialangriffen führen zu kurzen Pausen'],
        ],
      }),
    },
    { text: '\nDie Tabelle bricht an der Handybreite um; lange Wörter werden nicht mitten im Wort getrennt.' },
  ],
};

export const longWords: DemoScenario = {
  format: 'compare',
  steps: () => [
    { text: 'Zwei Bildschirmtechniken im Vergleich (Beispieltext):\n\n' },
    {
      text: hui({
        type: 'compare',
        basis: 'sourced',
        source: 'Erfundene Datenblätter und Testberichte 2025–2026 (Stand Sept. 2026), https://www.example.com/bildschirmtechnik',
        columns: [
          { title: 'Selbstleuchter', badge: 'Kontrast', items: ['Pixel leuchtet selbst, kein Backlight', 'Aus = echtes Schwarz, praktisch unendlicher Kontrast', 'Schnell, weite Blickwinkel, sehr dünn'], cons: ['Einbrennen bei statischen Elementen möglich', 'Teurer, Vollflächen-Helligkeit oft niedriger'] },
          { title: 'Hintergrundlicht', badge: 'Helligkeit', items: ['Kristalle filtern eine Hintergrundbeleuchtung', 'Schwarz bleibt dunkelgrau, Licht kann durchscheinen', 'Backlight läuft immer, Strom eher konstant'], pros: ['Kein permanentes Einbrennen', 'Günstiger, gut bei Dauerbild'] },
        ],
      }),
    },
    { text: '\nFilme und dunkle Räume: Selbstleuchter. Büro und Sonne: Hintergrundlicht.' },
  ],
};

export const stats: DemoScenario = {
  format: 'stats',
  steps: (ctx) => [
    { text: L(ctx, 'Deine Kennzahlen diese Woche:\n\n', 'Your key figures this week:\n\n', 'Tus cifras clave de esta semana:\n\n') },
    {
      text: hui({
        type: 'stats',
        items: [
          { label: L(ctx, 'Schritte', 'Steps', 'Pasos'), value: L(ctx, '8.421', '8,421', '8.421'), delta: L(ctx, '+12 %', '+12 %', '+12 %'), trend: 'up' },
          { label: L(ctx, 'Schlaf', 'Sleep', 'Sueño'), value: L(ctx, '6,8 h', '6.8 h', '6,8 h'), delta: L(ctx, '-0,4 h', '-0.4 h', '-0,4 h'), trend: 'down' },
          { label: L(ctx, 'Puls (Ruhe)', 'Resting pulse', 'Pulso en reposo'), value: '58', delta: '±0', trend: 'flat' },
        ],
      }),
    },
    {
      text:
        '\n' +
        hui({ type: 'callout', tone: 'warning', title: L(ctx, 'Schlaf', 'Sleep', 'Sueño'), text: L(ctx, 'Du schläfst unter deinem Ziel von 7,5 h.', 'You are sleeping below your target of 7.5 h.', 'Duermes menos que tu objetivo de 7,5 h.') }) +
        hui({ type: 'progress', label: L(ctx, 'Wochenziel Schritte', 'Weekly step goal', 'Objetivo semanal de pasos'), value: 52, max: 70 }),
    },
  ],
};

export const compare: DemoScenario = {
  format: 'compare',
  steps: (ctx) => [
    { text: L(ctx, 'Vergleich der drei Tarife:\n\n', 'Comparison of the three plans:\n\n', 'Comparación de las tres tarifas:\n\n') },
    {
      text: hui({
        type: 'compare',
        columns: [
          { title: 'Basic', items: ['5 GB', L(ctx, '9 € / Monat', '€9 / month', '9 € / mes'), L(ctx, 'Kündigung 1 Monat', '1 month notice', 'Baja con 1 mes de aviso')], cons: [L(ctx, 'Kein 5G', 'No 5G', 'Sin 5G')] },
          { title: 'Plus', badge: L(ctx, 'Empfohlen', 'Recommended', 'Recomendado'), highlight: true, items: ['50 GB', L(ctx, '15 € / Monat', '€15 / month', '15 € / mes'), L(ctx, 'Kündigung 1 Monat', '1 month notice', 'Baja con 1 mes de aviso')], pros: [L(ctx, '5G inklusive', '5G included', '5G incluido')] },
          { title: 'Max', items: [L(ctx, 'Unlimitiert', 'Unlimited', 'Ilimitado'), L(ctx, '29 € / Monat', '€29 / month', '29 € / mes'), L(ctx, 'EU-Roaming', 'EU roaming', 'Roaming UE')], pros: [L(ctx, '5G inklusive', '5G included', '5G incluido')], cons: [L(ctx, 'Klar teurer', 'More expensive', 'Más caro')] },
        ],
      }),
    },
    { text: L(ctx, '\nFür die meisten passt **Plus** am besten.\n\n', '\n**Plus** fits most people best.\n\n', '\n**Plus** es lo que mejor encaja con la mayoría.\n\n') + chips(ctx, 'products', 'loan', 'tour') },
  ],
};

export const form: DemoScenario = {
  format: 'form',
  steps: (ctx) => [
    { text: L(ctx, 'Gib die Eckdaten ein, dann rechne ich den Kredit durch:\n\n', 'Enter the basics and I will work through the loan:\n\n', 'Introduce los datos básicos y calculo el préstamo:\n\n') },
    {
      text: hui({
        type: 'form',
        id: 'kredit',
        title: L(ctx, 'Kreditanfrage', 'Loan request', 'Solicitud de préstamo'),
        fields: [
          { name: 'betrag', label: L(ctx, 'Betrag', 'Amount', 'Importe'), kind: 'number', unit: '€', min: 1000, max: 100000, default: 20000 },
          { name: 'laufzeit', label: L(ctx, 'Laufzeit (Jahre)', 'Term (years)', 'Plazo (años)'), kind: 'slider', min: 1, max: 15, step: 1, default: 5 },
          { name: 'typ', label: L(ctx, 'Zinsbindung', 'Rate type', 'Tipo de interés'), kind: 'select', options: [L(ctx, 'fix', 'fixed', 'fijo'), L(ctx, 'variabel', 'variable', 'variable')], default: L(ctx, 'fix', 'fixed', 'fijo') },
          { name: 'sondertilgung', label: L(ctx, 'Sondertilgung', 'Extra repayments', 'Amortización extra'), kind: 'toggle', default: false },
          { name: 'start', label: L(ctx, 'Start', 'Start', 'Inicio'), kind: 'date' },
        ],
        submit: { label: L(ctx, 'Berechnen', 'Calculate', 'Calcular') },
      }),
    },
  ],
};

export const steps: DemoScenario = {
  format: 'steps',
  steps: (ctx) => [
    { text: L(ctx, 'So installierst du es:\n\n', 'This is how you install it:\n\n', 'Así se instala:\n\n') },
    {
      text: hui({
        type: 'steps',
        current: 1,
        items: [
          { title: L(ctx, 'Paket laden', 'Download the package', 'Descarga el paquete'), detail: L(ctx, 'Lade das Archiv von der Projektseite.', 'Download the archive from the project page.', 'Descarga el archivo de la página del proyecto.') },
          { title: L(ctx, 'Entpacken', 'Unpack', 'Descomprime'), detail: L(ctx, 'Mit `tar -xf paket.tar.gz`.', 'With `tar -xf package.tar.gz`.', 'Con `tar -xf paquete.tar.gz`.') },
          { title: L(ctx, 'Konfigurieren', 'Configure', 'Configura') },
          { title: L(ctx, 'Starten', 'Start', 'Inicia'), detail: L(ctx, 'Mit `./run`.', 'With `./run`.', 'Con `./run`.') },
        ],
      }),
    },
    { text: L(ctx, '\nSag Bescheid, wenn du bei Schritt 2 hängst.', '\nLet me know if you get stuck at step 2.', '\nAvísame si te atascas en el paso 2.') },
  ],
};

export const timeline: DemoScenario = {
  format: 'timeline',
  steps: (ctx) => [
    { text: L(ctx, 'Der Ablauf deiner Reise:\n\n', 'The schedule of your trip:\n\n', 'El itinerario de tu viaje:\n\n') },
    {
      text: hui({
        type: 'timeline',
        items: [
          { time: '07:10', title: L(ctx, 'Abflug Wien', 'Departure Vienna', 'Salida de Viena'), detail: L(ctx, 'Terminal 3, Gate C12', 'Terminal 3, gate C12', 'Terminal 3, puerta C12') },
          { time: '09:05', title: L(ctx, 'Ankunft Lissabon', 'Arrival Lisbon', 'Llegada a Lisboa') },
          { time: '11:00', title: L(ctx, 'Check-in Hotel', 'Hotel check-in', 'Registro en el hotel'), detail: 'Rua Exemplo 12' },
          { time: '19:30', title: L(ctx, 'Abendessen', 'Dinner', 'Cena'), detail: L(ctx, 'Reservierung auf „Silva“', 'Reservation under “Silva”', 'Reserva a nombre de «Silva»') },
        ],
      }),
    },
  ],
};

export const buttons: DemoScenario = {
  format: 'text',
  steps: (ctx) => [
    { text: L(ctx, 'Was möchtest du als Nächstes tun?\n\n', 'What would you like to do next?\n\n', '¿Qué quieres hacer a continuación?\n\n') },
    {
      text: hui({
        type: 'buttons',
        items: [
          { label: L(ctx, 'Details anzeigen', 'Show details', 'Mostrar detalles'), style: 'primary', action: { type: 'send', text: prompt('mixed', langOf(ctx)) } },
          { label: L(ctx, 'Link öffnen', 'Open a link', 'Abrir un enlace'), style: 'secondary', action: { type: 'open_url', url: 'https://example.com' } },
          { label: L(ctx, 'Kopieren', 'Copy', 'Copiar'), style: 'secondary', action: { type: 'copy', text: L(ctx, 'Hallo aus der Demo', 'Hello from the demo', 'Hola desde la demo') } },
        ],
      }),
    },
    { text: '\n' + chips(ctx, 'chart', 'compare', 'loan') },
  ],
};

export const calculator: DemoScenario = {
  format: 'calculator',
  steps: (ctx) => [
    { text: L(ctx, 'Hier ist ein einfacher Taschenrechner (generiertes HTML in einer Sandbox):\n\n', 'Here is a simple pocket calculator (generated HTML in a sandbox):\n\n', 'Aquí tienes una calculadora sencilla (HTML generado en un sandbox):\n\n') },
    { text: '```hui-html\n' + calculatorHtml(langOf(ctx)) + '\n```\n' },
    { text: L(ctx, '\nTipp: Probiere `12*7=`.', '\nTip: try `12*7=`.', '\nConsejo: prueba `12*7=`.') },
  ],
};

export const loan: DemoScenario = {
  format: 'calculator',
  steps: (ctx) => [
    { text: L(ctx, 'Hier ist ein interaktiver Kreditrechner. Die Startwerte sind **20.000 €** bei 6,5 % Sollzins und 5 Jahren Laufzeit:\n\n', 'Here is an interactive loan calculator. The starting values are **€20,000** at 6.5 % interest over 5 years:\n\n', 'Aquí tienes una calculadora de préstamos interactiva. Valores iniciales: **20.000 €** al 6,5 % de interés a 5 años:\n\n') },
    { text: '```hui-html\n' + loanHtml(langOf(ctx)) + '\n```\n' },
    { text: L(ctx, '\nMit den Schiebereglern kannst du Betrag, Zins und Laufzeit ändern. Die Rate wird nach der Annuitätenformel berechnet.\n\n', '\nUse the sliders to change amount, interest and term. The instalment uses the annuity formula.\n\n', '\nCon los deslizadores cambias importe, interés y plazo. La cuota se calcula con la fórmula de anualidad.\n\n') + chips(ctx, 'mixed', 'tour') },
  ],
};

export const mixed: DemoScenario = {
  format: 'interactive',
  steps: (ctx) => [
    { text: L(ctx, '# Wochenbericht\n\nIch habe die Daten ausgewertet und alles zusammengefasst.\n\n', '# Weekly report\n\nI analysed the data and summarised everything.\n\n', '# Informe semanal\n\nHe analizado los datos y lo he resumido todo.\n\n') },
    tool.file('~/data/week.csv', 700),
    { text: L(ctx, '## Überblick\n\n', '## Overview\n\n', '## Resumen\n\n') },
    {
      text: hui({
        type: 'stats',
        items: [
          { label: L(ctx, 'Umsatz', 'Revenue', 'Ingresos'), value: L(ctx, '12.480 €', '€12,480', '12.480 €'), delta: L(ctx, '+4,2 %', '+4.2 %', '+4,2 %'), trend: 'up' },
          { label: L(ctx, 'Kunden', 'Customers', 'Clientes'), value: '318', delta: '+9', trend: 'up' },
          { label: L(ctx, 'Retouren', 'Returns', 'Devoluciones'), value: L(ctx, '2,1 %', '2.1 %', '2,1 %'), delta: L(ctx, '-0,3 pp', '-0.3 pp', '-0,3 pp'), trend: 'down' },
        ],
      }),
    },
    { text: L(ctx, '\n## Verlauf\n\nDer Umsatz stieg über die Woche fast durchgehend:\n\n', '\n## Trend\n\nRevenue rose almost every day of the week:\n\n', '\n## Evolución\n\nLos ingresos subieron casi cada día de la semana:\n\n') },
    {
      text: hui({
        type: 'chart',
        kind: 'area',
        title: L(ctx, 'Umsatz pro Tag (€)', 'Revenue per day (€)', 'Ingresos por día (€)'),
        basis: 'illustrative',
        series: [{ name: L(ctx, 'Umsatz', 'Revenue', 'Ingresos'), data: [1450, 1620, 1580, 1910, 2230, 2010, 1680].map((y, i) => ({ x: DAYS[langOf(ctx)][i], y })) }],
      }),
    },
    { text: L(ctx, '\n## Details\n\n', '\n## Details\n\n', '\n## Detalles\n\n') },
    {
      text: hui({
        type: 'table',
        basis: 'illustrative',
        columns: [L(ctx, 'Kategorie', 'Category', 'Categoría'), L(ctx, 'Umsatz', 'Revenue', 'Ingresos'), L(ctx, 'Anteil', 'Share', 'Cuota')],
        rows: [['Hardware', L(ctx, '6.100 €', '€6,100', '6.100 €'), '49 %'], ['Software', L(ctx, '4.300 €', '€4,300', '4.300 €'), '34 %'], ['Service', L(ctx, '2.080 €', '€2,080', '2.080 €'), '17 %']],
      }),
    },
    {
      text:
        L(
          ctx,
          '\n**Fazit:** Gute Woche. Mögliche nächste Schritte:\n\n1. Retouren im Bereich Hardware prüfen\n2. Wochenende stärker bewerben\n3. Preisänderung simulieren\n\n',
          '\n**Summary:** a good week. Possible next steps:\n\n1. Check hardware returns\n2. Promote the weekend more\n3. Simulate a price change\n\n',
          '\n**Conclusión:** buena semana. Posibles próximos pasos:\n\n1. Revisar las devoluciones de hardware\n2. Promocionar más el fin de semana\n3. Simular un cambio de precio\n\n',
        ) + chips(ctx, 'loan', 'checklist', 'quiz'),
    },
  ],
};

export const tool_: DemoScenario = {
  format: 'text',
  steps: (ctx) => [
    { text: L(ctx, 'Ich schaue kurz nach der Uhrzeit.', 'Let me check the time.', 'Miro la hora un momento.') },
    { reasoning: L(ctx, 'Der Nutzer fragt nach der Zeit; ein Terminal-Aufruf genügt.', 'The user asks for the time; one terminal call is enough.', 'El usuario pregunta la hora; basta una llamada al terminal.') },
    tool.terminal('date', 900),
    { text: L(ctx, '\n\nEs ist jetzt **', '\n\nIt is now **', '\n\nAhora son las **') + ctx.now.toLocaleString(LOCALE[langOf(ctx)], { dateStyle: 'full', timeStyle: 'short' }) + '**.' },
  ],
};

export const tools2: DemoScenario = {
  format: 'text',
  steps: (ctx) => [
    { text: L(ctx, 'Ich recherchiere das parallel.', 'I research this in parallel.', 'Lo investigo en paralelo.') },
    tool.search(L(ctx, 'Wetter morgen Beispielstadt', 'weather tomorrow Example City', 'tiempo mañana Ciudad Ejemplo'), 1200),
    tool.file('~/notes/todo.md', 600),
    { status: { kind: 'lifecycle', text: L(ctx, 'Warte auf Provider (Wiederholung 1/3) …', 'Waiting for provider (retry 1/3) …', 'Esperando al proveedor (reintento 1/3) …') } },
    { wait: 1200 },
    { text: L(ctx, '\n\nFertig: Morgen wird es mild, die Notizen enthalten 3 offene Punkte.', '\n\nDone: tomorrow will be mild, and your notes hold 3 open items.', '\n\nListo: mañana será templado y tus notas tienen 3 puntos abiertos.') },
  ],
};

export const weather: DemoScenario = {
  format: 'weather',
  steps: (ctx) => [
    tool.search(L(ctx, 'Wetter Beispielstadt', 'weather Example City', 'tiempo Ciudad Ejemplo'), 800),
    { text: L(ctx, 'So wird das Wetter in der Beispielstadt:\n\n', 'Here is the weather for Example City:\n\n', 'Así estará el tiempo en Ciudad Ejemplo:\n\n') },
    {
      text: hui({
        type: 'weather',
        location: L(ctx, 'Beispielstadt', 'Example City', 'Ciudad Ejemplo'),
        unit: 'C',
        basis: 'illustrative',
        current: { temp: 17, condition: 'partly', feelsLike: 16, wind: 14, humidity: 58, precip: 20 },
        hourly: [
          { time: '12:00', temp: 15, condition: 'cloudy' },
          { time: '13:00', temp: 16, condition: 'partly' },
          { time: '14:00', temp: 17, condition: 'partly' },
          { time: '15:00', temp: 18, condition: 'sunny' },
          { time: '16:00', temp: 18, condition: 'sunny' },
          { time: '17:00', temp: 16, condition: 'cloudy', precip: 10 },
          { time: '18:00', temp: 15, condition: 'showers', precip: 55 },
          { time: '19:00', temp: 13, condition: 'rain', precip: 70 },
          { time: '20:00', temp: 12, condition: 'cloudy' },
          { time: '21:00', temp: 11, condition: 'clear' },
        ],
        daily: [
          { date: isoDay(ctx.now, 0), min: 11, max: 19, condition: 'showers', precip: 60 },
          { date: isoDay(ctx.now, 1), min: 10, max: 17, condition: 'rain', precip: 80 },
          { date: isoDay(ctx.now, 2), min: 9, max: 16, condition: 'cloudy', precip: 20 },
          { date: isoDay(ctx.now, 3), min: 8, max: 18, condition: 'partly' },
          { date: isoDay(ctx.now, 4), min: 10, max: 21, condition: 'sunny' },
        ],
      }),
    },
    { text: L(ctx, '\nAbends wird es nass – die Jacke lohnt sich.', '\nRain moves in during the evening – bring a jacket.', '\nPor la noche lloverá: vale la pena llevar chaqueta.') },
  ],
};

export const places: DemoScenario = {
  format: 'places',
  steps: (ctx) => [
    tool.search(L(ctx, 'Restaurants Beispielstadt', 'restaurants Example City', 'restaurantes Ciudad Ejemplo'), 800),
    { text: L(ctx, 'Drei fiktive Lokale in Laufnähe:\n\n', 'Three fictional places within walking distance:\n\n', 'Tres locales ficticios a pie:\n\n') },
    {
      text: hui({
        type: 'places',
        id: 'demo-places',
        title: L(ctx, 'Essen in der Beispielstadt', 'Eating in Example City', 'Comer en Ciudad Ejemplo'),
        basis: 'illustrative',
        places: [
          {
            id: 'garten',
            name: L(ctx, 'Gartenküche Beispiel', 'Example Garden Kitchen', 'Cocina del Jardín (ejemplo)'),
            category: L(ctx, 'Regionale Küche', 'Regional cuisine', 'Cocina regional'),
            address: L(ctx, 'Beispielgasse 18, Beispielstadt', '18 Example Lane, Example City', 'Calle Ejemplo 18, Ciudad Ejemplo'),
            rating: 4.7,
            reviews: 1284,
            price: '€€',
            openNow: true,
            hoursToday: '12:00–23:30',
            website: 'https://example.com/garden-kitchen',
            distance: '450 m',
            note: L(ctx, 'Kleiner Hof, ruhige Tische, abends am besten reservieren.', 'Small courtyard, quiet tables; best to book for the evening.', 'Patio pequeño, mesas tranquilas; mejor reservar por la noche.'),
            tags: [L(ctx, 'Innenhof', 'Courtyard', 'Patio'), L(ctx, 'Vegetarische Auswahl', 'Vegetarian choices', 'Opciones vegetarianas')],
          },
          {
            id: 'fluss',
            name: L(ctx, 'Flussgabel Beispiel', 'Example River Fork', 'El Tenedor del Río (ejemplo)'),
            category: L(ctx, 'Italienisch', 'Italian', 'Italiano'),
            address: L(ctx, 'Beispielweg 7, Beispielstadt', '7 Example Way, Example City', 'Camino Ejemplo 7, Ciudad Ejemplo'),
            rating: 4.5,
            reviews: 862,
            price: '€€',
            openNow: true,
            hoursToday: '18:30–23:00',
            website: 'https://example.com/river-fork',
            distance: '900 m',
            note: L(ctx, 'Terrasse mit Blick aufs Wasser, hausgemachte Pasta.', 'Terrace with a view of the water, homemade pasta.', 'Terraza con vistas al agua y pasta casera.'),
            tags: [L(ctx, 'Terrasse', 'Terrace', 'Terraza')],
          },
          {
            id: 'ofen',
            name: L(ctx, 'Knusperofen Beispiel', 'Example Crispy Oven', 'Horno Crujiente (ejemplo)'),
            category: 'Pizza',
            address: L(ctx, 'Beispielstraße 31, Beispielstadt', '31 Example Street, Example City', 'Calle Ejemplo 31, Ciudad Ejemplo'),
            rating: 4.4,
            reviews: 2140,
            price: '€',
            openNow: false,
            hoursToday: L(ctx, 'öffnet um 19:00', 'opens at 19:00', 'abre a las 19:00'),
            distance: L(ctx, '1,3 km', '1.3 km', '1,3 km'),
            note: L(ctx, 'Dünne Pizza aus dem Holzofen, schnell und günstig.', 'Thin wood-fired pizza, quick and cheap.', 'Pizza fina de horno de leña, rápida y barata.'),
            tags: [L(ctx, 'Holzofen', 'Wood-fired', 'Horno de leña'), L(ctx, 'Ohne Reservierung', 'No booking needed', 'Sin reserva')],
          },
        ],
      }),
    },
    { text: L(ctx, '\nMein Tipp: die **Gartenküche** – im Hof ist es abends am ruhigsten.', '\nMy pick: the **Garden Kitchen** – the courtyard is quietest in the evening.', '\nMi recomendación: la **Cocina del Jardín**; el patio es lo más tranquilo por la noche.') },
  ],
};

export const calc: DemoScenario = {
  format: 'calculator',
  steps: (ctx) => [
    { text: L(ctx, 'Ein Zinseszins-Rechner – nativ berechnet, ohne generierten Code:\n\n', 'A compound-interest calculator – computed natively, no generated code:\n\n', 'Una calculadora de interés compuesto, calculada de forma nativa y sin código generado:\n\n') },
    {
      text: hui({
        type: 'calc',
        id: 'savings-plan',
        title: L(ctx, 'Sparplan mit Zinseszins', 'Savings plan with compound interest', 'Plan de ahorro con interés compuesto'),
        basis: 'calculated',
        inputs: [
          { name: 'start', label: L(ctx, 'Startkapital', 'Starting capital', 'Capital inicial'), kind: 'number', min: 0, max: 1000000, step: 500, default: 5000, unit: '€' },
          { name: 'rate', label: L(ctx, 'Monatliche Sparrate', 'Monthly saving', 'Ahorro mensual'), kind: 'slider', min: 0, max: 2000, step: 25, default: 200, unit: '€' },
          { name: 'zins', label: L(ctx, 'Zinssatz p. a.', 'Interest rate p. a.', 'Interés anual'), kind: 'slider', min: 0, max: 10, step: 0.25, default: 4, unit: '%' },
          { name: 'jahre', label: L(ctx, 'Laufzeit', 'Term', 'Plazo'), kind: 'slider', min: 1, max: 40, step: 1, default: 15, unit: L(ctx, 'Jahre', 'years', 'años') },
        ],
        outputs: [
          { name: 'q', label: L(ctx, 'Monatszins', 'Monthly rate', 'Interés mensual'), expr: 'zins / 100 / 12', format: 'percent', decimals: 3 },
          { name: 'n', label: L(ctx, 'Monate', 'Months', 'Meses'), expr: 'jahre * 12', format: 'integer' },
          { name: 'end', label: L(ctx, 'Endkapital', 'Final capital', 'Capital final'), expr: 'q == 0 ? start + rate * n : start * pow(1 + q, n) + rate * (pow(1 + q, n) - 1) / q', format: 'currency', emphasis: true },
          { label: L(ctx, 'Eingezahlt', 'Paid in', 'Aportado'), expr: 'start + rate * n', format: 'currency' },
          { label: L(ctx, 'Zinserträge', 'Interest earned', 'Intereses ganados'), expr: 'end - start - rate * n', format: 'currency' },
        ],
        chart: { kind: 'line', sweep: { input: 'jahre', from: 1, to: 40, steps: 40 }, y: 'zins == 0 ? start + rate * jahre * 12 : start * pow(1 + zins / 1200, jahre * 12) + rate * (pow(1 + zins / 1200, jahre * 12) - 1) / (zins / 1200)', label: L(ctx, 'Endkapital nach Laufzeit', 'Final capital by term', 'Capital final según el plazo') },
        note: L(ctx, 'Vereinfachte Rechnung ohne Steuern und Inflation.', 'Simplified calculation without taxes and inflation.', 'Cálculo simplificado, sin impuestos ni inflación.'),
      }),
    },
  ],
};

export const kreditCalc: DemoScenario = {
  format: 'calc',
  steps: (ctx) => [
    { wait: 400 },
    { text: L(ctx, 'Hier ist dein Kreditrechner – Betrag, Zins und Laufzeit lassen sich mit den Reglern ändern:\n\n', 'Here is your loan calculator – amount, rate and term change with the sliders:\n\n', 'Aquí tienes tu calculadora de préstamos: importe, interés y plazo cambian con los deslizadores:\n\n') },
    {
      text: hui({
        type: 'calc',
        id: 'car-loan',
        title: L(ctx, 'Autokredit', 'Car loan', 'Préstamo para coche'),
        basis: 'calculated',
        inputs: [
          { name: 'betrag', label: L(ctx, 'Kreditsumme', 'Loan amount', 'Importe'), kind: 'slider', min: 5000, max: 60000, step: 500, default: 25000, unit: '€' },
          { name: 'zins', label: L(ctx, 'Sollzins p. a.', 'Interest rate p. a.', 'Interés anual'), kind: 'slider', min: 0.5, max: 12, step: 0.1, default: 5.9, unit: '%' },
          { name: 'jahre', label: L(ctx, 'Laufzeit', 'Term', 'Plazo'), kind: 'slider', min: 1, max: 10, step: 1, default: 5, unit: L(ctx, 'Jahre', 'years', 'años') },
        ],
        outputs: [
          { name: 'q', label: L(ctx, 'Monatszins', 'Monthly rate', 'Interés mensual'), expr: 'zins / 100 / 12', format: 'percent', decimals: 3 },
          { name: 'n', label: L(ctx, 'Raten', 'Payments', 'Cuotas'), expr: 'jahre * 12', format: 'integer' },
          { name: 'rate', label: L(ctx, 'Monatliche Rate', 'Monthly payment', 'Cuota mensual'), expr: 'q == 0 ? betrag / n : betrag * q / (1 - pow(1 + q, -n))', format: 'currency', emphasis: true },
          { label: L(ctx, 'Zinskosten gesamt', 'Total interest', 'Intereses totales'), expr: 'rate * n - betrag', format: 'currency' },
          { label: L(ctx, 'Gesamtbetrag', 'Total', 'Total'), expr: 'rate * n', format: 'currency' },
        ],
        chart: { kind: 'bar', sweep: { input: 'jahre', from: 1, to: 10, steps: 10 }, y: 'zins == 0 ? betrag / (jahre * 12) : betrag * (zins / 1200) / (1 - pow(1 + zins / 1200, -jahre * 12))', label: L(ctx, 'Monatliche Rate nach Laufzeit', 'Monthly payment by term', 'Cuota mensual según el plazo') },
        note: L(ctx, 'Annuitätendarlehen mit festem Zins, ohne Gebühren.', 'Annuity loan with a fixed rate, no fees.', 'Préstamo de anualidad con interés fijo y sin comisiones.'),
      }),
    },
  ],
};

export const poll: DemoScenario = {
  format: 'poll',
  steps: (ctx) => [
    { wait: 500 },
    { text: L(ctx, 'Gute Idee! Gebt das Handy einfach reihum weiter – jede Person tippt ihren Namen und stimmt ab:\n\n', 'Good idea! Just pass the phone around – everyone taps their name and votes:\n\n', '¡Buena idea! Pasad el móvil de mano en mano: cada uno toca su nombre y vota:\n\n') },
    {
      text: hui({
        type: 'poll',
        id: 'saturday-dinner',
        question: L(ctx, 'Was kochen wir am Samstag?', 'What are we cooking on Saturday?', '¿Qué cocinamos el sábado?'),
        options: [
          { id: 'pizza', label: 'Pizza', emoji: '\u{1F355}' },
          { id: 'paella', label: 'Paella', emoji: '\u{1F958}' },
        ],
        voters: ['Alice', 'Bob', 'Carol', 'Dan'],
        allowAdd: true,
      }),
    },
  ],
};

export const translation: DemoScenario = {
  format: 'translation',
  steps: (ctx) => {
    const lang = langOf(ctx);
    const src = {
      de: { lang: 'de', text: 'Kommst du am Sonntag zum Mittagessen? Oma kocht Paella und wir sitzen im Garten.' },
      en: { lang: 'en', text: 'Are you coming for lunch on Sunday? Grandma is cooking paella and we will sit in the garden.' },
      es: { lang: 'es', text: '¿Vienes el domingo a comer? La abuela cocina paella y nos sentamos en el jardín.' },
    }[lang];
    const target = lang === 'es' ? { lang: 'en', text: 'Are you coming for lunch on Sunday? Grandma is cooking paella and we will sit in the garden.' } : { lang: 'es', text: '¿Vienes el domingo a comer? La abuela cocina paella y nos sentamos en el jardín.' };
    return [
      { wait: 400 },
      {
        text: hui({
          type: 'translation',
          id: 'tr-sunday',
          source: src,
          targets: [target],
          note: { de: '„Comer“ heißt in Spanien auch „zu Mittag essen“; in Lateinamerika sagt man eher „almorzar“.', en: '“Comer” also means “to have lunch” in Spain; in Latin America “almorzar” is more common.', es: '«Comer» también significa almorzar; en inglés se dice «come for lunch».' }[lang],
        }),
      },
      { text: L(ctx, '\nMit 🔊 hörst du die Aussprache, mit „Tauschen“ drehst du die Richtung um.', '\nTap 🔊 to hear the pronunciation, “Swap” turns the direction around.', '\nCon 🔊 oyes la pronunciación; con «Intercambiar» das la vuelta a la dirección.') },
    ];
  },
};

export const charts3: DemoScenario = {
  format: 'chart',
  steps: (ctx) => {
    const years = ['2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];
    const pair = (ys: number[]): [string, number][] => ys.map((y, i) => [years[i], y]);
    return [
      { text: L(ctx, 'Drei Diagramme, drei Fragen:\n\n**1. Strompreis für Haushalte (Beispielwerte)**\n\n', 'Three charts, three questions:\n\n**1. Household electricity price (sample values)**\n\n', 'Tres gráficos, tres preguntas:\n\n**1. Precio de la luz para hogares (valores de ejemplo)**\n\n') },
      {
        text: hui({
          type: 'chart',
          kind: 'line',
          title: L(ctx, 'Strompreis Haushalte (ct/kWh)', 'Household electricity price (ct/kWh)', 'Precio de la luz en hogares (ct/kWh)'),
          unit: 'ct',
          basis: 'illustrative',
          series: [
            { name: L(ctx, 'Durchschnitt', 'Average', 'Media'), data: xy(pair([28.7, 29.2, 29.7, 30.0, 30.5, 31.8, 32.2, 37.1, 45.2, 41.4, 39.6])) },
            { name: L(ctx, 'Neukunden', 'New customers', 'Clientes nuevos'), data: xy(pair([26.9, 27.5, 27.9, 28.4, 28.9, 29.4, 31.0, 52.4, 36.8, 33.1, 31.9])) },
          ],
        }),
      },
      { text: L(ctx, '\n**2. Zwei Handys im Vergleich**\n\n', '\n**2. Two phones compared**\n\n', '\n**2. Dos móviles comparados**\n\n') },
      {
        text: hui({
          type: 'chart',
          kind: 'radar',
          title: L(ctx, 'Handy A vs. Handy B', 'Phone A vs. phone B', 'Móvil A vs. móvil B'),
          max: 10,
          basis: 'estimate',
          series: [
            { name: L(ctx, 'Handy A', 'Phone A', 'Móvil A'), data: xy([[L(ctx, 'Kamera', 'Camera', 'Cámara'), 8.5], [L(ctx, 'Akku', 'Battery', 'Batería'), 8], [L(ctx, 'Display', 'Display', 'Pantalla'), 7.5], [L(ctx, 'Leistung', 'Speed', 'Rendimiento'), 7], [L(ctx, 'Preis', 'Price', 'Precio'), 9.5], [L(ctx, 'Updates', 'Updates', 'Actualizaciones'), 9.5]]) },
            { name: L(ctx, 'Handy B', 'Phone B', 'Móvil B'), data: xy([[L(ctx, 'Kamera', 'Camera', 'Cámara'), 9], [L(ctx, 'Akku', 'Battery', 'Batería'), 7], [L(ctx, 'Display', 'Display', 'Pantalla'), 9.4], [L(ctx, 'Leistung', 'Speed', 'Rendimiento'), 9.3], [L(ctx, 'Preis', 'Price', 'Precio'), 6], [L(ctx, 'Updates', 'Updates', 'Actualizaciones'), 8.5]]) },
          ],
        }),
      },
      { text: L(ctx, '\n**3. Dein Monatsbudget**\n\n', '\n**3. Your monthly budget**\n\n', '\n**3. Tu presupuesto mensual**\n\n') },
      {
        text: hui({
          type: 'chart',
          kind: 'waterfall',
          title: L(ctx, 'Monatsbudget Oktober', 'Monthly budget October', 'Presupuesto mensual de octubre'),
          unit: '€',
          basis: 'calculated',
          series: [
            {
              name: 'Budget',
              data: [
                { x: L(ctx, 'Gehalt', 'Salary', 'Sueldo'), y: 3200 },
                { x: L(ctx, 'Nebenjob', 'Side job', 'Trabajo extra'), y: 450 },
                { x: L(ctx, 'Miete', 'Rent', 'Alquiler'), y: -1150 },
                { x: L(ctx, 'Lebensmittel', 'Groceries', 'Comida'), y: -520 },
                { x: L(ctx, 'Verfügbar', 'Available', 'Disponible'), y: 0, total: true },
                { x: L(ctx, 'Sparen', 'Savings', 'Ahorro'), y: -600 },
                { x: L(ctx, 'Freizeit', 'Leisure', 'Ocio'), y: -380 },
                { x: L(ctx, 'Rest', 'Left', 'Resto'), y: 0, total: true },
              ],
            },
          ],
        }),
      },
      { text: L(ctx, '\nTipp: Tippe auf einen Punkt oder Balken, um die genauen Werte zu sehen.\n\n', '\nTip: tap a point or a bar to see the exact values.\n\n', '\nConsejo: toca un punto o una barra para ver los valores exactos.\n\n') + chips(ctx, 'mixed', 'loan', 'tour') },
    ];
  },
};

export const agenda: DemoScenario = {
  format: 'agenda',
  steps: (ctx) => {
    const d = new Date(ctx.now);
    return [
      { wait: 500 },
      { text: L(ctx, 'Hier ist ein entspannter Plan für deinen Samstag. Blöcke kannst du verschieben oder direkt in den Kalender übernehmen:\n\n', 'Here is a relaxed plan for your Saturday. You can move the blocks or add them straight to your calendar:\n\n', 'Aquí tienes un plan tranquilo para tu sábado. Puedes mover los bloques o pasarlos directamente al calendario:\n\n') },
      {
        text: hui({
          type: 'agenda',
          id: 'saturday',
          date: isoDay(d, (6 - d.getDay() + 7) % 7 || 7),
          title: L(ctx, 'Samstag', 'Saturday', 'Sábado'),
          blocks: [
            { id: 'breakfast', start: '08:30', end: '09:15', title: L(ctx, 'Frühstück', 'Breakfast', 'Desayuno'), kind: 'meal' },
            { id: 'run', start: '09:30', end: '10:30', title: L(ctx, 'Laufen im Park', 'Run in the park', 'Correr en el parque'), kind: 'sport', location: L(ctx, 'Stadtpark', 'City park', 'Parque de la ciudad') },
            { id: 'market', start: '11:00', end: '12:00', title: L(ctx, 'Wochenmarkt', 'Farmers’ market', 'Mercado semanal'), kind: 'free', note: L(ctx, 'Tomaten, Basilikum, Käse', 'Tomatoes, basil, cheese', 'Tomates, albahaca, queso') },
            { id: 'lunch', start: '12:30', end: '13:30', title: L(ctx, 'Mittagessen mit Oma', 'Lunch with Grandma', 'Comida con la abuela'), kind: 'meal' },
            { id: 'bike', start: '14:30', end: '15:30', title: L(ctx, 'Fahrrad reparieren', 'Fix the bike', 'Arreglar la bici'), kind: 'focus' },
            { id: 'coffee', start: '16:00', end: '17:00', title: L(ctx, 'Kaffee mit Alice', 'Coffee with Alice', 'Café con Alice'), kind: 'event', location: L(ctx, 'Café an der Ecke', 'Corner café', 'Café de la esquina') },
            { id: 'cinema', start: '19:30', end: '21:30', title: L(ctx, 'Kino', 'Cinema', 'Cine'), kind: 'event' },
          ],
        }),
      },
    ];
  },
};

export const webSuche: DemoScenario = {
  format: 'text',
  steps: (ctx) => [
    { reasoning: L(ctx, 'Jetlag nach einem Ostflug: Ich suche belastbare Tipps zu Licht, Schlaf und Melatonin und fasse sie kurz zusammen.', 'Jet lag after an eastbound flight: I look for reliable tips on light, sleep and melatonin and summarise them.', 'Jet lag tras un vuelo hacia el este: busco consejos fiables sobre luz, sueño y melatonina y los resumo.') },
    { text: L(ctx, 'Ich recherchiere kurz.', 'A quick look.', 'Busco un momento.') },
    tool.search(L(ctx, 'Jetlag Tipps Flug nach Osten', 'jet lag tips eastbound flight', 'jet lag consejos vuelo hacia el este'), 1300),
    tool.browser('example.com/jet-lag', 1100),
    tool.search(L(ctx, 'Tageslicht Melatonin innere Uhr', 'daylight melatonin body clock', 'luz natural melatonina reloj interno'), 1000),
    { reasoning: L(ctx, ' Die Quellen sind sich einig: Licht ist der wichtigste Taktgeber.', ' The sources agree: light is the strongest clock setter.', ' Las fuentes coinciden: la luz es lo que más ajusta el reloj.') },
    {
      text:
        L(
          ctx,
          '\n\n**So kommst du schneller in die neue Zeitzone:**\n\n1. **Schon vorher verschieben:** 2–3 Tage vor dem Flug jeden Abend eine Stunde früher ins Bett.\n2. **Morgens Tageslicht:** Am Ziel vormittags raus ins Helle – das stellt die innere Uhr am stärksten um.\n3. **Abends wenig Licht:** Bildschirme dimmen, kein grelles Licht vor dem Schlafen.\n4. **Kurzer Mittagsschlaf:** Höchstens 20 Minuten, sonst wird die erste Nacht schwer.\n\n',
          '\n\n**How to settle into the new time zone faster:**\n\n1. **Shift early:** for 2–3 days before the flight, go to bed an hour earlier each evening.\n2. **Morning daylight:** at the destination get outside in the morning – that moves the body clock the most.\n3. **Dim evenings:** lower the screens, no bright light before sleep.\n4. **Short nap:** 20 minutes at most, or the first night gets hard.\n\n',
          '\n\n**Cómo adaptarte antes a la nueva zona horaria:**\n\n1. **Adelántate:** 2–3 días antes del vuelo, acuéstate una hora antes cada noche.\n2. **Luz por la mañana:** al llegar sal por la mañana a la luz; es lo que más mueve el reloj interno.\n3. **Poca luz por la noche:** baja el brillo de las pantallas, nada de luz intensa antes de dormir.\n4. **Siesta corta:** 20 minutos como mucho, o la primera noche se complica.\n\n',
        ) + hui({ type: 'sources', items: [{ title: L(ctx, 'Jetlag im Überblick', 'Jet lag overview', 'Jet lag: resumen'), url: 'https://example.com/jet-lag', siteName: 'example.com', snippet: L(ctx, 'Beispielquelle: Störung des Schlaf-Wach-Rhythmus nach schnellem Wechsel mehrerer Zeitzonen.', 'Sample source: disruption of the sleep-wake rhythm after quickly crossing time zones.', 'Fuente de ejemplo: alteración del ritmo sueño-vigilia tras cruzar zonas horarias.') }] }),
    },
  ],
};

export const blocks: DemoScenario = {
  format: 'blocks',
  steps: (ctx) => {
    const agents = (framed: boolean) => [1, 2, 3, 4].map((n) => ({ label: `Agent ${n}`, icon: framed ? 'vm' : 'container', ...(framed ? { sub: L(ctx, `Kernel ${n}`, `Kernel ${n}`, `Kernel ${n}`), style: 'framed' } : {}) }));
    return [
      { wait: 300 },
      { text: L(ctx, 'Container lassen alle Agenten auf einem gemeinsamen Linux-Kernel laufen, klassische virtuelle Maschinen starten für jeden Agenten einen eigenen:\n\n', 'Containers run every agent on one shared Linux kernel, classic virtual machines boot a kernel of their own for each agent:\n\n', 'Los contenedores ejecutan todos los agentes sobre un único kernel Linux compartido; las máquinas virtuales clásicas arrancan un kernel propio por agente:\n\n') },
      {
        text: hui({
          type: 'blocks',
          id: 'demo-architecture',
          title: L(ctx, 'Agenten auf einem Rechner: geteilter Kernel oder eigene VMs', 'Agents on one machine: shared kernel or separate VMs', 'Agentes en un equipo: kernel compartido o VM propias'),
          columns: [
            { title: L(ctx, 'Container', 'Containers', 'Contenedores'), grid: 2, items: agents(false), base: { label: L(ctx, '1 Linux-Kernel', '1 Linux kernel', '1 kernel Linux'), sub: L(ctx, 'Gemeinsam genutzt', 'Shared', 'Compartido'), icon: 'terminal' } },
            { title: L(ctx, 'Virtuelle Maschinen', 'Virtual machines', 'Máquinas virtuales'), grid: 2, items: agents(true) },
          ],
          caption: L(ctx, 'Vereinfachtes Architekturmodell – Container teilen einen Kernel, klassische VMs bringen je einen eigenen mit.', 'Simplified architecture – containers share one kernel, classic VMs bring one each.', 'Modelo de arquitectura simplificado: los contenedores comparten un kernel, las VM clásicas traen uno cada una.'),
        }),
      },
      { text: L(ctx, '\nDer geteilte Kernel spart Speicher und startet schneller; eigene Kernel isolieren die Agenten stärker voneinander.', '\nThe shared kernel saves memory and starts faster; separate kernels isolate the agents more strongly.', '\nEl kernel compartido ahorra memoria y arranca más rápido; los kernels propios aíslan más a los agentes.') },
    ];
  },
};

export const error: DemoScenario = {
  format: 'text',
  steps: (ctx) => [
    { text: L(ctx, 'Ich beginne mit der Auswertung und lade die Daten …', 'I am starting the analysis and loading the data …', 'Empiezo el análisis y cargo los datos …') },
    tool.terminal('python analyze.py', 700),
    { text: L(ctx, '\n\nJetzt wird es kritisch, ich berechne das Ergebnis', '\n\nThis is the critical part, I am computing the result', '\n\nAhora viene lo crítico, calculo el resultado') },
    { fail: 'error' },
  ],
};

export const long: DemoScenario = {
  format: 'text',
  steps: (ctx) => {
    const para = L(
      ctx,
      'Dies ist ein langer Absatz zum Testen von Scrolling und Streaming. Er enthält **fetten Text**, *kursiven Text*, `Inline-Code` und einen [Link](https://example.com). Die App soll flüssig bleiben, auch wenn die Antwort mehrere Bildschirmseiten lang wird. ',
      'This is a long paragraph for testing scrolling and streaming. It contains **bold text**, *italic text*, `inline code` and a [link](https://example.com). The app should stay smooth even when the answer runs over several screens. ',
      'Este es un párrafo largo para probar el desplazamiento y el streaming. Contiene **texto en negrita**, *cursiva*, `código en línea` y un [enlace](https://example.com). La app debe seguir fluida aunque la respuesta ocupe varias pantallas. ',
    );
    const out: DemoStep[] = [];
    for (let i = 1; i <= 8; i++) out.push({ text: `## ${L(ctx, 'Abschnitt', 'Section', 'Sección')} ${i}\n\n${para}${para}\n\n` });
    out.push({ text: '```ts\nfunction fib(n: number): number {\n  return n < 2 ? n : fib(n - 1) + fib(n - 2);\n}\n```\n\n' + L(ctx, 'Ende.', 'The end.', 'Fin.') });
    return out;
  },
};

// ── coding: a fix as diff, the passing test run as terminal, the changed files ─────────────────────────────────────────
export const coding: DemoScenario = {
  format: 'diff',
  steps: (ctx) => {
    const totalPatch = [
      '--- a/src/cart/total.ts',
      '+++ b/src/cart/total.ts',
      '@@ -3,6 +3,6 @@ export interface Item { name: string; price?: number; qty: number }',
      ' ',
      ' export function cartTotal(items: Item[]): number {',
      '   let sum = 0;',
      '-  for (const it of items) sum += it.price * it.qty;',
      '+  for (const it of items) sum += (it.price ?? 0) * it.qty;',
      '   return sum;',
      ' }',
    ].join('\n');
    const formatPatch = [
      '--- a/src/cart/format.ts',
      '+++ b/src/cart/format.ts',
      '@@ -1,3 +1,4 @@',
      ' export function formatEuro(value: number): string {',
      "+  if (!Number.isFinite(value)) return '–';",
      "   return value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });",
      ' }',
    ].join('\n');
    const testPatch = [
      '--- a/test/cart.test.ts',
      '+++ b/test/cart.test.ts',
      '@@ -12,3 +12,7 @@ test("sums prices times quantity", () => {',
      '   expect(cartTotal([{ name: "Tea", price: 3.5, qty: 2 }])).toBe(7);',
      ' });',
      ' ',
      '+test("an item without a price counts as 0", () => {',
      '+  expect(cartTotal([{ name: "Gift card", qty: 1 }])).toBe(0);',
      '+});',
      '+',
    ].join('\n');
    return [
      { tool: { name: 'terminal', label: 'npm test', emoji: '\u{1F4BB}', ms: 900 } },
      { tool: { name: 'read_file', label: 'src/cart/total.ts', emoji: '\u{1F4C4}', ms: 400 } },
      { tool: { name: 'patch', label: 'src/cart/total.ts', emoji: '\u{270F}\u{FE0F}', ms: 500 } },
      { tool: { name: 'patch', label: 'src/cart/format.ts', emoji: '\u{270F}\u{FE0F}', ms: 400 } },
      { tool: { name: 'write_file', label: 'test/cart.test.ts', emoji: '\u{270F}\u{FE0F}', ms: 400 } },
      { tool: { name: 'terminal', label: 'npm test', emoji: '\u{1F4BB}', ms: 900 } },
      {
        text: L(
          ctx,
          'Behoben: Ein Artikel ohne Preis machte die Summe zu `NaN`. Jetzt zählt er als 0 €, und die Anzeige formatiert nur gültige Zahlen.\n\n',
          'Fixed: an item without a price turned the total into `NaN`. It now counts as €0, and the display only formats valid numbers.\n\n',
          'Corregido: un artículo sin precio convertía el total en `NaN`. Ahora cuenta como 0 € y la vista solo formatea números válidos.\n\n',
        ),
      },
      { text: '```diff\n' + totalPatch + '\n' + formatPatch + '\n```\n\n' },
      { text: L(ctx, 'Danach laufen alle Tests durch:\n\n', 'All tests pass afterwards:\n\n', 'Después pasan todas las pruebas:\n\n') },
      {
        text:
          '```terminal\n$ npm test\n> node --test\n\n' +
          '\u001b[32m✔\u001b[0m sums prices times quantity \u001b[90m(0.9ms)\u001b[0m\n' +
          '\u001b[32m✔\u001b[0m an item without a price counts as 0 \u001b[90m(0.4ms)\u001b[0m\n' +
          '\u001b[32m✔\u001b[0m formats euro amounts \u001b[90m(1.1ms)\u001b[0m\n\n' +
          'ℹ tests 3\nℹ pass 3\nℹ fail 0\n[exit 0, 3.9s]\n```\n\n',
      },
      {
        text: hui({
          type: 'changes',
          id: 'demo-changes',
          title: L(ctx, 'Geänderte Dateien', 'Changed files', 'Archivos modificados'),
          summary: L(ctx, 'Summe ohne NaN, neuer Test', 'Total without NaN, new test', 'Total sin NaN, prueba nueva'),
          agent: 'Hermes',
          files: [
            { path: 'src/cart/total.ts', status: 'modified' },
            { path: 'src/cart/format.ts', status: 'modified' },
            { path: 'test/cart.test.ts', status: 'modified' },
          ],
          patch: [totalPatch, formatPatch, testPatch].join('\n'),
        }),
      },
    ];
  },
};

// ── mindmap: a topic as a tree (map / outline view, collapsible branches) ─────────────────────────────────────────────
export const mindmap: DemoScenario = {
  format: 'mindmap',
  steps: (ctx) => {
    const n = (de: string, en: string, es: string, children?: unknown[]) => ({ label: L(ctx, de, en, es), ...(children ? { children } : {}) });
    return [
      { text: L(ctx, 'Die Wärmepumpe auf einen Blick:\n\n', 'The heat pump at a glance:\n\n', 'La bomba de calor de un vistazo:\n\n') },
      {
        text: hui({
          type: 'mindmap',
          id: 'demo-mindmap',
          title: L(ctx, 'Wärmepumpe', 'Heat pump', 'Bomba de calor'),
          root: n('Wärmepumpe', 'Heat pump', 'Bomba de calor', [
            n('Kreislauf', 'Cycle', 'Ciclo', [n('Verdampfen', 'Evaporate', 'Evaporar'), n('Verdichten', 'Compress', 'Comprimir'), n('Abgeben', 'Release heat', 'Ceder calor'), n('Entspannen', 'Expand', 'Expandir')]),
            n('Wärmequellen', 'Heat sources', 'Fuentes de calor', [n('Luft', 'Air', 'Aire'), n('Erdreich', 'Ground', 'Suelo'), n('Grundwasser', 'Groundwater', 'Agua subterránea')]),
            n('Effizienz', 'Efficiency', 'Eficiencia', [n('JAZ ab 3,5', 'SPF 3.5 or more', 'SPF desde 3,5'), n('Niedrige Vorlauftemperatur', 'Low flow temperature', 'Baja temperatura de impulsión')]),
            n('Kosten', 'Costs', 'Costes', [n('Anschaffung', 'Purchase', 'Compra'), n('Förderung', 'Subsidies', 'Ayudas'), n('Stromtarif', 'Power tariff', 'Tarifa eléctrica')]),
          ]),
        }),
      },
      { text: L(ctx, '\nTipp: Äste antippen, um sie auf- und zuzuklappen.\n\n', '\nTip: tap a branch to fold it.\n\n', '\nConsejo: toca una rama para plegarla.\n\n') + chips(ctx, 'explain', 'quiz', 'tour') },
    ];
  },
};

export const MORE: Record<string, DemoScenario> = {
  chart, table, wideTable, gameTable, longWords, stats, compare, form, steps, timeline, buttons, calculator, loan, mixed,
  tool: tool_, tools2, weather, places, calc, kreditCalc, poll, translation, charts3, agenda, webSuche, blocks, coding, mindmap, error, long,
};
