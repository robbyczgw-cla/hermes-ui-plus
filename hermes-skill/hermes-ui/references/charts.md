# charts (all kinds)

{kind:"bar"|"line"|"area"|"pie"|"donut"|"hbar"|"stacked"|"scatter"|"radar"|"gauge"|"heatmap"|"waterfall", title?, unit?, xLabel?, yLabel?, min?, max?, target?, basis?, source?, series:[{name, data:[{x, y:number, y2?, label?, total?}]}]}  <= 8 categories / 60 points; pie/donut: ONE series. `basis`: user | sourced | calculated | estimate | illustrative (label sample values).
bar/line/area: trends and categories (several series ok). `hbar` ranking/long labels (sorted). `stacked` composition (>=2 series, same x). `scatter` correlation (numeric x,y, `label?`). `radar` multi-criteria profile (3-8 axes, series per entity, same axes, `max`). `gauge` ONE KPI vs target (one point, `min`,`max`,`target`). `heatmap` activity over days (x ISO date, y count; matrix: x column, `y2` row). `waterfall` budget flow (y delta, `total:true` sum bar).

{"type":"chart","kind":"line","title":"Temperatur","unit":"°C","xLabel":"Monat","series":[{"name":"Berlin","data":[{"x":"Jan","y":0.6},{"x":"Jul","y":19.2}]}]}
{"type":"chart","kind":"donut","title":"Ausgaben","unit":"€","series":[{"name":"Ausgaben","data":[{"x":"Miete","y":900},{"x":"Essen","y":350},{"x":"Sonstiges","y":150}]}]}
{"type":"chart","kind":"radar","title":"Reiseziel-Profil","max":10,"basis":"estimate","series":[{"name":"Berlin","data":[{"x":"Kosten","y":6},{"x":"Kultur","y":9},{"x":"Wetter","y":5}]},{"name":"Lissabon","data":[{"x":"Kosten","y":7},{"x":"Kultur","y":8},{"x":"Wetter","y":9}]}]}
{"type":"chart","kind":"gauge","title":"Laufkilometer 2026","unit":"km","min":0,"max":2500,"target":2500,"basis":"user","series":[{"name":"Gelaufen","data":[{"x":"Kilometer","y":1800}]}]}
{"type":"chart","kind":"heatmap","title":"Commits pro Tag","basis":"user","series":[{"name":"Commits","data":[{"x":"2026-10-05","y":8},{"x":"2026-10-06","y":0},{"x":"2026-10-07","y":3}]}]}
{"type":"chart","kind":"waterfall","title":"Monatsbudget","unit":"€","basis":"user","series":[{"name":"Budget","data":[{"x":"Netto","y":3200},{"x":"Miete","y":-1100},{"x":"Auto","y":-260},{"x":"Übrig","y":1840,"total":true}]}]}
{"type":"chart","kind":"hbar","title":"Größte Städte (Mio.)","basis":"estimate","series":[{"name":"Einwohner","data":[{"x":"Berlin","y":3.7},{"x":"Hamburg","y":1.9}]}]}
{"type":"chart","kind":"scatter","title":"Lernstunden und Note","xLabel":"Stunden","yLabel":"Note","basis":"user","series":[{"name":"Personen","data":[{"x":2,"y":3.7,"label":"Anna"},{"x":10,"y":1.7,"label":"Dana"}]}]}
stats sparkline: {"label":"Umsatz","value":"12,4 Mio. €","trend":"up","sparkline":[9,10,10.5,11,12.4]}
