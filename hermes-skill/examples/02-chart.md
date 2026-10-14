# 02 Diagramm (nativ)

Router-Hint: `UI-ROUTER-HINT: format=chart confidence=0.88 - Werte über Monate`

Nutzer: Zeig mir die durchschnittlichen Monatstemperaturen in Berlin als Kurve.

Assistent:
````markdown
Im Juli wird es mit etwa 19 °C im Schnitt am wärmsten, im Januar mit rund 0 °C am kältesten. Es sind ungefähre Klimamittelwerte, keine Messreihe aus einer Abfrage.

```hui
{"type":"chart","kind":"line","title":"Mittlere Temperatur in Berlin (ca.)","unit":"°C","xLabel":"Monat","yLabel":"Temperatur","series":[{"name":"Durchschnitt","data":[{"x":"Jan","y":0.6},{"x":"Feb","y":1.3},{"x":"Mär","y":4.7},{"x":"Apr","y":9.6},{"x":"Mai","y":14.3},{"x":"Jun","y":17.7},{"x":"Jul","y":19.8},{"x":"Aug","y":19.4},{"x":"Sep","y":15.0},{"x":"Okt","y":9.9},{"x":"Nov","y":4.9},{"x":"Dez","y":1.8}]}]}
```
````
