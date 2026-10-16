// Bundled HTML for the demo's hui-html scenarios, ported from mock-server/scenarios.mjs. The widgets run in a
// sandbox without the app's dictionary, so their few UI words and the number format are baked in per chat language.
import type { DemoLang } from './kit.ts';

const S = {
  de: { error: 'Fehler', locale: 'de-DE', title: 'Kreditrechner &ndash; monatliche Rate', amount: 'Kreditsumme', rate: 'Sollzins p.&nbsp;a.', term: 'Laufzeit', year: 'Jahr', years: 'Jahre', monthly: 'Monatliche Rate', interest: 'Zinskosten', total: 'Gesamtbetrag', principal: 'Tilgung', interestLegend: 'Zinsen', balance: 'Restschuld über die Laufzeit', yearCol: 'Jahr', balanceCol: 'Restschuld', note: 'Annuitätendarlehen, monatliche Raten, Zins gebunden über die gesamte Laufzeit.' },
  en: { error: 'Error', locale: 'en-IE', title: 'Loan calculator &ndash; monthly payment', amount: 'Loan amount', rate: 'Interest rate p.&nbsp;a.', term: 'Term', year: 'year', years: 'years', monthly: 'Monthly payment', interest: 'Interest cost', total: 'Total', principal: 'Principal', interestLegend: 'Interest', balance: 'Remaining balance over the term', yearCol: 'Year', balanceCol: 'Balance', note: 'Annuity loan, monthly payments, interest fixed for the whole term.' },
  es: { error: 'Error', locale: 'es-ES', title: 'Calculadora de préstamos &ndash; cuota mensual', amount: 'Importe', rate: 'Interés anual', term: 'Plazo', year: 'año', years: 'años', monthly: 'Cuota mensual', interest: 'Coste de intereses', total: 'Total', principal: 'Amortización', interestLegend: 'Intereses', balance: 'Saldo pendiente durante el plazo', yearCol: 'Año', balanceCol: 'Saldo', note: 'Préstamo de anualidad, cuotas mensuales, interés fijo durante todo el plazo.' },
} as const;

/** Pocket calculator (only the error word depends on the language). */
export const calculatorHtml = (lang: DemoLang): string => `<div class="calc">
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
        if (k === '=') { try { expr = String(Function('"use strict";return (' + (expr || '0') + ')')()); } catch (e) { expr = '${S[lang].error}'; } }
        else { if (expr === '${S[lang].error}') expr = ''; expr += k; }
        d.textContent = expr || '0';
      };
      g.appendChild(b);
    });
    var c = document.createElement('button'); c.textContent = 'C'; c.style.gridColumn = 'span 4';
    c.onclick = function () { expr = ''; d.textContent = '0'; }; g.appendChild(c);
  </script>
</div>`;

// Close to what a model produces for "build me a loan calculator"; texts and number formats follow the chat language.
export const loanHtml = (lang: DemoLang): string => {
  const s = S[lang];
  const eur = new Intl.NumberFormat(s.locale, { style: 'currency', currency: 'EUR' });
  const amount0 = eur.format(20000).replace(/[.,]00$/, '').replace(/\s/g, '&nbsp;');
  const rate0 = new Intl.NumberFormat(s.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(6.5);
  const fmt = (n: number) => eur.format(n).replace(/\s/g, '&nbsp;');
  return `<style>
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
  <h3 style="margin:0">${s.title}</h3>
  <div class="field">
    <div class="field-head"><label for="amount">${s.amount}</label><output id="amountOut">${amount0}</output></div>
    <input type="range" id="amount" min="1000" max="100000" step="500" value="20000">
  </div>
  <div class="field">
    <div class="field-head"><label for="rate">${s.rate}</label><output id="rateOut">${rate0}&nbsp;%</output></div>
    <input type="range" id="rate" min="0.5" max="15" step="0.05" value="6.5">
  </div>
  <div class="field">
    <div class="field-head"><label for="years">${s.term}</label><output id="yearsOut">5 ${s.years}</output></div>
    <input type="range" id="years" min="1" max="10" step="1" value="5">
  </div>
  <div class="result">
    <div class="stat"><div class="stat-label">${s.monthly}</div><div class="stat-value" id="monthly">${fmt(391.32)}</div></div>
    <div class="stat"><div class="stat-label">${s.interest}</div><div class="stat-value" id="interest">${fmt(3479.2)}</div></div>
    <div class="stat"><div class="stat-label">${s.total}</div><div class="stat-value" id="total">${fmt(23479.2)}</div></div>
  </div>
  <div class="bar"><span id="barP" style="width:85%;background:var(--h-chart-1)"></span><span id="barI" style="width:15%;background:var(--h-chart-2)"></span></div>
  <div class="legend"><span><i style="background:var(--h-chart-1)"></i>${s.principal}</span><span><i style="background:var(--h-chart-2)"></i>${s.interestLegend}</span></div>
  <svg id="chart" viewBox="0 0 300 120" preserveAspectRatio="none" aria-label="${s.balance}"></svg>
  <table>
    <thead><tr><th>${s.yearCol}</th><th>${s.interestLegend}</th><th>${s.principal}</th><th>${s.balanceCol}</th></tr></thead>
    <tbody id="plan"></tbody>
  </table>
  <p class="muted" style="margin:0;font-size:.85em">${s.note}</p>
</div>
<script>
  (function () {
    var eur = new Intl.NumberFormat('${s.locale}', { style: 'currency', currency: 'EUR' });
    var pct = new Intl.NumberFormat('${s.locale}', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var $ = function (id) { return document.getElementById(id); };
    function calc() {
      var P = +$('amount').value, r = +$('rate').value / 100 / 12, n = +$('years').value * 12;
      var m = r === 0 ? P / n : (P * r) / (1 - Math.pow(1 + r, -n));
      var total = m * n, interest = total - P;
      $('amountOut').textContent = eur.format(P).replace(/[.,]00$/, '');
      $('rateOut').textContent = pct.format(+$('rate').value) + ' %';
      $('yearsOut').textContent = $('years').value + ($('years').value === '1' ? ' ${s.year}' : ' ${s.years}');
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
};
