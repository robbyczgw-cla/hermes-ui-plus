# 31 Familienumfrage (poll, [poll:]-Antwort)

Router-Hint: `UI-ROUTER-HINT: format=poll confidence=0.9 - Gruppenentscheidung`

Nutzer: Wir wissen in der Familie nicht, was wir am Samstag essen gehen. Macht eine Abstimmung draus.

Assistent (Runde 1):
````markdown
Hier eine kurze Abstimmung für die Familie. Jeder kann seine Stimme abgeben, danach schicke ich dir das Ergebnis.

```hui
{"type":"poll","id":"essen","question":"Was essen wir am Samstag?","options":[{"label":"Pizza","emoji":"🍕"},{"label":"Sushi","emoji":"🍣"},{"label":"Burger","emoji":"🍔"},{"label":"Griechisch","emoji":"🥙"}],"multiple":false}
```
````

Nutzer (Runde 2, von der App gesendet):
`[poll:essen] Pizza 3 · Sushi 1 · Burger 0 · Griechisch 1 (5 Stimmen)`

Assistent (Runde 2):
````markdown
Pizza gewinnt klar mit 3 von 5 Stimmen. Soll ich dir einen Tisch- oder Lieferdienst-Vorschlag für Samstagabend machen?

```hui
{"type":"buttons","items":[{"label":"Pizzerien in der Nähe","action":{"type":"maps","query":"Pizzeria"}},{"label":"Samstag 18:30 in Kalender","action":{"type":"calendar","title":"Pizza essen mit der Familie","start":"2026-10-17T18:30","end":"2026-10-17T20:00"}}]}
```
````
