# 37 Rangfolge nach Vorliebe (rank, [rank:]-Antwort)

Router-Hint: `UI-ROUTER-HINT: format=rank confidence=0.85 - Reihenfolge nach Vorliebe`

Nutzer: Ich will meine Urlaubsaktivitäten nach Wichtigkeit sortieren, damit du den Plan danach baust: Strand, Wandern, Städte, Essen, Wellness.

Assistent (Runde 1):
````markdown
Ordne die fünf Punkte so, wie sie dir wichtig sind (oben = am wichtigsten). Danach baue ich den Plan entsprechend.

```hui
{"type":"rank","id":"prio","prompt":"Was ist dir im Urlaub am wichtigsten?","items":[{"label":"Strand","description":"Baden, Liegen"},{"label":"Wandern","description":"Natur, Aussicht"},{"label":"Städte","description":"Museen, Altstadt"},{"label":"Essen","description":"Lokale Küche"},{"label":"Wellness","description":"Sauna, Spa"}],"submitLabel":"Reihenfolge senden"}
```
````

Nutzer (Runde 2, von der App gesendet):
`[rank:prio] 1. Essen · 2. Wandern · 3. Städte · 4. Strand · 5. Wellness`

Assistent (Runde 2):
````markdown
Dann setze ich auf Essen und Wandern: eine Region mit guter Küche und Wanderwegen, etwa die Toskana oder das Piemont, mit ein bis zwei Stadttagen. Strand und Wellness lasse ich weg. Soll ich dafür einen Plan über eine Woche machen?
````
