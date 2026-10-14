Hier ist der Überblick für dein Wochenende in **Freiburg** – kurz gesagt: Samstag ist deutlich besser als Sonntag.

```hui
{
  "type": "card",
  "title": "Wetter Wochenende",
  "subtitle": "Freiburg im Breisgau",
  "children": [
    { "type": "stats", "items": [
      { "label": "Samstag", "value": "21 °C", "delta": "+3 °C", "trend": "up" },
      { "label": "Sonntag", "value": "14 °C", "delta": "-7 °C", "trend": "down" },
      { "label": "Regenrisiko", "value": "60 %", "trend": "flat" }
    ]},
    { "type": "chart", "kind": "line", "title": "Temperatur", "unit": "°C", "xLabel": "Uhrzeit",
      "series": [
        { "name": "Samstag", "data": [ {"x":"06:00","y":11}, {"x":"12:00","y":19}, {"x":"15:00","y":"21"}, {"x":"21:00","y":15} ] },
        { "name": "Sonntag", "data": [ {"x":"06:00","y":9}, {"x":"12:00","y":13}, {"x":"15:00","y":14}, {"x":"21:00","y":10} ] }
      ] },
    { "type": "callout", "tone": "warning", "title": "Gewitter möglich", "text": "Am Sonntag ab **16 Uhr** kann es kräftige Schauer geben." }
  ]
}
```

Wenn du magst, plane ich dir daraus eine Route:

```hui
{ "type": "suggestions", "items": ["Wanderung am Samstag planen", "Alternativen für Sonntag (drinnen)", "Wetter nächste Woche"] }
```
