# 16 Kreditrechner als calc (zwei Runden mit [calc:]-Antwort)

Router-Hint: `UI-ROUTER-HINT: format=calc component=loan confidence=0.9`

Nutzer: Bau mir einen Kreditrechner, ich will Summe, Zins und Laufzeit verstellen.

Assistent (Runde 1; kein hui-html, sondern calc):
````markdown
Hier ist ein Annuitätenrechner. Die Rate bleibt konstant. Gebühren, Sondertilgungen und Effektivzins sind nicht enthalten, also nur zur Orientierung.

```hui
{"type":"calc","id":"kredit","title":"Kreditrechner","basis":"calculated","inputs":[{"name":"kredit","label":"Kreditsumme","kind":"slider","min":1000,"max":100000,"step":500,"default":20000,"unit":"€"},{"name":"zins","label":"Zins p. a.","kind":"slider","min":0,"max":12,"step":0.1,"default":4.5,"unit":"%"},{"name":"monate","label":"Laufzeit","kind":"slider","min":6,"max":120,"step":6,"default":60,"unit":"Monate"}],"outputs":[{"name":"r","label":"Monatszins","expr":"zins / 100 / 12","format":"percent","decimals":3},{"name":"rate","label":"Monatliche Rate","expr":"r == 0 ? kredit / monate : kredit * r / (1 - (1 + r) ^ -monate)","format":"currency","emphasis":true},{"name":"gesamt","label":"Gesamtkosten","expr":"rate * monate","format":"currency"},{"label":"Zinsen gesamt","expr":"gesamt - kredit","format":"currency"}],"chart":{"kind":"line","sweep":{"input":"monate","from":12,"to":120,"steps":10},"y":"rate","label":"Rate je Laufzeit"},"note":"Annuitätendarlehen, gleichbleibende Rate, ohne Gebühren."}
```
````

Nutzer (Runde 2, über „Ergebnis übernehmen“):
`[calc:kredit] Kreditsumme 30.000 € · Zins p. a. 5,2 % · Laufzeit 72 Monate → Monatliche Rate 485,94 € · Gesamtkosten 34.987,40 € · Zinsen gesamt 4.987,40 €`

Assistent (Runde 2; geht auf die Zahlen ein, kein neuer Rechner):
````markdown
Bei 30.000 € über 72 Monate zahlst du rund 5.000 € Zinsen. Mit 48 statt 72 Monaten steigt die Rate auf etwa 694 €, die Zinsen sinken aber um gut ein Drittel auf rund 3.300 €. Wenn du magst, rechne ich dir eine Variante mit Sondertilgung durch.
````
