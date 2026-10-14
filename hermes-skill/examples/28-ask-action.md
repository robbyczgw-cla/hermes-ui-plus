# 28 calc mit ask-Aktion (Werte gezielt an Hermes schicken)

Router-Hint: `UI-ROUTER-HINT: format=calc component=savings confidence=0.9`

Nutzer: Wie viel habe ich nach 20 Jahren, wenn ich monatlich 300 € in einen ETF spare?

Assistent:
````markdown
Bei angenommenen 6 % Rendite pro Jahr wären es nach 20 Jahren rund 138.000 €, davon 72.000 € eingezahlt. Die Rendite ist eine Annahme, keine Prognose, und Steuern sind nicht enthalten.

```hui
{"type":"stack","children":[{"type":"calc","id":"sparplan","title":"Sparplan","basis":"estimate","inputs":[{"name":"rate","label":"Monatlich","kind":"slider","min":25,"max":2000,"step":25,"default":300,"unit":"€"},{"name":"zins","label":"Rendite p. a. (Annahme)","kind":"slider","min":0,"max":10,"step":0.5,"default":6,"unit":"%"},{"name":"jahre","label":"Laufzeit","kind":"slider","min":1,"max":40,"step":1,"default":20,"unit":"Jahre"}],"outputs":[{"name":"endwert","label":"Endwert","expr":"zins == 0 ? rate * 12 * jahre : rate * (((1 + zins / 100 / 12) ^ (12 * jahre) - 1) / (zins / 100 / 12))","format":"currency","decimals":0,"emphasis":true},{"name":"einzahlung","label":"Eingezahlt","expr":"rate * 12 * jahre","format":"currency","decimals":0},{"label":"Ertrag","expr":"endwert - einzahlung","format":"currency","decimals":0}],"note":"Monatliche Verzinsung, ohne Kosten und Steuern; Rendite ist eine Annahme."},{"type":"buttons","items":[{"label":"Was heißt das für mich?","action":{"type":"ask","text":"Bewerte dieses Ergebnis kurz und nenne Risiken.","include":["sparplan"]},"style":"secondary"}]}]}
```
````
