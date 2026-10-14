# 03 Kennzahlen nach Tool-Abruf

Router-Hint: `UI-ROUTER-HINT: format=stats confidence=0.9 - Status mit wenigen Kennzahlen`

Nutzer: Wie geht es meinem Server gerade?

(Annahme: der Agent hat zuvor per Terminal-Tool `uptime`, `free` und `df` ausgeführt und diese Werte erhalten.)

Assistent:
````markdown
Dem Server geht es gut, nur die Festplatte füllt sich langsam. Gemessen eben per Terminal auf `hermes-host`.

```hui
{"type":"card","title":"hermes-host - Systemstatus","children":[{"type":"stats","items":[{"label":"Last (1 min)","value":"0,42","trend":"flat"},{"label":"RAM belegt","value":"5,1 / 16 GB","delta":"32 %","trend":"flat"},{"label":"Laufzeit","value":"41 Tage"}]},{"type":"progress","label":"Festplatte /","value":78,"max":100},{"type":"callout","tone":"warning","title":"Speicher","text":"Die Festplatte ist zu **78 %** belegt. Bei 85 % würde ich aufräumen."}]}
```
````
