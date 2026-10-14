## Stromtarife im Vergleich

Ich habe drei Tarife gegenübergestellt. Der **günstigste** im ersten Jahr ist nicht automatisch der beste:

```hui
{
  "type": "table",
  "caption": "Preise bei 3.500 kWh/Jahr",
  "source": "Anbieterwebseiten, Stand heute",
  "columns": ["Tarif", "Arbeitspreis (ct/kWh)", "Grundpreis (€/Monat)", "Jahreskosten (€)"],
  "rows": [
    ["Öko Basic", 31.2, 11.9, 1235],
    ["Grün Flex", 33.5, 9.5, 1286],
    ["Stadtwerke Fix", "29,8", 14.9, "1.222"],
    ["Dynamisch", null, 8.0, null]
  ]
}
```

Probier selbst, wie sich dein Verbrauch auswirkt. Der Rechner nutzt `Math.round` und rechnet live:

```hui-html
<div style="font-family:var(--h-font);color:var(--h-text);padding:12px">
  <label>Verbrauch (kWh/Jahr): <input id="kwh" type="range" min="1000" max="8000" value="3500"></label>
  <output id="out">3500</output>
  <div id="res"></div>
</div>
<script>
  const tarife = { 'Öko Basic': [31.2, 11.9], 'Grün Flex': [33.5, 9.5], 'Stadtwerke Fix': [29.8, 14.9] };
  const kwh = document.getElementById('kwh');
  function render() {
    document.getElementById('out').textContent = kwh.value;
    document.getElementById('res').innerHTML = Object.entries(tarife)
      .map(([n, [a, g]]) => `<p>${n}: ${Math.round(kwh.value * a / 100 + g * 12)} €</p>`).join('');
  }
  kwh.addEventListener('input', render); render();
</script>
```

Beispiel für einen Markdown-Codeblock mit verschachtelten Backticks:

````markdown
```hui
{ "type": "text", "text": "Das ist nur ein Beispiel" }
```
````

Soll ich einen Wechsel vorbereiten?

```hui
{ "type": "buttons", "items": [
  { "label": "Ja, vorbereiten", "style": "primary", "action": { "type": "send", "text": "Ja, bitte Wechsel vorbereiten" } },
  { "label": "Link kopieren", "action": { "type": "copy", "text": "https://example.org/tarife" } },
  { "label": "Zum Anbieter", "style": "secondary", "action": { "type": "open_url", "url": "https://example.org" } }
] }
```
