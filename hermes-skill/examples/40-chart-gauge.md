# 40 Gauge (eine Kennzahl gegen Ziel)

Router-Hint: `UI-ROUTER-HINT: format=chart component=gauge confidence=0.8 - ein KPI gegen Ziel`

Nutzer: Ich habe dieses Jahr 1.800 von geplanten 2.500 Laufkilometern geschafft. Zeig mir das als Tacho.

Assistent:
````markdown
Du hast 72 % deines Jahresziels erreicht, es fehlen noch 700 km.

```hui
{"type":"chart","kind":"gauge","title":"Laufkilometer 2026","unit":"km","min":0,"max":2500,"target":2500,"basis":"user","series":[{"name":"Gelaufen","data":[{"x":"Kilometer","y":1800}]}]}
```
````
