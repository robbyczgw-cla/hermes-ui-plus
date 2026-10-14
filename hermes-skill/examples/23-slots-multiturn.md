# 23 Terminvorschlag mit slots (zwei Varianten der Antwort)

Router-Hint: `UI-ROUTER-HINT: format=choice component=slots confidence=0.7`

Nutzer: Schlag mir zwei Zeiten für das Telefonat mit Frau Weber nächste Woche vor. Du hast ja meinen Kalender.

Assistent (Runde 1; Annahme: die Zeiten stammen aus dem Kalender-Tool, beide Fenster waren frei):
````markdown
Laut deinem Kalender sind diese beiden Zeiten nächste Woche frei. Such dir eine aus, dann schreibe ich Frau Weber einen Entwurf.

```hui
{"type":"slots","id":"weber","title":"Telefonat mit Frau Weber","timezone":"Europe/Berlin","slots":[{"id":"a","start":"2026-10-20T10:00","end":"2026-10-20T10:30","label":"Di, 20. Okt., 10:00"},{"id":"b","start":"2026-10-22T15:30","end":"2026-10-22T16:00","label":"Do, 22. Okt., 15:30"}]}
```
````

Nutzer (Variante A, von der App gesendet):
`[slot:weber] Do, 22. Okt., 15:30`

Assistent (A; Entwurf als Text, nichts als gesendet behaupten):
````markdown
Hier ist ein Entwurf, den du kopieren kannst:

> Guten Tag Frau Weber, passt Ihnen ein kurzes Telefonat am Donnerstag, 22. Oktober, um 15:30 Uhr? Viele Grüße

```hui
{"type":"buttons","items":[{"label":"Entwurf kopieren","action":{"type":"copy","text":"Guten Tag Frau Weber, passt Ihnen ein kurzes Telefonat am Donnerstag, 22. Oktober, um 15:30 Uhr? Viele Grüße"}},{"label":"In Kalender (Vorschlag)","action":{"type":"calendar","title":"Telefonat Frau Weber","start":"2026-10-22T15:30","end":"2026-10-22T16:00"}}]}
```
````

Nutzer (Variante B, von der App gesendet):
`[slot:weber] keiner passt`

Assistent (B; fragt nach der Verfügbarkeit statt neue Zeiten zu erfinden):
````markdown
Alles klar. An welchen Tagen und zu welchen Uhrzeiten hättest du nächste Woche Zeit? Dann schlage ich dir neue Fenster vor.
````
