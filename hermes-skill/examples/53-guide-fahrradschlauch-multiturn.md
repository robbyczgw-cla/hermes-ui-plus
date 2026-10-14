# 53 Guide: Fahrradschlauch wechseln (guide, Antworten `[guide:]`)

Router-Hint: `UI-ROUTER-HINT: format=guide confidence=0.9`

Nutzer: Wie wechsle ich einen Fahrradschlauch? Schritt für Schritt bitte.

Assistent (Runde 1):
````markdown
Dauer etwa 20 Minuten, du brauchst zwei Reifenheber, einen Ersatzschlauch und eine Pumpe. Die Schritte kannst du einzeln abhaken, bei Problemen sag mir, wo du hängst.

```hui
{"type":"guide","id":"reifen","title":"Fahrradschlauch wechseln","intro":"Du brauchst: 2 Reifenheber, neuen Schlauch (gleiche Größe wie der Mantel), Pumpe.","steps":[{"title":"Rad ausbauen","body":"Bremse öffnen, Schnellspanner lösen oder die Muttern mit dem Schlüssel lockern und das Rad herausnehmen.","warning":"Bei Scheibenbremsen den Bremshebel nicht ziehen, solange das Rad draußen ist."},{"title":"Luft ablassen und Mantel lösen","body":"Ventil öffnen, restliche Luft entweichen lassen. Einen Reifenheber unter die Mantelkante setzen und rundum aushebeln.","imageQuery":"Reifenheber Fahrradmantel"},{"title":"Alten Schlauch entfernen","body":"Schlauch herausziehen. Den Mantel innen mit den Fingern auf Dornen oder Glassplitter absuchen.","tip":"Die Stelle, wo der Schlauch Luft verlor, am Mantel markieren."},{"title":"Neuen Schlauch einlegen","body":"Schlauch leicht anpumpen, das Ventil durchs Felgenloch stecken und den Schlauch gleichmäßig in den Mantel legen."},{"title":"Mantel aufziehen","body":"Mantel mit den Händen in die Felge drücken, am Ende wenig Kraft mit dem Reifenheber, ohne den Schlauch zu klemmen."},{"title":"Aufpumpen und Prüfen","body":"Auf den Druck aufpumpen, der an der Mantelflanke steht. 5 Minuten warten und kontrollieren, ob der Druck hält.","seconds":300},{"title":"Rad einbauen","body":"Rad in die Ausfallenden setzen, Schnellspanner schließen, Bremse wieder einhängen und Probe fahren."}],"stuckLabel":"Ich hänge fest"}
```
````

Nutzer (Runde 2, von der App gesendet):
`[guide:reifen] Schritt 5 („Mantel aufziehen“): Ich hänge fest – der Mantel geht nicht über die Felge`

Assistent (Runde 2; nur zu diesem Schritt helfen, Guide nicht erneut zeigen):
````markdown
Das passiert oft, wenn der Mantel in der Felgenmitte nicht ins Tiefbett rutscht. Drück den bereits aufgezogenen Teil in die Mitte der Felge, dann hast du am Ende mehr Spiel. Hilf mit Spülmittelwasser an der Mantelkante nach. Wenn es trotzdem klemmt: Ist der Mantel größer als die Felge, also die Größenangabe auf beiden gleich?
````

Nutzer (Runde 3, von der App gesendet):
`[guide:reifen] Fertig`

Assistent (Runde 3):
````markdown
Stark, dein Reifen ist wieder fit. Kontrolliere den Druck nach den ersten Kilometern noch einmal. Soll ich dir eine Packliste für die Pannenhilfe fürs Rad machen?
````
