# 42 Waterfall (Budgetfluss)

Router-Hint: `UI-ROUTER-HINT: format=chart component=waterfall confidence=0.85 - Budgetfluss`

Nutzer: Mein Monat: 3.200 € Netto, Miete 1.100, Lebensmittel 420, Auto 260, Freizeit 300, Sparen 500. Zeig, wie das Geld fließt, was bleibt übrig?

Assistent:
````markdown
Von 3.200 € bleiben nach allen Posten 620 € übrig.

```hui
{"type":"chart","kind":"waterfall","title":"Monatsbudget","unit":"€","basis":"user","series":[{"name":"Budget","data":[{"x":"Netto","y":3200},{"x":"Miete","y":-1100},{"x":"Lebensmittel","y":-420},{"x":"Auto","y":-260},{"x":"Freizeit","y":-300},{"x":"Sparen","y":-500},{"x":"Übrig","y":620,"total":true}]}]}
```
````
