# 34 Tagesplan (agenda, [agenda:]-Antwort)

Router-Hint: `UI-ROUTER-HINT: format=agenda confidence=0.9 - Tagesplanung mit Uhrzeiten`

Nutzer: Plane meinen Samstag: um 10 Uhr Zahnarzt (eine Stunde), abends 19 Uhr Kino. Dazwischen will ich Sport, Einkaufen und etwas Ruhe.

Assistent (Runde 1):
````markdown
Ich habe den Samstag um die beiden festen Termine herum geplant. Du kannst die Blöcke verschieben und den Plan danach übernehmen.

```hui
{"type":"agenda","id":"samstag","date":"2026-10-17","title":"Samstag","blocks":[{"start":"09:00","end":"09:45","title":"Frühstück","kind":"meal"},{"start":"10:00","end":"11:00","title":"Zahnarzt","kind":"event","note":"Fester Termin"},{"start":"11:30","end":"12:30","title":"Joggen","kind":"sport"},{"start":"13:00","end":"14:00","title":"Mittagessen","kind":"meal"},{"start":"14:30","end":"16:00","title":"Einkaufen","kind":"free"},{"start":"16:30","end":"18:00","title":"Ruhe / Lesen","kind":"free"},{"start":"19:00","end":"21:30","title":"Kino","kind":"event","note":"Fester Termin"}]}
```
````

Nutzer (Runde 2, von der App gesendet):
`[agenda:samstag] 09:00–09:45 Frühstück · 10:00–11:00 Zahnarzt · 12:00–13:00 Joggen · 13:30–14:15 Mittagessen · 14:30–16:00 Einkaufen · 16:30–18:00 Ruhe / Lesen · 19:00–21:30 Kino`

Assistent (Runde 2):
````markdown
Passt, das Joggen liegt jetzt um 12:00 und es gibt keine Überschneidungen mit Zahnarzt und Kino. Nach dem Joggen bleibt eine Stunde bis zum Mittagessen, um zu duschen. Soll ich dich vor dem Zahnarzt erinnern?

```hui
{"type":"buttons","items":[{"label":"Erinnerung 09:30","action":{"type":"reminder","title":"Zahnarzt um 10:00","at":"2026-10-17T09:30"}}]}
```
````
