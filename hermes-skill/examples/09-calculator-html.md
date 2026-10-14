# 09 Rechner (hui-html, interaktiv)

Router-Hint: `UI-ROUTER-HINT: format=calculator confidence=0.94 - Eingaben und Berechnung`

Hinweis: Seit v2 gehören normale Rechner in den nativen `calc`-Knoten (siehe 16, 17, 28). Dieses hui-html-Beispiel gilt nur für klar eigene oder visuelle Werkzeuge, die `calc` nicht ausdrücken kann.

Nutzer: Bau mir einen Kreditrechner. Ich will Betrag, Zins und Laufzeit einstellen und die monatliche Rate sehen.

Assistent:
````markdown
Hier ist ein Annuitätenrechner. Die Rate ist konstant und enthält Zins und Tilgung. Gebühren, Sondertilgungen und Effektivzins sind nicht berücksichtigt, also nur als Orientierung nutzen.

```hui-html
<style>
.w{font-family:var(--h-font);color:var(--h-text);font-size:15px;line-height:1.4;background:var(--h-surface);border:1px solid var(--h-border);border-radius:var(--h-radius);padding:14px}
.w *{box-sizing:border-box}
.w label{display:block;font-size:13px;color:var(--h-muted);margin:10px 0 4px}
.w input[type=number]{width:100%;min-height:44px;padding:8px 10px;font:inherit;color:var(--h-text);background:var(--h-bg);border:1px solid var(--h-border);border-radius:8px}
.w input[type=range]{width:100%;min-height:32px;accent-color:var(--h-accent)}
.w .out{font-size:28px;font-weight:600;margin-top:12px}
.w .muted{color:var(--h-muted);font-size:13px}
.w .row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.w button{min-height:44px;padding:8px 16px;font:inherit;border:0;border-radius:8px;background:var(--h-accent);color:#fff}
.w button.sec{background:transparent;color:var(--h-accent);border:1px solid var(--h-border)}
</style>
<div class="w">
 <label for="a">Kreditbetrag (€)</label>
 <input id="a" type="number" inputmode="decimal" min="0" step="500" value="20000">
 <label for="r">Sollzins p. a. (%)</label>
 <input id="r" type="number" inputmode="decimal" min="0" step="0.1" value="4.5">
 <label for="y">Laufzeit: <b id="yv">5</b> Jahre</label>
 <input id="y" type="range" min="1" max="30" value="5">
 <div class="out" id="rate" role="status">-</div>
 <div class="muted" id="sum"></div>
 <p class="muted">Formel: Rate = K * i / (1 - (1 + i)^-n), i = Zins/12, n = Monate.</p>
 <div class="row"><button type="button" class="sec" id="reset">Zurücksetzen</button><button type="button" id="ask">Ergebnis erklären</button></div>
</div>
<script>
var $=function(i){return document.getElementById(i)};
var eur=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
var DEF={a:20000,r:4.5,y:5};
function calc(){
  var K=$('a').valueAsNumber,p=$('r').valueAsNumber,y=+$('y').value;
  $('yv').textContent=y;
  if(!Number.isFinite(K)||!Number.isFinite(p)||K<=0||p<0){$('rate').textContent='Bitte gültige Werte eingeben.';$('sum').textContent='';return null}
  var i=p/100/12,n=y*12;
  var m=i===0?K/n:K*i/(1-Math.pow(1+i,-n));
  $('rate').textContent=eur.format(m)+' / Monat';
  $('sum').textContent='Gesamtzahlung '+eur.format(m*n)+', davon Zinsen '+eur.format(m*n-K);
  return {m:m,K:K,p:p,y:y};
}
['a','r','y'].forEach(function(id){$(id).addEventListener('input',calc)});
$('reset').addEventListener('click',function(){$('a').value=DEF.a;$('r').value=DEF.r;$('y').value=DEF.y;calc()});
$('ask').addEventListener('click',function(){
  var c=calc();
  if(c&&window.hermes)window.hermes.send('Erkläre mir diese Kreditrechnung: '+c.K+' € bei '+c.p+' % über '+c.y+' Jahre, Rate '+eur.format(c.m));
});
calc();
</script>
```
````
