# 32 Terminumfrage mit Namen (poll mit voters, Mehrfachauswahl)

Router-Hint: `UI-ROUTER-HINT: format=poll confidence=0.85 - Termin für mehrere Personen`

Nutzer: Wir sind zu viert (Anna, Ben, Chris, Dana) und suchen einen Abend für den Spieleabend im November. Wir geben das Handy rum.

Assistent:
````markdown
Jeder wählt seinen Namen und markiert alle Abende, die für ihn gehen. Das Ergebnis zeigt dann, welcher Termin am besten passt.

```hui
{"type":"poll","id":"spieleabend","question":"Welche Abende passen dir?","multiple":true,"voters":["Anna","Ben","Chris","Dana"],"options":[{"label":"Fr, 6. Nov."},{"label":"Sa, 7. Nov."},{"label":"Fr, 13. Nov."},{"label":"Sa, 14. Nov."},{"label":"Fr, 20. Nov."}]}
```
````
