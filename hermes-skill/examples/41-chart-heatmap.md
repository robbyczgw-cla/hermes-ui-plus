# 41 Heatmap (Aktivität über Tage)

Router-Hint: `UI-ROUTER-HINT: format=chart component=heatmap confidence=0.8 - Aktivität über Tage`

Nutzer: Hier meine Commits der letzten zwei Wochen pro Tag: 1.-5. Okt: 3, 5, 0, 2, 8; 6.-7. Okt: 0, 0; 8.-12. Okt: 4, 6, 7, 1, 0. Mach daraus eine Aktivitäts-Heatmap.

Assistent:
````markdown
Die aktivsten Tage waren der 5. und 10. Oktober, am Wochenende ruhte es komplett.

```hui
{"type":"chart","kind":"heatmap","title":"Commits pro Tag","basis":"user","series":[{"name":"Commits","data":[{"x":"2026-10-01","y":3},{"x":"2026-10-02","y":5},{"x":"2026-10-03","y":0},{"x":"2026-10-04","y":2},{"x":"2026-10-05","y":8},{"x":"2026-10-06","y":0},{"x":"2026-10-07","y":0},{"x":"2026-10-08","y":4},{"x":"2026-10-09","y":6},{"x":"2026-10-10","y":7},{"x":"2026-10-11","y":1},{"x":"2026-10-12","y":0}]}]}
```
````
