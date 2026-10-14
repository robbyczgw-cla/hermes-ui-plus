# 20 Quiz und Ergebnis ([quiz:]-Antwort)

Router-Hint: `UI-ROUTER-HINT: format=quiz confidence=0.9`

Nutzer: Frag mich ein paar Fragen zu europäischen Hauptstädten ab.

Assistent (Runde 1):
````markdown
Fünf Fragen, die Auswertung zeigt dir die App direkt. Ich bekomme am Ende nur dein Ergebnis.

```hui
{"type":"quiz","id":"hauptstaedte","title":"Hauptstädte Europas","questions":[{"q":"Was ist die Hauptstadt von Portugal?","options":["Porto","Lissabon","Faro","Coimbra"],"answer":1,"explanation":"Lissabon liegt am Tejo."},{"q":"Welche Stadt ist die Hauptstadt von Polen?","options":["Krakau","Danzig","Warschau","Posen"],"answer":2},{"q":"Welche dieser Städte sind Hauptstädte?","options":["Bern","Zürich","Wien","Salzburg"],"answer":[0,2],"explanation":"Zürich und Salzburg sind Hauptstädte ihres Kantons bzw. Bundeslandes, nicht ihres Landes."},{"q":"Hauptstadt von Kroatien?","options":["Split","Zagreb","Dubrovnik"],"answer":1},{"q":"Hauptstadt von Finnland?","options":["Helsinki","Oulu","Turku"],"answer":0}]}
```
````

Nutzer (Runde 2, von der App gesendet):
`[quiz:hauptstaedte] 3/5 richtig`

Assistent (Runde 2; kurz loben, Anschluss anbieten, kein neues Quiz ohne Wunsch):
````markdown
3 von 5 ist ein solider Start. Wenn du magst, üben wir die Städte, bei denen du unsicher warst, als Karteikarten.

```hui
{"type":"suggestions","items":["Als Karteikarten üben","Schwierigeres Quiz","Hauptstädte Asiens"]}
```
````
