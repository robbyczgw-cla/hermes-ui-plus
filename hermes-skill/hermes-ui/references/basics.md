# basic node examples (strict JSON, one per ```hui block)

card {title?, subtitle?, imageQuery?, children[]} · stack {direction?:"vertical"|"horizontal", gap?:"s"|"m"|"l", children[]} · text {text (inline md), variant?:"title"|"body"|"caption"|"mono"} · callout {tone:"info"|"success"|"warning"|"danger", title?, text} · progress {label, value, max?} · code {language?, code} · buttons {items:[{label, action, style?:"primary"|"secondary"}]}

card + text + callout
{"type":"card","title":"Backup-Status","subtitle":"Heute 03:10","children":[{"type":"text","text":"Letzter Lauf **erfolgreich**","variant":"body"},{"type":"callout","tone":"warning","title":"Speicher","text":"Nur noch 12 % frei."}]}

stack (horizontal row of stats)
{"type":"stack","direction":"horizontal","gap":"m","children":[{"type":"stats","items":[{"label":"CPU","value":"23 %"},{"label":"RAM","value":"5,1 GB"}]}]}

stats
{"type":"stats","items":[{"label":"Besucher","value":"12.480","delta":"+4,2 %","trend":"up"},{"label":"Absprungrate","value":"38 %","delta":"-1 %","trend":"down"},{"label":"Dauer","value":"2:14 min","trend":"flat"}]}

table
{"type":"table","caption":"Einwohner (ca., 2023)","source":"Destatis","columns":["Stadt","Einwohner"],"rows":[["Berlin",3880000],["Hamburg",1890000]]}
list
{"type":"list","style":"check","items":[{"title":"Pass prüfen","subtitle":"gültig bis 2029","icon":"passport"},{"title":"Packen","trailing":"Fr"}]}

steps (current is 0-based; omit for plain how-to)
{"type":"steps","current":1,"items":[{"title":"App installieren","detail":"Aus dem Play Store"},{"title":"Anmelden"},{"title":"Gerät freigeben"}]}

timeline
{"type":"timeline","items":[{"time":"1957","title":"Sputnik 1","detail":"Erster Satellit"},{"time":"1969","title":"Apollo 11"}]}

compare (highlight = recommended column). REQUIRED form for judging columns: every upside in `pros` (check), every downside in `cons` (minus); `items` only for neutral facts (price, weight, size → plain dot). The app does NOT guess from wording: a pro or con written into `items` shows as a neutral dot, so always sort them into `pros`/`cons`. Give each column at least one pro or con.
{"type":"compare","columns":[{"title":"Raspberry Pi 5","badge":"günstig","items":["ca. 80 €","5-12 W"],"pros":["Sehr günstig","GPIO"],"cons":["SD-Karte als Systemplatte"]},{"title":"Mini-PC N100","highlight":true,"badge":"Empfehlung","items":["ca. 150 €","8-15 W"],"pros":["x86, echte SSD","Kein Einbrennen"],"cons":["Mehr Verbrauch"]}]}

image by query (app finds a real photo + credits; never invent URLs)
{"type":"image","query":"Matterhorn","caption":"Das Matterhorn von Zermatt aus"}
gallery (2-6 photos, swipeable)
{"type":"gallery","items":[{"query":"Kolosseum","caption":"Kolosseum"},{"query":"Trevi-Brunnen","caption":"Trevi-Brunnen"},{"query":"Pantheon (Rom)","caption":"Pantheon"}]}

thumbnails via imageQuery (list / timeline / steps items, card, compare columns)
{"type":"list","items":[{"title":"Tiramisu","subtitle":"Mascarpone, Espresso","trailing":"6 €","imageQuery":"Tiramisu"},{"title":"Carbonara","trailing":"14 €","imageQuery":"Spaghetti carbonara"}]}

progress
{"type":"progress","label":"Download","value":62,"max":100}

code
{"type":"code","language":"bash","code":"git rebase -i HEAD~3"}

buttons
{"type":"buttons","items":[{"label":"Details","action":{"type":"send","text":"Zeig mir Details"},"style":"primary"},{"label":"Befehl kopieren","action":{"type":"copy","text":"git status"}},{"label":"Doku","action":{"type":"open_url","url":"https://git-scm.com/docs"}}]}

suggestions (tap = sent as user message)
{"type":"suggestions","items":["Als Diagramm zeigen","Letzte 12 Monate","Exportieren"]}
Web images: `source:"web"` for what Wikipedia lacks (games, current products, movies, cars, apps); precise multi-word query, always a caption, never a URL.
{"type":"gallery","items":[{"query":"Octopath Traveler screenshot","source":"web","caption":"Teil 1: HD-2D-Stil"},{"query":"Octopath Traveler 2 screenshot","source":"web","caption":"Teil 2: größere Kulissen"}]}
{"type":"image","query":"Pixel 10 Pro back","source":"web","caption":"Rückseite mit Kamerabalken"}
