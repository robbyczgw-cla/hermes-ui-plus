# charts (all kinds)

{kind:"bar"|"line"|"area"|"pie"|"donut"|"hbar"|"stacked"|"scatter"|"radar"|"gauge"|"heatmap"|"waterfall", title?, unit?, xLabel?, yLabel?, min?, max?, target?, basis?, source?, series:[{name, data:[{x, y:number, y2?, label?, total?}]}]}  <= 8 categories / 60 points; pie/donut: ONE series. `basis`: user | sourced | calculated | estimate | illustrative (label sample values).
bar/line/area: trends and categories (several series ok). `hbar` ranking/long labels (sorted). `stacked` composition (>=2 series, same x). `scatter` correlation (numeric x,y, `label?`). `radar` multi-criteria profile (3-8 axes, series per entity, same axes, `max`). `gauge` ONE KPI vs target (one point, `min`,`max`,`target`). `heatmap` activity over days (x ISO date, y count; matrix: x column, `y2` row). `waterfall` budget flow (y delta, `total:true` sum bar).

{"type":"chart","kind":"line","title":"Temperature","unit":"°C","xLabel":"Month","series":[{"name":"Berlin","data":[{"x":"Jan","y":0.6},{"x":"Jul","y":19.2}]}]}
{"type":"chart","kind":"donut","title":"Spending","unit":"€","series":[{"name":"Spending","data":[{"x":"Rent","y":900},{"x":"Food","y":350},{"x":"Other","y":150}]}]}
{"type":"chart","kind":"radar","title":"Destination profile","max":10,"basis":"estimate","series":[{"name":"Berlin","data":[{"x":"Cost","y":6},{"x":"Culture","y":9},{"x":"Weather","y":5}]},{"name":"Lisbon","data":[{"x":"Cost","y":7},{"x":"Culture","y":8},{"x":"Weather","y":9}]}]}
{"type":"chart","kind":"gauge","title":"Running distance 2026","unit":"km","min":0,"max":2500,"target":2500,"basis":"user","series":[{"name":"Run","data":[{"x":"Kilometres","y":1800}]}]}
{"type":"chart","kind":"heatmap","title":"Commits per day","basis":"user","series":[{"name":"Commits","data":[{"x":"2026-10-05","y":8},{"x":"2026-10-06","y":0},{"x":"2026-10-07","y":3}]}]}
{"type":"chart","kind":"waterfall","title":"Monthly budget","unit":"€","basis":"user","series":[{"name":"Budget","data":[{"x":"Net pay","y":3200},{"x":"Rent","y":-1100},{"x":"Car","y":-260},{"x":"Left","y":1840,"total":true}]}]}
{"type":"chart","kind":"hbar","title":"Largest cities (millions)","basis":"estimate","series":[{"name":"Population","data":[{"x":"Berlin","y":3.7},{"x":"Hamburg","y":1.9}]}]}
{"type":"chart","kind":"scatter","title":"Study hours and score","xLabel":"Hours","yLabel":"Score","basis":"user","series":[{"name":"Students","data":[{"x":2,"y":54,"label":"Anna"},{"x":10,"y":88,"label":"Dana"}]}]}
stats sparkline: {"label":"Revenue","value":"€12.4M","trend":"up","sparkline":[9,10,10.5,11,12.4]}
