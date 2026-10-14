# 54 Workout: Push-Tag (workout, Antwort `[workout:]`)

Router-Hint: `UI-ROUTER-HINT: format=workout confidence=0.9`

Nutzer: Mach mir einen Trainingsplan für heute, Brust und Schultern, 45 Minuten, ich habe Kurzhanteln und eine Bank.

Assistent (Runde 1; Gewichte nur als Startvorschlag, Level und Equipment sind genannt):
````markdown
Ein kompakter Push-Tag für 45 Minuten mit Kurzhanteln. Wähle die Gewichte so, dass die letzten ein bis zwei Wiederholungen jedes Satzes anstrengend sind. Bei Schmerzen im Gelenk die Übung auslassen.

```hui
{"type":"workout","id":"push-heute","title":"Push-Tag mit Kurzhanteln","kind":"strength","warmup":"5 Min Armkreisen, Schulterkreisen und leichte Liegestütze","exercises":[{"name":"Kurzhantel-Bankdrücken","sets":4,"reps":"8-10","weight":"Startgewicht wählen","restSeconds":90,"imageQuery":"Kurzhantel Bankdrücken Übung"},{"name":"Schrägbank-Fliegende","sets":3,"reps":12,"restSeconds":60},{"name":"Schulterdrücken im Sitzen","sets":3,"reps":10,"restSeconds":90},{"name":"Seitheben","sets":3,"reps":15,"restSeconds":45},{"name":"Trizeps-Dips an der Bank","sets":3,"reps":"AMRAP","weight":"Körpergewicht","restSeconds":60},{"name":"Plank","sets":3,"seconds":45,"restSeconds":30}],"cooldown":"Brust und Schultern je 30 Sekunden dehnen"}
```
````

Nutzer (Runde 2, von der App gesendet):
`[workout:push-heute] 17/19 Sätze · 44 min · Kurzhantel-Bankdrücken 4×10 @ 22 kg · Schulterdrücken im Sitzen 3×10 @ 16 kg · Plank 2×45 s`

Assistent (Runde 2; kurz bewerten, Steigerung vorschlagen, kein neues Workout ohne Wunsch):
````markdown
17 von 19 Sätzen in 44 Minuten ist ein sehr solides Training. Wenn die 10 Wiederholungen beim Bankdrücken sauber liefen, nimm beim nächsten Mal 2 kg mehr. Morgen wäre ein Pull- oder Beintag sinnvoll.

```hui
{"type":"suggestions","items":["Pull-Tag für morgen","Beintraining planen"]}
```
````
