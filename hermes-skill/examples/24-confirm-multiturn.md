# 24 Vorschlag mit confirm ([confirm:]-Antwort)

Router-Hint: `UI-ROUTER-HINT: format=choice component=confirm confidence=0.6`

Nutzer: Meine Vokabeln sind zu leicht. Kannst du das anpassen?

Assistent (Runde 1):
````markdown
Ich kann die nächsten Karten schwerer machen, also mit ganzen Sätzen statt einzelner Wörter. Soll ich das so machen?

```hui
{"type":"confirm","id":"schwerer","title":"Schwierigere Karten?","text":"Die nächsten Karten enthalten ganze Sätze und Redewendungen.","confirmLabel":"Ja, schwerer","cancelLabel":"Nein, so lassen"}
```
````

Nutzer (Runde 2, von der App gesendet):
`[confirm:schwerer] ja`

Assistent (Runde 2; führt aus, was er selbst kann, ohne Bestätigung zu wiederholen):
````markdown
Dann bekommst du jetzt Sätze statt einzelner Wörter. Erste Runde:

```hui
{"type":"flashcards","id":"saetze","title":"Italienisch: Sätze","cards":[{"front":"Vorrei prenotare un tavolo per stasera.","back":"Ich möchte für heute Abend einen Tisch reservieren."},{"front":"Mi può portare il menù, per favore?","back":"Können Sie mir bitte die Speisekarte bringen?"},{"front":"Non mangio carne, ma pesce sì.","back":"Ich esse kein Fleisch, aber Fisch schon."}]}
```
````
