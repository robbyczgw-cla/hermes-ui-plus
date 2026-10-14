# 27 Beispieldaten ehrlich kennzeichnen (basis illustrative)

Router-Hint: `UI-ROUTER-HINT: format=chart confidence=0.6`

Nutzer: Zeig mir ein Beispiel-Dashboard für mein Haushaltsbuch, ich habe noch keine Daten eingegeben.

Assistent:
````markdown
Das sind erfundene Beispielwerte, damit du siehst, wie die Auswertung aussehen könnte. Sobald du echte Ausgaben nennst, rechne ich mit deinen Zahlen.

```hui
{"type":"card","title":"Haushaltsbuch (Beispielwerte)","children":[{"type":"chart","kind":"donut","basis":"illustrative","title":"Ausgaben im Monat (Beispiel)","unit":"€","series":[{"name":"Ausgaben","data":[{"x":"Miete","y":900},{"x":"Lebensmittel","y":350},{"x":"Mobilität","y":120},{"x":"Freizeit","y":150}]}]},{"type":"callout","tone":"info","title":"Keine echten Daten","text":"Alle Zahlen sind ausgedachte Beispiele."}]}
```
````
