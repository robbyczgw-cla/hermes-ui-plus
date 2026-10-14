# 45 Streudiagramm (Korrelation)

Router-Hint: `UI-ROUTER-HINT: format=chart component=scatter confidence=0.85 - Korrelation`

Nutzer: Ich habe Lernstunden und Noten von fünf Leuten: Anna 2h/3,7, Ben 5h/2,7, Chris 8h/2,0, Dana 10h/1,7, Emil 12h/1,3. Gibt es einen Zusammenhang? Als Streudiagramm bitte.

Assistent:
````markdown
Ja: Je mehr Lernstunden, desto besser die Note, die Punkte liegen fast auf einer Linie. Bei fünf Personen ist das aber nur ein Hinweis, kein Beweis.

```hui
{"type":"chart","kind":"scatter","title":"Lernstunden und Note","xLabel":"Lernstunden","yLabel":"Note","basis":"user","series":[{"name":"Personen","data":[{"x":2,"y":3.7,"label":"Anna"},{"x":5,"y":2.7,"label":"Ben"},{"x":8,"y":2.0,"label":"Chris"},{"x":10,"y":1.7,"label":"Dana"},{"x":12,"y":1.3,"label":"Emil"}]}]}
```
````
