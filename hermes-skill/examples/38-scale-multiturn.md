# 38 Bewertungsskala (scale, [scale:]-Antwort)

Router-Hint: `UI-ROUTER-HINT: format=scale confidence=0.8 - Bewertung 1-5`

Nutzer: Frag mich bitte, wie gut mir das Training heute gefallen hat, auf einer Skala.

Assistent (Runde 1):
````markdown
Gern, tippe einfach die Sterne an.

```hui
{"type":"scale","id":"training","question":"Wie gut war das Training heute?","min":1,"max":5,"style":"stars","labels":{"min":"Schlecht","max":"Super"}}
```
````

Nutzer (Runde 2, von der App gesendet):
`[scale:training] 4/5 Super`

Assistent (Runde 2):
````markdown
4 von 5, das klingt nach einem guten Training. Soll ich die nächste Einheit ähnlich aufbauen oder etwas ändern?
````
