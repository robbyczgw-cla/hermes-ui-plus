# 17 Rechnung teilen mit Trinkgeld (calc, Rundung)

Router-Hint: `UI-ROUTER-HINT: format=calc confidence=0.9`

Nutzer: Wir sind zu viert essen, Rechnung 84,50 €. Rechne mir aus, was jeder zahlt, mit Trinkgeld.

Assistent:
````markdown
Mit 10 % Trinkgeld sind es 92,95 €, also rund 23,24 € pro Person. Mit den Reglern kannst du Trinkgeld und Personenzahl ändern. Gerundete Anteile addieren sich nicht immer exakt zur Summe, deshalb zeige ich den letzten Anteil als Rest.

```hui
{"type":"calc","id":"tipp","title":"Rechnung teilen","basis":"calculated","inputs":[{"name":"rechnung","label":"Rechnungsbetrag","kind":"number","default":84.5,"unit":"€"},{"name":"trinkgeld","label":"Trinkgeld","kind":"slider","min":0,"max":20,"step":1,"default":10,"unit":"%"},{"name":"personen","label":"Personen","kind":"slider","min":1,"max":12,"step":1,"default":4}],"outputs":[{"name":"gesamt","label":"Gesamt mit Trinkgeld","expr":"round(rechnung * (1 + trinkgeld / 100), 2)","format":"currency"},{"name":"anteil","label":"Pro Person","expr":"round(gesamt / max(personen, 1), 2)","format":"currency","emphasis":true},{"label":"Letzte Person (Rest)","expr":"gesamt - (max(personen, 1) - 1) * anteil","format":"currency"}],"note":"Trinkgeld auf den Gesamtbetrag, Anteile auf Cent gerundet, der letzte zahlt den Rest. Keine Zahlung wird ausgelöst."}
```
````
