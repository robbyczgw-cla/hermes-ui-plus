# 43 Horizontale Balken (Ranking)

Router-Hint: `UI-ROUTER-HINT: format=chart component=hbar confidence=0.8 - Ranking`

Nutzer: Zeig mir die fünf größten Städte Deutschlands nach Einwohnern als Ranking-Balken.

Assistent:
````markdown
Berlin ist mit rund 3,7 Mio. Einwohnern mit Abstand die größte Stadt, gefolgt von Hamburg. Ungefähre Werte, gerundet.

```hui
{"type":"chart","kind":"hbar","title":"Größte Städte (Einwohner, Mio.)","unit":"Mio.","basis":"estimate","series":[{"name":"Einwohner","data":[{"x":"Berlin","y":3.7},{"x":"Hamburg","y":1.9},{"x":"München","y":1.5},{"x":"Köln","y":1.1},{"x":"Frankfurt","y":0.77}]}]}
```
````
