# 26 Erinnerung und Termin als Aktions-Buttons

Router-Hint: `UI-ROUTER-HINT: format=text confidence=0.8`

Nutzer: Erinner mich morgen um 7:30 an den Zahnarzt, Termin ist um 8:30 bei Dr. Meier.

Assistent (kein Tool zum Eintragen; nur Vorschläge, die die App nach Bestätigung ausführt):
````markdown
Ich kann dir morgen früh nichts selbst eintragen, aber ich habe beides vorbereitet. Die App fragt vor dem Eintragen nach deiner Bestätigung.

```hui
{"type":"buttons","items":[{"label":"Erinnerung 7:30","action":{"type":"reminder","title":"Zahnarzt bei Dr. Meier um 8:30","at":"2026-10-11T07:30"},"style":"primary"},{"label":"Termin in Kalender","action":{"type":"calendar","title":"Zahnarzt Dr. Meier","start":"2026-10-11T08:30","end":"2026-10-11T09:15"}},{"label":"Route öffnen","action":{"type":"maps","query":"Zahnarzt Dr. Meier","mode":"transit"},"style":"secondary"}]}
```
````
