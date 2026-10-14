# 48 Lange Recherche: summary zuerst, Fußnoten [^n], hui:-Links

Router-Hint: `UI-ROUTER-HINT: format=text confidence=0.6`

Nutzer: Lohnt sich ein Wochenende in Rom im November? Bitte mit Wetter, Preisen und Tipps, ausführlich und mit Quellen.

Assistent (Annahme: Zahlen und URLs stammen aus einer Websuche in diesem Turn; das `summary` steht ZUERST, danach die Details; Fußnoten verweisen auf die `sources`-Einträge, 1-basiert):
````markdown
Ja, der November ist eine gute Zeit für Rom: weniger Andrang, mildes Wetter und deutlich günstigere Unterkünfte als im Sommer.

```hui
{"type":"summary","text":"Rom im November lohnt sich: 12 bis 17 Grad, kürzere Warteschlangen und Hotels, die etwa ein Viertel günstiger sind als im Sommer. Rechne mit Regen und plane Indoor-Alternativen ein.","points":["Tagsüber 12-17 °C, häufiger Regen","Hotels im Schnitt ca. 25 % günstiger als im Juli","Kolosseum und Vatikan: Tickets vorab buchen"],"verdict":"Empfehlung: 3 Nächte, Museen für Regentage fest einplanen"}
```

## Wetter und Reisezeit
Im November liegen die Höchstwerte meist bei 15-17 °C, nachts wird es kühler, und es regnet an etwa jedem dritten Tag.[^1] Mitte November ist die Nebensaison, dadurch sind die Schlangen an den großen Sehenswürdigkeiten spürbar kürzer.[^2]

## Kosten
Ein Doppelzimmer im Dreisterne-Hotel kostet im November im Schnitt rund 95 € pro Nacht, im Juli liegt der Schnitt bei etwa 125 €.[^2] Das [Kolosseum](hui:place?q=Kolosseum%20Rom) kostet mit Forum und Palatin ein Kombiticket; der aktuelle Preis steht auf der offiziellen Seite.[^3]

## Tipps
- Das Kolosseum früh am Morgen besuchen, das Gedränge nimmt danach zu.
- Bei Regen: [Vatikanische Museen](hui:place?q=Vatikanische%20Museen%20Rom) und [Galleria Borghese](hui:place?q=Galleria%20Borghese%20Rom), beide mit Zeitfenster-Ticket.
- Flug-Check-in: [Sa, 14. Nov., 6:10](hui:date?start=2026-11-14T06:10&title=Flug%20nach%20Rom) als Beispiel für einen Frühflug, damit du den ganzen Tag vor Ort hast.

```hui
{"type":"sources","items":[{"title":"Klima und Wetter in Rom","url":"https://example.org/rom-klima","siteName":"example.org","snippet":"Monatliche Durchschnittswerte für Temperatur und Niederschlag"},{"title":"Hotelpreise Rom nach Monat","url":"https://example.org/rom-hotelpreise","siteName":"example.org"},{"title":"Kolosseum: Tickets und Öffnungszeiten","url":"https://example.org/kolosseum-tickets","siteName":"example.org"}]}
```
````
