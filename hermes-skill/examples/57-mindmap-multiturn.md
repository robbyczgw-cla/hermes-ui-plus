# 57 Mindmap: Photosynthese (mindmap, Antwort `[mindmap]` ohne id)

Router-Hint: `UI-ROUTER-HINT: format=mindmap confidence=0.9`

Nutzer: Mach mir eine Mindmap zur Photosynthese, damit ich die Zusammenhänge fürs Lernen sehe.

Assistent (Runde 1; 3-7 Hauptäste, kurze Labels, Details in `note`):
````markdown
Die Mindmap zeigt, was die Pflanze braucht, was sie daraus macht und wo das passiert. Tippe auf einen Knoten für eine Erklärung oder lass dir einen Ast vertiefen.

```hui
{"type":"mindmap","id":"photosynthese","title":"Photosynthese","root":{"label":"Photosynthese","note":"Pflanzen wandeln Lichtenergie in chemische Energie um.","children":[{"label":"Ausgangsstoffe","children":[{"label":"Wasser","note":"Wird über die Wurzeln aufgenommen."},{"label":"Kohlenstoffdioxid","note":"Gelangt durch die Spaltöffnungen ins Blatt."},{"label":"Licht","note":"Liefert die Energie für die Reaktion."}]},{"label":"Produkte","children":[{"label":"Glukose","note":"Zucker, den die Pflanze als Energie- und Baustoff nutzt."},{"label":"Sauerstoff","note":"Wird über die Spaltöffnungen abgegeben."}]},{"label":"Ort","children":[{"label":"Chloroplasten","note":"Zellorganellen mit dem grünen Farbstoff Chlorophyll."}]},{"label":"Phasen","children":[{"label":"Lichtreaktion","note":"Läuft in den Thylakoiden ab und bildet ATP."},{"label":"Calvin-Zyklus","note":"Baut mit ATP aus CO2 Glukose auf."}]}]}}
```
````

Nutzer (Runde 2, von der App gesendet):
`[mindmap] Erkläre „Calvin-Zyklus“ genauer`

Assistent (Runde 2; als Text erklären, keine neue Mindmap ohne Wunsch):
````markdown
Der Calvin-Zyklus ist die "dunkle" Phase der Photosynthese im Stroma der Chloroplasten. Ein Enzym (RuBisCO) bindet CO2 an einen Fünfer-Zucker, daraus entstehen zwei Dreier-Zucker. Mit der Energie (ATP) und den Elektronen (NADPH) aus der Lichtreaktion wird daraus Glukose aufgebaut, und der Fünfer-Zucker wird zurückgewonnen. Der Zyklus braucht kein Licht direkt, aber die Produkte der Lichtreaktion.
````
