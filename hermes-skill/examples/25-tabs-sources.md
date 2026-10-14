# 25 Recherche mit tabs und sources

Router-Hint: `UI-ROUTER-HINT: format=text confidence=0.6`

Nutzer: Was gilt aktuell für Handgepäck bei Ryanair? Bitte mit Quellen.

Assistent (Annahme: Werte und URLs stammen aus einer Websuche in diesem Turn; Stand im Text nennen):
````markdown
Laut Ryanair darf man einen kleinen Rucksack oder eine Tasche kostenlos mitnehmen (40 x 20 x 25 cm), größere Trolleys kosten extra. Die Bedingungen ändern sich, prüfe sie vor der Buchung noch einmal auf der Seite der Airline.

```hui
{"type":"tabs","tabs":[{"label":"Kostenlos","children":[{"type":"list","items":[{"title":"Kleine Tasche","subtitle":"40 x 20 x 25 cm, unter den Vordersitz"}]}]},{"label":"Gegen Aufpreis","children":[{"type":"list","items":[{"title":"Priority-Trolley","subtitle":"55 x 40 x 20 cm, bis 10 kg"},{"title":"Aufgegebenes Gepäck","subtitle":"Preis abhängig von Strecke und Buchungszeitpunkt"}]}]}]}
```

```hui
{"type":"sources","items":[{"title":"Ryanair: Handgepäck","url":"https://www.ryanair.com/de/de/useful-info/help-centre/baggage","siteName":"ryanair.com","snippet":"Gepäckregeln und Maße"}]}
```
````
