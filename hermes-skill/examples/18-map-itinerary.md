# 18 Rom-Tag als map mit Plan

Router-Hint: `UI-ROUTER-HINT: format=map component=route confidence=0.9`

Nutzer: Plan mir einen Tag in Rom mit den wichtigsten Sehenswürdigkeiten auf einer Karte.

Assistent:
````markdown
Ein Tag, vier Stationen in der Altstadt, alles zu Fuß machbar. Die Linie zeigt nur die Reihenfolge, keine Wegbeschreibung. Koordinaten sind ungefähr, Öffnungszeiten und Ticketpreise habe ich nicht geprüft.

```hui
{"type":"card","title":"Rom an einem Tag","children":[{"type":"map","id":"rom","basis":"estimate","route":true,"animate":true,"markers":[{"number":1,"lat":41.8902,"lng":12.4922,"title":"Kolosseum","description":"Morgens, Tickets vorab online","imageQuery":"Kolosseum"},{"number":2,"lat":41.8925,"lng":12.4853,"title":"Forum Romanum","description":"Gleiches Ticket wie das Kolosseum"},{"number":3,"lat":41.8986,"lng":12.4769,"title":"Pantheon","description":"Mittags, kurz hineinschauen"},{"number":4,"lat":41.9009,"lng":12.4833,"title":"Trevi-Brunnen","description":"Abends, dann ist es etwas ruhiger"}]},{"type":"timeline","items":[{"time":"09:00","title":"Kolosseum und Forum"},{"time":"13:00","title":"Mittagessen im Viertel Monti"},{"time":"15:00","title":"Pantheon"},{"time":"18:30","title":"Trevi-Brunnen"}]}]}
```
````
