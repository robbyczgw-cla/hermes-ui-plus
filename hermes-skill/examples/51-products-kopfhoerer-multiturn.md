# 51 Produkte: ANC-Kopfhörer bis 200 € (products, Antwort `[products:]`)

Router-Hint: `UI-ROUTER-HINT: format=products confidence=0.9`

Nutzer: Was sind die besten Noise-Cancelling-Kopfhörer unter 200 €?

Assistent (Runde 1; Annahme: Preise, Bewertungen und Händler-URLs stammen aus Websuche/Testseiten in diesem Turn. Beim zweiten Produkt fehlen Preis und Händler, weil die Quelle keine nannte: Felder bleiben weg):
````markdown
Für ANC bis 200 € liegen die Sony WH-1000XM5 vorn, die Anker Soundcore Space One sind die günstige Alternative. Preise schwanken, die hier genannten sind Stand heute und ohne Gewähr.

```hui
{"type":"products","id":"anc-200","title":"ANC-Kopfhörer bis 200 €","layout":"carousel","compare":true,"products":[{"name":"Sony WH-1000XM5","brand":"Sony","imageQuery":"Sony WH-1000XM5","price":199,"currency":"EUR","priceNote":"Stand 11.10.2026","rating":4.6,"reviews":3400,"badge":"Testsieger","specs":[{"label":"Akku","value":"30 h"},{"label":"Gewicht","value":"250 g"},{"label":"ANC","value":"Adaptiv"}],"pros":["Sehr gutes ANC","Bequem","Gutes Mikrofon"],"cons":["Nicht faltbar"],"offers":[{"merchant":"Händler A","price":199,"url":"https://example.org/xm5-a"},{"merchant":"Händler B","price":209,"url":"https://example.org/xm5-b"}]},{"name":"Soundcore Space One","brand":"Anker","imageQuery":"Soundcore Space One","price":99,"currency":"EUR","priceNote":"Stand 11.10.2026","rating":4.4,"reviews":5200,"badge":"Bester Preis","specs":[{"label":"Akku","value":"40 h"},{"label":"ANC","value":"Adaptiv"}],"pros":["Sehr günstig","Lange Laufzeit"],"cons":["Weniger Klangtiefe"],"offers":[{"merchant":"Händler A","price":99,"url":"https://example.org/space-one"}]},{"name":"Bose QuietComfort SE","brand":"Bose","imageQuery":"Bose QuietComfort SE","specs":[{"label":"Akku","value":"24 h"}],"pros":["Sehr bequem"]}],"source":"Websuche und Testberichte, abgerufen 11.10.2026","basis":"sourced"}
```
````

Nutzer (Runde 2, von der App gesendet):
`[products:anc-200] Favorit: Sony WH-1000XM5`

Assistent (Runde 2; Wahl bestätigen, kein neues Produkt-Node, nächsten Schritt anbieten):
````markdown
Gute Wahl, die XM5 sind der Allrounder in dieser Klasse. Ich kann dir noch Hüllen oder Ohrpolster dazu heraussuchen.

```hui
{"type":"suggestions","items":["Passende Hülle suchen","Wie lange hält der Akku wirklich?"]}
```
````
