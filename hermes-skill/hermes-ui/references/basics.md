# basic node examples (strict JSON, one per ```hui block)

card {title?, subtitle?, imageQuery?, children[]} · stack {direction?:"vertical"|"horizontal", gap?:"s"|"m"|"l", children[]} · text {text (inline md), variant?:"title"|"body"|"caption"|"mono"} · callout {tone:"info"|"success"|"warning"|"danger", title?, text} · progress {label, value, max?} · code {language?, code} · buttons {items:[{label, action, style?:"primary"|"secondary"}]}

card + text + callout
{"type":"card","title":"Backup status","subtitle":"Today 03:10","children":[{"type":"text","text":"Last run **succeeded**","variant":"body"},{"type":"callout","tone":"warning","title":"Storage","text":"Only 12 % free."}]}

stack (horizontal row of stats)
{"type":"stack","direction":"horizontal","gap":"m","children":[{"type":"stats","items":[{"label":"CPU","value":"23 %"},{"label":"RAM","value":"5.1 GB"}]}]}

stats
{"type":"stats","items":[{"label":"Visitors","value":"12,480","delta":"+4.2 %","trend":"up"},{"label":"Bounce rate","value":"38 %","delta":"-1 %","trend":"down"},{"label":"Duration","value":"2:14 min","trend":"flat"}]}

table
{"type":"table","caption":"Population (approx., 2023)","source":"Destatis","columns":["City","Population"],"rows":[["Berlin",3880000],["Hamburg",1890000]]}
list
{"type":"list","style":"check","items":[{"title":"Check passport","subtitle":"valid until 2029","icon":"passport"},{"title":"Pack","trailing":"Fri"}]}

steps (current is 0-based; omit for plain how-to)
{"type":"steps","current":1,"items":[{"title":"Install the app","detail":"From the Play Store"},{"title":"Sign in"},{"title":"Approve the device"}]}

timeline
{"type":"timeline","items":[{"time":"1957","title":"Sputnik 1","detail":"First satellite"},{"time":"1969","title":"Apollo 11"}]}

compare (highlight = recommended column). REQUIRED form for judging columns: every upside in `pros` (check), every downside in `cons` (minus); `items` only for neutral facts (price, weight, size → plain dot). The app does NOT guess from wording: a pro or con written into `items` shows as a neutral dot, so always sort them into `pros`/`cons`. Give each column at least one pro or con.
{"type":"compare","columns":[{"title":"Raspberry Pi 5","badge":"cheap","items":["~80 €","5-12 W"],"pros":["Very cheap","GPIO"],"cons":["SD card as system disk"]},{"title":"Mini PC N100","highlight":true,"badge":"Recommended","items":["~150 €","8-15 W"],"pros":["x86, real SSD","No SD wear"],"cons":["Uses more power"]}]}

image by query (app finds a real photo + credits; never invent URLs)
{"type":"image","query":"Matterhorn","caption":"The Matterhorn seen from Zermatt"}
gallery (2-6 photos, swipeable)
{"type":"gallery","items":[{"query":"Colosseum","caption":"Colosseum"},{"query":"Trevi Fountain","caption":"Trevi Fountain"},{"query":"Pantheon, Rome","caption":"Pantheon"}]}

thumbnails via imageQuery (list / timeline / steps items, card, compare columns)
{"type":"list","items":[{"title":"Tiramisu","subtitle":"Mascarpone, Espresso","trailing":"6 €","imageQuery":"Tiramisu"},{"title":"Carbonara","trailing":"14 €","imageQuery":"Spaghetti carbonara"}]}

progress
{"type":"progress","label":"Download","value":62,"max":100}

code
{"type":"code","language":"bash","code":"git rebase -i HEAD~3"}

buttons
{"type":"buttons","items":[{"label":"Details","action":{"type":"send","text":"Show me details"},"style":"primary"},{"label":"Copy command","action":{"type":"copy","text":"git status"}},{"label":"Docs","action":{"type":"open_url","url":"https://git-scm.com/docs"}}]}

suggestions (tap = sent as user message)
{"type":"suggestions","items":["Show as a chart","Last 12 months","Export"]}
Web images: `source:"web"` for what Wikipedia lacks (games, current products, movies, cars, apps); precise multi-word query, always a caption, never a made-up URL. Not with a `[hermes-ui-caps] image_search=off` line: then `{url, caption}` items with image URLs your extract tool returned (products reference, "Photos without web image search"), or text links.
{"type":"gallery","items":[{"query":"Octopath Traveler screenshot","source":"web","caption":"Part 1: HD-2D style"},{"query":"Octopath Traveler 2 screenshot","source":"web","caption":"Part 2: bigger scenery"}]}
{"type":"image","query":"Pixel 10 Pro back","source":"web","caption":"Back with the camera bar"}
