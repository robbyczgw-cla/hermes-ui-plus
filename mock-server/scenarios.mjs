// Scripted answers for the mock server. A scenario is a list of steps:
//   { text }                      streamed token-ish
//   { tool: {name,label,emoji,ms} } hermes.tool.progress running -> (ms) -> completed
//   { reasoning }                 delta.reasoning_content
//   { status: {kind,text} }       event: hermes.status
//   { wait: ms }                  silence (keepalive comments every 10 s)
//   { approval: {...} }           approval.request, blocks until POST /v1/runs/:id/approval
//   { fail: 'error'|'drop' }      error finish chunk / hard connection drop
// `format` is the RouteFormat emitted with --route.

import { readFileSync } from 'node:fs';

/** First assistant answer (```` ```markdown ```` block) of a hermes-skill example: realistic one-line hui JSON. */
function exampleAnswer(file) {
  try {
    const md = readFileSync(new URL(`../hermes-skill/examples/${file}`, import.meta.url), 'utf8');
    const m = /````markdown\n([\s\S]*?)\n````/.exec(md);
    return m ? m[1] + '\n' : `(Beispiel ${file} ohne Antwortblock)\n`;
  } catch {
    return `(Beispiel ${file} nicht gefunden)\n`;
  }
}
const example = (format, file) => ({ format, steps: () => [{ text: exampleAnswer(file) }] });

const hui = (node) => '```hui\n' + JSON.stringify(node, null, 2) + '\n```\n';

const CALCULATOR_HTML = `<div class="calc">
  <style>
    .calc { font-family: var(--h-font, system-ui); background: var(--h-surface, #f4f4f5); color: var(--h-text, #111);
      border: 1px solid var(--h-border, #ddd); border-radius: var(--h-radius, 12px); padding: 12px; max-width: 320px; }
    .calc output { display:block; text-align:right; font-size: 28px; padding: 8px 4px 12px; min-height: 44px; overflow:hidden; }
    .calc .grid { display:grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .calc button { font-size: 18px; padding: 12px 0; border-radius: 10px; border: 1px solid var(--h-border, #ddd);
      background: var(--h-bg, #fff); color: var(--h-text, #111); }
    .calc button.op { background: var(--h-accent, #4f46e5); color: #fff; border-color: transparent; }
  </style>
  <output id="d">0</output>
  <div class="grid" id="g"></div>
  <script>
    const keys = ['7','8','9','/','4','5','6','*','1','2','3','-','0','.','=','+'];
    const d = document.getElementById('d'); const g = document.getElementById('g'); let expr = '';
    keys.forEach(function (k) {
      const b = document.createElement('button'); b.textContent = k; if ('/*-+='.indexOf(k) >= 0) b.className = 'op';
      b.onclick = function () {
        if (k === '=') { try { expr = String(Function('"use strict";return (' + (expr || '0') + ')')()); } catch (e) { expr = 'Fehler'; } }
        else { if (expr === 'Fehler') expr = ''; expr += k; }
        d.textContent = expr || '0';
      };
      g.appendChild(b);
    });
    var c = document.createElement('button'); c.textContent = 'C'; c.style.gridColumn = 'span 4';
    c.onclick = function () { expr = ''; d.textContent = '0'; }; g.appendChild(c);
  </script>
</div>`;

// Close to what Claude produces for "Bau mir einen Rechner für die monatliche Kreditrate …":
// long <style> first, sliders + stats + SVG chart, one <script> at the end, entities and €.
const LOAN_HTML = `<style>
  .loan { display: grid; gap: 14px; }
  .loan .field { display: grid; gap: 4px; }
  .loan .field-head { display: flex; justify-content: space-between; align-items: baseline; }
  .loan .field-head output { font-weight: 600; font-variant-numeric: tabular-nums; }
  .loan .result { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .loan .result .stat-value { font-size: 1.15em; }
  .loan .bar { display: flex; height: 14px; border-radius: 7px; overflow: hidden; background: var(--h-surface-alt); }
  .loan .bar span { display: block; height: 100%; transition: width .2s; }
  .loan .legend { display: flex; gap: 14px; font-size: .85em; color: var(--h-muted); }
  .loan .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
  .loan svg { width: 100%; height: 120px; display: block; }
  .loan table td:not(:first-child), .loan table th:not(:first-child) { text-align: right; font-variant-numeric: tabular-nums; }
</style>
<div class="loan card">
  <h3 style="margin:0">Kreditrechner &ndash; monatliche Rate</h3>
  <div class="field">
    <div class="field-head"><label for="amount">Kreditsumme</label><output id="amountOut">20.000&nbsp;€</output></div>
    <input type="range" id="amount" min="1000" max="100000" step="500" value="20000">
  </div>
  <div class="field">
    <div class="field-head"><label for="rate">Sollzins p.&nbsp;a.</label><output id="rateOut">6,50&nbsp;%</output></div>
    <input type="range" id="rate" min="0.5" max="15" step="0.05" value="6.5">
  </div>
  <div class="field">
    <div class="field-head"><label for="years">Laufzeit</label><output id="yearsOut">5 Jahre</output></div>
    <input type="range" id="years" min="1" max="10" step="1" value="5">
  </div>
  <div class="result">
    <div class="stat"><div class="stat-label">Monatliche Rate</div><div class="stat-value" id="monthly">391,32&nbsp;€</div></div>
    <div class="stat"><div class="stat-label">Zinskosten</div><div class="stat-value" id="interest">3.479,20&nbsp;€</div></div>
    <div class="stat"><div class="stat-label">Gesamtbetrag</div><div class="stat-value" id="total">23.479,20&nbsp;€</div></div>
  </div>
  <div class="bar"><span id="barP" style="width:85%;background:var(--h-chart-1)"></span><span id="barI" style="width:15%;background:var(--h-chart-2)"></span></div>
  <div class="legend"><span><i style="background:var(--h-chart-1)"></i>Tilgung</span><span><i style="background:var(--h-chart-2)"></i>Zinsen</span></div>
  <svg id="chart" viewBox="0 0 300 120" preserveAspectRatio="none" aria-label="Restschuld über die Laufzeit"></svg>
  <table>
    <thead><tr><th>Jahr</th><th>Zinsen</th><th>Tilgung</th><th>Restschuld</th></tr></thead>
    <tbody id="plan"></tbody>
  </table>
  <p class="muted" style="margin:0;font-size:.85em">Annuitätendarlehen, monatliche Raten, Zins gebunden über die gesamte Laufzeit.</p>
</div>
<script>
  (function () {
    var eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
    var pct = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var $ = function (id) { return document.getElementById(id); };
    function calc() {
      var P = +$('amount').value, r = +$('rate').value / 100 / 12, n = +$('years').value * 12;
      var m = r === 0 ? P / n : (P * r) / (1 - Math.pow(1 + r, -n));
      var total = m * n, interest = total - P;
      $('amountOut').textContent = eur.format(P).replace(',00', '');
      $('rateOut').textContent = pct.format(+$('rate').value) + ' %';
      $('yearsOut').textContent = $('years').value + ($('years').value === '1' ? ' Jahr' : ' Jahre');
      $('monthly').textContent = eur.format(m);
      $('interest').textContent = eur.format(interest);
      $('total').textContent = eur.format(total);
      $('barP').style.width = (P / total * 100) + '%';
      $('barI').style.width = (interest / total * 100) + '%';
      var bal = P, rows = '', pts = ['0,' + 0], yi = 0, yp = 0;
      for (var k = 1; k <= n; k++) {
        var zi = bal * r, ti = m - zi; bal = Math.max(0, bal - ti); yi += zi; yp += ti;
        pts.push((k / n * 300).toFixed(1) + ',' + (120 - bal / P * 110).toFixed(1));
        if (k % 12 === 0) { rows += '<tr><td>' + k / 12 + '</td><td>' + eur.format(yi) + '</td><td>' + eur.format(yp) + '</td><td>' + eur.format(bal) + '</td></tr>'; yi = 0; yp = 0; }
      }
      pts[0] = '0,10';
      $('plan').innerHTML = rows;
      $('chart').innerHTML = '<polyline fill="none" stroke="var(--h-chart-1)" stroke-width="2" vector-effect="non-scaling-stroke" points="' + pts.join(' ') + '"/>';
    }
    ['amount', 'rate', 'years'].forEach(function (id) { $(id).addEventListener('input', calc); });
    calc();
  })();
</script>`;

const scenarios = {
  // real example answers (one-line JSON like the model writes it) – streaming skeleton checks
  checklist: example('checklist', '14-checklist-shopping.md'),
  choice: example('choice', '13-choice-multiturn.md'),
  // Real-device bug repro (Android, 547e0fb): choice → tap → answer WITH several tools. The tool
  // footer/chips use plural i18n ("2 Werkzeuge") which crashed on Hermes (no Intl.PluralRules).
  reise: {
    format: 'choice',
    steps: () => [
      { text: 'Gern vergleiche ich das. Kurz vorab:\n\n' },
      {
        text: hui({
          type: 'choice',
          id: 'reise-modus',
          question: 'Was ist dir bei der Reise am wichtigsten?',
          options: [
            { id: 'zeit', label: 'Schnell ankommen', description: 'Tür-zu-Tür-Zeit zählt' },
            { id: 'preis', label: 'Günstig', description: 'Preis zählt' },
            { id: 'co2', label: 'Wenig CO₂', description: 'Klima zählt' },
          ],
          allowOther: true,
        }),
      },
    ],
  },
  reiseResult: {
    format: 'compare',
    steps: () => [
      { reasoning: 'Fahrzeiten und Preise Wien–Berlin vergleichen.' },
      { tool: { name: 'web_search', label: 'Wien Berlin Zug Fahrzeit', emoji: '\u{1F50D}', ms: 900 } },
      { tool: { name: 'web_search', label: 'Flug Wien Berlin Preis', emoji: '\u{1F50D}', ms: 800 } },
      { tool: { name: 'browser', label: 'https://example.com/fahrplan', emoji: '\u{1F310}', ms: 700 } },
      { text: 'Für Wien → Berlin (Beispielwerte, keine Live-Daten):\n\n' },
      {
        text: hui({
          type: 'compare',
          columns: [
            { title: 'Bahn', badge: 'Empfohlen', highlight: true, items: ['ca. 8–9 h Tür zu Tür', 'ab ca. 50 €', 'ca. 10 kg CO₂'] },
            { title: 'Flugzeug', items: ['ca. 4–5 h Tür zu Tür', 'ab ca. 80 €', 'ca. 100 kg CO₂'] },
          ],
        }),
      },
      { text: '\nMit Nachtzug sparst du dir zusätzlich eine Hotelnacht.' },
    ],
  },
  recipe: example('recipe', '19-recipe.md'),
  quiz: example('quiz', '20-quiz-multiturn.md'),
  plain: {
    format: 'text',
    steps: (ctx) => [
      {
        text:
          `Hallo! Das ist eine Antwort des **Mock-Servers**. Du hast geschrieben: „${ctx.userText.slice(0, 120)}“.\n\n` +
          `Das ist Nachricht ${ctx.turn} in der Sitzung \`${ctx.sessionId}\`.\n\n` +
          '- Streaming in kleinen Häppchen\n- Markdown mit **fett**, *kursiv* und `code`\n- Probiere: „chart“, „tabelle“, „kennzahlen“, „vergleich“, „formular“, „schritte“, „timeline“, „buttons“, „rechner“, „tool“, „werkzeuge“, „freigabe“, „lang“, „fehler“, „langsam“\n',
      },
    ],
  },

  tool: {
    format: 'text',
    steps: () => [
      { text: 'Ich schaue kurz nach der Uhrzeit.' },
      { reasoning: 'Der Nutzer fragt nach der Zeit; ein Terminal-Aufruf genügt.' },
      { tool: { name: 'terminal', label: 'date', emoji: '\u{1F4BB}', ms: 900 } },
      { text: `\n\nEs ist jetzt **${new Date().toLocaleString('de-AT', { dateStyle: 'full', timeStyle: 'short' })}**.` },
    ],
  },

  tools2: {
    format: 'text',
    steps: () => [
      { text: 'Ich recherchiere das parallel.' },
      { tool: { name: 'web_search', label: 'Wetter Wien morgen', emoji: '\u{1F50D}', ms: 1200 } },
      { tool: { name: 'read_file', label: '~/notes/todo.md', emoji: '\u{1F4C4}', ms: 600 } },
      { status: { kind: 'lifecycle', text: 'Warte auf Provider (Wiederholung 1/3)…' } },
      { wait: 1200 },
      { text: '\n\nFertig: Morgen wird es mild, die Notizen enthalten 3 offene Punkte.' },
    ],
  },

  // rich tool timeline for the "Werkzeug-Details" view (reasoning, several tools, status, compaction)
  werkzeuge: {
    format: 'text',
    steps: () => [
      { reasoning: 'Der Nutzer will den Stand des Projekts. Ich prüfe System, Notizen und das Changelog.' },
      { text: 'Ich prüfe das in mehreren Schritten.' },
      { tool: { name: 'terminal', label: 'uname -a && uptime', emoji: '\u{1F4BB}', ms: 700 } },
      { tool: { name: 'web_search', label: 'Hermes Agent v0.21 Release Notes', emoji: '\u{1F50D}', ms: 1400 } },
      { status: { kind: 'lifecycle', text: 'Warte auf Provider (Wiederholung 1/3)…' } },
      { wait: 900 },
      { tool: { name: 'read_file', label: '~/notes/hermes-ui.md', emoji: '\u{1F4C4}', ms: 500 } },
      { tool: { name: 'browser', label: 'https://example.com/changelog', emoji: '\u{1F310}', ms: 1100 } },
      { tool: { name: 'terminal', label: 'pytest -q tests/test_api.py', emoji: '\u{1F4BB}', ms: 6000 } },
      { reasoning: ' Alle Daten sind da, ich fasse zusammen.' },
      { status: { kind: 'compacted', text: 'Kontext komprimiert (48k → 12k Tokens)' } },
      {
        text:
          '\n\n**Stand:** System läuft seit 12 Tagen, die Notizen nennen 3 offene Punkte, das Changelog listet v0.21.4 als aktuell, und alle 42 API-Tests sind grün.',
      },
    ],
  },

  chart: {
    format: 'chart',
    steps: () => [
      { text: 'Hier der Verlauf der Temperaturen und der Niederschlagsmenge:\n\n' },
      {
        text: hui({
          type: 'chart',
          kind: 'line',
          title: 'Temperatur Wien (°C)',
          unit: '°C',
          xLabel: 'Tag',
          yLabel: 'Temperatur',
          series: [
            { name: 'Max', data: [['Mo', 18], ['Di', 21], ['Mi', 19], ['Do', 24], ['Fr', 22], ['Sa', 17], ['So', 15]].map(([x, y]) => ({ x, y })) },
            { name: 'Min', data: [['Mo', 9], ['Di', 11], ['Mi', 10], ['Do', 13], ['Fr', 12], ['Sa', 8], ['So', 7]].map(([x, y]) => ({ x, y })) },
          ],
        }),
      },
      {
        text:
          '\nUnd als Balken:\n\n' +
          hui({
            type: 'chart',
            kind: 'bar',
            title: 'Niederschlag (mm)',
            series: [{ name: 'mm', data: [['Mo', 0], ['Di', 2], ['Mi', 8], ['Do', 1], ['Fr', 0], ['Sa', 12], ['So', 5]].map(([x, y]) => ({ x, y })) }],
          }) +
          '\nTendenz: Wochenende nass und kühler.',
      },
    ],
  },

  table: {
    format: 'table',
    steps: () => [
      { text: 'Die Top-Städte nach Einwohnern:\n\n' },
      {
        text: hui({
          type: 'table',
          caption: 'Einwohner (Mio.)',
          source: 'Mock-Daten',
          columns: ['Stadt', 'Land', 'Einwohner', 'Fläche km²'],
          rows: [
            ['Berlin', 'DE', 3.7, 892],
            ['Wien', 'AT', 2.0, 415],
            ['Hamburg', 'DE', 1.9, 755],
            ['Zürich', 'CH', 0.44, 92],
            ['Graz', 'AT', 0.3, 127],
            ['Unbekannt', null, null, null],
          ],
        }),
      },
      { text: '\nBerlin ist mit Abstand die größte.' },
    ],
  },

  stats: {
    format: 'stats',
    steps: () => [
      { text: 'Deine Kennzahlen diese Woche:\n\n' },
      {
        text: hui({
          type: 'stats',
          items: [
            { label: 'Schritte', value: '8.421', delta: '+12 %', trend: 'up' },
            { label: 'Schlaf', value: '6,8 h', delta: '-0,4 h', trend: 'down' },
            { label: 'Puls (Ruhe)', value: '58', delta: '±0', trend: 'flat' },
          ],
        }),
      },
      {
        text:
          '\n' +
          hui({ type: 'callout', tone: 'warning', title: 'Schlaf', text: 'Du schläfst unter deinem Ziel von 7,5 h.' }) +
          hui({ type: 'progress', label: 'Wochenziel Schritte', value: 52, max: 70 }),
      },
    ],
  },

  compare: {
    format: 'compare',
    steps: () => [
      { text: 'Vergleich der drei Tarife:\n\n' },
      {
        text: hui({
          type: 'compare',
          columns: [
            { title: 'Basic', items: ['5 GB', '9 € / Monat', 'Kündigung 1 Monat'] },
            { title: 'Plus', badge: 'Empfohlen', highlight: true, items: ['50 GB', '15 € / Monat', '5G inklusive', 'Kündigung 1 Monat'] },
            { title: 'Max', items: ['Unlimitiert', '29 € / Monat', '5G inklusive', 'EU-Roaming'] },
          ],
        }),
      },
      { text: '\nFür dich passt **Plus** am besten.' },
    ],
  },

  form: {
    format: 'form',
    steps: () => [
      { text: 'Gib die Eckdaten ein, dann rechne ich den Kredit durch:\n\n' },
      {
        text: hui({
          type: 'form',
          id: 'kredit',
          title: 'Kreditrechner',
          fields: [
            { name: 'betrag', label: 'Betrag', kind: 'number', unit: '€', min: 1000, max: 100000, default: 20000 },
            { name: 'laufzeit', label: 'Laufzeit (Jahre)', kind: 'slider', min: 1, max: 15, step: 1, default: 5 },
            { name: 'typ', label: 'Zinsbindung', kind: 'select', options: ['fix', 'variabel'], default: 'fix' },
            { name: 'sondertilgung', label: 'Sondertilgung', kind: 'toggle', default: false },
            { name: 'start', label: 'Start', kind: 'date' },
            { name: 'notiz', label: 'Notiz', kind: 'text', placeholder: 'optional' },
          ],
          submit: { label: 'Berechnen' },
        }),
      },
    ],
  },

  formResult: {
    format: 'text',
    steps: (ctx) => [
      { text: `Danke, ich habe dein Formular erhalten:\n\n\`\`\`json\n${ctx.userText}\n\`\`\`\n\nMonatliche Rate: **ca. 372 €**.` },
    ],
  },

  steps: {
    format: 'steps',
    steps: () => [
      { text: 'So installierst du es:\n\n' },
      {
        text: hui({
          type: 'steps',
          current: 1,
          items: [
            { title: 'Paket laden', detail: 'Lade das Archiv von der Projektseite.' },
            { title: 'Entpacken', detail: 'Mit `tar -xf paket.tar.gz`.' },
            { title: 'Konfigurieren' },
            { title: 'Starten', detail: 'Mit `./run`.' },
          ],
        }),
      },
      { text: '\nSag Bescheid, wenn du bei Schritt 2 hängst.' },
    ],
  },

  timeline: {
    format: 'timeline',
    steps: () => [
      { text: 'Der Ablauf deiner Reise:\n\n' },
      {
        text: hui({
          type: 'timeline',
          items: [
            { time: '07:10', title: 'Abflug Wien', detail: 'Terminal 3, Gate C12' },
            { time: '09:05', title: 'Ankunft Lissabon' },
            { time: '11:00', title: 'Check-in Hotel', detail: 'Rua Augusta 12' },
            { time: '19:30', title: 'Abendessen', detail: 'Reservierung auf „Silva“' },
          ],
        }),
      },
    ],
  },

  buttons: {
    format: 'text',
    steps: () => [
      { text: 'Was möchtest du als Nächstes tun?\n\n' },
      {
        text: hui({
          type: 'buttons',
          items: [
            { label: 'Details anzeigen', style: 'primary', action: { type: 'send', text: 'Zeig mir die Details' } },
            { label: 'Link öffnen', style: 'secondary', action: { type: 'open_url', url: 'https://example.com' } },
            { label: 'Kopieren', style: 'secondary', action: { type: 'copy', text: 'Hallo aus dem Mock' } },
          ],
        }),
      },
      { text: '\n' + hui({ type: 'suggestions', items: ['Zeig mir ein Diagramm', 'Vergleiche drei Tarife', 'Öffne den Rechner'] }) },
    ],
  },

  calculator: {
    format: 'calculator',
    steps: () => [
      { text: 'Hier ist ein einfacher Taschenrechner:\n\n' },
      { text: '```hui-html\n' + CALCULATOR_HTML + '\n```\n' },
      { text: '\nTipp: Probiere `12*7=`.' },
    ],
  },

  loan: {
    format: 'calculator',
    steps: () => [
      { text: 'Hier ist ein interaktiver Kreditrechner. Die Startwerte sind **20.000 €** bei 6,5 % Sollzins und 5 Jahren Laufzeit:\n\n' },
      { text: '```hui-html\n' + LOAN_HTML + '\n```\n' },
      { text: '\nMit den Schiebereglern kannst du Betrag, Zins und Laufzeit ändern. Die Rate wird nach der Annuitätenformel berechnet.' },
    ],
  },

  mixed: {
    format: 'interactive',
    steps: () => [
      { text: '# Wochenbericht\n\nIch habe deine Daten ausgewertet und alles zusammengefasst.\n\n' },
      { tool: { name: 'read_file', label: '~/data/week.csv', emoji: '\u{1F4C4}', ms: 700 } },
      { text: '## Überblick\n\n' },
      {
        text: hui({
          type: 'stats',
          items: [
            { label: 'Umsatz', value: '12.480 €', delta: '+4,2 %', trend: 'up' },
            { label: 'Kunden', value: '318', delta: '+9', trend: 'up' },
            { label: 'Retouren', value: '2,1 %', delta: '-0,3 pp', trend: 'down' },
          ],
        }),
      },
      { text: '\n## Verlauf\n\nDer Umsatz stieg über die Woche fast durchgehend:\n\n' },
      {
        text: hui({
          type: 'chart',
          kind: 'area',
          title: 'Umsatz pro Tag (€)',
          series: [{ name: 'Umsatz', data: [1450, 1620, 1580, 1910, 2230, 2010, 1680].map((y, i) => ({ x: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][i], y })) }],
        }),
      },
      { text: '\n## Details\n\n' },
      {
        text: hui({
          type: 'table',
          columns: ['Kategorie', 'Umsatz', 'Anteil'],
          rows: [['Hardware', '6.100 €', '49 %'], ['Software', '4.300 €', '34 %'], ['Service', '2.080 €', '17 %']],
        }),
      },
      { text: '\nUnd ein kleiner Simulator zum Spielen:\n\n' },
      {
        text:
          '```hui-html\n<div style="font-family:var(--h-font,system-ui);padding:12px;background:var(--h-surface,#f4f4f5);color:var(--h-text,#111);border-radius:var(--h-radius,12px)">\n' +
          '<label>Preisänderung: <b id="v">0</b> %</label><br>\n<input id="s" type="range" min="-20" max="20" value="0" style="width:100%">\n' +
          '<p>Neuer Umsatz: <b id="o">12480</b> €</p>\n' +
          '<script>var s=document.getElementById("s");s.oninput=function(){document.getElementById("v").textContent=s.value;document.getElementById("o").textContent=Math.round(12480*(1+s.value/100));};</script>\n</div>\n```\n',
      },
      {
        text:
          '\n**Fazit:** Gute Woche. Mögliche nächste Schritte:\n\n' +
          '1. Retouren im Bereich Hardware prüfen\n2. Wochenende stärker bewerben\n3. Preisänderung simulieren\n\n' +
          hui({ type: 'suggestions', items: ['Retouren analysieren', 'Marketingplan für das Wochenende'] }),
      },
    ],
  },

  error: {
    format: 'text',
    steps: () => [
      { text: 'Ich beginne mit der Auswertung und lade die Daten …' },
      { tool: { name: 'terminal', label: 'python analyze.py', emoji: '\u{1F4BB}', ms: 700 } },
      { text: '\n\nJetzt wird es kritisch, ich berechne das Ergebnis' },
      { fail: 'error' },
    ],
  },

  drop: {
    format: 'text',
    steps: () => [{ text: 'Diese Antwort wird mitten im Satz abgebrochen, weil die Verbindung' }, { fail: 'drop' }],
  },

  approval: {
    format: 'text',
    steps: () => [
      { text: 'Ich möchte ein temporäres Verzeichnis aufräumen.' },
      {
        approval: {
          command: 'rm -rf /tmp/hermes-ui-cache',
          description: 'recursive delete',
          pattern_key: 'rm -rf',
          pattern_keys: ['rm -rf'],
        },
      },
    ],
  },

  long: {
    format: 'text',
    steps: () => {
      const para =
        'Dies ist ein langer Absatz zum Testen von Scrolling und Streaming-Performance. Er enthält **fetten Text**, *kursiven Text*, `Inline-Code` und einen [Link](https://example.com). Hermes streamt Token für Token, die App soll dabei flüssig bleiben, auch wenn die Antwort mehrere Bildschirmseiten lang wird. ';
      const out = [];
      for (let i = 1; i <= 14; i++) out.push({ text: `## Abschnitt ${i}\n\n${para}${para}\n\n` });
      out.push({ text: '```ts\nfunction fib(n: number): number {\n  return n < 2 ? n : fib(n - 1) + fib(n - 2);\n}\n```\n\nEnde.' });
      return out;
    },
  },
};

/** Pick a scenario from the user's message. Returns { name, scenario, slow }. */
export function pickScenario(userText) {
  const t = userText.toLowerCase();
  const slow = /langsam|slow/.test(t);
  const has = (re) => re.test(t);
  let name = 'plain';
  if (/^\[form:/.test(t)) name = 'formResult';
  else if (/^\[choice:reise/.test(t)) name = 'reiseResult';
  else if (has(/flugzeug oder bahn|bahn oder flug|reise.*\b(flug|flugzeug|bahn|zug)\b/)) name = 'reise';
  else if (has(/fehler|error|crash/)) name = 'error';
  else if (has(/abbruch|\bdrop\b|verbindung weg/)) name = 'drop';
  else if (has(/freigabe|approval|genehmig/)) name = 'approval';
  else if (has(/kredit|darlehen|\bloan/)) name = 'loan';
  else if (has(/rechner|calculator/)) name = 'calculator';
  else if (has(/gemischt|mixed|bericht|report/)) name = 'mixed';
  else if (has(/\blang\b|lange|long/)) name = 'long';
  else if (has(/einkauf|checkliste|checklist|shopping/)) name = 'checklist';
  else if (has(/rezept|recipe/)) name = 'recipe';
  else if (has(/quiz/)) name = 'quiz';
  else if (has(/auswahl|choice|entscheid/)) name = 'choice';
  else if (has(/chart|diagramm|verlauf/)) name = 'chart';
  else if (has(/tabelle|table/)) name = 'table';
  else if (has(/kennzahl|stats|kpi/)) name = 'stats';
  else if (has(/vergleich|compare/)) name = 'compare';
  else if (has(/formular|form\b/)) name = 'form';
  else if (has(/schritt|steps|anleitung/)) name = 'steps';
  else if (has(/werkzeug|nerd/)) name = 'werkzeuge';
  else if (has(/timeline|zeitleiste|ablauf/)) name = 'timeline';
  else if (has(/button|vorschl|suggest/)) name = 'buttons';
  else if (has(/tools|parallel|recherch/)) name = 'tools2';
  else if (has(/tool|uhr|zeit|datum|spät/)) name = 'tool';
  else if (has(/langsam|slow/)) name = 'long';
  return { name, scenario: scenarios[name], slow };
}

export { scenarios };
