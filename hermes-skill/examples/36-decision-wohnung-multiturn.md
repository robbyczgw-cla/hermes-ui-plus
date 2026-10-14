# 36 Entscheidungsmatrix (decision, [decision:]-Antwort)

Router-Hint: `UI-ROUTER-HINT: format=decision confidence=0.85 - mehrere Kriterien gewichten`

Nutzer: Ich schwanke zwischen drei Wohnungen: A (Altbau, zentral, 1.150 €), B (Neubau, Stadtrand, 980 €) und C (Dachgeschoss, gute Lage, 1.250 €). Mir sind Preis und Lage am wichtigsten, Balkon und Größe etwas weniger. Hilf mir, das zu gewichten.

Assistent (Runde 1):
````markdown
Ich habe deine Prioritäten als Gewichte gesetzt (Preis und Lage hoch) und die Wohnungen nach deinen Angaben grob bewertet. Die Punkte sind meine Einschätzung, du kannst Gewichte und Wertungen anpassen.

```hui
{"type":"decision","id":"wohnung","title":"Welche Wohnung?","criteria":[{"id":"preis","label":"Preis","weight":9},{"id":"lage","label":"Lage","weight":8},{"id":"balkon","label":"Balkon","weight":4},{"id":"groesse","label":"Größe","weight":5}],"options":[{"id":"a","label":"Wohnung A","scores":{"preis":5,"lage":9,"balkon":3,"groesse":6},"note":"Altbau, zentral, 1.150 €"},{"id":"b","label":"Wohnung B","scores":{"preis":9,"lage":4,"balkon":7,"groesse":7},"note":"Neubau, Stadtrand, 980 €"},{"id":"c","label":"Wohnung C","scores":{"preis":3,"lage":8,"balkon":8,"groesse":6},"note":"Dachgeschoss, 1.250 €"}],"note":"Bewertungen sind eine Schätzung auf Basis deiner Angaben."}
```
````

Nutzer (Runde 2, von der App gesendet):
`[decision:wohnung] Gewinner: Wohnung A (6,8) · Gewichte: Preis 9, Lage 9, Balkon 4, Größe 5`

Assistent (Runde 2):
````markdown
Mit Lage 9 liegt Wohnung A vorn (6,8), Wohnung B ist nahe dran und gewinnt, sobald der Preis wichtiger wird als die Lage. Wenn dir 170 € Mehrmiete im Monat zu viel sind, ist B die bessere Wahl. Ein Besichtigungstermin für A wäre der nächste Schritt.
````
