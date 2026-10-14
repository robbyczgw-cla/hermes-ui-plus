# 19 Rezept (recipe) mit Einkaufsliste-Button

Router-Hint: `UI-ROUTER-HINT: format=recipe confidence=0.9`

Nutzer: Gib mir ein einfaches Rezept für Pfannkuchen für 3 Personen.

Assistent:
````markdown
Ein Grundteig, der ohne Backpulver auskommt. Die Mengen lassen sich in der Karte mit der Portionszahl umrechnen. Die Wartezeit des Teigs ist als Timer hinterlegt.

```hui
{"type":"recipe","id":"pfannkuchen","title":"Pfannkuchen","imageQuery":"Pfannkuchen","servings":3,"time":{"prep":10,"cook":15,"total":35},"ingredients":[{"qty":250,"unit":"g","item":"Mehl"},{"qty":500,"unit":"ml","item":"Milch"},{"qty":3,"item":"Eier"},{"qty":1,"unit":"Prise","item":"Salz"},{"qty":2,"unit":"EL","item":"Zucker","group":"Optional"},{"item":"Butter oder Öl zum Braten"}],"steps":[{"text":"Mehl, Milch, Eier und Salz glatt verrühren."},{"text":"Teig 20 Minuten quellen lassen.","timerSeconds":1200},{"text":"Wenig Fett in der Pfanne erhitzen, eine Kelle Teig verteilen."},{"text":"Je Seite etwa 2 Minuten goldgelb backen."}],"tips":["Die erste Portion wird oft nicht perfekt, die Pfanne muss heiß genug sein."]}
```

```hui
{"type":"buttons","items":[{"label":"Zutaten auf die Einkaufsliste","action":{"type":"add_to_list","items":["Mehl 250 g","Milch 500 ml","Eier 3 Stück"],"listTitle":"Einkauf"},"style":"secondary"}]}
```
````
