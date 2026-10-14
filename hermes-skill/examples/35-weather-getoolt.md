# 35 Wetter mit Werkzeugdaten (weather)

Router-Hint: `UI-ROUTER-HINT: format=weather confidence=0.9 - Wetterabfrage`

Voraussetzung: Der Assistent hat die Werte per Wetter-Tool abgerufen (hier: Open-Meteo-Abruf, 2026-10-11 08:00). Ohne Tool-Daten: sagen, dass keine Daten vorliegen, keinen Knoten erfinden.

Nutzer: Wie wird das Wetter morgen in Ulm?

Assistent:
````markdown
Morgen wird es in Ulm mit bis zu 14 °C meist bewölkt, am Nachmittag ist mit Schauern zu rechnen. Ein Schirm lohnt sich.

```hui
{"type":"weather","location":"Ulm","unit":"C","current":{"temp":9,"condition":"cloudy","feelsLike":7,"wind":12,"humidity":78,"precip":20},"hourly":[{"time":"09:00","temp":9,"condition":"cloudy","precip":10},{"time":"12:00","temp":13,"condition":"cloudy","precip":20},{"time":"15:00","temp":14,"condition":"showers","precip":60},{"time":"18:00","temp":12,"condition":"rain","precip":70},{"time":"21:00","temp":10,"condition":"cloudy","precip":30}],"daily":[{"date":"2026-10-12","min":7,"max":14,"condition":"showers","precip":60},{"date":"2026-10-13","min":6,"max":13,"condition":"partly","precip":20},{"date":"2026-10-14","min":5,"max":12,"condition":"sunny","precip":5}],"source":"Open-Meteo, abgerufen 11.10.2026","basis":"sourced"}
```
````
