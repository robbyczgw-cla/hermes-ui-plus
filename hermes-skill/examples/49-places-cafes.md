# 49 Orte: Cafés in der Nähe (places, nur Tool-Daten)

Router-Hint: `UI-ROUTER-HINT: format=places confidence=0.9`

Nutzer: Gibt es gute Cafés in Ulm-Mitte, die jetzt noch offen haben und wo ich arbeiten kann?

Assistent (Annahme: Daten stammen aus einer Websuche/Maps-Suche in diesem Turn. Die dritte Karte hat nur Name, Adresse und Website, weil das Tool nichts weiter lieferte: keine erfundenen Bewertungen, Zeiten oder Telefonnummern):
````markdown
Für Arbeiten mit Laptop passt das Café Zeitlos am besten: ruhig, WLAN und bis 18 Uhr geöffnet. Die Rösterei Nord ist die Alternative, wenn du guten Kaffee vor Ruhe stellst.

```hui
{"type":"places","id":"cafes-ulm","title":"Cafés in Ulm-Mitte","layout":"carousel","places":[{"name":"Café Zeitlos","category":"Café","address":"Hafengasse 12, 89073 Ulm","rating":4.6,"reviews":812,"price":"€€","openNow":true,"hoursToday":"Heute 8:00-18:00","hours":["Mo-Fr 8:00-18:00","Sa 9:00-17:00","So 10:00-16:00"],"phone":"+49731000000","website":"https://example.org/zeitlos","imageQuery":"Café Zeitlos Ulm","distance":"400 m","note":"Ruhiger Hinterhof, WLAN, hausgemachte Kuchen","tags":["WLAN","Kuchen","Laptop-freundlich"]},{"name":"Rösterei Nord","category":"Kaffeerösterei","address":"Neue Straße 5, 89073 Ulm","rating":4.4,"reviews":356,"price":"€€","openNow":true,"hoursToday":"Heute 9:00-17:00","imageQuery":"Rösterei Nord Ulm","distance":"650 m","note":"Eigene Röstung, wenige Sitzplätze"},{"name":"Bistro am Münsterplatz","category":"Bistro","address":"Münsterplatz 3, 89073 Ulm","website":"https://example.org/bistro-muenster","imageQuery":"Bistro Münsterplatz Ulm"}],"source":"Websuche, abgerufen 11.10.2026","basis":"sourced"}
```

```hui
{"type":"suggestions","items":["Nur mit Steckdosen","Etwas zum Frühstücken","Route zum Café Zeitlos"]}
```
````
