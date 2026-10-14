# 07 Formular und Auswertung (zwei Runden)

Router-Hint: `UI-ROUTER-HINT: format=form confidence=0.8 - mehrere Eingaben nötig`

Nutzer: Plan mir einen Kurzurlaub.

Assistent (Runde 1):
````markdown
Gern. Ein paar Angaben reichen mir, dann mache ich dir einen konkreten Vorschlag.

```hui
{"type":"form","id":"trip","title":"Kurzurlaub planen","fields":[{"name":"ziel","label":"Wunschziel (oder leer lassen)","kind":"text","placeholder":"z. B. Lissabon"},{"name":"tage","label":"Dauer","kind":"slider","min":2,"max":10,"step":1,"unit":"Tage","default":4},{"name":"budget","label":"Budget gesamt","kind":"number","unit":"€","default":800},{"name":"stil","label":"Stil","kind":"select","options":["Städtetrip","Natur","Strand","Wellness"]},{"name":"abreise","label":"Frühester Abreisetag","kind":"date"},{"name":"bahn","label":"Nur mit Bahn erreichbar","kind":"toggle","default":false}],"submit":{"label":"Vorschlag erstellen"}}
```
````

Nutzer (Runde 2, von der App gesendet):
`[form:trip] {"ziel":"","tage":4,"budget":800,"stil":"Städtetrip","abreise":"2026-11-06","bahn":true}`

Assistent (Runde 2; Annahme: Preise stammen aus einer Recherche, hier nur als Richtwerte):
````markdown
Mit Bahn, vier Tagen und 800 € passt **Wien** gut: ab Berlin etwa 8 Stunden im Direktzug, und die Innenstadt ist zu Fuß machbar. Alle Beträge sind grobe Richtwerte, ich habe sie nicht live geprüft.

```hui
{"type":"card","title":"Wien, 4 Tage","subtitle":"ab 6. Nov. 2026","children":[{"type":"chart","kind":"donut","title":"Budget","unit":"€","series":[{"name":"Budget","data":[{"x":"Bahn (Sparpreis)","y":160},{"x":"Unterkunft (3 Nächte)","y":330},{"x":"Essen","y":200},{"x":"Museen und Sonstiges","y":110}]}]},{"type":"list","style":"number","items":[{"title":"Tag 1","subtitle":"Anreise, Altstadt und Stephansdom"},{"title":"Tag 2","subtitle":"Schönbrunn, Naschmarkt"},{"title":"Tag 3","subtitle":"Belvedere, Kaffeehaus-Tour"},{"title":"Tag 4","subtitle":"Rückreise am Nachmittag"}]},{"type":"buttons","items":[{"label":"Alternativen zeigen","action":{"type":"send","text":"Zeig mir zwei Alternativen zu Wien"},"style":"secondary"},{"label":"Detailplan","action":{"type":"send","text":"Mach mir einen Detailplan für Tag 1 bis 4 in Wien"},"style":"primary"}]}]}
```
````
