# 55 Lernplan: Spanisch A2 in 4 Wochen (studyplan, Antwort `[studyplan:]`)

Router-Hint: `UI-ROUTER-HINT: format=studyplan confidence=0.9`

Nutzer: Ich möchte in 4 Wochen Spanisch auf A2 lernen, ich habe etwa 30 Minuten pro Tag. Mach mir einen Lernplan.

Assistent (Runde 1; zwei Wochen voll ausgearbeitet, Rest folgt nach der Rückmeldung):
````markdown
Hier sind die ersten zwei Wochen, jeweils etwa 30 Minuten pro Tag. Hake Aufgaben ab; wenn du magst, schickst du mir deinen Fortschritt, und ich passe Woche 3 und 4 daran an.

```hui
{"type":"studyplan","id":"spanisch-a2","title":"Spanisch A2 in 4 Wochen","goal":"Alltagsgespräche führen und einfache Texte verstehen","weeks":[{"label":"Woche 1: Grundlagen","days":[{"label":"Mo","tasks":[{"text":"Präsens regelmäßiger Verben wiederholen","minutes":20,"kind":"review"},{"text":"15 Vokabeln: Essen und Trinken","minutes":10,"kind":"learn"}]},{"label":"Mi","tasks":[{"text":"Bestellen im Restaurant als Dialog laut üben","minutes":30,"kind":"practice"}]},{"label":"Fr","tasks":[{"text":"Mini-Test zum Wochenstoff","minutes":20,"kind":"test"},{"text":"Fehler nacharbeiten","minutes":10,"kind":"review"}]}]},{"label":"Woche 2: Alltag","days":[{"label":"Mo","tasks":[{"text":"Vergangenheit (Pretérito perfecto) lernen","minutes":25,"kind":"learn"},{"text":"10 Beispielsätze schreiben","minutes":10,"kind":"practice"}]},{"label":"Do","tasks":[{"text":"Kurzen Podcast für Anfänger hören","minutes":20,"kind":"practice"},{"text":"Unbekannte Wörter notieren","minutes":10,"kind":"learn"}]},{"label":"Sa","tasks":[{"text":"Selbsttest: Wegbeschreibung und Einkaufen","minutes":30,"kind":"test"}]}]}]}
```
````

Nutzer (Runde 2, von der App gesendet):
`[studyplan:spanisch-a2] Woche 1: 5/5 erledigt · Woche 2: 2/5 erledigt`

Assistent (Runde 2; Fortschritt kommentieren, nächsten Schritt anbieten, Plan nicht erneut zeigen):
````markdown
Woche 1 komplett erledigt, das ist ein starker Start. In Woche 2 fehlen noch drei Aufgaben, vor allem Hören und der Selbsttest am Samstag. Soll ich Woche 3 und 4 so aufbauen, dass sie auf diesem Stand aufsetzen, oder die Vergangenheit noch einmal mit Übungen festigen?

```hui
{"type":"suggestions","items":["Woche 3 und 4 erstellen","Vergangenheit extra üben"]}
```
````
