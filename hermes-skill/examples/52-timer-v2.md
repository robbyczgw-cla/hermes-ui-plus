# 52 Timer v2: mehrere Timer und Countdown bis zu einer Uhrzeit

Router-Hint: `UI-ROUTER-HINT: format=timer confidence=0.9`

Nutzer: Ich koche heute Sonntagsbraten mit Kartoffeln und Gemüse. Stell mir Timer für alles, der Braten braucht 90 Minuten.

Assistent (Runde 1; mehrere Timer in EINEM Node, nie autostart):
````markdown
Drei Timer für dein Menü. Starte jeden, wenn das jeweilige Gericht im Ofen oder Topf ist. Die App meldet sich auch, wenn sie im Hintergrund ist.

```hui
{"type":"timer","id":"sonntag","label":"Sonntagsbraten","seconds":0,"timers":[{"label":"Braten","seconds":5400},{"label":"Kartoffeln","seconds":1500},{"label":"Gemüse","seconds":420}]}
```
````

Nutzer: Und wie lange noch bis zum Anpfiff am Samstag um 20:45?

Assistent (Runde 2; Countdown mit `until`, ISO-Zeit, Datum aus dem Kontext bekannt: Samstag 17.10.2026):
````markdown
Bis zum Anpfiff am Samstag, 17. Oktober um 20:45 Uhr läuft dieser Countdown.

```hui
{"type":"timer","id":"anpfiff","label":"Bis zum Anpfiff","seconds":0,"until":"2026-10-17T20:45"}
```
````
