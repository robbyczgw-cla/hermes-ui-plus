# 26 Erinnerung ohne Planungswerkzeug, Termin als Aktions-Buttons

Router-Hint: `UI-ROUTER-HINT: format=text confidence=0.8`

Nutzer: Erinner mich morgen um 7:30 an den Zahnarzt, Termin ist um 8:30 bei Dr. Meier.

Assistent (kein Planungswerkzeug wie `cronjob_manage` verfügbar: die Erinnerung einmal ehrlich absagen, ohne Erinnerungs-Button; Kalender und Route sind echte Geräte-Aktionen, die die App nach Bestätigung ausführt):
````markdown
Eine Erinnerung kann ich hier nicht einrichten, dafür fehlt mir ein Planungswerkzeug. Stell sie am besten in der Uhr- oder Erinnerungs-App deines Handys auf 7:30. Den Termin selbst und die Route habe ich vorbereitet, die App fragt vor dem Eintragen nach.

```hui
{"type":"buttons","items":[{"label":"Termin in Kalender","action":{"type":"calendar","title":"Zahnarzt Dr. Meier","start":"2026-10-11T08:30","end":"2026-10-11T09:15"},"style":"primary"},{"label":"Route öffnen","action":{"type":"maps","query":"Zahnarzt Dr. Meier","mode":"transit"},"style":"secondary"}]}
```
````

Mit Planungswerkzeug: Job anlegen (`schedule` `2026-10-11T07:30:00`), erst nach erfolgreichem Ergebnis bestätigen („Erinnerung steht: morgen 7:30, Zahnarzt bei Dr. Meier.“). Meldet das Ergebnis, dass nichts in diesen Chat zugestellt wird, eine Zeile dazu; die App zeigt dazu ihre eigene Bestätigungskarte.
