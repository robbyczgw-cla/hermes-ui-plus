Klar, ich brauche noch ein paar Angaben für die Reiseplanung 🙂

```hui
{
  "type": "form",
  "id": "reise",
  "title": "Reise nach Lissabon",
  "fields": [
    { "name": "ziel", "label": "Ziel", "kind": "text", "placeholder": "Stadt", "default": "Lissabon" },
    { "name": "start", "label": "Abreise", "kind": "date" },
    { "name": "personen", "label": "Personen", "kind": "number", "min": 1, "max": 8, "default": 2 },
    { "name": "budget", "label": "Budget", "kind": "slider", "min": 200, "max": 3000, "step": 50, "unit": "€", "default": 900 },
    { "name": "stil", "label": "Stil", "kind": "select", "options": ["Entspannt", "Aktiv", "Kulinarisch"] },
    { "name": "mietwagen", "label": "Mietwagen", "kind": "toggle", "default": false }
  ],
  "submit": { "label": "Plan erstellen" }
}
```

So gehe ich danach vor:

```hui
{ "type": "steps", "current": 1, "items": [
  { "title": "Angaben sammeln", "detail": "Formular oben ausfüllen" },
  { "title": "Flüge prüfen", "detail": "Direktverbindungen ab Basel/Zürich" },
  { "title": "Unterkunft wählen" },
  { "title": "Tagesplan erstellen" }
] }
```

Und hier eine Zeitleiste der Vorbereitung:

```hui
{ "type": "timeline", "items": [
  { "time": "8 Wochen vorher", "title": "Flüge buchen" },
  { "time": "4 Wochen vorher", "title": "Unterkunft", "detail": "Altstadt oder Belém" },
  { "time": "1 Woche vorher", "title": "Packliste" }
] }
```

```hui-html
<div style="padding:12px;font-family:var(--h-font)">
  <svg viewBox="0 0 200 60" width="100%"><rect x="2" y="2" width="196" height="56" rx="8" fill="none" stroke="var(--h-accent)"/><text x="100" y="35" text-anchor="middle" fill="var(--h-text)">Lissabon ✈</text></svg>
</div>
```
