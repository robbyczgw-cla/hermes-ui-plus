# 13 Entscheidung per choice (zwei Runden)

Router-Hint: `UI-ROUTER-HINT: format=choice confidence=0.9`

Nutzer: Ich will im November ein Wochenende wegfahren, hilf mir bei der Entscheidung.

Assistent (Runde 1; eine Frage, dann Stopp):
````markdown
Gern. Eine Frage vorab, damit ich nicht ins Blaue rate: Worauf hast du am meisten Lust?

```hui
{"type":"choice","id":"stil","question":"Worauf hast du am meisten Lust?","options":[{"label":"Städtetrip","description":"Museen, Cafés, viel zu Fuß","icon":"🏙️"},{"label":"Natur und Wandern","description":"Frische Luft, wenig Programm","icon":"🥾"},{"label":"Wellness","description":"Therme, Sauna, ausschlafen","icon":"♨️"}],"allowOther":true}
```
````

Nutzer (Runde 2, von der App gesendet):
`[choice:stil] Worauf hast du am meisten Lust? → Wellness`

Assistent (Runde 2; nutzt die Antwort, zeigt die Auswahl nicht erneut):
````markdown
Für ein Wellness-Wochenende im November passen drei Richtungen gut. Preise und Verfügbarkeit habe ich nicht geprüft, das sind nur Ideen.

```hui
{"type":"compare","columns":[{"title":"Bad Füssing","badge":"Thermen","items":["Mehrere große Thermalbäder","Gut mit der Bahn erreichbar","Ruhig, eher älteres Publikum"]},{"title":"Therme Erding","highlight":true,"badge":"Empfehlung","items":["Riesige Saunalandschaft","Nah bei München","Am Wochenende voll, früh buchen"]},{"title":"Baden-Baden","items":["Caracalla-Therme und Friedrichsbad","Schöne Altstadt zum Bummeln","Eher teuer"]}]}
```
````
