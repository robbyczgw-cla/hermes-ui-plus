# 44 Gestapelte Balken (Zusammensetzung je Kategorie)

Router-Hint: `UI-ROUTER-HINT: format=chart component=stacked confidence=0.8 - Zusammensetzung über Kategorien`

Nutzer: Meine Ausgaben pro Quartal, aufgeteilt in Wohnen, Essen, Freizeit: Q1 1100/400/200, Q2 1100/430/350, Q3 1150/410/500. Zeig die Zusammensetzung gestapelt.

Assistent:
````markdown
Die Gesamtausgaben steigen von 1.700 € auf 2.060 €, vor allem wegen der Freizeit.

```hui
{"type":"chart","kind":"stacked","title":"Ausgaben pro Quartal","unit":"€","basis":"user","series":[{"name":"Wohnen","data":[{"x":"Q1","y":1100},{"x":"Q2","y":1100},{"x":"Q3","y":1150}]},{"name":"Essen","data":[{"x":"Q1","y":400},{"x":"Q2","y":430},{"x":"Q3","y":410}]},{"name":"Freizeit","data":[{"x":"Q1","y":200},{"x":"Q2","y":350},{"x":"Q3","y":500}]}]}
```
````
