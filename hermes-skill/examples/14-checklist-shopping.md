# 14 Einkaufsliste als checklist (zwei Runden)

Router-Hint: `UI-ROUTER-HINT: format=checklist confidence=0.9`

Nutzer: Schreib mir eine Einkaufsliste für Spaghetti Bolognese für 4 Personen und Salat dazu.

Assistent (Runde 1):
````markdown
Hier die Liste für vier Personen, nach Gängen im Supermarkt sortiert. Menge pro Person grob gerechnet, Vorräte wie Salz und Öl habe ich weggelassen.

```hui
{"type":"checklist","id":"einkauf","title":"Bolognese und Salat","kind":"shopping","groupBy":"category","items":[{"text":"Spaghetti","qty":500,"unit":"g","category":"Trockenware"},{"text":"Gehackte Tomaten (Dose)","qty":2,"category":"Trockenware"},{"text":"Tomatenmark","qty":1,"unit":"Tube","category":"Trockenware"},{"text":"Hackfleisch gemischt","qty":500,"unit":"g","category":"Fleisch"},{"text":"Zwiebeln","qty":2,"category":"Obst & Gemüse"},{"text":"Karotten","qty":2,"category":"Obst & Gemüse"},{"text":"Knoblauch","qty":1,"unit":"Knolle","category":"Obst & Gemüse"},{"text":"Kopfsalat","qty":1,"category":"Obst & Gemüse"},{"text":"Parmesan","qty":100,"unit":"g","category":"Kühlregal"},{"text":"Rotwein zum Kochen","qty":1,"unit":"Flasche","category":"Getränke","note":"optional"}]}
```
````

Nutzer (Runde 2, über „An Hermes senden“):
`[checklist:einkauf] erledigt: Spaghetti, Hackfleisch gemischt, Zwiebeln · offen: Gehackte Tomaten (Dose), Tomatenmark, Karotten, Knoblauch, Kopfsalat, Parmesan, Rotwein zum Kochen`

Assistent (Runde 2; nur der offene Rest, kein erneutes Anzeigen der ganzen Liste):
````markdown
Noch offen sind sieben Dinge, davon vier im Gemüse- und Kühlbereich. Der Rotwein ist optional, ein Schuss Gemüsebrühe tut es auch.

```hui
{"type":"checklist","id":"rest","title":"Noch zu kaufen","kind":"shopping","groupBy":"category","items":[{"text":"Gehackte Tomaten (Dose)","qty":2,"category":"Trockenware"},{"text":"Tomatenmark","qty":1,"unit":"Tube","category":"Trockenware"},{"text":"Karotten","qty":2,"category":"Obst & Gemüse"},{"text":"Knoblauch","qty":1,"unit":"Knolle","category":"Obst & Gemüse"},{"text":"Kopfsalat","qty":1,"category":"Obst & Gemüse"},{"text":"Parmesan","qty":100,"unit":"g","category":"Kühlregal"},{"text":"Rotwein zum Kochen","qty":1,"unit":"Flasche","category":"Getränke","note":"optional"}]}
```
````
