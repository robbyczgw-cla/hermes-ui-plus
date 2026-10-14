// Realistic ```hui-html fragments (German UI) for the gallery, demos and manual tests,
// plus `chunkString()` to replay them as a token stream. Pure (node --test).

export type SandboxSample = { id: string; title: string; html: string };

export const billSplitterSample = `<style>
.bs-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.bs-field{display:flex;flex-direction:column;gap:6px}
.bs-field label{font-size:.85em;color:var(--h-muted)}
.bs-step{display:flex;align-items:center;gap:8px}
.bs-step output{min-width:2ch;text-align:center;font-size:1.1em}
.bs-step button{width:40px;padding:0}
.bs-result{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
.bs-actions{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
</style>
<div class="card">
  <h3>Rechnung teilen</h3>
  <p class="muted">Betrag, Trinkgeld und Personen einstellen – das Ergebnis wird sofort berechnet.</p>
  <div class="bs-grid">
    <div class="bs-field">
      <label for="bs-amount">Rechnungsbetrag (€)</label>
      <input id="bs-amount" type="number" inputmode="decimal" min="0" step="0.01" value="84.50">
    </div>
    <div class="bs-field">
      <label>Personen</label>
      <div class="bs-step">
        <button type="button" id="bs-minus" aria-label="Eine Person weniger">−</button>
        <output id="bs-people">3</output>
        <button type="button" id="bs-plus" aria-label="Eine Person mehr">+</button>
      </div>
    </div>
  </div>
  <div class="bs-field" style="margin-top:12px">
    <label for="bs-tip">Trinkgeld: <strong id="bs-tip-label">10 %</strong></label>
    <input id="bs-tip" type="range" min="0" max="25" step="1" value="10">
  </div>
  <div class="bs-result" role="status">
    <div class="stat"><span class="stat-label">Trinkgeld</span><span class="stat-value" id="bs-tip-sum">–</span></div>
    <div class="stat"><span class="stat-label">Gesamt</span><span class="stat-value" id="bs-total">–</span></div>
    <div class="stat"><span class="stat-label">Pro Person</span><span class="stat-value" id="bs-each" style="color:var(--h-accent)">–</span></div>
  </div>
  <div class="bs-actions">
    <button type="button" class="primary" id="bs-send">Ergebnis in den Chat</button>
    <button type="button" id="bs-copy">Kopieren</button>
  </div>
</div>
<script>
(function () {
  var eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  var amount = document.getElementById('bs-amount');
  var tip = document.getElementById('bs-tip');
  var peopleOut = document.getElementById('bs-people');
  var people = 3;
  var last = null;
  function calc() {
    var a = amount.valueAsNumber;
    if (!isFinite(a) || a < 0 || a > 100000) {
      amount.setAttribute('aria-invalid', 'true');
      document.getElementById('bs-each').textContent = '–';
      last = null;
      return;
    }
    amount.removeAttribute('aria-invalid');
    var t = a * tip.valueAsNumber / 100;
    var total = a + t;
    last = { a: a, t: t, total: total, each: total / people };
    document.getElementById('bs-tip-label').textContent = tip.value + ' %';
    document.getElementById('bs-tip-sum').textContent = eur.format(t);
    document.getElementById('bs-total').textContent = eur.format(total);
    document.getElementById('bs-each').textContent = eur.format(last.each);
    peopleOut.textContent = people;
  }
  function summary() {
    return 'Rechnung ' + eur.format(last.a) + ' + ' + tip.value + ' % Trinkgeld = ' + eur.format(last.total) +
      ', geteilt durch ' + people + ' Personen: ' + eur.format(last.each) + ' pro Person.';
  }
  document.getElementById('bs-minus').onclick = function () { if (people > 1) { people--; calc(); } };
  document.getElementById('bs-plus').onclick = function () { if (people < 50) { people++; calc(); } };
  amount.addEventListener('input', calc);
  tip.addEventListener('input', calc);
  document.getElementById('bs-send').onclick = function () { if (last) window.hermes.send(summary()); };
  document.getElementById('bs-copy').onclick = function () { if (last) window.hermes.copy(summary()); };
  calc();
})();
</script>`;

export const flowDiagramSample = `<style>
.fd-box{fill:var(--h-surface-alt);stroke:var(--h-border-strong);stroke-width:1}
.fd-accent{fill:var(--h-accent-soft);stroke:var(--h-accent);stroke-width:1.2}
.fd-title{fill:var(--h-text);font-size:14px;font-weight:500}
.fd-sub{fill:var(--h-muted);font-size:12px}
.fd-line{stroke:var(--h-muted);stroke-width:1.5;fill:none}
.fd-dash{stroke:var(--h-accent);stroke-width:1.5;fill:none;stroke-dasharray:4 3}
</style>
<h3>So kommt deine Nachricht zu Hermes</h3>
<p class="muted">Vom Tippen in der App bis zur fertigen Antwort mit interaktiven Bausteinen.</p>
<svg width="100%" viewBox="0 0 680 400" role="img" aria-labelledby="fd-t fd-d" xmlns="http://www.w3.org/2000/svg">
  <title id="fd-t">Ablauf einer Chat-Nachricht</title>
  <desc id="fd-d">App sendet an die UI-Bridge, die per Router das Format wählt und an den Hermes Agent weiterleitet; Antworten streamen zurück.</desc>
  <defs>
    <marker id="fd-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
  </defs>
  <g>
    <rect class="fd-accent" x="40" y="40" width="180" height="56" rx="10"/>
    <text class="fd-title" x="130" y="62" text-anchor="middle" dominant-baseline="central">Hermes-App</text>
    <text class="fd-sub" x="130" y="80" text-anchor="middle" dominant-baseline="central">Android / iOS</text>
  </g>
  <g>
    <rect class="fd-box" x="250" y="40" width="180" height="56" rx="10"/>
    <text class="fd-title" x="340" y="62" text-anchor="middle" dominant-baseline="central">UI-Bridge</text>
    <text class="fd-sub" x="340" y="80" text-anchor="middle" dominant-baseline="central">SSE-Proxy</text>
  </g>
  <g>
    <rect class="fd-box" x="460" y="40" width="180" height="56" rx="10"/>
    <text class="fd-title" x="550" y="62" text-anchor="middle" dominant-baseline="central">Hermes Agent</text>
    <text class="fd-sub" x="550" y="80" text-anchor="middle" dominant-baseline="central">Modell + Gedächtnis</text>
  </g>
  <line class="fd-line" x1="220" y1="68" x2="246" y2="68" marker-end="url(#fd-arrow)"/>
  <line class="fd-line" x1="430" y1="68" x2="456" y2="68" marker-end="url(#fd-arrow)"/>
  <g>
    <rect class="fd-box" x="250" y="150" width="180" height="56" rx="10"/>
    <text class="fd-title" x="340" y="172" text-anchor="middle" dominant-baseline="central">UI-Router</text>
    <text class="fd-sub" x="340" y="190" text-anchor="middle" dominant-baseline="central">wählt das Format</text>
  </g>
  <line class="fd-line" x1="340" y1="96" x2="340" y2="146" marker-end="url(#fd-arrow)"/>
  <g>
    <rect class="fd-box" x="460" y="150" width="180" height="56" rx="10"/>
    <text class="fd-title" x="550" y="172" text-anchor="middle" dominant-baseline="central">Werkzeuge</text>
    <text class="fd-sub" x="550" y="190" text-anchor="middle" dominant-baseline="central">Suche, Kalender, Code</text>
  </g>
  <line class="fd-line" x1="550" y1="96" x2="550" y2="146" marker-end="url(#fd-arrow)"/>
  <g>
    <rect class="fd-accent" x="40" y="280" width="600" height="72" rx="12"/>
    <text class="fd-title" x="340" y="306" text-anchor="middle" dominant-baseline="central">Gestreamte Antwort</text>
    <text class="fd-sub" x="340" y="328" text-anchor="middle" dominant-baseline="central">Markdown · native Komponenten (hui) · HTML-Widgets (hui-html)</text>
  </g>
  <path class="fd-dash" d="M550 206 L550 250 L340 250 L340 276" marker-end="url(#fd-arrow)"/>
  <path class="fd-dash" d="M130 276 L130 100" marker-end="url(#fd-arrow)"/>
  <text class="fd-sub" x="140" y="190" dominant-baseline="central">Live-Anzeige</text>
</svg>
<p class="muted" style="font-size:.85em">Ohne Bridge spricht die App direkt mit Hermes – dann entfällt nur die Format-Empfehlung.</p>`;

export const savingsChartSample = `<style>
.sv-controls{display:grid;gap:10px;margin:10px 0 6px}
.sv-row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:2px 12px}
.sv-row label{font-size:.88em;color:var(--h-muted)}
.sv-row output{font-size:.95em}
.sv-row input{grid-column:1 / -1}
.sv-area{fill:var(--h-accent);opacity:.18}
.sv-line{fill:none;stroke:var(--h-accent);stroke-width:2.5;stroke-linejoin:round}
.sv-paid{fill:none;stroke:var(--h-muted);stroke-width:1.5;stroke-dasharray:5 4}
.sv-grid{stroke:var(--h-border);stroke-width:1}
.sv-axis{fill:var(--h-muted);font-size:11px}
.sv-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
.sv-stats .stat-value{font-size:1.1em}
</style>
<h3>Sparplan-Rechner</h3>
<p class="muted">Monatliche Sparrate mit Zinseszins – Schieberegler bewegen, Diagramm und Werte passen sich an.</p>
<div class="sv-controls">
  <div class="sv-row"><label for="sv-rate">Sparrate pro Monat</label><output id="sv-rate-out">200 €</output>
    <input id="sv-rate" type="range" min="25" max="1500" step="25" value="200"></div>
  <div class="sv-row"><label for="sv-years">Laufzeit</label><output id="sv-years-out">20 Jahre</output>
    <input id="sv-years" type="range" min="1" max="40" step="1" value="20"></div>
  <div class="sv-row"><label for="sv-int">Rendite p. a.</label><output id="sv-int-out">5,0 %</output>
    <input id="sv-int" type="range" min="0" max="10" step="0.5" value="5"></div>
</div>
<div class="sv-stats" role="status">
  <div class="stat"><span class="stat-label">Eingezahlt</span><span class="stat-value" id="sv-paid">–</span></div>
  <div class="stat"><span class="stat-label">Zinserträge</span><span class="stat-value" id="sv-gain" style="color:var(--h-success)">–</span></div>
  <div class="stat"><span class="stat-label">Endkapital</span><span class="stat-value" id="sv-end" style="color:var(--h-accent)">–</span></div>
</div>
<svg id="sv-chart" width="100%" viewBox="0 0 360 210" role="img" aria-label="Kapitalentwicklung über die Laufzeit" xmlns="http://www.w3.org/2000/svg"></svg>
<p class="muted" style="font-size:.82em">Beispielrechnung ohne Steuern, Kosten und Inflation. Monatliche Verzinsung mit festem Zinssatz.</p>
<button type="button" id="sv-ask">Ist das realistisch? Frag Hermes</button>
<script>
(function () {
  var eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  var int = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
  function axis(v) { return v >= 1e6 ? int.format(v / 1e6) + ' Mio.' : v >= 1000 ? int.format(v / 1000) + ' Tsd.' : int.format(v); }
  var pct = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.getElementById('sv-chart');
  var $ = function (id) { return document.getElementById(id); };
  var W = 360, H = 210, L = 66, R = 16, T = 10, B = 24;
  function el(name, attrs, text) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    svg.appendChild(n);
    return n;
  }
  function series(rate, years, interest) {
    var r = interest / 100 / 12, bal = 0, paid = 0, out = [{ y: 0, bal: 0, paid: 0 }];
    for (var m = 1; m <= years * 12; m++) {
      bal = bal * (1 + r) + rate; paid += rate;
      if (m % 12 === 0) out.push({ y: m / 12, bal: bal, paid: paid });
    }
    return out;
  }
  function draw() {
    var rate = $('sv-rate').valueAsNumber, years = $('sv-years').valueAsNumber, interest = $('sv-int').valueAsNumber;
    $('sv-rate-out').textContent = eur.format(rate);
    $('sv-years-out').textContent = years + (years === 1 ? ' Jahr' : ' Jahre');
    $('sv-int-out').textContent = pct.format(interest) + ' %';
    var s = series(rate, years, interest), last = s[s.length - 1];
    $('sv-paid').textContent = eur.format(last.paid);
    $('sv-gain').textContent = eur.format(last.bal - last.paid);
    $('sv-end').textContent = eur.format(last.bal);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var max = Math.max(last.bal, 1);
    var x = function (y) { return L + (W - L - R) * y / years; };
    var yv = function (v) { return T + (H - T - B) * (1 - v / max); };
    for (var i = 0; i <= 4; i++) {
      var v = max * i / 4;
      el('line', { class: 'sv-grid', x1: L, x2: W - R, y1: yv(v), y2: yv(v) });
      el('text', { class: 'sv-axis', x: L - 8, y: yv(v), 'text-anchor': 'end', 'dominant-baseline': 'central' }, axis(v) + ' €');
    }
    var step = years <= 10 ? 1 : years <= 20 ? 5 : 10;
    for (var t = 0; t <= years; t += step) el('text', { class: 'sv-axis', x: x(t), y: H - 6, 'text-anchor': 'middle' }, t + ' J.');
    var line = s.map(function (p, i) { return (i ? 'L' : 'M') + x(p.y).toFixed(1) + ' ' + yv(p.bal).toFixed(1); }).join(' ');
    el('path', { class: 'sv-area', d: line + ' L' + x(years) + ' ' + yv(0) + ' L' + x(0) + ' ' + yv(0) + ' Z' });
    el('path', { class: 'sv-paid', d: s.map(function (p, i) { return (i ? 'L' : 'M') + x(p.y).toFixed(1) + ' ' + yv(p.paid).toFixed(1); }).join(' ') });
    el('path', { class: 'sv-line', d: line });
  }
  ['sv-rate', 'sv-years', 'sv-int'].forEach(function (id) { $(id).addEventListener('input', draw); });
  $('sv-ask').addEventListener('click', function () {
    window.hermes.send('Ist ein Sparplan mit ' + $('sv-rate-out').textContent + ' pro Monat über ' + $('sv-years-out').textContent +
      ' bei ' + $('sv-int-out').textContent + ' Rendite realistisch? Ergebnis laut Rechner: ' + $('sv-end').textContent + '.');
  });
  draw();
})();
</script>`;

export const mapSample = `<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
#mp-map{height:300px;border-radius:var(--h-radius);border:1px solid var(--h-border);overflow:hidden}
.mp-pin{width:26px;height:26px;border-radius:50%;background:var(--h-accent);color:var(--h-on-accent);display:flex;align-items:center;justify-content:center;font:600 12px var(--h-font);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)}
.mp-list{margin:10px 0 0;padding:0;list-style:none;display:grid;gap:6px}
.mp-list li{display:flex;gap:10px;align-items:baseline}
.mp-list b{color:var(--h-accent);min-width:1.2em}
</style>
<h3>Spaziergang durch Hamburg</h3>
<p class="muted">Drei Stationen an der Elbe – Koordinaten ungefähr.</p>
<div id="mp-map" role="region" aria-label="Karte"></div>
<p id="mp-status" role="status" class="muted" style="font-size:.85em">Karte wird geladen …</p>
<ol class="mp-list">
  <li><b>1</b><span>Elbphilharmonie</span></li>
  <li><b>2</b><span>Speicherstadt</span></li>
  <li><b>3</b><span>Landungsbrücken</span></li>
</ol>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function () {
  var status = document.getElementById('mp-status');
  if (!window.L) { status.textContent = 'Kartenbibliothek konnte nicht geladen werden.'; return; }
  var stops = [[53.5413, 9.9841], [53.5440, 9.9930], [53.5457, 9.9690]];
  var map = L.map('mp-map', { scrollWheelZoom: false, attributionControl: true });
  var tiles = L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap-Mitwirkende'
  }).addTo(map);
  tiles.once('load', function () { status.textContent = 'Karte geladen.'; });
  tiles.on('tileerror', function () { status.textContent = 'Einige Kartenkacheln konnten nicht geladen werden.'; });
  stops.forEach(function (p, i) {
    L.marker(p, { icon: L.divIcon({ className: '', html: '<div class="mp-pin">' + (i + 1) + '</div>', iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(map);
  });
  L.polyline(stops, { color: getComputedStyle(document.documentElement).getPropertyValue('--h-accent').trim() || '#2563eb', weight: 3, dashArray: '6 6' }).addTo(map);
  map.fitBounds(stops, { padding: [30, 30] });
})();
</script>`;

export const SANDBOX_SAMPLES: SandboxSample[] = [
  { id: 'bill-splitter', title: 'Rechnung teilen', html: billSplitterSample },
  { id: 'flow-diagram', title: 'SVG-Ablaufdiagramm', html: flowDiagramSample },
  { id: 'savings-chart', title: 'Sparplan mit Schiebereglern', html: savingsChartSample },
  { id: 'map', title: 'Leaflet-Karte', html: mapSample },
];

export type ChunkOptions = { min?: number; max?: number; seed?: number };

/**
 * Splits `text` into pseudo-random chunks (deterministic per seed) — the way tokens arrive
 * from a streaming model. `chunks.join('') === text` always holds.
 */
export function chunkString(text: string, { min = 6, max = 28, seed = 1 }: ChunkOptions = {}): string[] {
  const lo = Math.max(1, Math.floor(min));
  const hi = Math.max(lo, Math.floor(max));
  let state = (seed >>> 0) || 1;
  const rand = () => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
  const out: string[] = [];
  for (let i = 0; i < text.length; ) {
    const n = lo + Math.floor(rand() * (hi - lo + 1));
    out.push(text.slice(i, i + n));
    i += n;
  }
  return out;
}
