# 50 Orte: Restaurants als Liste (places, layout list)

Router-Hint: `UI-ROUTER-HINT: format=places confidence=0.9`

Nutzer: Restaurants in der Nähe vom Hauptbahnhof Salzburg für heute Abend, vegetarisch.

Assistent (Annahme: Daten aus einer Websuche in diesem Turn; Öffnungszeiten nur dort, wo die Quelle sie nannte):
````markdown
Drei Lokale mit guter vegetarischer Auswahl sind vom Bahnhof zu Fuß erreichbar. Das Lokal "Grünkern" ist laut Bewertungen am verlässlichsten; ruf bei Gruppen vorher an.

```hui
{"type":"places","id":"veggie-sbg","title":"Vegetarisch nahe Hauptbahnhof","layout":"list","places":[{"name":"Grünkern","category":"Vegetarisches Restaurant","address":"Rainerstraße 14, 5020 Salzburg","lat":47.8128,"lng":13.0451,"rating":4.7,"reviews":524,"price":"€€","hoursToday":"Heute 17:30-22:00","phone":"+43662000000","distance":"5 min zu Fuß","note":"Saisonale Karte, viele vegane Gerichte","tags":["Vegetarisch","Vegan-Optionen"]},{"name":"Trattoria Primavera","category":"Italienisch","address":"Dreifaltigkeitsgasse 9, 5020 Salzburg","rating":4.3,"reviews":210,"price":"€€","distance":"8 min zu Fuß","note":"Pizza und Pasta auch ohne Fleisch"},{"name":"Café Kern","category":"Café","address":"Bahnhofstraße 2, 5020 Salzburg","website":"https://example.org/cafe-kern","distance":"2 min zu Fuß"}],"source":"Websuche, abgerufen 11.10.2026","basis":"sourced"}
```
````
