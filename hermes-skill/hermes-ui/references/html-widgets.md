# hui-html widgets - rules and templates

Condensed from OpenIntelligentUI (MIT, (c) Atai Barkai; see NOTICE.md), adapted to the Hermes UI sandbox.

## Hard rules (all hui-html blocks)
1. Fragment only (no html/head/body/doctype). Order: `<style>`, markup, `<script>` last; scripts run only after the block is complete, markup must be readable without JS.
2. Self-contained, < ~15 KB, data inline. No fetch/XHR, invented endpoints, localStorage/cookies, alert/confirm, navigation, `<form>` submit.
3. Theme only via CSS variables; no hard-coded page background/text colors; `font-family:var(--h-font)`.
4. Layout: width 100%, wrap/flex/grid, no fixed widths > 340 px, no `100vh`/`position:fixed`, touch targets >= 44 px, font >= 14 px. SVG: `viewBox` + `width="100%"`.
5. Libraries only from cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com, pinned versions; prefer plain SVG/CSS/JS.
6. `window.hermes.send(text)` only on a user tap (never on load/timer/input change), `.copy`, `.openUrl(https)`; check `window.hermes` exists first.
7. Inputs: `valueAsNumber`, reject NaN/blank/zero divisors with a visible message, `Intl.NumberFormat('de-DE')`, state formula/units/assumptions, provide reset. Never `eval`; set text with `textContent`.
8. Accessible: labels, `<button type="button">`, `aria-label` or text summary for SVG/canvas, honor `prefers-reduced-motion`.
9. Explanation, caveats, sources go in Markdown outside the block.
10. Close every tag and the fence; a broken half-block is worse than none.

## Environment
- Fragment in a sandboxed WebView, ~360 px wide, transparent background, auto height (ResizeObserver).
- Theme vars (set by the app, light/dark): `--h-bg --h-surface --h-text --h-muted --h-accent --h-border --h-radius --h-font`.
- Host API: `window.hermes.send(text)`, `.copy(text)`, `.openUrl(url)`. Allowed CDNs: cdn.jsdelivr.net, unpkg.com, cdnjs.cloudflare.com. No other network, no storage, no navigation.
- While streaming, the block is shown progressively; scripts run only when the block is complete.

## Base style (paste, trim what you do not need)
```html
<style>
.w{font-family:var(--h-font);color:var(--h-text);font-size:15px;line-height:1.4}
.w *{box-sizing:border-box}
.card{background:var(--h-surface);border:1px solid var(--h-border);border-radius:var(--h-radius);padding:14px}
.row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.muted{color:var(--h-muted);font-size:13px}
label{display:block;font-size:13px;color:var(--h-muted);margin-bottom:4px}
input,select{width:100%;min-height:44px;padding:8px 10px;font:inherit;color:var(--h-text);background:var(--h-bg);border:1px solid var(--h-border);border-radius:calc(var(--h-radius)/1.5)}
button{min-height:44px;padding:8px 16px;font:inherit;border:0;border-radius:calc(var(--h-radius)/1.5);background:var(--h-accent);color:#fff}
button.sec{background:transparent;color:var(--h-accent);border:1px solid var(--h-border)}
.out{font-size:24px;font-weight:600}
</style>
```

## Design rules
- Do not turn every answer into a dashboard. One idea per widget; headings, units, assumptions inside the UI only if needed.
- Readable before JS runs (semantic markup, text summary). Every enabled control must do real work.
- Grids collapse: `grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))`.
- Color by meaning, 2-3 colors, plus labels/patterns (not color alone). Canvas colors: `getComputedStyle(document.documentElement).getPropertyValue('--h-accent')` (read lazily; re-read on `prefers-color-scheme` change).
- Bounded chart containers (`height:220px`), no re-creating charts on each input (update data instead).
- Animation: one loop, pause/reset available, off under `prefers-reduced-motion`.
- Untrusted/strings from data: `textContent`, never `innerHTML` interpolation.
- Never send a message on load/timer/input-change; only on explicit tap, label such buttons as actions ("Frage senden").

## Template: calculator (only for a custom/visual tool the native `calc` node cannot express; otherwise use `calc`)
```html
<style>/* base style */</style>
<div class="w card">
  <label for="a">Betrag (€)</label><input id="a" type="number" inputmode="decimal" value="10000" min="0">
  <label for="r" style="margin-top:10px">Zins p. a. (%)</label><input id="r" type="number" inputmode="decimal" value="3.5" min="0" step="0.1">
  <label for="y" style="margin-top:10px">Laufzeit (Jahre): <b id="yv">10</b></label><input id="y" type="range" min="1" max="30" value="10">
  <p class="muted">Formel: A = K (1 + p)^n, jährliche Verzinsung, ohne Steuern.</p>
  <div class="out" id="res" role="status">-</div>
  <div class="row" style="margin-top:8px"><button type="button" id="reset" class="sec">Zurücksetzen</button><button type="button" id="ask">Ergebnis erklären</button></div>
</div>
<script>
const $=id=>document.getElementById(id), nf=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
const def={a:10000,r:3.5,y:10};
function calc(){const K=$('a').valueAsNumber,p=$('r').valueAsNumber/100,n=+$('y').value;$('yv').textContent=n;
 if(!Number.isFinite(K)||!Number.isFinite(p)||K<0||p<0){$('res').textContent='Bitte gültige Werte eingeben.';return null}
 const A=K*Math.pow(1+p,n);$('res').textContent=nf.format(A);return A}
['a','r','y'].forEach(i=>$(i).addEventListener('input',calc));
$('reset').onclick=()=>{$('a').value=def.a;$('r').value=def.r;$('y').value=def.y;calc()};
$('ask').onclick=()=>{const A=calc();if(A!==null&&window.hermes)window.hermes.send('Erkläre mir dieses Ergebnis: '+$('a').value+' € bei '+$('r').value+' % über '+$('y').value+' Jahre = '+nf.format(A))};
calc();
</script>
```

## Template: Chart.js (only when native `chart` cannot do it, e.g. mixed/scatter/interactive)
```html
<div class="w card"><div style="position:relative;height:220px"><canvas id="c" role="img" aria-label="Verlauf der Werte"></canvas></div></div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script>
const cs=getComputedStyle(document.documentElement),col=n=>cs.getPropertyValue(n).trim();
new Chart(document.getElementById('c'),{type:'line',data:{labels:['Q1','Q2','Q3'],datasets:[{label:'Umsatz',data:[3,5,4],borderColor:col('--h-accent'),tension:.3}]},
 options:{maintainAspectRatio:false,plugins:{legend:{labels:{color:col('--h-text')}}},scales:{x:{ticks:{color:col('--h-muted')}},y:{ticks:{color:col('--h-muted')}}}}});
</script>
```
Handle library load failure: `if(!window.Chart){ /* show a text table instead */ }`.

## Maps: use the native `map` node
Places, itineraries and routes are a native `map` node (see places.md), not hui-html. Never invent live traffic, routes, distances or opening hours; label coordinates as approximate.

## Template: stepper / interactive explainer
A slider or step buttons that change an SVG or number display (e.g. "Schritt 1/4"), with a text caption per step in the DOM. Keep state in one object, render() from state, no timers unless there is a pause button.

## Checklist before closing the fence
- <= ~15 KB, no external data fetch, only allowed CDNs, pinned versions.
- Theme variables used, nothing white/black hard-coded for page/text.
- Works at 340 px without horizontal scroll; tap targets >= 44 px.
- Inputs validated, no NaN/Infinity displayed, reset works.
- All tags closed; explanation is in Markdown outside the block.
